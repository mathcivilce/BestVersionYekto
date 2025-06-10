-- ============================================
-- 🕒 Phase 4: Cron Job Configuration Script
-- ============================================
-- Run this script in your Supabase SQL Editor to set up automated cleanup operations

-- ============================================
-- 1. Enable pg_cron Extension
-- ============================================

-- Enable pg_cron extension (requires superuser privileges)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant necessary permissions for cron operations
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- ============================================
-- 2. Environment Configuration
-- ============================================

-- Replace these variables with your actual values:
-- YOUR_SUPABASE_URL: Your Supabase project URL
-- YOUR_SERVICE_ROLE_KEY: Your service role key from Supabase dashboard

-- ⚠️  IMPORTANT: Replace these placeholders before running!
-- Example: https://abcdefghijklmnop.supabase.co
-- Example service key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

-- ============================================
-- 3. Daily Cleanup Operations
-- ============================================

-- Daily cleanup at 2 AM UTC - Remove expired attachments
SELECT cron.schedule(
    'daily-attachment-cleanup',
    '0 2 * * *', -- Daily at 2:00 AM UTC
    $$
    SELECT net.http_post(
        url := 'YOUR_SUPABASE_URL/functions/v1/cleanup-attachments',
        headers := jsonb_build_object(
            'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'cleanupType', 'expired',
            'dryRun', false,
            'batchSize', 100,
            'triggeredBy', 'cron-daily'
        )
    );
    $$
);

-- Daily temp file cleanup at 2:30 AM UTC
SELECT cron.schedule(
    'daily-temp-cleanup',
    '30 2 * * *', -- Daily at 2:30 AM UTC
    $$
    SELECT net.http_post(
        url := 'YOUR_SUPABASE_URL/functions/v1/cleanup-attachments',
        headers := jsonb_build_object(
            'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'cleanupType', 'temp_files',
            'dryRun', false,
            'batchSize', 200,
            'triggeredBy', 'cron-temp-daily'
        )
    );
    $$
);

-- ============================================
-- 4. Weekly Deep Cleanup
-- ============================================

-- Weekly comprehensive cleanup on Sundays at 3 AM UTC
SELECT cron.schedule(
    'weekly-deep-cleanup',
    '0 3 * * 0', -- Weekly on Sunday at 3:00 AM UTC
    $$
    SELECT net.http_post(
        url := 'YOUR_SUPABASE_URL/functions/v1/cleanup-attachments',
        headers := jsonb_build_object(
            'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'cleanupType', 'comprehensive',
            'dryRun', false,
            'batchSize', 500,
            'triggeredBy', 'cron-weekly-deep'
        )
    );
    $$
);

-- ============================================
-- 5. Storage Usage Updates
-- ============================================

-- Update storage usage statistics every 6 hours
SELECT cron.schedule(
    'storage-usage-update',
    '0 */6 * * *', -- Every 6 hours
    $$
    -- Update storage usage for all active users
    SELECT update_storage_usage(id) 
    FROM auth.users 
    WHERE deleted_at IS NULL 
    AND last_sign_in_at > NOW() - INTERVAL '30 days';
    $$
);

-- Daily storage statistics cleanup at 1 AM UTC
SELECT cron.schedule(
    'daily-storage-stats-cleanup',
    '0 1 * * *', -- Daily at 1:00 AM UTC
    $$
    -- Clean up old storage usage records (keep last 3 months)
    DELETE FROM storage_usage 
    WHERE last_calculated_at < NOW() - INTERVAL '3 months'
    AND month_year != TO_CHAR(NOW(), 'YYYY-MM');
    $$
);

-- ============================================
-- 6. Health Check Monitoring
-- ============================================

-- Hourly health check and system monitoring
SELECT cron.schedule(
    'hourly-health-check',
    '0 * * * *', -- Every hour at minute 0
    $$
    SELECT net.http_post(
        url := 'YOUR_SUPABASE_URL/functions/v1/health-check',
        headers := jsonb_build_object(
            'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'triggeredBy', 'cron-health-check'
        )
    );
    $$
);

