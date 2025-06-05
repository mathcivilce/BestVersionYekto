/*
  # Fix internal notes relationships

  1. Changes
    - Add foreign key constraint between internal_notes and user_profiles
    - Add index on user_id for better join performance
    - Update RLS policy to include user profile access

  2. Notes
    - Maintains existing RLS policies
    - Ensures proper relationship for user profile data
*/

-- Drop existing foreign key if it exists
ALTER TABLE internal_notes
DROP CONSTRAINT IF EXISTS internal_notes_user_id_fkey;

-- Add foreign key constraint to user_profiles
ALTER TABLE internal_notes
ADD CONSTRAINT internal_notes_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id);

-- Add index for user_id if it doesn't exist
CREATE INDEX IF NOT EXISTS internal_notes_user_id_idx ON internal_notes(user_id);

-- Drop existing policy
DROP POLICY IF EXISTS "Users can manage their own notes" ON internal_notes;

-- Create updated policy that includes access to user profiles
CREATE POLICY "Users can manage their own notes"
ON internal_notes
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Add index on email_id for better performance
CREATE INDEX IF NOT EXISTS internal_notes_email_id_idx ON internal_notes(email_id);