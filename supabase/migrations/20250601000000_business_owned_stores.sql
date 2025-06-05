/*
  # Convert stores to business-owned model

  1. Changes
    - Add business_id column to stores table
    - Migrate existing stores to be owned by businesses
    - Update RLS policies to use business-centric access
    - Keep user_id for audit/created_by purposes
    - Update unique constraints

  2. Migration Steps
    - Add business_id column
    - Populate business_id from user_profiles
    - Update constraints and indexes
    - Update RLS policies
    - Update emails table policies

  3. Security
    - Business members can access all stores in their business
    - Maintains existing role-based permissions
*/

-- =============================================
-- 1. ADD BUSINESS_ID TO STORES TABLE
-- =============================================

-- Add business_id column
ALTER TABLE stores ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_stores_business_id ON stores(business_id);

-- =============================================
-- 2. MIGRATE EXISTING DATA
-- =============================================

-- Populate business_id for existing stores
UPDATE stores 
SET business_id = (
  SELECT up.business_id 
  FROM user_profiles up 
  WHERE up.user_id = stores.user_id 
  LIMIT 1
)
WHERE business_id IS NULL;

-- =============================================
-- 3. UPDATE CONSTRAINTS
-- =============================================

-- Drop old unique constraint and create new business-scoped one
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_email_user_id_key;
ALTER TABLE stores ADD CONSTRAINT stores_email_business_unique UNIQUE(email, business_id);

-- Make business_id NOT NULL (after data migration)
ALTER TABLE stores ALTER COLUMN business_id SET NOT NULL;

-- =============================================
-- 4. UPDATE RLS POLICIES
-- =============================================

-- Drop existing stores policies
DROP POLICY IF EXISTS "Users can insert their own stores" ON stores;
DROP POLICY IF EXISTS "Users can manage their own stores" ON stores;
DROP POLICY IF EXISTS "Business members can manage stores" ON stores;

-- Create new business-centric policies
CREATE POLICY "Business members can manage stores"
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
-- 5. UPDATE EMAILS TABLE POLICIES  
-- =============================================

-- Drop existing emails policies
DROP POLICY IF EXISTS "Users can manage their own emails" ON emails;
DROP POLICY IF EXISTS "Business members can manage emails" ON emails;

-- Create new business-centric email policies
CREATE POLICY "Business members can manage emails"
  ON emails
  FOR ALL
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

-- =============================================
-- 6. UPDATE SHOPIFY INTEGRATION
-- =============================================

-- Update shopify_stores policies to use business-centric access
DROP POLICY IF EXISTS "Business members can manage shopify stores" ON shopify_stores;

CREATE POLICY "Business members can manage shopify stores"
  ON shopify_stores
  FOR ALL
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

-- =============================================
-- 7. CREATE HELPER FUNCTIONS
-- =============================================

-- Function to get stores for current user's business
CREATE OR REPLACE FUNCTION get_business_stores()
RETURNS TABLE (
  id uuid,
  name text,
  platform text,
  email text,
  connected boolean,
  status text,
  business_id uuid,
  user_id uuid,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.platform, s.email, s.connected, s.status, s.business_id, s.user_id, s.created_at
  FROM stores s
  JOIN user_profiles up ON up.business_id = s.business_id
  WHERE up.user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can access store
CREATE OR REPLACE FUNCTION can_access_store(store_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM stores s
    JOIN user_profiles up ON up.business_id = s.business_id
    WHERE s.id = store_uuid 
    AND up.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 