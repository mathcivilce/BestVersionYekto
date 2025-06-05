/*
  # Add email assignment support

  1. Changes
    - Add assigned_to column to emails table
    - Add foreign key constraint to auth.users
    - Add index for better query performance

  2. Notes
    - Maintains existing RLS policies
    - Allows tracking email assignments
*/

-- Add assigned_to column
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS emails_assigned_to_idx ON emails(assigned_to);