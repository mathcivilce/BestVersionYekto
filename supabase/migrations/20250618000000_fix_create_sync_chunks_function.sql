-- ============================================================================================================
-- FIXED CREATE_SYNC_CHUNKS FUNCTION - UNIFIED WITH CHUNKED_SYNC_JOBS SYSTEM
-- ============================================================================================================
-- 
-- This migration fixes the create_sync_chunks function to use the existing chunked_sync_jobs table
-- instead of the non-existent sync_chunks table. This unifies the chunking system and eliminates
-- duplicate table structures.
--
-- CHANGES:
-- - Uses chunked_sync_jobs table instead of sync_chunks
-- - Adds missing get_chunk_config function
-- - Maintains compatibility with existing interfaces
-- - Maps schema correctly between expected and actual table structure
-- - Includes business_id column that was missing
-- - FIXED: Uses chunk_number column (not chunk_index) to match actual table schema
--
-- ============================================================================================================

-- First, create the missing get_chunk_config function
CREATE OR REPLACE FUNCTION public.get_chunk_config(p_business_id UUID)
RETURNS TABLE(base_chunk_size INTEGER)
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Return default chunk configuration
  -- This can be enhanced later to support per-business configuration
  RETURN QUERY SELECT 100 as base_chunk_size;
END;
$function$;

-- Drop the old function that references non-existent sync_chunks table
DROP FUNCTION IF EXISTS public.create_sync_chunks(uuid, integer);

-- Create the corrected function that uses chunked_sync_jobs with proper schema
CREATE OR REPLACE FUNCTION public.create_sync_chunks(p_sync_job_id uuid, p_estimated_emails integer)
 RETURNS TABLE(success boolean, total_chunks integer, chunk_size integer, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  config RECORD;
  v_total_chunks INTEGER;
  v_store_id UUID;
  v_business_id UUID;
BEGIN
  -- Get job details from sync_queue
  SELECT sq.store_id, s.business_id INTO v_store_id, v_business_id
  FROM sync_queue sq 
  JOIN stores s ON sq.store_id = s.id
  WHERE sq.id = p_sync_job_id;

  IF v_store_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 'Parent sync job or store not found.'::text;
    RETURN;
  END IF;
  
  -- Get the chunk configuration
  SELECT * INTO config FROM get_chunk_config(v_business_id);
  
  -- Calculate total chunks needed
  v_total_chunks := CEIL(p_estimated_emails::numeric / config.base_chunk_size::numeric);
  
  -- Delete any existing chunks for this sync job (in case of retry)
  DELETE FROM chunked_sync_jobs WHERE parent_sync_job_id = p_sync_job_id;
  
  -- Create the chunk jobs in chunked_sync_jobs table
  -- FIXED: Use chunk_number column (not chunk_index) to match actual table schema
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
    created_at
  )
  SELECT 
    p_sync_job_id,
    v_business_id,
    v_store_id,
    chunk_num,
    v_total_chunks,
    config.base_chunk_size,
    LEAST(config.base_chunk_size, p_estimated_emails - (chunk_num - 1) * config.base_chunk_size),
    'pending',
    chunk_num,
    NOW()
  FROM generate_series(1, v_total_chunks) AS chunk_num;
  
  -- Return chunk_size instead of base_chunk_size to match expected interface
  RETURN QUERY SELECT true, v_total_chunks, config.base_chunk_size, 'Chunks created successfully in chunked_sync_jobs table.'::text;
END;
$function$; 