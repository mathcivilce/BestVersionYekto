-- ============================================================================================================
-- EVENT-DRIVEN BACKGROUND SYNC QUEUE SYSTEM - IMMEDIATE PROCESSING
-- ============================================================================================================
-- 
-- This migration creates an event-driven background sync system that processes email synchronization
-- immediately when jobs are created, without waiting for cron jobs. Uses Supabase webhooks for
-- instant processing and real-time user experience.
--
-- 🎯 EVENT-DRIVEN BENEFITS:
-- - IMMEDIATE processing (0-second delay vs 1-2 minutes with cron)
-- - Resource efficient (only runs when needed)
-- - Auto-scaling (handles load spikes naturally)
-- - Better UX (users see sync start instantly)
-- - Simpler architecture (no worker coordination)
--
-- 🏗️ ARCHITECTURE:
-- 1. User connects email → Job inserted into sync_queue
-- 2. Database trigger → Webhook fired immediately
-- 3. Webhook → Calls background-sync-processor Edge Function
-- 4. Processor claims job and processes it immediately
-- 5. Real-time status updates via Supabase subscriptions
--
-- 🔄 MULTIPLE BUSINESS HANDLING:
-- - Different businesses = Simultaneous webhook processing
-- - Same business = Sequential processing (prevents rate limiting)
-- - Natural load balancing and fairness
--
-- Created: January 31, 2025
-- ============================================================================================================

-- ============================================================================================================
-- 1. ENHANCED SYNC QUEUE TABLE
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS sync_queue (
    -- PRIMARY IDENTIFIERS
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- BUSINESS CONTEXT (Multi-tenant isolation)
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, 
    business_id UUID NOT NULL,
    
    -- JOB CONFIGURATION
    sync_type TEXT NOT NULL DEFAULT 'initial',
    priority INTEGER NOT NULL DEFAULT 10,
    
    -- CHUNKED PROCESSING SUPPORT
    parent_job_id UUID REFERENCES sync_queue(id) ON DELETE CASCADE,
    chunk_info JSONB,
    
    -- SYNC PARAMETERS
    sync_from TIMESTAMPTZ,
    sync_to TIMESTAMPTZ,
    
    -- JOB STATUS AND LIFECYCLE
    status TEXT NOT NULL DEFAULT 'pending',
    
    -- RETRY AND ERROR HANDLING
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_message TEXT,
    error_category TEXT,
    
    -- TIMING AND PERFORMANCE TRACKING
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- WORKER AND PROCESSING METADATA
    worker_id TEXT,
    processing_node TEXT,
    estimated_duration_ms INTEGER,
    actual_duration_ms INTEGER,
    
    -- WEBHOOK TRACKING
    webhook_triggered_at TIMESTAMPTZ,
    webhook_response_status INTEGER,
    webhook_attempts INTEGER DEFAULT 0,
    
    -- RESULT AND ANALYTICS METADATA
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- CONSTRAINTS
    CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    CONSTRAINT valid_sync_type CHECK (sync_type IN ('initial', 'incremental', 'manual', 'chunk', 'retry')),
    CONSTRAINT valid_priority CHECK (priority >= 1 AND priority <= 30),
    CONSTRAINT valid_attempts CHECK (attempts >= 0 AND attempts <= max_attempts)
);

-- ============================================================================================================
-- 2. PERFORMANCE INDEXES
-- ============================================================================================================

-- Primary processing index
CREATE INDEX IF NOT EXISTS idx_sync_queue_processing 
ON sync_queue(status, priority DESC, created_at) 
WHERE status = 'pending';

-- Business isolation index  
CREATE INDEX IF NOT EXISTS idx_sync_queue_business 
ON sync_queue(business_id, status, created_at DESC);

-- Store-specific queries
CREATE INDEX IF NOT EXISTS idx_sync_queue_store 
ON sync_queue(store_id, status, created_at DESC);

