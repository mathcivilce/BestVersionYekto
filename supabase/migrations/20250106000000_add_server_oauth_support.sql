/*
  # Add Server-Side OAuth Support

  1. Changes
    - Add oauth_method column to stores table (with safe default for existing records)
    - Create oauth_pending table for temporary OAuth state management
    - Add indexes for performance

  2. Security
    - All changes are additive and non-breaking
    - Existing stores automatically get 'msal_popup' method
    - RLS policies protect oauth_pending table
*/

-- =============================================
-- 1. ADD OAUTH_METHOD TO STORES TABLE
-- =============================================

-- Add oauth_method column with safe default for existing records
ALTER TABLE stores ADD COLUMN IF NOT EXISTS oauth_method TEXT DEFAULT 'msal_popup';

-- Add index for efficient routing queries
CREATE INDEX IF NOT EXISTS idx_stores_oauth_method ON stores(oauth_method);

-- =============================================
-- 2. CREATE OAUTH_PENDING TABLE
-- =============================================

-- Create table for temporary OAuth state management
CREATE TABLE IF NOT EXISTS oauth_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  business_id UUID NOT NULL,
  store_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE oauth_pending ENABLE ROW LEVEL SECURITY;

-- Add index for efficient state lookups
CREATE INDEX IF NOT EXISTS idx_oauth_pending_state ON oauth_pending(state);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_expires ON oauth_pending(expires_at);

-- =============================================
-- 3. RLS POLICIES FOR OAUTH_PENDING
-- =============================================

-- Policy for oauth_pending table
CREATE POLICY "Users can manage their own oauth_pending" ON oauth_pending
  FOR ALL 
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================
-- 4. CLEANUP FUNCTION FOR EXPIRED OAUTH STATES
-- =============================================

-- Function to clean up expired OAuth states (called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_pending()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM oauth_pending 
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION cleanup_expired_oauth_pending() TO authenticated; 