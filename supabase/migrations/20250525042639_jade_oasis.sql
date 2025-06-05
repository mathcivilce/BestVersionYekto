/*
  # Add indexes for better email query performance

  1. Changes
    - Add index on store_id and date for faster email filtering
    - Add index on user_id and date for faster user-specific queries
    - Add index on read status for faster unread filtering
    - Add index on status for faster status filtering

  2. Notes
    - These indexes will improve query performance for common email operations
    - Composite indexes are used to optimize multiple column filtering
*/

-- Add composite index for store_id and date
CREATE INDEX IF NOT EXISTS emails_store_id_date_idx ON emails(store_id, date DESC);

-- Add composite index for user_id and date
CREATE INDEX IF NOT EXISTS emails_user_id_date_idx ON emails(user_id, date DESC);

-- Add index for read status
CREATE INDEX IF NOT EXISTS emails_read_idx ON emails(read);

-- Add index for email status
CREATE INDEX IF NOT EXISTS emails_status_idx ON emails(status);

-- Add index for graph_id for faster lookups
CREATE INDEX IF NOT EXISTS emails_graph_id_idx ON emails(graph_id);

-- Add index for thread_id for faster thread lookups
CREATE INDEX IF NOT EXISTS emails_thread_id_idx ON emails(thread_id);