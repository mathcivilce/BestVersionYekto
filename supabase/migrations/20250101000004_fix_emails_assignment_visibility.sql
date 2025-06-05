/*
  # Fix emails table RLS policy for assignment visibility

  1. Problem
    - Business members can't see assigned_to field for emails assigned to other team members
    - Current RLS policy might be too restrictive for assignment collaboration

  2. Solution
    - Update emails table RLS policy to ensure business-wide visibility
    - All business members should see all email fields including assigned_to
    - Maintain security while enabling team collaboration

  3. Changes
    - Drop existing potentially conflicting policies
    - Create new comprehensive business-centric policy
    - Ensure proper business membership validation
*/

-- =============================================
-- 1. CLEAN UP EXISTING POLICIES
-- =============================================

-- Drop all existing email policies that might conflict
DROP POLICY IF EXISTS "Users can manage their own emails" ON emails;
DROP POLICY IF EXISTS "Business members can manage emails" ON emails;
DROP POLICY IF EXISTS "Users can insert their own emails" ON emails;
DROP POLICY IF EXISTS "Users can view their own emails" ON emails;

-- =============================================
-- 2. CREATE NEW COMPREHENSIVE BUSINESS POLICY
-- =============================================

-- Create a comprehensive policy that allows business members to see all emails
-- in their business, including full assignment information
CREATE POLICY "Business members can access all business emails"
  ON emails
  FOR ALL
  TO authenticated
  USING (
    -- Allow access if the email belongs to a store in the user's business
    store_id IN (
      SELECT s.id 
      FROM stores s
      JOIN user_profiles up ON up.business_id = s.business_id
      WHERE up.user_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Allow modifications if the email belongs to a store in the user's business
    store_id IN (
      SELECT s.id 
      FROM stores s
      JOIN user_profiles up ON up.business_id = s.business_id
      WHERE up.user_id = auth.uid()
    )
  );

-- =============================================
-- 3. VERIFY STORES TABLE POLICY IS CORRECT
-- =============================================

-- Ensure stores policy allows business-wide access
-- (This should already exist, but let's make sure)
DROP POLICY IF EXISTS "Business members can manage stores" ON stores;

CREATE POLICY "Business members can access business stores"
  ON stores
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid()
    )
  );

-- =============================================
-- 4. VERIFY USER_PROFILES POLICY FOR TEAM ACCESS
-- =============================================

-- Ensure user_profiles policy allows business members to see each other
-- This is needed for assignment name resolution
DROP POLICY IF EXISTS "Users can view profiles in their business" ON user_profiles;

CREATE POLICY "Business members can view team profiles"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid()
    )
  );

-- Keep existing update policy for own profile
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Keep existing policies for admins to manage team members
CREATE POLICY "Admins can manage team members" ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid() 
      AND up.role = 'admin'
    )
  ); 