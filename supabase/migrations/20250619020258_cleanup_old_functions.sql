-- ============================================================================================================
-- CLEANUP OLD FUNCTIONS AFTER UNIFIED PROCESSOR DEPLOYMENT
-- ============================================================================================================
-- 
-- This migration safely removes the old background-sync-processor and sync-emails Edge Functions
-- after confirming the unified-background-sync processor is working correctly.
-- 
-- IMPORTANT: Only run this migration AFTER confirming the unified system is working properly!
-- 
-- Functions to be removed:
-- 1. background-sync-processor Edge Function  
-- 2. sync-emails Edge Function
-- 
-- Note: This migration contains the commands to delete the functions but they are commented out
-- for safety. Uncomment and run manually once you've verified the unified system is stable.
-- ============================================================================================================

-- ============================================================================================================
-- SAFETY NOTICE - UNCOMMENT THESE COMMANDS ONLY AFTER TESTING
-- ============================================================================================================

-- Step 1: Delete the old background-sync-processor Edge Function
-- Command to run manually: npx supabase functions delete background-sync-processor

-- Step 2: Delete the old sync-emails Edge Function  
-- Command to run manually: npx supabase functions delete sync-emails

-- Step 3: Clean up any remaining references in logs or configurations
-- This should be done after confirming no errors in the unified system

-- ============================================================================================================
-- VERIFICATION CHECKLIST BEFORE CLEANUP
-- ============================================================================================================

-- 1. ✅ Verify unified-background-sync function is deployed
-- 2. ✅ Verify all database webhooks point to unified-background-sync
-- 3. ✅ Test email sync process end-to-end 
-- 4. ✅ Monitor logs for any errors for 24-48 hours
-- 5. ✅ Confirm no stuck chunks or failed sync jobs
-- 6. ✅ Test both manual and automatic sync triggers
-- 7. ✅ Verify real-time updates work properly

-- Once all above items are verified, manually run:
-- npx supabase functions delete background-sync-processor
-- npx supabase functions delete sync-emails

-- ============================================================================================================
-- MONITORING QUERIES FOR VERIFICATION
-- ============================================================================================================

-- Check sync job health
-- SELECT 
--     status,
--     COUNT(*) as count,
--     MAX(created_at) as latest_created,
--     MAX(completed_at) as latest_completed
-- FROM sync_queue 
-- WHERE created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY status;

-- Check chunk processing health
-- SELECT 
--     status,
--     COUNT(*) as count,
--     MAX(created_at) as latest_created,
--     MAX(completed_at) as latest_completed  
-- FROM chunk_processing_queue
-- WHERE created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY status;

-- Check for stuck processing jobs (should be 0)
-- SELECT COUNT(*) as stuck_processing_jobs
-- FROM chunk_processing_queue
-- WHERE status = 'processing' 
--   AND started_at < NOW() - INTERVAL '10 minutes';

DO $$
BEGIN
    RAISE LOG 'Cleanup migration created - contains instructions for manual function deletion';
    RAISE LOG 'IMPORTANT: Only delete old functions after 24-48 hours of verified unified system operation';
    RAISE LOG 'Commands to run manually: npx supabase functions delete background-sync-processor';
    RAISE LOG 'Commands to run manually: npx supabase functions delete sync-emails';
END;
$$;