-- ============================================
-- 7. Cleanup Log Maintenance
-- ============================================

-- Weekly cleanup log maintenance on Saturdays at 4 AM UTC
SELECT cron.schedule(
    'weekly-log-cleanup',
    '0 4 * * 6', -- Weekly on Saturday at 4:00 AM UTC
    $$
    -- Keep only last 365 days of cleanup logs
    DELETE FROM cleanup_logs 
    WHERE executed_at < NOW() - INTERVAL '365 days';
    
    -- Vacuum the table to reclaim space
    VACUUM ANALYZE cleanup_logs;
    $$
);

-- ============================================
-- 8. Monthly Reports and Maintenance
-- ============================================

-- Monthly storage report generation on 1st day of month at 5 AM UTC
SELECT cron.schedule(
    'monthly-storage-report',
    '0 5 1 * *', -- Monthly on 1st day at 5:00 AM UTC
    $$
    -- Insert monthly storage summary
    INSERT INTO cleanup_logs (
        cleanup_type, 
        files_deleted, 
        storage_freed_bytes, 
        cleanup_criteria,
        executed_by
    )
    SELECT 
        'monthly_report',
        COUNT(*) as total_files,
        COALESCE(SUM(file_size), 0) as total_storage,
        jsonb_build_object(
            'report_month', TO_CHAR(NOW() - INTERVAL '1 month', 'YYYY-MM'),
            'user_count', COUNT(DISTINCT user_id),
            'avg_file_size', COALESCE(AVG(file_size), 0)
        ),
        'cron-monthly-report'
    FROM email_attachments 
    WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    AND created_at < DATE_TRUNC('month', NOW());
    $$
);

-- ============================================
-- 9. Performance Optimization
-- ============================================

-- Weekly database maintenance on Sundays at 5 AM UTC
SELECT cron.schedule(
    'weekly-db-maintenance',
    '0 5 * * 0', -- Weekly on Sunday at 5:00 AM UTC
    $$
    -- Analyze tables for query optimization
    ANALYZE email_attachments;
    ANALYZE storage_usage;
    ANALYZE cleanup_logs;
    
    -- Reindex critical indexes if needed
    REINDEX INDEX CONCURRENTLY idx_email_attachments_user_id;
    REINDEX INDEX CONCURRENTLY idx_email_attachments_auto_delete;
    $$
);

-- ============================================
-- 10. Emergency Cleanup (Disabled by Default)
-- ============================================

-- Emergency cleanup job (commented out - enable only when needed)
/*
SELECT cron.schedule(
    'emergency-storage-cleanup',
    '0 0 * * *', -- Daily at midnight (DISABLED)
    $$
    -- Emergency cleanup when storage is critically high
    SELECT net.http_post(
        url := 'YOUR_SUPABASE_URL/functions/v1/cleanup-attachments',
        headers := jsonb_build_object(
            'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'cleanupType', 'emergency',
            'dryRun', false,
            'batchSize', 1000,
            'triggeredBy', 'cron-emergency'
        )
    );
    $$
);
*/

-- ============================================
-- 11. Monitoring and Management Functions
-- ============================================

