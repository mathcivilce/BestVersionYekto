-- ============================================================================================================
-- SAFE CHUNK PROCESSING SYSTEM - COMPLETE IMPLEMENTATION
-- ============================================================================================================
-- This is the safest approach for email sync chunk processing
-- It combines webhooks with a proper queue system for maximum reliability
-- ============================================================================================================

-- 1. Create a processing queue table (if not exists)
CREATE TABLE IF NOT EXISTS chunk_processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES chunked_sync_jobs(id),
    parent_sync_job_id UUID NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    worker_id TEXT,
    UNIQUE(chunk_id)
);

-- Create indexes for efficient queue operations
CREATE INDEX IF NOT EXISTS idx_queue_status_created 
    ON chunk_processing_queue(status, created_at) 
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_parent_sync_job 
    ON chunk_processing_queue(parent_sync_job_id);

-- 2. Modify your chunk creation to also create queue entries
CREATE OR REPLACE FUNCTION create_chunk_queue_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- When a chunk is created, create a queue entry
    INSERT INTO chunk_processing_queue (
        chunk_id,
        parent_sync_job_id,
        status,
        max_attempts
    ) VALUES (
        NEW.id,
        NEW.parent_sync_job_id,
        'pending',
        3
    ) ON CONFLICT (chunk_id) DO NOTHING;
    
    RETURN NEW;
END;
$$;

-- Create trigger for queue entry creation
DROP TRIGGER IF EXISTS create_chunk_queue_trigger ON chunked_sync_jobs;
CREATE TRIGGER create_chunk_queue_trigger
    AFTER INSERT ON chunked_sync_jobs
    FOR EACH ROW
EXECUTE FUNCTION create_chunk_queue_entries();

