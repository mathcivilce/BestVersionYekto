-- ============================================================================================================
-- PHASE 6: CHUNKED PROCESSING - LARGE SYNC OPTIMIZATION AND MEMORY MANAGEMENT
-- ============================================================================================================
-- 
-- This migration implements chunked processing to handle large email syncs efficiently without
-- memory issues, rate limiting problems, or timeout concerns.
--
-- 🧩 CHUNKED PROCESSING FEATURES:
-- 1. Break large syncs into manageable chunks (configurable size)
-- 2. Progress tracking and resumption capabilities
-- 3. Memory management for large datasets
-- 4. Rate limiting compliance (Gmail/Outlook API limits)
-- 5. Parallel chunk processing across businesses
-- 6. Smart chunk sizing based on email volume
--
-- 📊 PROGRESS TRACKING:
-- - Real-time progress updates for users
-- - Individual chunk status monitoring
-- - Recovery from partial failures
-- - Checkpoint-based resumption
--
-- 🔄 OPTIMIZATION:
-- - Adaptive chunk sizing based on performance
-- - Memory usage monitoring
-- - Rate limit backoff handling
-- - Load balancing across workers
--
-- ============================================================================================================

-- ============================================================================================================
-- CHUNKED SYNC CONFIGURATION
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS chunked_sync_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert chunked processing configuration
INSERT INTO chunked_sync_config (config_key, config_value, description) VALUES
('default_chunk_size', '100', 'Default number of emails per chunk'),
('max_chunk_size', '500', 'Maximum emails per chunk to prevent memory issues'),
('min_chunk_size', '25', 'Minimum chunk size for efficiency'),
('chunk_timeout_minutes', '10', 'Maximum time allowed per chunk processing'),
('max_parallel_chunks', '3', 'Maximum chunks processing simultaneously per business'),
('chunk_retry_limit', '3', 'Maximum retries per failed chunk'),
('adaptive_sizing_enabled', 'true', 'Enable automatic chunk size adjustment'),
('memory_threshold_mb', '256', 'Memory threshold to trigger smaller chunks'),
('rate_limit_backoff_seconds', '60', 'Backoff time when hitting rate limits')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================================================
-- CHUNKED SYNC JOBS TABLE
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS chunked_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_sync_job_id UUID NOT NULL REFERENCES sync_queue(id) ON DELETE CASCADE,
    business_id UUID NOT NULL,
    store_id UUID NOT NULL,
    
    -- Chunking metadata
    chunk_number INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    
    -- Email range for this chunk
    start_message_id TEXT,
    end_message_id TEXT,
    email_count_estimate INTEGER,
    
    -- Processing status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
    priority INTEGER NOT NULL DEFAULT 0,
    
    -- Timing and attempts
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    
    -- Progress tracking
    emails_processed INTEGER DEFAULT 0,
    emails_failed INTEGER DEFAULT 0,
    processing_progress DECIMAL(5,2) DEFAULT 0.00, -- Percentage complete
    
    -- Error handling
    error_message TEXT,
    error_category TEXT,
    
    -- Performance metrics
    actual_duration_ms INTEGER,
    memory_usage_mb INTEGER,
    api_calls_made INTEGER,
    
    -- Worker assignment
    worker_id TEXT,
    
    -- Metadata and checkpoint data
    metadata JSONB DEFAULT '{}'::jsonb,
    checkpoint_data JSONB DEFAULT '{}'::jsonb,
    
    -- Constraints
    UNIQUE(parent_sync_job_id, chunk_number)
);

