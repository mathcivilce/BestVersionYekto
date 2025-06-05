/*
  # Add graph_id column to emails table

  1. Changes
    - Add graph_id column to emails table
    - Make graph_id unique to prevent duplicates during sync
    - Add index on graph_id for faster lookups

  2. Notes
    - Maintains existing UUID primary key for referential integrity
    - Allows storing Microsoft Graph API's opaque string IDs
*/

-- Add graph_id column
ALTER TABLE emails ADD COLUMN IF NOT EXISTS graph_id text;

-- Add unique constraint on graph_id and user_id
-- This prevents duplicate emails while allowing same email ID across different users
ALTER TABLE emails ADD CONSTRAINT emails_graph_id_user_id_key UNIQUE (graph_id, user_id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS emails_graph_id_idx ON emails (graph_id);