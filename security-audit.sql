-- ====================================================
-- SECURITY AUDIT SCRIPT
-- ====================================================
-- This script verifies that RLS policies are working correctly
-- and that cross-business access is prevented

-- Run this as different users to verify business isolation

-- ====================================================
-- 1. BASIC SECURITY CHECK
-- ====================================================

-- Check current user's business
SELECT 
    auth.uid() as current_user_id,
    up.business_id,
    b.name as business_name,
    up.role
FROM user_profiles up
JOIN businesses b ON b.id = up.business_id
WHERE up.user_id = auth.uid();

-- ====================================================
-- 2. EMAIL ACCESS VERIFICATION
-- ====================================================

-- This should only return emails from user's business
SELECT 
    'EMAILS' as table_name,
    COUNT(*) as total_accessible,
    COUNT(DISTINCT e.store_id) as distinct_stores,
    COUNT(DISTINCT s.business_id) as distinct_businesses,
    ARRAY_AGG(DISTINCT s.business_id) as business_ids
FROM emails e
JOIN stores s ON s.id = e.store_id;

-- ====================================================
-- 3. STORES ACCESS VERIFICATION  
-- ====================================================

-- This should only return stores from user's business
SELECT 
    'STORES' as table_name,
    COUNT(*) as total_accessible,
    COUNT(DISTINCT business_id) as distinct_businesses,
    ARRAY_AGG(DISTINCT business_id) as business_ids
FROM stores;

-- ====================================================
-- 4. INTERNAL NOTES ACCESS VERIFICATION
-- ====================================================

-- This should only return notes for emails in user's business
SELECT 
    'INTERNAL_NOTES' as table_name,
    COUNT(*) as total_accessible,
    COUNT(DISTINCT in.email_id) as distinct_emails,
    COUNT(DISTINCT s.business_id) as distinct_businesses
FROM internal_notes in
JOIN emails e ON e.id = in.email_id
JOIN stores s ON s.id = e.store_id;

-- ====================================================
-- 5. USER PROFILES ACCESS VERIFICATION
-- ====================================================

-- This should only return profiles from user's business + own profile
SELECT 
    'USER_PROFILES' as table_name,
    COUNT(*) as total_accessible,
    COUNT(DISTINCT business_id) as distinct_businesses,
    ARRAY_AGG(DISTINCT business_id) as business_ids
FROM user_profiles
WHERE business_id IS NOT NULL;

-- ====================================================
-- 6. CROSS-BUSINESS ACCESS TEST
-- ====================================================

-- Try to access data that should be blocked
-- These queries should return 0 rows if RLS is working

-- Test 1: Try to access emails from other businesses
WITH user_business AS (
    SELECT business_id FROM user_profiles WHERE user_id = auth.uid()
)
SELECT 
    'SECURITY_TEST_EMAILS' as test_name,
    COUNT(*) as should_be_zero,
    CASE 
        WHEN COUNT(*) = 0 THEN '✓ SECURE - No cross-business access'
        ELSE '❌ VULNERABILITY - Cross-business access detected!'
    END as result
FROM emails e
JOIN stores s ON s.id = e.store_id
WHERE s.business_id NOT IN (SELECT business_id FROM user_business);

-- Test 2: Try to access stores from other businesses  
WITH user_business AS (
    SELECT business_id FROM user_profiles WHERE user_id = auth.uid()
)
SELECT 
    'SECURITY_TEST_STORES' as test_name,
    COUNT(*) as should_be_zero,
    CASE 
        WHEN COUNT(*) = 0 THEN '✓ SECURE - No cross-business access'
        ELSE '❌ VULNERABILITY - Cross-business access detected!'
    END as result
FROM stores s
WHERE s.business_id NOT IN (SELECT business_id FROM user_business);

-- Test 3: Try to access profiles from other businesses
WITH user_business AS (
    SELECT business_id FROM user_profiles WHERE user_id = auth.uid()
)
SELECT 
    'SECURITY_TEST_PROFILES' as test_name,
    COUNT(*) as should_be_zero,
    CASE 
        WHEN COUNT(*) = 0 THEN '✓ SECURE - No cross-business access'
        ELSE '❌ VULNERABILITY - Cross-business access detected!'
    END as result
FROM user_profiles up
WHERE up.business_id IS NOT NULL 
    AND up.business_id NOT IN (SELECT business_id FROM user_business)
    AND up.user_id != auth.uid(); -- Exclude own profile

-- ====================================================
-- 7. POLICY COMPLETENESS CHECK
-- ====================================================

-- Verify all critical tables have proper RLS policies
SELECT 
    t.table_name,
    t.row_security,
    CASE 
        WHEN t.row_security = 'YES' THEN '✓ RLS Enabled'
        ELSE '❌ RLS Disabled'
    END as rls_status,
    COALESCE(policy_count.count, 0) as policy_count
FROM information_schema.tables t
LEFT JOIN (
    SELECT 
        tablename,
        COUNT(*) as count
    FROM pg_policies 
    WHERE schemaname = 'public'
    GROUP BY tablename
) policy_count ON policy_count.tablename = t.table_name
WHERE t.table_schema = 'public' 
    AND t.table_name IN (
        'emails', 'stores', 'internal_notes', 'email_replies', 
        'user_profiles', 'businesses', 'analytics'
    )
ORDER BY t.table_name;

-- ====================================================
-- 8. DANGEROUS POLICY DETECTION
-- ====================================================

-- Check for any remaining dangerous policies
SELECT 
    'DANGEROUS_POLICIES' as check_name,
    tablename,
    policyname,
    cmd,
    '❌ UNRESTRICTED ACCESS POLICY FOUND!' as warning
FROM pg_policies 
WHERE schemaname = 'public' 
    AND (qual = 'true' OR with_check = 'true')
    AND tablename IN ('emails', 'stores', 'internal_notes', 'user_profiles');

-- If no results from above query, then all is secure

-- ====================================================
-- SUMMARY REPORT
-- ====================================================

SELECT 
    'SECURITY_AUDIT_SUMMARY' as report_section,
    'Run this script as different users to verify business isolation' as instruction,
    'All tests should show ✓ SECURE status' as success_criteria,
    'Any ❌ results indicate security vulnerabilities' as warning; 