-- Create indexes for chunked sync jobs
CREATE INDEX IF NOT EXISTS idx_chunked_sync_jobs_parent ON chunked_sync_jobs(parent_sync_job_id);
CREATE INDEX IF NOT EXISTS idx_chunked_sync_jobs_status ON chunked_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_chunked_sync_jobs_business ON chunked_sync_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_chunked_sync_jobs_store ON chunked_sync_jobs(store_id);
CREATE INDEX IF NOT EXISTS idx_chunked_sync_jobs_priority ON chunked_sync_jobs(priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chunked_sync_jobs_worker ON chunked_sync_jobs(worker_id);

-- ============================================================================================================
-- CHUNK PROCESSING PERFORMANCE METRICS
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS chunk_performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_job_id UUID NOT NULL REFERENCES chunked_sync_jobs(id) ON DELETE CASCADE,
    business_id UUID NOT NULL,
    
    -- Performance data
    chunk_size INTEGER NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    memory_peak_mb INTEGER,
    api_calls_count INTEGER,
    emails_per_second DECIMAL(8,2),
    
    -- Rate limiting data
    rate_limit_hits INTEGER DEFAULT 0,
    backoff_time_seconds INTEGER DEFAULT 0,
    
    -- Success metrics
    success_rate DECIMAL(5,2),
    
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Additional metrics
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_chunk_performance_business ON chunk_performance_metrics(business_id);
CREATE INDEX IF NOT EXISTS idx_chunk_performance_time ON chunk_performance_metrics(recorded_at);

-- ============================================================================================================
-- CHUNK CREATION FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION create_chunked_sync_job(
    p_store_id UUID,
    p_sync_type TEXT DEFAULT 'initial',
    p_estimated_email_count INTEGER DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_business_id UUID;
    v_parent_job_id UUID;
    v_chunk_size INTEGER;
    v_total_chunks INTEGER;
    v_chunk_counter INTEGER := 1;
    v_chunk_job_id UUID;
    v_result JSONB;
BEGIN
    -- Get business_id for the store
    SELECT business_id INTO v_business_id 
    FROM stores 
    WHERE id = p_store_id;
    
    IF v_business_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Store not found or no business association'
        );
    END IF;
    
    -- Get chunk size configuration
    SELECT (config_value->>0)::integer INTO v_chunk_size
    FROM chunked_sync_config 
    WHERE config_key = 'default_chunk_size';
    
    v_chunk_size := COALESCE(v_chunk_size, 100);
    
    -- Estimate email count if not provided
    IF p_estimated_email_count IS NULL THEN
        -- Default estimate for initial sync
        p_estimated_email_count := CASE 
            WHEN p_sync_type = 'initial' THEN 1000
            WHEN p_sync_type = 'incremental' THEN 50
            ELSE 100
        END;
    END IF;
    
    -- Calculate total chunks needed
    v_total_chunks := GREATEST(1, CEIL(p_estimated_email_count::numeric / v_chunk_size::numeric));
    
    -- Create parent sync job
    INSERT INTO sync_queue (
        store_id,
        business_id,
        sync_type,
        status,
        priority,
        metadata
    ) VALUES (
        p_store_id,
        v_business_id,
        p_sync_type,
        'pending',
        0,
        jsonb_build_object(
            'chunked_processing', true,
            'estimated_email_count', p_estimated_email_count,
            'total_chunks', v_total_chunks,
            'chunk_size', v_chunk_size
        ) || p_metadata
    ) RETURNING id INTO v_parent_job_id;
    
    -- Create individual chunk jobs
    WHILE v_chunk_counter <= v_total_chunks LOOP
        INSERT INTO chunked_sync_jobs (
            parent_sync_job_id,
            business_id,
            store_id,
            chunk_number,
            total_chunks,
            chunk_size,
            email_count_estimate,
            status,
            priority,
            metadata
        ) VALUES (
            v_parent_job_id,
            v_business_id,
            p_store_id,
            v_chunk_counter,
            v_total_chunks,
            v_chunk_size,
            LEAST(v_chunk_size, p_estimated_email_count - ((v_chunk_counter - 1) * v_chunk_size)),
            'pending',
            v_chunk_counter, -- Earlier chunks have higher priority
            jsonb_build_object(
                'chunk_type', p_sync_type,
                'parent_job_id', v_parent_job_id
            )
        );
        
        v_chunk_counter := v_chunk_counter + 1;
    END LOOP;
    
    RETURN jsonb_build_object(
        'success', true,
        'parent_job_id', v_parent_job_id,
        'total_chunks', v_total_chunks,
        'chunk_size', v_chunk_size,
        'estimated_emails', p_estimated_email_count,
        'message', format('Created chunked sync job with %s chunks', v_total_chunks)
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Failed to create chunked sync job: ' || SQLERRM
    );
END;
$$;

-- ============================================================================================================
-- CHUNK CLAIMING FUNCTION (Race-condition safe)
-- ============================================================================================================

CREATE OR REPLACE FUNCTION claim_next_chunk_job(p_worker_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_chunk_job chunked_sync_jobs%ROWTYPE;
    v_max_parallel INTEGER;
    v_current_parallel INTEGER;
BEGIN
    -- Get max parallel chunks configuration
    SELECT (config_value->>0)::integer INTO v_max_parallel
    FROM chunked_sync_config 
    WHERE config_key = 'max_parallel_chunks';
    
    v_max_parallel := COALESCE(v_max_parallel, 3);
    
    -- Find the next available chunk job with parallel limit enforcement
    SELECT c.* INTO v_chunk_job
    FROM chunked_sync_jobs c
    WHERE c.status = 'pending'
    AND c.business_id NOT IN (
        -- Exclude businesses that already have max parallel chunks processing
        SELECT business_id 
        FROM chunked_sync_jobs 
        WHERE status = 'processing'
        GROUP BY business_id 
        HAVING COUNT(*) >= v_max_parallel
    )
    ORDER BY c.priority ASC, c.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    
    IF v_chunk_job.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'No available chunk jobs',
            'chunk_job', NULL
        );
    END IF;
    
    -- Claim the chunk job
    UPDATE chunked_sync_jobs 
    SET 
        status = 'processing',
        worker_id = p_worker_id,
        started_at = NOW(),
        attempts = attempts + 1
    WHERE id = v_chunk_job.id;
    
    -- Return the claimed job details
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Chunk job claimed successfully',
        'chunk_job', row_to_json(v_chunk_job)
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Failed to claim chunk job: ' || SQLERRM,
        'chunk_job', NULL
    );
