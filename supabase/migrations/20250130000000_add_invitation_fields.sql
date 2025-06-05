/*
  # Enhanced Team Invitations

  1. Tables Modified
    - `team_invitations` - Add first_name, last_name, job_title fields

  2. Purpose
    - Support enhanced invitation modal with complete user information
    - Enable personalized invitation emails
    - Store all required user data during invitation process
*/

-- =============================================
-- 1. ADD NEW FIELDS TO TEAM_INVITATIONS TABLE
-- =============================================

-- Add new fields for enhanced invitation system
ALTER TABLE team_invitations 
ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS job_title text;

-- Update the constraint to ensure first_name and last_name are not empty when provided
ALTER TABLE team_invitations 
ADD CONSTRAINT check_first_name_not_empty CHECK (length(trim(first_name)) >= 2),
ADD CONSTRAINT check_last_name_not_empty CHECK (length(trim(last_name)) >= 2),
ADD CONSTRAINT check_job_title_not_empty CHECK (job_title IS NULL OR length(trim(job_title)) >= 2);

-- Create indexes for performance on new fields
CREATE INDEX IF NOT EXISTS idx_team_invitations_names ON team_invitations(first_name, last_name);

-- =============================================
-- 2. VERIFY USER_PROFILES HAS JOB_TITLE
-- =============================================

-- Ensure user_profiles table has job_title field for compatibility
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS job_title text;

-- Add constraint for job_title if provided
ALTER TABLE user_profiles 
ADD CONSTRAINT IF NOT EXISTS check_profile_job_title_not_empty 
CHECK (job_title IS NULL OR length(trim(job_title)) >= 2);

-- =============================================
-- 3. UPDATE EXISTING PENDING INVITATIONS
-- =============================================

-- Set default values for existing pending invitations to avoid constraint violations
UPDATE team_invitations 
SET 
  first_name = CASE 
    WHEN first_name = '' OR first_name IS NULL THEN 'Pending'
    ELSE first_name 
  END,
  last_name = CASE 
    WHEN last_name = '' OR last_name IS NULL THEN 'User'
    ELSE last_name 
  END
WHERE status = 'pending' AND (first_name = '' OR first_name IS NULL OR last_name = '' OR last_name IS NULL); 