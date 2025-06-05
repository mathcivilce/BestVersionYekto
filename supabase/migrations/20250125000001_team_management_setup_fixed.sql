/*
  # Team Management System Implementation - Fixed

  1. New Tables
    - `businesses` - Store business information
    - `team_invitations` - Track pending invitations

  2. Modified Tables
    - `user_profiles` - Add business relationship and role management

  3. Security
    - Business-centric RLS policies
    - Role-based access control
    - Invitation system security

  4. Functions
    - Trigger functions for auto-assignment
    - Permission checking functions
*/

-- =============================================
-- 1. CREATE BUSINESSES TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on businesses
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_businesses_created_by ON businesses(created_by);

-- =============================================
-- 2. MODIFY USER_PROFILES TABLE
-- =============================================

-- Add business relationship and role columns
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id),
ADD COLUMN IF NOT EXISTS business_name text,
ADD COLUMN IF NOT EXISTS role text DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'observer')),
ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users,
ADD COLUMN IF NOT EXISTS invitation_token text,
ADD COLUMN IF NOT EXISTS invitation_expires_at timestamptz;

-- Create non-unique index on business_id for performance (NOT unique constraint)
CREATE INDEX IF NOT EXISTS idx_user_profiles_business_id ON user_profiles(business_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_invitation_token ON user_profiles(invitation_token);

-- =============================================
-- 3. CREATE TEAM_INVITATIONS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  business_id uuid REFERENCES businesses(id) NOT NULL,
  role text DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'observer')),
  invited_by uuid REFERENCES auth.users NOT NULL,
  invitation_token text UNIQUE NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(email, business_id, status) -- Prevent duplicate pending invitations
);

-- Enable RLS on team_invitations
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_team_invitations_business_id ON team_invitations(business_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email_status ON team_invitations(email, status);

-- =============================================
-- 4. INITIALIZE EXISTING DATA
-- =============================================

-- Create a default business for existing users
INSERT INTO businesses (name, created_by)
SELECT 'Default Business', id
FROM auth.users
WHERE id NOT IN (SELECT created_by FROM businesses)
LIMIT 1;

-- Get the default business ID and update existing profiles
DO $$
DECLARE
  default_business_id uuid;
BEGIN
  SELECT id INTO default_business_id 
  FROM businesses 
  WHERE name = 'Default Business' 
  LIMIT 1;
  
  -- Update all existing user profiles to reference the default business
  UPDATE user_profiles 
  SET business_id = default_business_id,
      business_name = 'Default Business',
      role = 'admin'
  WHERE business_id IS NULL;
END $$;

-- =============================================
-- 5. CLEAR EXISTING RESTRICTIVE POLICIES
-- =============================================

-- Drop existing user_profiles policies
DROP POLICY IF EXISTS "Users can manage their own profile" ON user_profiles;

-- =============================================
-- 6. CREATE NEW BUSINESS-CENTRIC POLICIES
-- =============================================

-- Businesses table policies
CREATE POLICY "Users can view their business"
  ON businesses
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can update their business"
  ON businesses
  FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

CREATE POLICY "Users can create businesses"
  ON businesses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- User_profiles table policies
CREATE POLICY "Users can view profiles in their business"
  ON user_profiles
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own profile"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage team members"
  ON user_profiles
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

CREATE POLICY "Allow profile creation during invitation acceptance"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id OR
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Team_invitations table policies
CREATE POLICY "Users can view invitations for their business"
  ON team_invitations
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage invitations"
  ON team_invitations
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- =============================================
-- 7. UPDATE EXISTING TABLE POLICIES
-- =============================================

-- Update stores table policies to be business-aware
DROP POLICY IF EXISTS "Users can manage their own stores" ON stores;

CREATE POLICY "Business members can manage stores"
  ON stores
  FOR ALL
  TO authenticated
  USING (
    user_id IN (
      SELECT up.user_id 
      FROM user_profiles up
      JOIN user_profiles cu ON cu.business_id = up.business_id
      WHERE cu.user_id = auth.uid()
    )
  );

-- Update emails table policies to be business-aware
DROP POLICY IF EXISTS "Users can manage their own emails" ON emails;

CREATE POLICY "Business members can manage emails"
  ON emails
  FOR ALL
  TO authenticated
  USING (
    user_id IN (
      SELECT up.user_id 
      FROM user_profiles up
      JOIN user_profiles cu ON cu.business_id = up.business_id
      WHERE cu.user_id = auth.uid()
    )
  );

-- =============================================
-- 8. UTILITY FUNCTIONS
-- =============================================

-- Function to check if user is admin in their business
CREATE OR REPLACE FUNCTION is_business_admin(user_uuid uuid DEFAULT auth.uid())
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM user_profiles 
    WHERE user_id = user_uuid 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's business_id
CREATE OR REPLACE FUNCTION get_user_business_id(user_uuid uuid DEFAULT auth.uid())
RETURNS uuid AS $$
DECLARE
  business_uuid uuid;
BEGIN
  SELECT business_id INTO business_uuid
  FROM user_profiles 
  WHERE user_id = user_uuid;
  
  RETURN business_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to expire old invitations
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS void AS $$
BEGIN
  UPDATE team_invitations 
  SET status = 'expired'
  WHERE status = 'pending' 
  AND expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 9. TRIGGERS
-- =============================================

-- Trigger to update updated_at on businesses
CREATE TRIGGER update_businesses_updated_at
    BEFORE UPDATE ON businesses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to auto-create business when user profile is created
CREATE OR REPLACE FUNCTION auto_create_business_for_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_business_id uuid;
BEGIN
  -- If business_id is not provided, create a new business
  IF NEW.business_id IS NULL THEN
    INSERT INTO businesses (name, created_by)
    VALUES (COALESCE(NEW.first_name || '''s Business', 'My Business'), NEW.user_id)
    RETURNING id INTO new_business_id;
    
    NEW.business_id := new_business_id;
    NEW.business_name := COALESCE(NEW.first_name || '''s Business', 'My Business');
    NEW.role := 'admin';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_create_business_trigger
    BEFORE INSERT ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_business_for_new_user(); 