-- ====================================================
-- COMPREHENSIVE RLS SECURITY FIX
-- ====================================================
-- This migration fixes critical security vulnerabilities in RLS policies
-- that allowed cross-business data access

BEGIN;

-- Drop all problematic overly permissive policies that allow unrestricted access
DROP POLICY IF EXISTS "Authenticated users can access emails" ON emails;
DROP POLICY IF EXISTS "Authenticated users can access stores" ON emails;
DROP POLICY IF EXISTS "Authenticated users can access stores" ON stores;

-- Also clean up any conflicting policies on related tables
DROP POLICY IF EXISTS "Users can view notes for accessible emails" ON internal_notes;
DROP POLICY IF EXISTS "Users can insert notes for accessible emails" ON internal_notes;

-- ====================================================
-- EMAILS TABLE - CRITICAL SECURITY FIX
-- ====================================================

-- Business members can SELECT emails from stores in their business
CREATE POLICY "Business members can select emails" ON emails
FOR SELECT
TO authenticated
USING (
    store_id IN (
        SELECT s.id 
        FROM stores s
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- Business members can INSERT emails for stores in their business
CREATE POLICY "Business members can insert emails" ON emails
FOR INSERT
TO authenticated
WITH CHECK (
    store_id IN (
        SELECT s.id 
        FROM stores s
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- Business members can UPDATE emails for stores in their business
CREATE POLICY "Business members can update emails" ON emails
FOR UPDATE
TO authenticated
USING (
    store_id IN (
        SELECT s.id 
        FROM stores s
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
)
WITH CHECK (
    store_id IN (
        SELECT s.id 
        FROM stores s
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- Business members can DELETE emails for stores in their business
CREATE POLICY "Business members can delete emails" ON emails
FOR DELETE
TO authenticated
USING (
    store_id IN (
        SELECT s.id 
        FROM stores s
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- ====================================================
-- STORES TABLE - CRITICAL SECURITY FIX
-- ====================================================

-- Drop the overly permissive policy and replace with proper business-scoped ones
-- (Keep the existing business-scoped policies as they are correct)

-- ====================================================
-- INTERNAL NOTES TABLE - FIX BUSINESS SCOPE
-- ====================================================

-- Business members can view internal notes for emails in their business
CREATE POLICY "Business members can select internal notes" ON internal_notes
FOR SELECT
TO authenticated
USING (
    email_id IN (
        SELECT e.id 
        FROM emails e
        JOIN stores s ON s.id = e.store_id
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- Business members can insert internal notes for emails in their business
CREATE POLICY "Business members can insert internal notes" ON internal_notes
FOR INSERT
TO authenticated
WITH CHECK (
    email_id IN (
        SELECT e.id 
        FROM emails e
        JOIN stores s ON s.id = e.store_id
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- Business members can update internal notes for emails in their business
CREATE POLICY "Business members can update internal notes" ON internal_notes
FOR UPDATE
TO authenticated
USING (
    email_id IN (
        SELECT e.id 
        FROM emails e
        JOIN stores s ON s.id = e.store_id
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
)
WITH CHECK (
    email_id IN (
        SELECT e.id 
        FROM emails e
        JOIN stores s ON s.id = e.store_id
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- Business members can delete internal notes for emails in their business
CREATE POLICY "Business members can delete internal notes" ON internal_notes
FOR DELETE
TO authenticated
USING (
    email_id IN (
        SELECT e.id 
        FROM emails e
        JOIN stores s ON s.id = e.store_id
        JOIN user_profiles up ON up.business_id = s.business_id
        WHERE up.user_id = auth.uid()
    )
);

-- ====================================================
-- EMAIL REPLIES TABLE - ENSURE BUSINESS SCOPE
-- ====================================================

-- The existing policy should be sufficient, but let's verify it exists
-- If it doesn't exist, create it

DO $$
BEGIN
    -- Check if the policy exists, create if not
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'email_replies' 
        AND policyname = 'Business members can manage email replies'
    ) THEN
        -- Create comprehensive policies for email_replies
        CREATE POLICY "Business members can select email replies" ON email_replies
        FOR SELECT
        TO authenticated
        USING (
            store_id IN (
                SELECT s.id 
                FROM stores s
                JOIN user_profiles up ON up.business_id = s.business_id
                WHERE up.user_id = auth.uid()
            )
        );

        CREATE POLICY "Business members can insert email replies" ON email_replies
        FOR INSERT
        TO authenticated
        WITH CHECK (
            store_id IN (
                SELECT s.id 
                FROM stores s
                JOIN user_profiles up ON up.business_id = s.business_id
                WHERE up.user_id = auth.uid()
            )
        );

        CREATE POLICY "Business members can update email replies" ON email_replies
        FOR UPDATE
        TO authenticated
        USING (
            store_id IN (
                SELECT s.id 
                FROM stores s
                JOIN user_profiles up ON up.business_id = s.business_id
                WHERE up.user_id = auth.uid()
            )
        )
        WITH CHECK (
            store_id IN (
                SELECT s.id 
                FROM stores s
                JOIN user_profiles up ON up.business_id = s.business_id
                WHERE up.user_id = auth.uid()
            )
        );

        CREATE POLICY "Business members can delete email replies" ON email_replies
        FOR DELETE
        TO authenticated
        USING (
            store_id IN (
                SELECT s.id 
                FROM stores s
                JOIN user_profiles up ON up.business_id = s.business_id
                WHERE up.user_id = auth.uid()
            )
        );
    END IF;
END $$;

-- ====================================================
-- ANALYTICS TABLE - ENSURE BUSINESS SCOPE
-- ====================================================

-- Verify analytics policies are business-scoped (they appear to be correct)

-- ====================================================
-- USER PROFILES TABLE - RESTRICT ACCESS
-- ====================================================

-- The current "authenticated_users_can_read_profiles" policy allows reading ANY profile
-- This should be restricted to business members only

DROP POLICY IF EXISTS "authenticated_users_can_read_profiles" ON user_profiles;

-- Business members can only view profiles within their business
CREATE POLICY "Business members can select profiles" ON user_profiles
FOR SELECT
TO authenticated
USING (
    business_id IN (
        SELECT up.business_id 
        FROM user_profiles up
        WHERE up.user_id = auth.uid()
    )
    OR user_id = auth.uid() -- Users can always see their own profile
);

-- ====================================================
-- VERIFY ALL CRITICAL TABLES HAVE RLS ENABLED
-- ====================================================

-- Ensure RLS is enabled on all critical tables
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- Force RLS on critical tables (no bypass for owners)
ALTER TABLE emails FORCE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
ALTER TABLE internal_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE email_replies FORCE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;

COMMIT;

-- ====================================================
-- VERIFICATION QUERIES (for manual testing)
-- ====================================================

-- Run these queries to verify policies are working:
-- 
-- 1. Check that emails are properly scoped:
-- SELECT email.id, store.business_id, profile.business_id as user_business 
-- FROM emails email
-- JOIN stores store ON store.id = email.store_id
-- JOIN user_profiles profile ON profile.user_id = auth.uid();
--
-- 2. Check that stores are properly scoped:
-- SELECT store.id, store.business_id, profile.business_id as user_business
-- FROM stores store
-- JOIN user_profiles profile ON profile.user_id = auth.uid()
-- WHERE store.business_id = profile.business_id;
--
-- 3. Verify no cross-business access by switching users and running queries 