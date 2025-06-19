-- Migration: Fix complete_chunk_job_safe function parameter name
-- Description: Update parameter from p_chunk_job_id to p_chunk_id for consistency with claim function

-- Drop the existing function
DROP FUNCTION IF EXISTS complete_chunk_job_safe(UUID, UUID, TEXT, INTEGER, INTEGER, INTEGER, TEXT);

-- Recreate with corrected parameter name
CREATE OR REPLACE FUNCTION complete_chunk_job_safe(
    p_chunk_id UUID,
    p_queue_id UUID,
    p_status TEXT,
    p_emails_processed INTEGER DEFAULT 0,
    p_emails_failed INTEGER DEFAULT 0,
    p_processing_time_ms INTEGER DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_parent_job_id UUID;
    v_completed_chunks INT;
    v_total_chunks INT;
    v_pending_chunks INT;
    v_webhook_url TEXT;
    v_webhook_payload JSONB;
BEGIN
    -- Update chunk status
    UPDATE chunked_sync_jobs
    SET 
        status = p_status,
        emails_processed = p_emails_processed,
        emails_failed = p_emails_failed,
        processing_time_ms = p_processing_time_ms,
        completed_at = CASE WHEN p_status = 'completed' THEN NOW() ELSE NULL END,
        error_message = p_error_message
    WHERE id = p_chunk_id
    RETURNING parent_sync_job_id INTO v_parent_job_id;
    
    -- Update the corresponding queue entry
    UPDATE chunk_processing_queue
    SET 
        status = p_status,
        completed_at = CASE WHEN p_status = 'completed' THEN NOW() ELSE NULL END,
        error_message = p_error_message
    WHERE chunk_id = p_chunk_id;
    
    -- Check overall progress
    SELECT 
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'pending'),
        MAX(total_chunks)
    INTO v_completed_chunks, v_pending_chunks, v_total_chunks
    FROM chunked_sync_jobs
    WHERE parent_sync_job_id = v_parent_job_id;
    
    -- Update parent job if all chunks are complete
    IF v_completed_chunks = v_total_chunks THEN
        UPDATE sync_queue
        SET 
            status = 'completed',
            completed_at = NOW(),
            metadata = metadata || jsonb_build_object(
                'chunks_completed', v_completed_chunks,
                'chunks_total', v_total_chunks,
                'completion_time', NOW()
            )
        WHERE id = v_parent_job_id;
        
        RAISE NOTICE 'All chunks completed for sync job %', v_parent_job_id;
        
    ELSIF p_status = 'completed' AND v_pending_chunks > 0 THEN
        -- If this chunk completed successfully and there are pending chunks, trigger webhook for next chunk
        v_webhook_url := 'https://vjkofswgtffzyeuiainf.supabase.co/functions/v1/unified-background-sync';
        
        v_webhook_payload := jsonb_build_object(
            'trigger_source', 'chunked_sync',
            'parent_sync_job_id', v_parent_job_id
        );
        
        -- Use the fixed net.http_post function
        PERFORM net.http_post(
            url := v_webhook_url,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqa29mc3dndGZmenlldWlhaW5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxNzg1OTg3NSwiZXhwIjoyMDMzNDM1ODc1fQ.H3mjYLzA4sdhTbmtqwL5HPXI0gSKJGdGv1dRNrAzYN0'
            ),
            body := v_webhook_payload
        );
        
        RAISE NOTICE 'Triggered webhook for next chunk processing: %', v_parent_job_id;
    END IF;
END;
$$ LANGUAGE plpgsql; 