-- Webhook monitoring
CREATE INDEX IF NOT EXISTS idx_sync_queue_webhook 
ON sync_queue(webhook_triggered_at, webhook_response_status) 
WHERE webhook_triggered_at IS NOT NULL;

-- ============================================================================================================
-- 3. UNIQUE CONSTRAINTS FOR DUPLICATE PREVENTION
-- ============================================================================================================

-- Prevent duplicate active sync jobs per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_unique_active 
ON sync_queue(store_id, sync_type) 
WHERE status IN ('pending', 'processing');

-- ============================================================================================================
-- 4. ATOMIC JOB CLAIMING FUNCTION (WEBHOOK VERSION)
-- ============================================================================================================

CREATE OR REPLACE FUNCTION claim_next_sync_job(
    worker_id TEXT,
    target_business_id UUID DEFAULT NULL
)
RETURNS TABLE(
    id UUID,
    store_id UUID,
    user_id UUID,
    business_id UUID,
    sync_type TEXT,
    sync_from TIMESTAMPTZ,
    sync_to TIMESTAMPTZ,
    chunk_info JSONB,
    metadata JSONB,
    attempts INTEGER,
    priority INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_time TIMESTAMPTZ := NOW();
BEGIN
    -- Reset stuck jobs first
    UPDATE sync_queue 
    SET status = 'pending', worker_id = NULL
    WHERE status = 'processing' 
    AND started_at < current_time - INTERVAL '10 minutes';
    
    -- Claim next job (with business targeting for webhooks)
    RETURN QUERY
    UPDATE sync_queue 
    SET 
        status = 'processing',
        started_at = current_time,
        attempts = attempts + 1,
        worker_id = claim_next_sync_job.worker_id,
        metadata = metadata || jsonb_build_object(
            'claimed_at', current_time,
            'claimed_by_worker', claim_next_sync_job.worker_id
        )
    WHERE sync_queue.id = (
        SELECT sq.id 
        FROM sync_queue sq
        WHERE sq.status = 'pending' 
        AND sq.attempts < sq.max_attempts
        AND (target_business_id IS NULL OR sq.business_id = target_business_id)
        AND NOT EXISTS (
            -- Prevent multiple jobs for same business (rate limiting)
            SELECT 1 FROM sync_queue sq2 
            WHERE sq2.business_id = sq.business_id 
            AND sq2.status = 'processing'
        )
        ORDER BY sq.priority DESC, sq.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING 
        sync_queue.id, sync_queue.store_id, sync_queue.user_id, sync_queue.business_id,
        sync_queue.sync_type, sync_queue.sync_from, sync_queue.sync_to, 
        sync_queue.chunk_info, sync_queue.metadata, sync_queue.attempts, sync_queue.priority;
END;
$$;

-- ============================================================================================================
-- 5. JOB COMPLETION FUNCTIONS
-- ============================================================================================================

CREATE OR REPLACE FUNCTION complete_sync_job(
    job_id UUID,
    result_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    processing_duration_ms INTEGER;
BEGIN
    UPDATE sync_queue 
    SET 
        status = 'completed',
        completed_at = NOW(),
        actual_duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
        metadata = metadata || result_metadata
    WHERE id = job_id;
    
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fail_sync_job(
    job_id UUID,
    error_message TEXT,
    error_category TEXT DEFAULT 'system_error'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    job_record RECORD;
    new_status TEXT;
BEGIN
    SELECT * INTO job_record FROM sync_queue WHERE id = job_id;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Determine if retry needed
    IF job_record.attempts < job_record.max_attempts AND error_category NOT IN ('auth_failure', 'user_cancelled') THEN
        new_status := 'pending'; -- Will trigger webhook again
    ELSE
        new_status := 'failed';
    END IF;
    
    UPDATE sync_queue 
    SET 
        status = new_status,
        completed_at = CASE WHEN new_status = 'failed' THEN NOW() ELSE NULL END,
        error_message = fail_sync_job.error_message,
        error_category = fail_sync_job.error_category,
        actual_duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
    WHERE id = job_id;
    
    RETURN TRUE;
END;
$$;

-- ============================================================================================================
-- 6. WEBHOOK TRIGGER FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION trigger_sync_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    webhook_url TEXT;
    webhook_payload JSONB;
    webhook_response RECORD;
BEGIN
    -- Only trigger for pending jobs (including retries)
    IF NEW.status != 'pending' THEN
        RETURN NEW;
    END IF;
    
    -- Construct webhook URL
    webhook_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/background-sync-processor';
    
    -- Prepare webhook payload
    webhook_payload := jsonb_build_object(
        'job_id', NEW.id,
        'business_id', NEW.business_id,
        'store_id', NEW.store_id,
        'sync_type', NEW.sync_type,
        'priority', NEW.priority,
        'triggered_at', NOW()
    );
    
    -- Fire webhook asynchronously
    PERFORM net.http_post(
        url := webhook_url,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := webhook_payload::text
    );
    
    -- Update webhook tracking
    NEW.webhook_triggered_at := NOW();
    NEW.webhook_attempts := COALESCE(NEW.webhook_attempts, 0) + 1;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log webhook failure but don't block the insert
    RAISE WARNING 'Webhook trigger failed for job %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================================================================
-- 7. CREATE WEBHOOK TRIGGER
-- ============================================================================================================

-- Trigger webhook on job creation and retry
CREATE TRIGGER sync_queue_webhook_trigger
    AFTER INSERT OR UPDATE OF status ON sync_queue
    FOR EACH ROW
    EXECUTE FUNCTION trigger_sync_webhook();

-- ============================================================================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================================================================

ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

-- User access policy
CREATE POLICY sync_queue_user_access ON sync_queue
    FOR ALL TO authenticated
    USING (business_id = (SELECT business_id FROM user_profiles WHERE user_id = auth.uid()));

-- Service role policy  
CREATE POLICY sync_queue_service_access ON sync_queue
    FOR ALL TO service_role
    USING (true);

-- ============================================================================================================
-- 9. MONITORING FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION get_sync_queue_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    stats JSONB;
BEGIN
    WITH queue_stats AS (
        SELECT 
            COUNT(*) as total_jobs,
            COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
            COUNT(*) FILTER (WHERE status = 'processing') as processing_jobs,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
            COUNT(DISTINCT business_id) as active_businesses,
            AVG(actual_duration_ms) FILTER (WHERE status = 'completed') as avg_duration_ms
        FROM sync_queue
        WHERE created_at > NOW() - INTERVAL '24 hours'
    )
    SELECT jsonb_build_object(
        'timestamp', NOW(),
        'total_jobs', total_jobs,
        'pending_jobs', pending_jobs, 
        'processing_jobs', processing_jobs,
        'completed_jobs', completed_jobs,
        'failed_jobs', failed_jobs,
        'active_businesses', active_businesses,
        'avg_duration_ms', COALESCE(avg_duration_ms, 0),
        'queue_health', CASE 
            WHEN pending_jobs > 10 THEN 'backlog'
            WHEN processing_jobs = 0 AND pending_jobs > 0 THEN 'webhook_issues'
            ELSE 'healthy'
        END
    ) INTO stats
    FROM queue_stats;
    
    RETURN stats;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION claim_next_sync_job TO service_role;
GRANT EXECUTE ON FUNCTION complete_sync_job TO service_role;
GRANT EXECUTE ON FUNCTION fail_sync_job TO service_role;
GRANT EXECUTE ON FUNCTION get_sync_queue_stats TO service_role;

-- ============================================================================================================
-- MIGRATION COMPLETION
-- ============================================================================================================

DO $$
BEGIN
    RAISE LOG 'Event-driven sync queue system migration completed';
    RAISE LOG 'Webhook-based immediate processing ready';
END;
$$; 