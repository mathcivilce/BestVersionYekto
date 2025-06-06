-- ====================================================
-- RLS FIX VERIFICATION SCRIPT
-- ====================================================
-- This script verifies that the RLS fix allows proper access
-- while maintaining business-level security

-- Test user: mathcivilce@gmail.com
-- User ID: 3beb833d-aeaa-4393-91b6-6cf41df50421
-- Business ID: 362d1dab-8505-4006-b024-0884657a48f6

SELECT '=== RLS FIX VERIFICATION REPORT ===' as title;

-- ====================================================
-- TEST 1: USER PROFILE ACCESS (Must work for app to function)
-- ====================================================
SELECT 
    '1. USER PROFILE ACCESS' as test_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ PASS - User can access their profile'
        ELSE '❌ FAIL - User cannot access their profile'
    END as result,
    COUNT(*) as profiles_accessible
FROM user_profiles 
WHERE user_id = '3beb833d-aeaa-4393-91b6-6cf41df50421';

-- ====================================================
-- TEST 2: BUSINESS INFORMATION ACCESS
-- ====================================================
SELECT 
    '2. BUSINESS ACCESS' as test_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ PASS - User can access their business'
        ELSE '❌ FAIL - User cannot access their business'
    END as result,
    b.name as business_name
FROM user_profiles up
JOIN businesses b ON b.id = up.business_id
WHERE up.user_id = '3beb833d-aeaa-4393-91b6-6cf41df50421'
GROUP BY b.name;

-- ====================================================
-- TEST 3: STORES ACCESS (Frontend needs this)
-- ====================================================
WITH user_business AS (
    SELECT business_id FROM user_profiles 
    WHERE user_id = '3beb833d-aeaa-4393-91b6-6cf41df50421'
)
SELECT 
    '3. STORES ACCESS' as test_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ PASS - User can access their stores'
        ELSE '❌ FAIL - User cannot access their stores'
    END as result,
    COUNT(*) as stores_accessible
FROM stores s
WHERE s.business_id IN (SELECT business_id FROM user_business);

-- ====================================================
-- TEST 4: EMAILS ACCESS (Frontend needs this)
-- ====================================================
WITH user_business AS (
    SELECT business_id FROM user_profiles 
    WHERE user_id = '3beb833d-aeaa-4393-91b6-6cf41df50421'
),
business_stores AS (
    SELECT id FROM stores 
    WHERE business_id IN (SELECT business_id FROM user_business)
)
SELECT 
    '4. EMAILS ACCESS' as test_name,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ PASS - User can access their emails'
        ELSE '❌ FAIL - User cannot access their emails'
    END as result,
    COUNT(*) as emails_accessible
FROM emails 
WHERE store_id IN (SELECT id FROM business_stores);

-- ====================================================
-- TEST 5: CROSS-BUSINESS SECURITY (Must be blocked)
-- ====================================================
WITH user_business AS (
    SELECT business_id FROM user_profiles 
    WHERE user_id = '3beb833d-aeaa-4393-91b6-6cf41df50421'
)
SELECT 
    '5. CROSS-BUSINESS SECURITY' as test_name,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ PASS - No access to other businesses'
        ELSE '❌ FAIL - Can access other businesses'
    END as result,
    COUNT(*) as other_business_stores
FROM stores s
WHERE s.business_id NOT IN (SELECT business_id FROM user_business);

-- ====================================================
-- TEST 6: EMAIL CROSS-BUSINESS SECURITY
-- ====================================================
WITH user_business AS (
    SELECT business_id FROM user_profiles 
    WHERE user_id = '3beb833d-aeaa-4393-91b6-6cf41df50421'
),
other_business_stores AS (
    SELECT id FROM stores 
    WHERE business_id NOT IN (SELECT business_id FROM user_business)
)
SELECT 
    '6. EMAIL CROSS-BUSINESS SECURITY' as test_name,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ PASS - No access to other business emails'
        ELSE '❌ FAIL - Can access other business emails'
    END as result,
    COUNT(*) as other_business_emails
FROM emails 
WHERE store_id IN (SELECT id FROM other_business_stores);

-- ====================================================
-- SUMMARY
-- ====================================================
SELECT '=== SUMMARY ===' as summary;
SELECT 'If all tests show ✅ PASS, the RLS fix is successful' as instruction;
SELECT 'Any ❌ FAIL results indicate issues that need to be addressed' as warning; 