/*
  # Fix internal notes relationship with users

  1. Changes
    - Add foreign key constraint between internal_notes and users
    - Add index on user_id for better query performance

  2. Notes
    - This ensures proper relationship between internal_notes and users tables
    - Allows joining with user_profiles through users table
*/

-- Add index on user_id for better join performance
CREATE INDEX IF NOT EXISTS internal_notes_user_id_idx ON internal_notes(user_id);

-- Add foreign key constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'internal_notes_user_id_fkey'
  ) THEN
    ALTER TABLE internal_notes 
    ADD CONSTRAINT internal_notes_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id);
  END IF;
END $$;