CREATE OR REPLACE FUNCTION claim_next_chunk_job_safe(p_parent_sync_job_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_chunk_job RECORD;
  v_chunk RECORD;
BEGIN
  -- Find the next available chunk job.
  -- If p_parent_sync_job_id is provided, it looks for a chunk in that specific job.
  -- If p_parent_sync_job_id is NULL, it looks for any available chunk job.
  -- It also picks up stale jobs that have been 'processing' for more than 5 minutes.
  SELECT * INTO v_chunk_job
  FROM chunked_sync_jobs
  WHERE (p_parent_sync_job_id IS NULL OR sync_job_id = p_parent_sync_job_id)
    AND (
      status = 'pending'
      OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes')
    )
  ORDER BY chunk_number ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- If no job is found, return NULL
  IF v_chunk_job IS NULL THEN
    RETURN NULL;
  END IF;

  -- Mark the job as 'processing' and update the timestamp
  UPDATE chunked_sync_jobs
  SET status = 'processing', updated_at = NOW()
  WHERE id = v_chunk_job.id
  RETURNING * INTO v_chunk_job;

  -- Now, get the full chunk details including user_id and connection_id from the parent sync_jobs table.
  -- This join is essential and uses the sync_job_id from the v_chunk_job we just claimed.
  SELECT
      j.id,
      j.sync_job_id as parent_sync_job_id,
      j.status,
      j.chunk_number,
      j.created_at,
      j.updated_at,
      s.user_id,
      s.connection_id
  INTO v_chunk
  FROM chunked_sync_jobs j
  JOIN sync_jobs s ON j.sync_job_id = s.id
  WHERE j.id = v_chunk_job.id AND s.id = v_chunk_job.sync_job_id;


  -- Return the claimed job details as JSONB, translating column names for the application
  RETURN jsonb_build_object(
    'id', v_chunk.id,
    'parent_sync_job_id', v_chunk.parent_sync_job_id,
    'status', v_chunk.status,
    'chunk_index', v_chunk.chunk_number, -- Translate chunk_number to chunk_index
    'created_at', v_chunk.created_at,
    'updated_at', v_chunk.updated_at,
    'user_id', v_chunk.user_id,
    'connection_id', v_chunk.connection_id
  );
EXCEPTION
  WHEN OTHERS THEN
    -- If anything goes wrong, log the error and re-raise it.
    RAISE WARNING 'Error in claim_next_chunk_job_safe: %', SQLERRM;
    RAISE;
END;
$$ LANGUAGE plpgsql; 