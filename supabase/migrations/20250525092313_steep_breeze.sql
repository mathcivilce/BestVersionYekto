/*
  # Add email threading improvements

  1. Changes
    - Add internet_message_id column to emails table
    - Add unique constraint on internet_message_id and user_id
    - Add index on thread_id for faster thread lookups
    - Add index on parent_id for faster reply chain lookups

  2. Notes
    - internet_message_id is the unique identifier from email headers
    - This prevents duplicate emails while allowing same email across different users
*/

-- Add internet_message_id column
ALTER TABLE emails ADD COLUMN IF NOT EXISTS internet_message_id text;

-- Add unique constraint on internet_message_id and user_id
ALTER TABLE emails ADD CONSTRAINT emails_internet_message_id_user_id_key 
  UNIQUE (internet_message_id, user_id);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS emails_thread_id_idx ON emails(thread_id);
CREATE INDEX IF NOT EXISTS emails_parent_id_idx ON emails(parent_id);