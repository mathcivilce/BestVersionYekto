/*
  # Fix Remove Member RLS Policy

  1. Problem
    - Current "Admins can manage team members" policy prevents setting business_id to null
    - USING clause checks if business_id matches admin's business, but fails when setting to null
    - Remove member operation fails silently due to RLS policy restriction

  2. Solution
    - Split the monolithic "FOR ALL" policy into specific operation policies
    - CREATE separate policies for SELECT, UPDATE, INSERT, DELETE
    - UPDATE policy allows admins to remove members (set business_id to null)
    - Maintain security while enabling proper team member removal

  3. Requirements
    - Soft-delete approach (business_id = null)
    - Stores remain in business when admin is removed
    - Allow immediate re-invitation
    - Maintain business-level data isolation
*/

-- =============================================
-- 1. DROP EXISTING CONFLICTING POLICY
-- =============================================

-- Remove the overly broad policy that's causing the issue
DROP POLICY IF EXISTS "Admins can manage team members" ON user_profiles;

-- =============================================
-- 2. CREATE SPECIFIC ADMIN MANAGEMENT POLICIES
-- =============================================

-- Admins can SELECT (view) all team members in their business
CREATE POLICY "Admins can view team members" ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    )
    OR user_id = auth.uid() -- Users can always see their own profile
  );

-- Admins can UPDATE team members in their business
-- CRITICAL: This allows setting business_id to null for member removal
CREATE POLICY "Admins can update team members" ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Can select the row to update if it's in admin's business
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    )
    OR user_id = auth.uid() -- Users can always update their own profile
  )
  WITH CHECK (
    -- Allow final state after update
    -- This is crucial: allows business_id to be null (removal) or remain in business
    (business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    ))
    OR business_id IS NULL  -- Allow removal (setting business_id to null)
    OR user_id = auth.uid() -- Users can always update their own profile
  );

-- Admins can INSERT new team members into their business
CREATE POLICY "Admins can create team members" ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    )
    OR user_id = auth.uid() -- Users can create their own profile
  );

-- Admins can DELETE team members (if hard delete is ever needed)
-- Currently not used since we do soft delete, but included for completeness
CREATE POLICY "Admins can delete team members" ON user_profiles
  FOR DELETE
  TO authenticated
  USING (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    )
    AND user_id != auth.uid() -- Prevent self-deletion
  );

-- =============================================
-- 3. ENSURE OTHER EXISTING POLICIES REMAIN
-- =============================================

-- Verify that the general business member view policy exists
-- This allows non-admin team members to see each other
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'Users can view profiles in their business'
  ) THEN
    CREATE POLICY "Users can view profiles in their business" ON user_profiles
      FOR SELECT
      TO authenticated
      USING (
        business_id IN (
          SELECT up.business_id 
          FROM user_profiles up 
          WHERE up.user_id = auth.uid()
        )
        OR user_id = auth.uid()
      );
  END IF;
END $$;

-- Verify that the self-update policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_profiles' 
    AND policyname = 'Users can update their own profile'
  ) THEN
    CREATE POLICY "Users can update their own profile" ON user_profiles
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- =============================================
-- 4. CREATE HELPER FUNCTION FOR TESTING
-- =============================================

-- Function to test if a user can be removed from business
CREATE OR REPLACE FUNCTION can_admin_remove_member(admin_user_id uuid, target_user_id uuid)
RETURNS boolean AS $$
DECLARE
  admin_business_id uuid;
  target_business_id uuid;
  admin_role text;
BEGIN
  -- Get admin's business and role
  SELECT business_id, role INTO admin_business_id, admin_role
  FROM user_profiles 
  WHERE user_id = admin_user_id;
  
  -- Get target user's business
  SELECT business_id INTO target_business_id
  FROM user_profiles 
  WHERE user_id = target_user_id;
  
  -- Check if admin can remove the target user
  RETURN (
    admin_role = 'admin' AND
    admin_business_id = target_business_id AND
    admin_user_id != target_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 5. ADD COMMENTS FOR DOCUMENTATION
-- =============================================

COMMENT ON POLICY "Admins can view team members" ON user_profiles IS 
'Allows business admins to view all team members in their business. Users can always view their own profile.';

COMMENT ON POLICY "Admins can update team members" ON user_profiles IS 
'Allows business admins to update team member profiles, including removing members by setting business_id to null. Critical for remove member functionality.';

COMMENT ON POLICY "Admins can create team members" ON user_profiles IS 
'Allows business admins to create new team member profiles during invitation acceptance process.';

COMMENT ON POLICY "Admins can delete team members" ON user_profiles IS 
'Allows business admins to hard delete team members if needed. Currently unused as app uses soft delete approach.';

COMMENT ON FUNCTION can_admin_remove_member(uuid, uuid) IS 
'Helper function to test if an admin user can remove a target user from their business. Used for debugging and validation.'; 