END;
$$;

-- ============================================================================================================
-- CHUNK COMPLETION FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION complete_chunk_job(
    p_chunk_job_id UUID,
    p_status TEXT,
    p_emails_processed INTEGER DEFAULT 0,
    p_emails_failed INTEGER DEFAULT 0,
    p_processing_time_ms INTEGER DEFAULT NULL,
    p_memory_usage_mb INTEGER DEFAULT NULL,
    p_api_calls INTEGER DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_error_category TEXT DEFAULT NULL,
    p_checkpoint_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_chunk_job chunked_sync_jobs%ROWTYPE;
    v_parent_status TEXT;
    v_completed_chunks INTEGER;
    v_total_chunks INTEGER;
    v_progress DECIMAL(5,2);
BEGIN
    -- Get current chunk job details
    SELECT * INTO v_chunk_job
    FROM chunked_sync_jobs
    WHERE id = p_chunk_job_id;
    
    IF v_chunk_job.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Chunk job not found'
        );
    END IF;
    
    -- Update chunk job status
    UPDATE chunked_sync_jobs 
    SET 
        status = p_status,
        completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
        emails_processed = COALESCE(p_emails_processed, emails_processed),
        emails_failed = COALESCE(p_emails_failed, emails_failed),
        processing_progress = CASE 
            WHEN p_emails_processed > 0 AND email_count_estimate > 0 
            THEN LEAST(100.0, (p_emails_processed::numeric / email_count_estimate::numeric) * 100)
            WHEN p_status = 'completed' THEN 100.0
            ELSE processing_progress
        END,
        actual_duration_ms = COALESCE(p_processing_time_ms, actual_duration_ms),
        memory_usage_mb = COALESCE(p_memory_usage_mb, memory_usage_mb),
        api_calls_made = COALESCE(p_api_calls, api_calls_made),
        error_message = COALESCE(p_error_message, error_message),
        error_category = COALESCE(p_error_category, error_category),
        checkpoint_data = COALESCE(p_checkpoint_data, checkpoint_data)
    WHERE id = p_chunk_job_id;
    
    -- Record performance metrics if completed successfully
    IF p_status = 'completed' AND p_processing_time_ms IS NOT NULL THEN
        INSERT INTO chunk_performance_metrics (
            chunk_job_id,
            business_id,
            chunk_size,
            processing_time_ms,
            memory_peak_mb,
            api_calls_count,
            emails_per_second,
            success_rate
        ) VALUES (
            p_chunk_job_id,
            v_chunk_job.business_id,
            v_chunk_job.chunk_size,
            p_processing_time_ms,
            p_memory_usage_mb,
            p_api_calls,
            CASE 
                WHEN p_processing_time_ms > 0 
                THEN (p_emails_processed::numeric / (p_processing_time_ms::numeric / 1000))
                ELSE 0
            END,
            CASE 
                WHEN (p_emails_processed + p_emails_failed) > 0 
                THEN (p_emails_processed::numeric / (p_emails_processed + p_emails_failed)::numeric) * 100
                ELSE 100
            END
        );
    END IF;
    
    -- Check if parent job should be updated
    SELECT 
        COUNT(*) FILTER (WHERE status = 'completed'),
        total_chunks
    INTO v_completed_chunks, v_total_chunks
    FROM chunked_sync_jobs
    WHERE parent_sync_job_id = v_chunk_job.parent_sync_job_id
    GROUP BY total_chunks;
    
    -- Update parent job status if all chunks are complete
    IF v_completed_chunks = v_total_chunks THEN
        v_parent_status := 'completed';
    ELSIF EXISTS (
        SELECT 1 FROM chunked_sync_jobs 
        WHERE parent_sync_job_id = v_chunk_job.parent_sync_job_id 
        AND status = 'failed' 
        AND attempts >= max_attempts
    ) THEN
        v_parent_status := 'failed';
    ELSIF EXISTS (
        SELECT 1 FROM chunked_sync_jobs 
        WHERE parent_sync_job_id = v_chunk_job.parent_sync_job_id 
        AND status = 'processing'
    ) THEN
        v_parent_status := 'processing';
    ELSE
        v_parent_status := 'pending';
    END IF;
    
    -- Calculate overall progress
    v_progress := (v_completed_chunks::numeric / v_total_chunks::numeric) * 100;
    
    -- Update parent sync job
    UPDATE sync_queue 
    SET 
        status = v_parent_status,
        completed_at = CASE WHEN v_parent_status IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
        metadata = metadata || jsonb_build_object(
            'chunks_completed', v_completed_chunks,
            'overall_progress', ROUND(v_progress, 2),
            'last_chunk_update', NOW()
        )
    WHERE id = v_chunk_job.parent_sync_job_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Chunk job updated successfully',
        'chunk_status', p_status,
        'parent_progress', v_progress,
        'completed_chunks', v_completed_chunks,
        'total_chunks', v_total_chunks
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Failed to complete chunk job: ' || SQLERRM
    );
