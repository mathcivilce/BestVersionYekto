/*
  # Add token refresh support to stores table

  1. Changes
    - Add refresh_token column to store Microsoft refresh tokens
    - Add token_expires_at column to track token expiration
    - Add token_last_refreshed column to track last refresh attempt

  2. Security
    - Columns are protected by existing RLS policies
*/

-- Add refresh token and expiration tracking
ALTER TABLE stores ADD COLUMN IF NOT EXISTS refresh_token text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS token_last_refreshed timestamptz;

-- Add index for efficient token expiration queries
CREATE INDEX IF NOT EXISTS idx_stores_token_expires_at ON stores(token_expires_at) WHERE token_expires_at IS NOT NULL; 