/*
  # Enable Automated Cron Job Scheduling
  
  This migration enables the pg_cron extension and sets up automated scheduling for:
  1. Token refresh every 30 minutes 
  2. Subscription renewal every 6 hours
  
  The jobs will automatically call the respective Edge Functions on schedule.
  
  IMPORTANT: You need to set the service role key as a database setting:
  ALTER DATABASE postgres SET app.service_role_key = 'your_service_role_key_here';
*/

-- Enable the pg_cron extension (requires superuser privileges)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable the http extension for making HTTP requests
CREATE EXTENSION IF NOT EXISTS http;

-- Create a function to call our Edge Functions via HTTP
CREATE OR REPLACE FUNCTION call_edge_function(
  function_name text,
  project_url text DEFAULT 'https://vjkofswgtffzyeuiainf.supabase.co'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_role_key text;
  response http_response;
  full_url text;
BEGIN
  -- Try to get the service role key from database settings
  BEGIN
    service_role_key := current_setting('app.service_role_key');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Service role key not configured. Please run: ALTER DATABASE postgres SET app.service_role_key = ''your_key_here'';';
  END;
  
  -- Build the full URL
  full_url := project_url || '/functions/v1/' || function_name;
  
  -- Make the HTTP request
  SELECT * INTO response FROM http((
    'POST',
    full_url,
    ARRAY[
      http_header('Content-Type', 'application/json'),
      http_header('Authorization', 'Bearer ' || service_role_key)
    ],
    'application/json',
    '{}'
  )::http_request);
  
  -- Log the result
  RAISE NOTICE 'Called Edge Function: % - Status: %', function_name, response.status;
  
  -- Return the response as JSON
  RETURN response.content::json;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to call Edge Function %: %', function_name, SQLERRM;
    RETURN json_build_object('error', SQLERRM);
END;
$$;

-- Schedule token refresh every 30 minutes
-- This prevents tokens from expiring and ensures continuous service
SELECT cron.schedule(
  'refresh-tokens-every-30min',
  '*/30 * * * *',  -- Every 30 minutes
  $$
  SELECT call_edge_function('cron-refresh-tokens');
  $$
);

-- Schedule subscription renewal every 6 hours
-- This ensures subscriptions are renewed well before they expire
SELECT cron.schedule(
  'renew-subscriptions-every-6hours',
  '0 */6 * * *',  -- Every 6 hours at minute 0
  $$
  SELECT call_edge_function('renew-subscriptions');
  $$
);

-- Schedule a daily cleanup job to remove old cron logs (optional)
SELECT cron.schedule(
  'cleanup-cron-logs-daily',
  '0 2 * * *',  -- Every day at 2 AM
  $$
  DELETE FROM cron.job_run_details 
  WHERE end_time < now() - interval '7 days';
  $$
);

-- Create a function to check cron job status
CREATE OR REPLACE FUNCTION get_cron_job_status()
RETURNS TABLE (
  jobname text,
  schedule text,
  active boolean,
  last_run timestamptz,
  next_run timestamptz,
  command text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    j.jobname,
    j.schedule,
    j.active,
    r.end_time as last_run,
    CASE 
      WHEN j.schedule ~ '^\*/[0-9]+' THEN 
        -- Handle */n format (every n minutes/hours)
        COALESCE(r.end_time, now()) + 
        CASE 
          WHEN j.schedule LIKE '*/30 * * * *' THEN interval '30 minutes'
          WHEN j.schedule LIKE '0 */6 * * *' THEN interval '6 hours'
          WHEN j.schedule LIKE '0 2 * * *' THEN interval '1 day'
          ELSE interval '1 hour'
        END
      ELSE COALESCE(r.end_time, now()) + interval '1 hour'
    END as next_run,
    j.command
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT end_time 
    FROM cron.job_run_details 
    WHERE jobid = j.jobid 
    ORDER BY end_time DESC 
    LIMIT 1
  ) r ON true
  WHERE j.jobname IN (
    'refresh-tokens-every-30min',
    'renew-subscriptions-every-6hours',
    'cleanup-cron-logs-daily'
  )
  ORDER BY j.jobname;
$$;

-- Create a function to manually trigger cron jobs (for testing)
CREATE OR REPLACE FUNCTION trigger_cron_job(job_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_command text;
BEGIN
  -- Get the command for the specified job
  SELECT command INTO job_command
  FROM cron.job
  WHERE jobname = job_name AND active = true;
  
  IF job_command IS NULL THEN
    RETURN 'Job not found or inactive: ' || job_name;
  END IF;
  
  -- Execute the command
  EXECUTE job_command;
  
  RETURN 'Job triggered successfully: ' || job_name;
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'Error triggering job ' || job_name || ': ' || SQLERRM;
END;
$$;

-- Create a function to manage cron jobs
CREATE OR REPLACE FUNCTION manage_cron_job(
  action text,  -- 'enable', 'disable', 'delete'
  job_name text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  CASE action
    WHEN 'enable' THEN
      UPDATE cron.job SET active = true WHERE jobname = job_name;
      RETURN 'Job enabled: ' || job_name;
    WHEN 'disable' THEN
      UPDATE cron.job SET active = false WHERE jobname = job_name;
      RETURN 'Job disabled: ' || job_name;
    WHEN 'delete' THEN
      SELECT cron.unschedule(job_name);
      RETURN 'Job deleted: ' || job_name;
    ELSE
      RETURN 'Invalid action. Use: enable, disable, or delete';
  END CASE;
EXCEPTION
  WHEN OTHERS THEN
    RETURN 'Error managing job ' || job_name || ': ' || SQLERRM;
END;
$$;

-- Add helpful comments for documentation
COMMENT ON EXTENSION pg_cron IS 'PostgreSQL job scheduler for automated tasks';
COMMENT ON FUNCTION get_cron_job_status() IS 'Check the status and schedule of automated cron jobs';
COMMENT ON FUNCTION trigger_cron_job(text) IS 'Manually trigger a cron job for testing purposes';
COMMENT ON FUNCTION manage_cron_job(text, text) IS 'Enable, disable, or delete cron jobs';
COMMENT ON FUNCTION call_edge_function(text, text) IS 'Call Supabase Edge Functions from cron jobs';

-- Log the successful setup
DO $$
BEGIN
  RAISE NOTICE 'Cron scheduling setup completed successfully!';
  RAISE NOTICE 'Scheduled jobs:';
  RAISE NOTICE '- Token refresh: every 30 minutes';
  RAISE NOTICE '- Subscription renewal: every 6 hours';
  RAISE NOTICE '- Log cleanup: daily at 2 AM';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT: Set your service role key with:';
  RAISE NOTICE 'ALTER DATABASE postgres SET app.service_role_key = ''your_service_role_key_here'';';
  RAISE NOTICE '';
  RAISE NOTICE 'Useful commands:';
  RAISE NOTICE '- Check job status: SELECT * FROM get_cron_job_status();';
  RAISE NOTICE '- Test a job: SELECT trigger_cron_job(''refresh-tokens-every-30min'');';
  RAISE NOTICE '- Manage jobs: SELECT manage_cron_job(''disable'', ''job-name'');';
END $$; 