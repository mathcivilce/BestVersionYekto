-- Fix team_invitations unique constraint
-- The current constraint prevents multiple cancelled/expired invitations for the same email
-- We only want to prevent duplicate PENDING invitations

-- Drop the overly restrictive constraint
ALTER TABLE team_invitations 
DROP CONSTRAINT IF EXISTS team_invitations_email_business_id_status_key;

-- Create a partial unique index that only applies to pending invitations
-- This allows multiple cancelled/expired invitations but prevents duplicate pending ones
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_team_invitations_unique_pending
ON team_invitations (email, business_id)
WHERE status = 'pending';

-- Add a comment explaining the constraint
COMMENT ON INDEX idx_team_invitations_unique_pending IS 
'Ensures only one pending invitation per email per business, while allowing multiple cancelled/expired invitations'; 