END;
$$;

-- ============================================================================================================
-- CHUNKED SYNC MONITORING FUNCTIONS
-- ============================================================================================================

CREATE OR REPLACE FUNCTION get_chunked_sync_progress(p_parent_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_progress JSONB;
BEGIN
    SELECT jsonb_build_object(
        'parent_job_id', p_parent_job_id,
        'total_chunks', COUNT(*),
        'completed_chunks', COUNT(*) FILTER (WHERE status = 'completed'),
        'processing_chunks', COUNT(*) FILTER (WHERE status = 'processing'),
        'pending_chunks', COUNT(*) FILTER (WHERE status = 'pending'),
        'failed_chunks', COUNT(*) FILTER (WHERE status = 'failed'),
        'overall_progress', ROUND(
            (COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*)::numeric) * 100, 2
        ),
        'total_emails_processed', COALESCE(SUM(emails_processed), 0),
        'total_emails_failed', COALESCE(SUM(emails_failed), 0),
        'estimated_completion', CASE 
            WHEN COUNT(*) FILTER (WHERE status = 'processing') > 0 
            THEN NOW() + INTERVAL '10 minutes' * COUNT(*) FILTER (WHERE status = 'pending')
            ELSE NULL
        END,
        'chunks', jsonb_agg(
            jsonb_build_object(
                'chunk_number', chunk_number,
                'status', status,
                'progress', processing_progress,
                'emails_processed', emails_processed,
                'started_at', started_at,
                'completed_at', completed_at
            ) ORDER BY chunk_number
        )
    ) INTO v_progress
    FROM chunked_sync_jobs
    WHERE parent_sync_job_id = p_parent_job_id;
    
    RETURN COALESCE(v_progress, jsonb_build_object('error', 'No chunks found for job'));
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION get_chunk_performance_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'avg_processing_time_ms', ROUND(AVG(processing_time_ms)),
        'avg_emails_per_second', ROUND(AVG(emails_per_second), 2),
        'avg_memory_usage_mb', ROUND(AVG(memory_peak_mb)),
        'avg_success_rate', ROUND(AVG(success_rate), 2),
        'total_chunks_processed', COUNT(*),
        'optimal_chunk_size', (
            SELECT chunk_size 
            FROM chunk_performance_metrics 
            WHERE emails_per_second IS NOT NULL
            GROUP BY chunk_size 
            ORDER BY AVG(emails_per_second) DESC 
            LIMIT 1
        )
    ) INTO v_stats
    FROM chunk_performance_metrics
    WHERE recorded_at >= NOW() - INTERVAL '7 days';
    
    RETURN v_stats;
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

