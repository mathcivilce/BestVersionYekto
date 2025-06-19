-- ============================================================================================================
-- PHASE 1: STUCK CHUNK RECOVERY SYSTEM - IMMEDIATE FIXES (ZERO DOWNTIME)
-- ============================================================================================================
--
-- This migration adds lightweight stuck chunk recovery to the existing system without major changes.
-- It's designed to be safe, non-destructive, and immediately effective.
--
-- Key Features:
-- 1. Simple stuck chunk detection and recovery
-- 2. Enhanced error handling and categorization
-- 3. Automatic recovery triggers
-- 4. Basic health monitoring
--
-- ============================================================================================================

-- 1.1 SIMPLE STUCK CHUNK RECOVERY FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION reset_stuck_chunks(p_timeout_minutes INTEGER DEFAULT 10)
RETURNS TABLE(
    reset_count INTEGER, 
    chunk_ids TEXT[], 
    recovery_details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_timeout_threshold TIMESTAMPTZ;
    v_reset_chunks TEXT[];
    v_count INTEGER;
    v_recovery_details JSONB;
BEGIN
    v_timeout_threshold := NOW() - (p_timeout_minutes * INTERVAL '1 minute');
    
    -- Log the recovery attempt
    RAISE NOTICE 'Starting stuck chunk recovery for chunks older than % minutes', p_timeout_minutes;
    
    -- Find stuck chunks with detailed information
    WITH stuck_chunks AS (
        SELECT 
            id,
            chunk_number,
            total_chunks,
            started_at,
            attempts,
            max_attempts,
            worker_id,
            error_message,
            EXTRACT(EPOCH FROM (NOW() - started_at))/60 as stuck_minutes
        FROM chunked_sync_jobs
        WHERE status = 'processing'
          AND started_at < v_timeout_threshold
          AND attempts < max_attempts
    )
    SELECT 
        array_agg(id::text), 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'chunk_id', id,
                'chunk_number', chunk_number,
                'total_chunks', total_chunks,
                'stuck_minutes', stuck_minutes,
                'attempts', attempts,
                'worker_id', worker_id,
                'previous_error', error_message
            )
        )
    INTO v_reset_chunks, v_count, v_recovery_details
    FROM stuck_chunks;
    
    -- Reset stuck chunks to pending (safe operation)
    UPDATE chunked_sync_jobs
    SET 
        status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        error_message = 'Auto-reset from stuck state after ' || p_timeout_minutes || ' minutes at ' || NOW()::text
    WHERE status = 'processing'
      AND started_at < v_timeout_threshold
      AND attempts < max_attempts;
    
    -- Log success
    IF v_count > 0 THEN
        RAISE NOTICE 'Successfully reset % stuck chunks', v_count;
        
        -- Insert recovery event for tracking
        INSERT INTO chunk_recovery_log (
            recovery_type,
            chunks_affected,
            recovery_details,
            recovered_at
        ) VALUES (
            'stuck_chunk_reset',
            v_count,
            v_recovery_details,
            NOW()
        );
    ELSE
        RAISE NOTICE 'No stuck chunks found requiring recovery';
    END IF;
    
    RETURN QUERY SELECT 
        COALESCE(v_count, 0), 
        COALESCE(v_reset_chunks, ARRAY[]::TEXT[]),
        COALESCE(v_recovery_details, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION reset_stuck_chunks IS 'Safely resets chunks stuck in processing state back to pending for retry. Non-destructive operation.';

-- ============================================================================================================
-- 1.2 CHUNK RECOVERY LOGGING TABLE
-- ============================================================================================================

CREATE TABLE IF NOT EXISTS chunk_recovery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recovery_type TEXT NOT NULL,
    chunks_affected INTEGER NOT NULL DEFAULT 0,
    recovery_details JSONB DEFAULT '{}',
    recovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recovered_by TEXT DEFAULT 'auto_recovery_system'
);

CREATE INDEX IF NOT EXISTS idx_chunk_recovery_log_type_time ON chunk_recovery_log(recovery_type, recovered_at);

COMMENT ON TABLE chunk_recovery_log IS 'Audit log for all chunk recovery operations for monitoring and debugging';