-- 3. Enhanced claim function that uses the queue
CREATE OR REPLACE FUNCTION claim_next_chunk_job_safe(p_worker_id TEXT)
RETURNS TABLE (
    success BOOLEAN,
    chunk_job JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_queue_entry RECORD;
    v_chunk RECORD;
    v_sync_job RECORD;
BEGIN
    -- Claim the next available queue entry
    WITH claimed_entry AS (
        UPDATE chunk_processing_queue
        SET 
            status = 'processing',
            started_at = NOW(),
            worker_id = p_worker_id,
            attempts = attempts + 1
        WHERE id = (
            SELECT id
            FROM chunk_processing_queue
            WHERE status = 'pending'
              AND attempts < max_attempts
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    )
    SELECT * INTO v_queue_entry FROM claimed_entry;
    
    -- If no entry found, return failure
    IF v_queue_entry.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::JSONB;
        RETURN;
    END IF;
    
    -- Get the chunk details
    SELECT * INTO v_chunk
    FROM chunked_sync_jobs
    WHERE id = v_queue_entry.chunk_id;
    
    -- Get sync job details for additional context
    SELECT * INTO v_sync_job
    FROM sync_queue
    WHERE id = v_chunk.parent_sync_job_id;
    
    -- Update chunk status
    UPDATE chunked_sync_jobs
    SET 
        status = 'processing',
        started_at = NOW(),
        attempts = v_queue_entry.attempts,
        worker_id = p_worker_id
    WHERE id = v_chunk.id;
    
    -- Return success with chunk details
    RETURN QUERY SELECT 
        true,
        jsonb_build_object(
            'queue_id', v_queue_entry.id,
            'chunk_id', v_chunk.id,
            'store_id', v_chunk.store_id,
            'business_id', v_chunk.business_id,
            'parent_sync_job_id', v_chunk.parent_sync_job_id,
            'chunk_index', v_chunk.chunk_number,
            'total_chunks', v_chunk.total_chunks,
            'start_offset', ((v_chunk.chunk_number - 1) * v_chunk.chunk_size),
            'end_offset', ((v_chunk.chunk_number - 1) * v_chunk.chunk_size) + v_chunk.chunk_size - 1,
            'estimated_emails', v_chunk.email_count_estimate,
            'sync_type', v_sync_job.sync_type,
            'sync_from', v_sync_job.sync_from,
            'sync_to', v_sync_job.sync_to,
            'attempts', v_queue_entry.attempts,
            'max_attempts', v_queue_entry.max_attempts
        );
END;
$$;

-- 4. Enhanced completion function
CREATE OR REPLACE FUNCTION complete_chunk_job_safe(
    p_chunk_job_id UUID,
    p_queue_id UUID,
    p_status TEXT,
    p_emails_processed INT DEFAULT 0,
    p_emails_failed INT DEFAULT 0,
    p_processing_time_ms INT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Update chunk status
    UPDATE chunked_sync_jobs
    SET 
        status = p_status,
        emails_processed = p_emails_processed,
        emails_failed = p_emails_failed,
        actual_duration_ms = p_processing_time_ms,
        completed_at = CASE WHEN p_status = 'completed' THEN NOW() ELSE NULL END,
        error_message = p_error_message
    WHERE id = p_chunk_job_id;
    
    -- Update queue entry
    UPDATE chunk_processing_queue
    SET 
        status = p_status,
        completed_at = CASE WHEN p_status = 'completed' THEN NOW() ELSE NULL END,
        error_message = p_error_message
    WHERE id = p_queue_id;
    
    -- If this chunk completed successfully, check if we should trigger next chunk
    IF p_status = 'completed' THEN
        PERFORM trigger_next_chunk_processing(
            (SELECT parent_sync_job_id FROM chunked_sync_jobs WHERE id = p_chunk_job_id)
        );
    END IF;
END;
$$;

-- 5. Function to trigger next chunk processing
CREATE OR REPLACE FUNCTION trigger_next_chunk_processing(p_parent_sync_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_pending_count INT;
    v_webhook_url TEXT;
    v_webhook_payload JSONB;
BEGIN
    -- Check if there are pending chunks
    SELECT COUNT(*) INTO v_pending_count
    FROM chunk_processing_queue cpq
    JOIN chunked_sync_jobs csj ON cpq.chunk_id = csj.id
    WHERE csj.parent_sync_job_id = p_parent_sync_job_id
      AND cpq.status = 'pending';
    
    IF v_pending_count > 0 THEN
        -- Trigger webhook for next chunk
        v_webhook_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/background-sync-processor';
        
        v_webhook_payload := jsonb_build_object(
            'trigger_source', 'chunk_completion',
            'parent_sync_job_id', p_parent_sync_job_id
        );
        
        PERFORM net.http_post(
            url := v_webhook_url,
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
                'Content-Type', 'application/json'
            ),
            body := v_webhook_payload::text
        );
        
        RAISE NOTICE 'Triggered webhook for next chunk processing: %', p_parent_sync_job_id;
    ELSE
        -- All chunks completed, update parent sync job
        UPDATE sync_queue
        SET 
            status = 'completed',
            completed_at = NOW()
        WHERE id = p_parent_sync_job_id
          AND NOT EXISTS (
              SELECT 1 FROM chunk_processing_queue cpq
              JOIN chunked_sync_jobs csj ON cpq.chunk_id = csj.id
              WHERE csj.parent_sync_job_id = p_parent_sync_job_id
                AND cpq.status != 'completed'
          );
        
        RAISE NOTICE 'All chunks completed for sync job %', p_parent_sync_job_id;
    END IF;
END;
$$;

-- 6. Webhook trigger for initial sync job
CREATE OR REPLACE FUNCTION trigger_sync_webhook_safe()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    webhook_url TEXT;
    webhook_payload JSONB;
BEGIN
    -- Only trigger for pending jobs
    IF NEW.status != 'pending' THEN
        RETURN NEW;
    END IF;
    
    -- Construct webhook URL
    webhook_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/background-sync-processor';
    
    -- Build payload
    webhook_payload := jsonb_build_object(
        'trigger_source', 'sync_queue',
        'parent_sync_job_id', NEW.id,
        'store_id', NEW.store_id
    );
    
    -- Fire webhook
    PERFORM net.http_post(
        url := webhook_url,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := webhook_payload::text
    );
    
    RETURN NEW;
END;
$$;

-- Update existing trigger
DROP TRIGGER IF EXISTS sync_queue_webhook_trigger ON sync_queue;
CREATE TRIGGER sync_queue_webhook_trigger
    AFTER INSERT OR UPDATE OF status ON sync_queue
    FOR EACH ROW
EXECUTE FUNCTION trigger_sync_webhook_safe();

-- 7. Monitoring views
CREATE OR REPLACE VIEW chunk_processing_status AS
SELECT 
    cj.parent_sync_job_id,
    cj.store_id,
    COUNT(*) FILTER (WHERE cpq.status = 'pending') AS pending_chunks,
    COUNT(*) FILTER (WHERE cpq.status = 'processing') AS processing_chunks,
    COUNT(*) FILTER (WHERE cpq.status = 'completed') AS completed_chunks,
    COUNT(*) FILTER (WHERE cpq.status = 'failed') AS failed_chunks,
    COUNT(*) AS total_chunks,
    MIN(cpq.created_at) AS started_at,
    MAX(cpq.completed_at) AS last_completed_at,
    CASE 
        WHEN COUNT(*) FILTER (WHERE cpq.status != 'completed') = 0 THEN 'completed'
        WHEN COUNT(*) FILTER (WHERE cpq.status = 'processing') > 0 THEN 'processing'
        WHEN COUNT(*) FILTER (WHERE cpq.status = 'failed') > 0 THEN 'partial_failure'
        ELSE 'pending'
    END AS overall_status,
    ROUND((COUNT(*) FILTER (WHERE cpq.status = 'completed')::numeric / COUNT(*)::numeric) * 100, 2) AS progress_percentage
FROM chunked_sync_jobs cj
JOIN chunk_processing_queue cpq ON cj.id = cpq.chunk_id
GROUP BY cj.parent_sync_job_id, cj.store_id;

-- 8. Cleanup function for stuck jobs
CREATE OR REPLACE FUNCTION cleanup_stuck_chunks()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT;
BEGIN
    -- Reset chunks that have been processing for more than 10 minutes
    WITH reset_chunks AS (
        UPDATE chunk_processing_queue
        SET 
            status = 'pending',
            error_message = 'Reset due to timeout'
        WHERE status = 'processing'
          AND started_at < NOW() - INTERVAL '10 minutes'
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM reset_chunks;
    
    -- Also reset the chunked_sync_jobs status
    UPDATE chunked_sync_jobs
    SET status = 'pending'
    WHERE status = 'processing'
      AND started_at < NOW() - INTERVAL '10 minutes';
    
    RETURN v_count;
END;
$$;

-- 9. Helper function to check sync job progress
CREATE OR REPLACE FUNCTION get_sync_job_progress(p_parent_sync_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'parent_sync_job_id', parent_sync_job_id,
        'store_id', store_id,
        'total_chunks', total_chunks,
        'pending_chunks', pending_chunks,
        'processing_chunks', processing_chunks,
        'completed_chunks', completed_chunks,
        'failed_chunks', failed_chunks,
        'overall_status', overall_status,
        'progress_percentage', progress_percentage,
        'started_at', started_at,
        'last_completed_at', last_completed_at
    ) INTO v_result
    FROM chunk_processing_status
    WHERE parent_sync_job_id = p_parent_sync_job_id;
    
    RETURN COALESCE(v_result, jsonb_build_object('error', 'Sync job not found'));
END;
$$;

-- Grant necessary permissions
GRANT ALL ON chunk_processing_queue TO service_role;
GRANT SELECT ON chunk_processing_status TO service_role, authenticated;

-- Add RLS policies
ALTER TABLE chunk_processing_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chunk_processing_queue_policy" ON chunk_processing_queue
FOR ALL USING (
  auth.uid() IN (
    SELECT user_id FROM stores WHERE id = (
      SELECT store_id FROM chunked_sync_jobs WHERE id = chunk_id
    )
  )
);

-- Schedule cleanup (run every 5 minutes to reset stuck chunks)
-- Uncomment if you want automatic cleanup
-- SELECT cron.schedule('cleanup-stuck-chunks', '*/5 * * * *', 'SELECT cleanup_stuck_chunks();');

-- ============================================================================================================
-- SAFE CHUNK PROCESSING SYSTEM COMPLETE
-- ============================================================================================================

COMMENT ON TABLE chunk_processing_queue IS 'Safe queue system for processing email sync chunks without Edge Function timeout issues';
COMMENT ON FUNCTION claim_next_chunk_job_safe IS 'Safely claims next chunk from queue with race condition protection';
COMMENT ON FUNCTION complete_chunk_job_safe IS 'Marks chunk as complete and triggers next chunk processing via webhook';
COMMENT ON FUNCTION trigger_next_chunk_processing IS 'Database-driven orchestration to trigger next chunk webhook';
COMMENT ON VIEW chunk_processing_status IS 'Real-time view of chunk processing progress across all sync jobs'; 