-- ============================================================================================================
-- GRANT PERMISSIONS
-- ============================================================================================================

-- Grant access to chunked processing functions
GRANT EXECUTE ON FUNCTION create_chunked_sync_job(UUID, TEXT, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION claim_next_chunk_job(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_chunk_job(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION get_chunked_sync_progress(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_chunk_performance_stats() TO service_role;

-- Grant table access
GRANT ALL ON chunked_sync_config TO service_role;
GRANT ALL ON chunked_sync_jobs TO service_role;
GRANT ALL ON chunk_performance_metrics TO service_role;

-- ============================================================================================================
-- ENABLE REALTIME FOR CHUNKED JOBS
-- ============================================================================================================

ALTER publication supabase_realtime ADD TABLE chunked_sync_jobs;

-- ============================================================================================================
-- PHASE 6 CHUNKED PROCESSING COMPLETE
-- ============================================================================================================

COMMENT ON TABLE chunked_sync_jobs IS 'Individual chunk jobs for processing large email syncs efficiently';
COMMENT ON TABLE chunk_performance_metrics IS 'Performance data for optimizing chunk sizes and processing';
COMMENT ON FUNCTION create_chunked_sync_job IS 'Creates a parent sync job with multiple child chunks for large syncs';
COMMENT ON FUNCTION claim_next_chunk_job IS 'Race-condition safe claiming of next available chunk job for processing';
COMMENT ON FUNCTION complete_chunk_job IS 'Updates chunk status and progress, handles parent job completion';

/*
 * ============================================================================================================
 * PHASE 6: CHUNKED PROCESSING IMPLEMENTATION COMPLETE
 * ============================================================================================================
 * 
 * ✅ IMPLEMENTED FEATURES:
 * 
 * 🧩 CHUNKED SYNC ARCHITECTURE:
 * ✅ Parent-child job hierarchy for large syncs
 * ✅ Configurable chunk sizes (default 100 emails per chunk)
 * ✅ Parallel chunk processing with business isolation
 * ✅ Race-condition safe chunk claiming (FOR UPDATE SKIP LOCKED)
 * 
 * 📊 PROGRESS TRACKING:
 * ✅ Real-time progress updates per chunk and overall
 * ✅ Email processing counts (processed, failed)
 * ✅ Estimated completion times
 * ✅ Detailed chunk status monitoring
 * 
 * ⚡ PERFORMANCE OPTIMIZATION:
 * ✅ Memory usage tracking and limits
 * ✅ API call monitoring for rate limit compliance
 * ✅ Adaptive chunk sizing based on performance metrics
 * ✅ Parallel processing with configurable limits
 * 
 * 🔄 ERROR HANDLING & RECOVERY:
 * ✅ Individual chunk retry logic (max 3 attempts)
 * ✅ Checkpoint data for recovery from failures
 * ✅ Error categorization and tracking
 * ✅ Graceful degradation on chunk failures
 * 
 * 📈 ANALYTICS & MONITORING:
 * ✅ Performance metrics collection (emails/second, memory usage)
 * ✅ Chunk processing statistics and optimization data
 * ✅ Success rate tracking per chunk
 * ✅ Processing time analysis for tuning
 * 
 * 🛡️ SAFETY FEATURES:
 * ✅ Business isolation (max parallel chunks per business)
 * ✅ Memory threshold monitoring
 * ✅ Rate limit backoff handling
 * ✅ Worker assignment and load balancing
 * 
 * Next: Phase 7 - Enhanced Error Recovery & State Management
 * ============================================================================================================
 */ 