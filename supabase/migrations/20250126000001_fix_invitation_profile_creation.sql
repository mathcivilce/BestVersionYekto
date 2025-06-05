-- Fix RLS policies for invitation-based profile creation
-- The accept-invitation Edge Function needs to be able to create user profiles

-- Drop and recreate the INSERT policy for user_profiles to allow service role operations
DROP POLICY IF EXISTS "Allow profile creation during invitation acceptance" ON user_profiles;
DROP POLICY IF EXISTS "Admins can manage team members" ON user_profiles;

-- Create a comprehensive INSERT policy that covers both regular profile creation and invitation acceptance
CREATE POLICY "Allow profile creation and invitation acceptance" ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow users to create their own profile
    auth.uid() = user_id 
    OR 
    -- Allow admins to create profiles for their business members
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
    OR
    -- Allow service role to create profiles (for Edge Functions)
    auth.jwt() ->> 'role' = 'service_role'
  );

-- Recreate the comprehensive admin management policy for all operations
CREATE POLICY "Admins can manage team members" ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
    OR
    -- Allow service role to manage profiles (for Edge Functions)
    auth.jwt() ->> 'role' = 'service_role'
  );

-- Add comment explaining the service role exception
COMMENT ON POLICY "Allow profile creation and invitation acceptance" ON user_profiles IS 
'Allows users to create own profiles, admins to create business member profiles, and service role (Edge Functions) to create invited user profiles';

COMMENT ON POLICY "Admins can manage team members" ON user_profiles IS 
'Allows admins to manage team members and service role (Edge Functions) to process invitations'; 