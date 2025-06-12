# 🚀 Deploy Attachment Cleanup Cron Jobs

## ✅ What I've Already Configured

I've updated your `scripts/setup-cron-jobs.sql` file with:
- ✅ **Supabase URL**: `https://vjkofswgtffzyeuiainf.supabase.co`
- ✅ **All cleanup job schedules** configured and ready to deploy

## ⚠️ Manual Steps Required

### Step 1: Get Your Service Role Key

1. **Open your Supabase Dashboard**: https://supabase.com/dashboard/project/vjkofswgtffzyeuiainf
2. **Navigate to**: Settings → API
3. **Copy the `service_role` key** (starts with `eyJhbGci...`)

### Step 2: Replace Service Role Key in Script

1. **Open**: `scripts/setup-cron-jobs.sql`
2. **Find all instances** of `YOUR_SERVICE_ROLE_KEY` (there are 4 instances)
3. **Replace each one** with your actual service role key

**Or use this command to replace all at once:**
```bash
# Replace YOUR_SERVICE_ROLE_KEY with your actual key
sed -i 's/YOUR_SERVICE_ROLE_KEY/your_actual_service_role_key_here/g' scripts/setup-cron-jobs.sql
```

### Step 3: Deploy the Cron Jobs

1. **Open Supabase SQL Editor**: https://supabase.com/dashboard/project/vjkofswgtffzyeuiainf/sql/new
2. **Copy and paste** the entire content of `scripts/setup-cron-jobs.sql`
3. **Execute** the script
4. **Verify success messages** appear

## 🎯 What Will Be Deployed

### Primary Cleanup Jobs:
- **`daily-attachment-cleanup`** (2:00 AM UTC) - Removes expired attachments
- **`daily-temp-cleanup`** (2:30 AM UTC) - Cleans up unsent files after 7 days
- **`weekly-deep-cleanup`** (Sunday 3:00 AM UTC) - Comprehensive cleanup

### Supporting Jobs:
- **`storage-usage-update`** (Every 6 hours) - Updates storage statistics
- **`daily-storage-stats-cleanup`** (1:00 AM UTC) - Cleans old usage records
- **`hourly-health-check`** (Every hour) - System monitoring
- **`weekly-log-cleanup`** (Saturday 4:00 AM UTC) - Cleanup log maintenance
- **`monthly-storage-report`** (1st day 5:00 AM UTC) - Monthly reports
- **`weekly-db-maintenance`** (Sunday 5:00 AM UTC) - Database optimization

## 🔍 Verification Commands

After deployment, run these in Supabase SQL Editor to verify:

### Check Job Status
```sql
SELECT * FROM get_cron_job_status();
```

### View All Scheduled Jobs
```sql
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
```

### Test a Job Manually (Optional)
```sql
-- Test temp file cleanup
SELECT trigger_cron_job('daily-temp-cleanup');
```

## 🎉 Expected Results

You should see these **8 NEW cron jobs** created:
1. `daily-attachment-cleanup`
2. `daily-temp-cleanup` 
3. `weekly-deep-cleanup`
4. `storage-usage-update`
5. `daily-storage-stats-cleanup`
6. `hourly-health-check`
7. `weekly-log-cleanup`
8. `monthly-storage-report`
9. `weekly-db-maintenance`

## 🛡️ Security Notes

- ✅ **Service role key** has admin privileges - keep it secure
- ✅ **All URLs** are configured for your project
- ✅ **Batch sizes** are conservative to avoid timeouts
- ✅ **Execution times** are staggered to avoid conflicts

## 🚨 Troubleshooting

### If you see errors:
1. **Check service role key** is valid and properly replaced
2. **Verify pg_cron extension** is enabled: `CREATE EXTENSION IF NOT EXISTS pg_cron;`
3. **Check Edge Functions** are deployed and accessible
4. **Review execution logs** in Supabase Dashboard

### Monitor Job Health:
```sql
-- Check recent job executions
SELECT 
    j.jobname,
    jr.start_time,
    jr.end_time,
    jr.return_message,
    CASE WHEN jr.return_message IS NULL THEN 'Success' ELSE 'Failed' END as status
FROM cron.job j
LEFT JOIN cron.job_run_details jr ON j.jobid = jr.jobid
WHERE j.jobname LIKE '%cleanup%' 
   OR j.jobname LIKE '%storage%'
   OR j.jobname LIKE '%health%'
ORDER BY jr.start_time DESC
LIMIT 10;
```

## ✅ Once Complete

Your system will automatically:
- 🧹 **Clean up unsent files** after 7 days
- 🗑️ **Remove expired attachments** daily
- 📊 **Update storage statistics** every 6 hours
- 🔍 **Monitor system health** hourly
- 📈 **Generate usage reports** monthly
- ⚡ **Optimize database** weekly

**No more manual cleanup needed! Your storage will be automatically managed.** 🎆 