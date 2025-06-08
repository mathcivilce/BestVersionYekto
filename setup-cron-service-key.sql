-- Configuration script to set up the service role key for cron jobs
-- You need to replace 'YOUR_SERVICE_ROLE_KEY_HERE' with your actual service role key

-- STEP 1: Set your service role key (REPLACE WITH YOUR ACTUAL KEY)
-- The service role key should start with 'eyJ...' and be very long
-- You can find it in your Supabase project settings under API -> service_role key

ALTER DATABASE postgres SET app.service_role_key = 'YOUR_SERVICE_ROLE_KEY_HERE';

-- STEP 2: Verify the configuration
SELECT current_setting('app.service_role_key') as service_key_configured;

-- STEP 3: Check cron job status
SELECT * FROM get_cron_job_status();

-- STEP 4: Test a cron job manually (optional)
-- SELECT trigger_cron_job('refresh-tokens-every-30min');

-- STEP 5: View cron job execution history
SELECT 
  j.jobname,
  r.runid,
  r.start_time,
  r.end_time,
  r.return_message,
  CASE WHEN r.return_message IS NULL THEN 'Success' ELSE 'Failed' END as status
FROM cron.job j
LEFT JOIN cron.job_run_details r ON j.jobid = r.jobid
WHERE j.jobname IN (
  'refresh-tokens-every-30min',
  'renew-subscriptions-every-6hours',
  'cleanup-cron-logs-daily'
)
ORDER BY r.start_time DESC
LIMIT 10;

-- OPTIONAL: Manage cron jobs
-- Enable a job:   SELECT manage_cron_job('enable', 'refresh-tokens-every-30min');
-- Disable a job:  SELECT manage_cron_job('disable', 'refresh-tokens-every-30min');
-- Delete a job:   SELECT manage_cron_job('delete', 'refresh-tokens-every-30min'); 