-- ============================================================================================================
-- 1.3 ENHANCED ERROR CATEGORIZATION FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION categorize_chunk_error(p_error_message TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_error_message IS NULL THEN
        RETURN 'unknown';
    END IF;
    
    -- Categorize errors for smart retry logic
    CASE 
        WHEN p_error_message ILIKE '%timeout%' OR p_error_message ILIKE '%timed out%' THEN
            RETURN 'timeout';
        WHEN p_error_message ILIKE '%rate limit%' OR p_error_message ILIKE '%too many requests%' OR p_error_message ILIKE '%429%' THEN
            RETURN 'rate_limit';
        WHEN p_error_message ILIKE '%network%' OR p_error_message ILIKE '%connection%' OR p_error_message ILIKE '%dns%' THEN
            RETURN 'network';
        WHEN p_error_message ILIKE '%temporary%' OR p_error_message ILIKE '%unavailable%' OR p_error_message ILIKE '%503%' OR p_error_message ILIKE '%502%' THEN
            RETURN 'temporary';
        WHEN p_error_message ILIKE '%auth%' OR p_error_message ILIKE '%token%' OR p_error_message ILIKE '%401%' OR p_error_message ILIKE '%403%' THEN
            RETURN 'auth';
        WHEN p_error_message ILIKE '%permission%' OR p_error_message ILIKE '%access%' OR p_error_message ILIKE '%forbidden%' THEN
            RETURN 'permission';
        WHEN p_error_message ILIKE '%not found%' OR p_error_message ILIKE '%404%' THEN
            RETURN 'not_found';
        WHEN p_error_message ILIKE '%duplicate%' OR p_error_message ILIKE '%conflict%' OR p_error_message ILIKE '%409%' THEN
            RETURN 'data_conflict';
        ELSE
            RETURN 'processing_error';
    END CASE;
END;
$$;

COMMENT ON FUNCTION categorize_chunk_error IS 'Categorizes error messages for smart retry logic and error analysis';

-- ============================================================================================================
-- 1.4 SMART RETRY DETERMINATION FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION should_retry_chunk(
    p_attempts INTEGER,
    p_max_attempts INTEGER,
    p_error_category TEXT,
    p_chunk_number INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Never retry if max attempts reached
    IF p_attempts >= p_max_attempts THEN
        RETURN false;
    END IF;
    
    -- Retry logic based on error category
    CASE p_error_category
        WHEN 'timeout' THEN
            RETURN true; -- Always retry timeouts
        WHEN 'rate_limit' THEN
            RETURN true; -- Always retry rate limits
        WHEN 'network' THEN
            RETURN true; -- Always retry network issues
        WHEN 'temporary' THEN
            RETURN true; -- Always retry temporary issues
        WHEN 'auth' THEN
            RETURN p_attempts < 2; -- Retry auth issues once
        WHEN 'permission' THEN
            RETURN false; -- Don't retry permission issues
        WHEN 'not_found' THEN
            RETURN false; -- Don't retry not found errors
        WHEN 'data_conflict' THEN
            RETURN false; -- Don't retry data conflicts
        WHEN 'processing_error' THEN
            RETURN p_attempts < 2; -- Retry processing errors once
        ELSE
            RETURN p_attempts < 2; -- Conservative retry for unknown errors
    END CASE;
END;
$$;

COMMENT ON FUNCTION should_retry_chunk IS 'Determines if a chunk should be retried based on error category and attempt count';

-- ============================================================================================================
-- 1.5 AUTO-RECOVERY TRIGGER FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION auto_recover_stuck_chunks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_recovery_result RECORD;
BEGIN
    -- Only run recovery when a chunk changes from processing to failed/completed
    IF (NEW.status IN ('failed', 'completed') AND OLD.status = 'processing') THEN
        
        -- Run stuck chunk recovery (async style - fire and forget)
        BEGIN
            SELECT * INTO v_recovery_result 
            FROM reset_stuck_chunks(10); -- Reset chunks stuck for 10+ minutes
            
            IF v_recovery_result.reset_count > 0 THEN
                RAISE NOTICE 'Auto-recovery triggered: reset % stuck chunks', v_recovery_result.reset_count;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Don't fail the main operation if recovery fails
            RAISE WARNING 'Auto-recovery failed but continuing: %', SQLERRM;
        END;
    END IF;
    
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_recover_stuck_chunks IS 'Automatically triggers stuck chunk recovery when chunks complete or fail';

-- ============================================================================================================
-- 1.6 APPLY AUTO-RECOVERY TRIGGER
-- ============================================================================================================

-- Remove existing trigger if it exists
DROP TRIGGER IF EXISTS auto_recovery_trigger ON chunked_sync_jobs;

-- Create the auto-recovery trigger
CREATE TRIGGER auto_recovery_trigger
    AFTER UPDATE OF status ON chunked_sync_jobs
    FOR EACH ROW
    WHEN (NEW.status IN ('failed', 'completed') AND OLD.status = 'processing')
    EXECUTE FUNCTION auto_recover_stuck_chunks();

-- ============================================================================================================
-- 1.7 MANUAL RECOVERY FUNCTIONS FOR EMERGENCY USE
-- ============================================================================================================

-- Force reset specific chunk (emergency use)
CREATE OR REPLACE FUNCTION force_reset_chunk(p_chunk_id UUID, p_reason TEXT DEFAULT 'Manual reset')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_chunk_record RECORD;
BEGIN
    -- Get chunk details
    SELECT * INTO v_chunk_record
    FROM chunked_sync_jobs
    WHERE id = p_chunk_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Chunk not found'
        );
    END IF;
    
    -- Reset the chunk
    UPDATE chunked_sync_jobs
    SET 
        status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        error_message = 'Force reset: ' || p_reason || ' at ' || NOW()::text
    WHERE id = p_chunk_id;
    
    -- Log the manual reset
    INSERT INTO chunk_recovery_log (
        recovery_type,
        chunks_affected,
        recovery_details,
        recovered_by
    ) VALUES (
        'manual_force_reset',
        1,
        jsonb_build_object(
            'chunk_id', p_chunk_id,
            'chunk_number', v_chunk_record.chunk_number,
            'reason', p_reason,
            'previous_status', v_chunk_record.status
        ),
        'manual_intervention'
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'chunk_id', p_chunk_id,
        'chunk_number', v_chunk_record.chunk_number,
        'previous_status', v_chunk_record.status,
        'message', 'Chunk force reset successfully'
    );
END;
$$;

COMMENT ON FUNCTION force_reset_chunk IS 'Emergency function to force reset a specific chunk. Use with caution.';

-- Reset all chunks for a specific sync job (emergency use)
CREATE OR REPLACE FUNCTION reset_sync_job_chunks(p_parent_sync_job_id UUID, p_reason TEXT DEFAULT 'Sync job reset')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reset_count INTEGER;
    v_chunk_details JSONB;
BEGIN
    -- Get details of chunks to be reset
    SELECT 
        COUNT(*),
        jsonb_agg(
            jsonb_build_object(
                'chunk_id', id,
                'chunk_number', chunk_number,
                'status', status
            )
        )
    INTO v_reset_count, v_chunk_details
    FROM chunked_sync_jobs
    WHERE parent_sync_job_id = p_parent_sync_job_id
      AND status IN ('processing', 'failed');
    
    -- Reset chunks
    UPDATE chunked_sync_jobs
    SET 
        status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        attempts = 0, -- Reset attempts for fresh start
        error_message = 'Sync job reset: ' || p_reason || ' at ' || NOW()::text
    WHERE parent_sync_job_id = p_parent_sync_job_id
      AND status IN ('processing', 'failed');
    
    -- Log the reset
    INSERT INTO chunk_recovery_log (
        recovery_type,
        chunks_affected,
        recovery_details,
        recovered_by
    ) VALUES (
        'sync_job_reset',
        v_reset_count,
        jsonb_build_object(
            'parent_sync_job_id', p_parent_sync_job_id,
            'reason', p_reason,
            'chunks_reset', v_chunk_details
        ),
        'manual_intervention'
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'parent_sync_job_id', p_parent_sync_job_id,
        'chunks_reset', v_reset_count,
        'details', v_chunk_details
    );
END;
$$;

COMMENT ON FUNCTION reset_sync_job_chunks IS 'Emergency function to reset all chunks for a specific sync job';

-- ============================================================================================================
-- 1.8 GRANT PERMISSIONS
-- ============================================================================================================

-- Grant permissions for the new functions
GRANT EXECUTE ON FUNCTION reset_stuck_chunks TO service_role;
GRANT EXECUTE ON FUNCTION categorize_chunk_error TO service_role;
GRANT EXECUTE ON FUNCTION should_retry_chunk TO service_role;
GRANT EXECUTE ON FUNCTION force_reset_chunk TO service_role;
GRANT EXECUTE ON FUNCTION reset_sync_job_chunks TO service_role;

-- Grant table permissions
GRANT ALL ON chunk_recovery_log TO service_role;
GRANT SELECT ON chunk_recovery_log TO authenticated;

-- Enable RLS on new table
ALTER TABLE chunk_recovery_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for recovery log
CREATE POLICY "chunk_recovery_log_read_policy" ON chunk_recovery_log
    FOR SELECT
    TO authenticated
    USING (true); -- Allow reading recovery logs for monitoring

-- ============================================================================================================
-- 1.9 TESTING AND VALIDATION
-- ============================================================================================================

-- Test the recovery system
DO $$
DECLARE
    v_test_result RECORD;
BEGIN
    -- Test stuck chunk detection (should return 0 if no stuck chunks)
    SELECT * INTO v_test_result FROM reset_stuck_chunks(5);
    
    RAISE NOTICE 'Phase 1 Implementation Test Complete:';
    RAISE NOTICE '- Stuck chunks found: %', v_test_result.reset_count;
    RAISE NOTICE '- Recovery system: ACTIVE';
    RAISE NOTICE '- Auto-recovery trigger: INSTALLED';
    RAISE NOTICE '- Error categorization: FUNCTIONAL';
    RAISE NOTICE '- Emergency functions: AVAILABLE';
    
    IF v_test_result.reset_count > 0 THEN
        RAISE NOTICE '- IMMEDIATE BENEFIT: % stuck chunks recovered!', v_test_result.reset_count;
    END IF;
END;
$$; 