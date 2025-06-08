/*
  # Team Management System Implementation
  
  This migration establishes a comprehensive team management system for the email management application.
  It implements a business-centric multi-tenant architecture where users belong to businesses and
  can collaborate on email management tasks.

  ## Database Schema Overview:
  
  1. **New Tables**
     - `businesses` - Central business entities that own email stores and team members
     - `team_invitations` - Manages pending team member invitations with token-based security

  2. **Modified Tables**
     - `user_profiles` - Enhanced with business relationships, roles, and invitation tracking

  3. **Security Model**
     - Business-centric Row Level Security (RLS) policies
     - Role-based access control (admin, agent, observer)
     - Secure invitation system with expiring tokens
     - Multi-tenant data isolation

  4. **Functions & Triggers**
     - Automatic timestamp updates
     - Permission checking functions
     - Data integrity enforcement

  ## Business Model:
  - Each business can have multiple team members
  - Users can only belong to one business at a time
  - Admins can invite new team members and manage business settings
  - Agents can handle emails and perform day-to-day operations
  - Observers have read-only access for reporting and monitoring

  ## Security Features:
  - Complete data isolation between businesses
  - Token-based invitation system with expiration
  - Role-based permissions for different operations
  - Audit trail for invitation acceptance
*/

-- =============================================
-- 1. CREATE BUSINESSES TABLE
-- =============================================
-- Central table for business entities in the multi-tenant system
-- Each business owns email stores, team members, and related data

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                              -- Business display name
  created_at timestamptz DEFAULT now(),            -- Business creation timestamp
  created_by uuid REFERENCES auth.users NOT NULL, -- User who created the business
  updated_at timestamptz DEFAULT now()             -- Last modification timestamp
);

-- Enable Row Level Security for multi-tenant data isolation
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- Performance optimization: Index on creator for faster lookups
CREATE INDEX IF NOT EXISTS idx_businesses_created_by ON businesses(created_by);

-- =============================================
-- 2. MODIFY USER_PROFILES TABLE
-- =============================================
-- Enhance existing user profiles with business relationships and team management features

-- Add business relationship and role management columns
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id),     -- Business membership
ADD COLUMN IF NOT EXISTS business_name text,                             -- Cached business name for performance
ADD COLUMN IF NOT EXISTS role text DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'observer')), -- User role within business
ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users,          -- Who invited this user
ADD COLUMN IF NOT EXISTS invitation_token text,                          -- Invitation token for acceptance
ADD COLUMN IF NOT EXISTS invitation_expires_at timestamptz;              -- Token expiration time

-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_business_id ON user_profiles(business_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_invitation_token ON user_profiles(invitation_token);

-- =============================================
-- 3. CREATE TEAM_INVITATIONS TABLE
-- =============================================
-- Manages the invitation workflow for adding new team members to businesses
-- Provides secure, token-based invitation system with expiration and status tracking

CREATE TABLE IF NOT EXISTS team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,                                                    -- Invitee's email address
  business_id uuid REFERENCES businesses(id) NOT NULL,                   -- Target business
  role text DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'observer')), -- Assigned role
  invited_by uuid REFERENCES auth.users NOT NULL,                        -- Inviting user
  invitation_token text UNIQUE NOT NULL,                                 -- Secure invitation token
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')), -- Invitation status
  expires_at timestamptz NOT NULL,                                       -- Token expiration time
  created_at timestamptz DEFAULT now(),                                  -- Invitation creation time
  accepted_at timestamptz,                                               -- Acceptance timestamp
  UNIQUE(email, business_id, status) -- Prevent duplicate pending invitations for same email/business
);

-- Enable Row Level Security for invitation data protection
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- Performance indexes for invitation management queries
CREATE INDEX IF NOT EXISTS idx_team_invitations_business_id ON team_invitations(business_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email_status ON team_invitations(email, status);

-- =============================================
-- 4. INITIALIZE EXISTING DATA
-- =============================================
-- Migrate existing users to the new business-centric model
-- Creates a default business for backward compatibility

-- Create a default business for existing users who don't have one
INSERT INTO businesses (name, created_by)
SELECT 'Default Business', id
FROM auth.users
WHERE id NOT IN (SELECT created_by FROM businesses)
LIMIT 1;

-- Assign all existing users to the default business with admin privileges
-- This ensures backward compatibility for existing installations
DO $$
DECLARE
  default_business_id uuid;
BEGIN
  -- Get the default business ID
  SELECT id INTO default_business_id 
  FROM businesses 
  WHERE name = 'Default Business' 
  LIMIT 1;
  
  -- Update all existing user profiles to reference the default business
  -- All existing users become admins of the default business
  UPDATE user_profiles 
  SET business_id = default_business_id,
      business_name = 'Default Business',
      role = 'admin'
  WHERE business_id IS NULL;
END $$;

-- =============================================
-- 5. CLEAR EXISTING RESTRICTIVE POLICIES
-- =============================================
-- Remove old single-user policies to implement business-centric security

-- Drop existing user_profiles policies that don't account for business relationships
DROP POLICY IF EXISTS "Users can manage their own profile" ON user_profiles;

-- =============================================
-- 6. CREATE NEW BUSINESS-CENTRIC POLICIES
-- =============================================
-- Implement comprehensive Row Level Security policies for multi-tenant architecture

-- BUSINESSES TABLE POLICIES
-- Users can view their own business information
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

-- Only business admins can update business information
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

-- Authenticated users can create new businesses (becomes admin automatically)
CREATE POLICY "Users can create businesses"
  ON businesses
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- USER_PROFILES TABLE POLICIES
-- Users can view all profiles within their business (for team collaboration)
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

-- Users can update their own profile information
CREATE POLICY "Users can update their own profile"
  ON user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Business admins can manage all team member profiles
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

-- Allow profile creation during invitation acceptance and by admins
CREATE POLICY "Allow profile creation during invitation acceptance"
  ON user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id OR  -- Users can create their own profile
    business_id IN (         -- Admins can create profiles for team members
      SELECT business_id 
      FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- TEAM_INVITATIONS TABLE POLICIES
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
      JOIN user_profiles current_user ON current_user.business_id = up.business_id
      WHERE current_user.user_id = auth.uid()
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
      JOIN user_profiles current_user ON current_user.business_id = up.business_id
      WHERE current_user.user_id = auth.uid()
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