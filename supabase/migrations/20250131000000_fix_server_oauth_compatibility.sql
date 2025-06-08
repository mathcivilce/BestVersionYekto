/*
  # Fix Server OAuth Compatibility Issues
  
  ## CRITICAL FIXES FOR SERVER OAUTH + REFRESH TOKEN COMPATIBILITY
  
  ### Issues Fixed:
  1. oauth_pending table missing code_verifier column (CRITICAL)
  2. Add performance indexes for multi-platform filtering
  3. Prepare database for OAuth-aware token refresh system
  
  ### Changes:
  - Add code_verifier column to oauth_pending table
  - Add performance indexes for platform/oauth_method filtering
  - Add token expiration index for efficient refresh queries
  
  ### Impact:
  - Fixes server OAuth callback failures
  - Improves query performance for refresh token system
  - Prepares for multi-platform email integration (Gmail, IMAP, etc.)
  
  ### Backward Compatibility:
  - All changes are additive (IF NOT EXISTS clauses)
  - No existing data affected
  - No breaking changes to existing functionality
*/

-- =============================================
-- 1. FIX OAUTH_PENDING TABLE SCHEMA
-- =============================================

-- Add missing code_verifier column that oauth-callback function expects
-- This fixes the critical bug where server OAuth flow fails
ALTER TABLE oauth_pending ADD COLUMN IF NOT EXISTS code_verifier TEXT;

-- Add comment to document the column purpose
COMMENT ON COLUMN oauth_pending.code_verifier IS 'PKCE code verifier for secure OAuth flow - prevents authorization code interception attacks';

-- =============================================
-- 2. ADD PERFORMANCE INDEXES FOR MULTI-PLATFORM SUPPORT
-- =============================================

-- Index for efficient platform + oauth_method + connection filtering
-- Used by refresh-tokens and renew-subscriptions functions
CREATE INDEX IF NOT EXISTS idx_stores_platform_oauth_connected 
ON stores(platform, oauth_method, connected) 
WHERE connected = true;

-- Index for efficient token expiration queries
-- Used by refresh-tokens cron job to find expiring tokens
CREATE INDEX IF NOT EXISTS idx_stores_token_expiry 
ON stores(token_expires_at) 
WHERE connected = true AND oauth_method = 'server_side' AND token_expires_at IS NOT NULL;

-- Index for subscription renewal queries
-- Improves performance when joining graph_subscriptions with stores
CREATE INDEX IF NOT EXISTS idx_graph_subscriptions_store_expiry 
ON graph_subscriptions(store_id, expiration_date) 
WHERE expiration_date IS NOT NULL;

-- =============================================
-- 3. ADD PLATFORM-SPECIFIC INDEXES
-- =============================================

-- Index for OAuth platforms that need refresh tokens
-- Currently only 'outlook', but prepared for 'gmail', 'yahoo', etc.
CREATE INDEX IF NOT EXISTS idx_stores_oauth_platforms 
ON stores(platform) 
WHERE connected = true AND oauth_method = 'server_side' AND platform IN ('outlook');

-- =============================================
-- 4. ADD TABLE COMMENTS FOR DOCUMENTATION
-- =============================================

-- Document the oauth_pending table purpose
COMMENT ON TABLE oauth_pending IS 'Temporary storage for server-side OAuth state management. Records are automatically cleaned up after successful completion or expiration.';

-- Document critical columns
COMMENT ON COLUMN oauth_pending.state IS 'CSRF protection state parameter - must match between initiate and callback';
COMMENT ON COLUMN oauth_pending.expires_at IS 'Security timeout - pending requests expire after 10 minutes';
COMMENT ON COLUMN oauth_pending.store_data IS 'Store configuration data passed from frontend to callback';

-- =============================================
-- 5. VERIFY SCHEMA INTEGRITY
-- =============================================

-- Ensure all required columns exist for server OAuth flow
DO $$
BEGIN
  -- Verify oauth_pending has all required columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'oauth_pending' AND column_name = 'code_verifier'
  ) THEN
    RAISE EXCEPTION 'Critical: oauth_pending.code_verifier column not created properly';
  END IF;
  
  -- Verify stores table has required OAuth columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'stores' AND column_name = 'oauth_method'
  ) THEN
    RAISE EXCEPTION 'Critical: stores.oauth_method column missing';
  END IF;
  
  RAISE NOTICE 'Database schema verification completed successfully';
END $$; 