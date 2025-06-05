/*
  # Convert reply_templates to business-owned model

  1. Changes
    - Add business_id column to reply_templates table
    - Migrate existing templates to be owned by businesses
    - Update RLS policies to use business-centric access
    - Keep user_id for audit/created_by purposes

  2. Migration Steps
    - Add business_id column
    - Populate business_id from user_profiles
    - Update RLS policies

  3. Security
    - Business members can access all templates in their business
    - Maintains existing role-based permissions
*/

-- =============================================
-- 1. ADD BUSINESS_ID TO REPLY_TEMPLATES TABLE
-- =============================================

-- Add business_id column
ALTER TABLE reply_templates ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_reply_templates_business_id ON reply_templates(business_id);

-- =============================================
-- 2. MIGRATE EXISTING DATA
-- =============================================

-- Populate business_id for existing templates
UPDATE reply_templates 
SET business_id = (
  SELECT up.business_id 
  FROM user_profiles up 
  WHERE up.user_id = reply_templates.user_id 
  LIMIT 1
)
WHERE business_id IS NULL;

-- Make business_id NOT NULL (after data migration)
ALTER TABLE reply_templates ALTER COLUMN business_id SET NOT NULL;

-- =============================================
-- 3. UPDATE RLS POLICIES
-- =============================================

-- Drop existing reply_templates policies
DROP POLICY IF EXISTS "Users can manage their own templates" ON reply_templates;

-- Create new business-centric policies
CREATE POLICY "Business members can manage reply templates"
  ON reply_templates
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