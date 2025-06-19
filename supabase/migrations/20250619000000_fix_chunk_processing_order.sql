-- ============================================================================================================
-- FIX CHUNK PROCESSING ORDER - ENSURE SEQUENTIAL PROCESSING
-- ============================================================================================================
-- 
-- ISSUE: Background sync processor was processing chunks in wrong order (chunk 4 first instead of chunk 1)
-- CAUSE: claim_next_chunk_job function was ordering by priority DESC, which processes highest priority first
--        Since chunks are assigned priority = chunk_number (1,2,3,4), chunk 4 was processed first
-- 
-- SOLUTION: Change ordering to use chunk_number ASC for sequential processing
-- 
-- ============================================================================================================

-- Fix the compatibility bridge version (used by background-sync-processor)
CREATE OR REPLACE FUNCTION claim_next_chunk_job(p_worker_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_claimed_chunk RECORD;
    v_sync_job RECORD;
BEGIN
    -- ================================================================================================
    -- CLAIM CHUNK USING EXISTING SYSTEM - WITH SEQUENTIAL ORDERING
    -- ================================================================================================
    
    -- Use existing chunked_sync_jobs table for atomic claiming
    -- FIXED: Order by chunk_number ASC to process chunks sequentially (1, 2, 3, 4)
    UPDATE chunked_sync_jobs 
    SET 
        status = 'processing',
        started_at = NOW(),
        attempts = attempts + 1,
        worker_id = p_worker_id
    WHERE id = (
        SELECT id 
        FROM chunked_sync_jobs
        WHERE status = 'pending' 
        AND attempts < max_attempts
        ORDER BY chunk_number ASC, created_at ASC  -- FIXED: Sequential processing
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING * INTO v_claimed_chunk;
    
    -- Check if claim was successful
    IF v_claimed_chunk.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'No pending chunk jobs available',
            'chunk_job', NULL,
            'compatibility_bridge', true
        );
    END IF;
    
    -- ================================================================================================
    -- GET ADDITIONAL SYNC JOB INFORMATION
    -- ================================================================================================
    
    -- Get sync job details for complete context
    SELECT sq.*
    INTO v_sync_job
    FROM sync_queue sq
    WHERE sq.id = v_claimed_chunk.parent_sync_job_id;
    
    -- ================================================================================================
    -- RETURN COMPATIBLE FORMAT
    -- ================================================================================================
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Chunk job claimed successfully',
        'chunk_job', jsonb_build_object(
            'chunk_id', v_claimed_chunk.id,
            'parent_sync_job_id', v_claimed_chunk.parent_sync_job_id,
            'business_id', v_claimed_chunk.business_id,
            'store_id', v_claimed_chunk.store_id,
            'chunk_index', v_claimed_chunk.chunk_number,
            'total_chunks', v_claimed_chunk.total_chunks,
            'start_offset', (v_claimed_chunk.chunk_number - 1) * v_claimed_chunk.chunk_size,
            'end_offset', (v_claimed_chunk.chunk_number * v_claimed_chunk.chunk_size) - 1,
            'estimated_emails', v_claimed_chunk.email_count_estimate,
            'sync_type', v_sync_job.sync_type,
            'status', 'processing',
            'attempts', v_claimed_chunk.attempts,
            'max_attempts', v_claimed_chunk.max_attempts,
            'sync_from', v_sync_job.sync_from,
            'sync_to', v_sync_job.sync_to,
            'metadata', v_claimed_chunk.metadata || jsonb_build_object('compatibility_bridge', true),
            'checkpoint_data', COALESCE(v_claimed_chunk.checkpoint_data, '{}'::jsonb)
        ),
        'compatibility_bridge', true,
        'backend_chunk_id', v_claimed_chunk.id
    );
    
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'message', 'Failed to claim chunk job: ' || SQLERRM,
        'chunk_job', NULL,
        'compatibility_bridge', true,
        'error_code', 'CLAIM_BRIDGE_EXCEPTION'
    );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION claim_next_chunk_job(TEXT) TO service_role;

-- Add comment explaining the fix
COMMENT ON FUNCTION claim_next_chunk_job IS 
'Race-condition safe claiming of next available chunk job for processing. 
FIXED: Now processes chunks sequentially (chunk_number ASC) instead of reverse order.'; 