/*
  # Add Email Direction and Recipient Fields to Email Replies
  
  This migration extends the email_replies table to include direction and recipient fields,
  maintaining consistency with the emails table structure.
  
  1. New Fields for email_replies
    - `direction` (text) - 'inbound' or 'outbound' with constraint
    - `recipient` (text) - email address of the actual recipient
    
  2. Data Migration
    - Mark all existing replies as 'outbound' (since all current replies are sent by users)
    - Set recipient to null for existing replies (will be populated for new replies)
    
  3. Constraints
    - direction must be either 'inbound' or 'outbound'
    - Default direction is 'outbound' for replies (users sending responses)
    
  Purpose:
  - Maintain consistency between emails and email_replies tables
  - Support future analytics and reporting on reply directions
  - Enable proper customer identification in email threads
*/

-- Add direction field with constraint to email_replies
ALTER TABLE email_replies 
ADD COLUMN direction text CHECK (direction IN ('inbound', 'outbound')) DEFAULT 'outbound';

-- Add recipient field to store the actual email recipient
ALTER TABLE email_replies 
ADD COLUMN recipient text;

-- Update all existing replies to be marked as outbound
-- This is correct since all current replies are sent by users to customers
UPDATE email_replies 
SET direction = 'outbound' 
WHERE direction IS NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_replies_direction ON email_replies(direction);
CREATE INDEX IF NOT EXISTS idx_email_replies_recipient ON email_replies(recipient);

-- Add comments to document the new fields
COMMENT ON COLUMN email_replies.direction IS 'Reply direction: inbound (received) or outbound (sent)';
COMMENT ON COLUMN email_replies.recipient IS 'Email address of the actual recipient (for outbound replies)'; 