-- Migration: Fix race condition in sync job completion check
-- Description: Add atomic function to safely check if all chunks are completed and mark parent job as completed

-- Create atomic function to check and complete sync jobs
CREATE OR REPLACE FUNCTION check_and_complete_sync_job(
    p_parent_sync_job_id UUID,
    p_current_chunk_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_total_chunks INT;
    v_completed_chunks INT;
    v_pending_chunks INT;
    v_failed_chunks INT;
    v_processing_chunks INT;
    v_parent_status TEXT;
    v_was_completed BOOLEAN := FALSE;
    v_should_trigger_webhook BOOLEAN := FALSE;
    v_webhook_url TEXT;
    v_webhook_payload JSONB;
BEGIN
    -- Get current parent job status first (with row lock to prevent concurrent updates)
    SELECT status INTO v_parent_status
    FROM sync_queue 
    WHERE id = p_parent_sync_job_id
    FOR UPDATE;
    
    -- If parent is already completed, return early
    IF v_parent_status = 'completed' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'parent_status', v_parent_status,
            'action_taken', 'none'
        );
    END IF;
    
    -- Count chunk statuses atomically (with consistent read)
    SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'processing') as processing
    INTO v_total_chunks, v_completed_chunks, v_pending_chunks, v_failed_chunks, v_processing_chunks
    FROM chunked_sync_jobs
    WHERE parent_sync_job_id = p_parent_sync_job_id;
    
    -- Check if all chunks are completed
    IF v_completed_chunks = v_total_chunks AND v_total_chunks > 0 THEN
        -- Atomically update parent job to completed (only if not already completed)
        UPDATE sync_queue
        SET 
            status = 'completed',
            completed_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'chunks_completed', v_completed_chunks,
                'chunks_total', v_total_chunks,
                'completion_time', NOW(),
                'completed_by_chunk', p_current_chunk_id,
                'race_condition_protected', true
            )
        WHERE id = p_parent_sync_job_id 
        AND status != 'completed'  -- Double-check to prevent race condition
        RETURNING true INTO v_was_completed;
        
        -- If we successfully marked it as completed
        IF v_was_completed THEN
            RAISE NOTICE 'Sync job % marked as completed by chunk % (total: %, completed: %)', 
                p_parent_sync_job_id, p_current_chunk_id, v_total_chunks, v_completed_chunks;
        END IF;
        
    ELSIF v_completed_chunks < v_total_chunks AND v_pending_chunks > 0 THEN
        -- There are still pending chunks, trigger webhook for next chunk processing
        v_should_trigger_webhook := TRUE;
        v_webhook_url := 'https://vjkofswgtffzyeuiainf.supabase.co/functions/v1/unified-background-sync';
        
        v_webhook_payload := jsonb_build_object(
            'trigger_source', 'completion_check',
            'parent_sync_job_id', p_parent_sync_job_id,
            'completed_chunk_id', p_current_chunk_id,
            'chunks_remaining', v_pending_chunks
        );
        
        -- Trigger webhook for next chunk processing
        PERFORM net.http_post(
            url := v_webhook_url,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqa29mc3dndGZmenlldWlhaW5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxNzg1OTg3NSwiZXhwIjoyMDMzNDM1ODc1fQ.H3mjYLzA4sdhTbmtqwL5HPXI0gSKJGdGv1dRNrAzYN0'
            ),
            body := v_webhook_payload
        );
        
        RAISE NOTICE 'Triggered webhook for next chunk processing: % (% chunks remaining)', 
            p_parent_sync_job_id, v_pending_chunks;
    END IF;
    
    -- Return comprehensive status
    RETURN jsonb_build_object(
        'success', true,
        'parent_sync_job_id', p_parent_sync_job_id,
        'current_chunk_id', p_current_chunk_id,
        'total_chunks', v_total_chunks,
        'completed_chunks', v_completed_chunks,
        'pending_chunks', v_pending_chunks,
        'failed_chunks', v_failed_chunks,
        'processing_chunks', v_processing_chunks,
        'all_chunks_completed', v_completed_chunks = v_total_chunks,
        'parent_was_completed', COALESCE(v_was_completed, false),
        'webhook_triggered', v_should_trigger_webhook,
        'parent_status', v_parent_status,
        'action_taken', CASE 
            WHEN v_was_completed THEN 'parent_marked_completed'
            WHEN v_should_trigger_webhook THEN 'webhook_triggered'
            ELSE 'status_check_only'
        END
    );
    
EXCEPTION 
    WHEN OTHERS THEN
        RAISE WARNING 'Error in check_and_complete_sync_job for %: %', p_parent_sync_job_id, SQLERRM;
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM,
            'parent_sync_job_id', p_parent_sync_job_id,
            'current_chunk_id', p_current_chunk_id
        );
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_and_complete_sync_job(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_complete_sync_job(UUID, UUID) TO service_role; 