-- Function to check cron job status
CREATE OR REPLACE FUNCTION get_cron_job_status()
RETURNS TABLE(
    job_name TEXT,
    schedule TEXT,
    active BOOLEAN,
    last_run TIMESTAMP WITH TIME ZONE,
    next_run TIMESTAMP WITH TIME ZONE,
    run_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.jobname::TEXT,
        j.schedule::TEXT,
        j.active,
        MAX(jr.start_time) as last_run,
        cron.get_next_run_time(j.jobid) as next_run,
        COUNT(jr.runid) as run_count
    FROM cron.job j
    LEFT JOIN cron.job_run_details jr ON j.jobid = jr.jobid
    WHERE j.jobname LIKE '%cleanup%' 
       OR j.jobname LIKE '%storage%'
       OR j.jobname LIKE '%health%'
    GROUP BY j.jobid, j.jobname, j.schedule, j.active
    ORDER BY j.jobname;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to disable/enable cron jobs
CREATE OR REPLACE FUNCTION manage_cron_job(job_name TEXT, enable BOOLEAN)
RETURNS BOOLEAN AS $$
DECLARE
    job_id BIGINT;
BEGIN
    SELECT jobid INTO job_id FROM cron.job WHERE jobname = job_name;
    
    IF job_id IS NULL THEN
        RAISE EXCEPTION 'Job % not found', job_name;
        RETURN FALSE;
    END IF;
    
    UPDATE cron.job SET active = enable WHERE jobid = job_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 12. Verification and Status Check
-- ============================================

-- View all scheduled cron jobs
SELECT 
    jobname,
    schedule,
    active,
    database,
    username
FROM cron.job 
WHERE jobname LIKE '%cleanup%' 
   OR jobname LIKE '%storage%'
   OR jobname LIKE '%health%'
ORDER BY jobname;

-- Check recent cron job executions
SELECT 
    j.jobname,
    jr.start_time,
    jr.end_time,
    jr.return_message,
    jr.job_pid
FROM cron.job j
LEFT JOIN cron.job_run_details jr ON j.jobid = jr.jobid
WHERE j.jobname LIKE '%cleanup%' 
   OR j.jobname LIKE '%storage%'
   OR j.jobname LIKE '%health%'
ORDER BY jr.start_time DESC
LIMIT 20;

-- ============================================
-- 13. Configuration Summary
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '✅ Cron jobs setup completed successfully!';
    RAISE NOTICE '';
    RAISE NOTICE '📋 Scheduled Jobs Summary:';
    RAISE NOTICE '- Daily attachment cleanup: 2:00 AM UTC';
    RAISE NOTICE '- Daily temp file cleanup: 2:30 AM UTC';
    RAISE NOTICE '- Weekly deep cleanup: Sunday 3:00 AM UTC';
    RAISE NOTICE '- Storage usage updates: Every 6 hours';
    RAISE NOTICE '- Health checks: Every hour';
    RAISE NOTICE '- Log maintenance: Saturday 4:00 AM UTC';
    RAISE NOTICE '- Monthly reports: 1st day 5:00 AM UTC';
    RAISE NOTICE '- DB maintenance: Sunday 5:00 AM UTC';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  IMPORTANT: Replace placeholder URLs and keys!';
    RAISE NOTICE '   - YOUR_SUPABASE_URL: Your actual Supabase project URL';
    RAISE NOTICE '   - YOUR_SERVICE_ROLE_KEY: Your actual service role key';
    RAISE NOTICE '';
    RAISE NOTICE '🔍 Monitoring Commands:';
    RAISE NOTICE '   - Check status: SELECT * FROM get_cron_job_status();';
    RAISE NOTICE '   - Disable job: SELECT manage_cron_job(''job-name'', false);';
    RAISE NOTICE '   - Enable job: SELECT manage_cron_job(''job-name'', true);';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 Your automated cleanup system is ready!';
END $$;

-- ============================================
-- 14. Security Notes
-- ============================================

/*
🔒 SECURITY CONSIDERATIONS:

1. Service Role Key:
   - Store securely in Supabase dashboard environment variables
   - Rotate every 30-90 days
   - Never expose in client-side code

2. Monitoring:
   - Set up alerts for failed cron jobs
   - Monitor cleanup operation success rates
   - Track storage usage trends

3. Rate Limiting:
   - Cron jobs respect Supabase function rate limits
   - Batch sizes are conservative to avoid timeouts
   - Stagger job execution times to avoid conflicts

4. Backup Strategy:
   - Consider backup before major cleanup operations
   - Keep cleanup logs for audit trail
   - Test disaster recovery procedures

5. Access Control:
   - Only service role can trigger cleanup operations
   - Users can only manage their own attachments
   - Admin roles required for system-wide operations
*/ 