/*
  # Add Email Direction and Recipient Fields
  
  This migration adds support for distinguishing between inbound and outbound emails
  by adding direction and recipient fields to the emails table.
  
  1. New Fields
    - `direction` (text) - 'inbound' or 'outbound' with constraint
    - `recipient` (text) - email address of the actual recipient
    
  2. Data Migration
    - Mark all existing emails as 'inbound' (default behavior)
    - Set recipient to null for existing emails (will be populated for new emails)
    
  3. Constraints
    - direction must be either 'inbound' or 'outbound'
    - Default direction is 'inbound' for backward compatibility
    
  Purpose:
  - Enable proper customer identification for Shopify data lookup
  - Support correct "To" field display in email threads
  - Provide foundation for email analytics and reporting by direction
*/

-- Add direction field with constraint
ALTER TABLE emails 
ADD COLUMN direction text CHECK (direction IN ('inbound', 'outbound')) DEFAULT 'inbound';

-- Add recipient field to store the actual email recipient
ALTER TABLE emails 
ADD COLUMN recipient text;

-- Update all existing emails to be marked as inbound
-- This ensures backward compatibility with the current data
UPDATE emails 
SET direction = 'inbound' 
WHERE direction IS NULL;

-- Add index on direction for performance (filtering by direction will be common)
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(direction);

-- Add index on recipient for performance (customer lookups)
CREATE INDEX IF NOT EXISTS idx_emails_recipient ON emails(recipient);

-- Add comment to document the new fields
COMMENT ON COLUMN emails.direction IS 'Email direction: inbound (received) or outbound (sent)';
COMMENT ON COLUMN emails.recipient IS 'Email address of the actual recipient (for outbound emails)'; 