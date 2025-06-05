/*
  # Add email thread support

  1. New Tables
    - `email_replies`
      - `id` (uuid, primary key)
      - `email_id` (uuid, references emails)
      - `user_id` (uuid, references auth.users)
      - `store_id` (uuid, references stores)
      - `graph_id` (text)
      - `content` (text)
      - `sent_at` (timestamptz)
      - `created_at` (timestamptz)

  2. Changes
    - Add `thread_id` column to emails table to group related emails
    - Add `parent_id` column to emails table for reply chains

  3. Security
    - Enable RLS on email_replies table
    - Add policies for authenticated users
*/

-- Create email_replies table
CREATE TABLE IF NOT EXISTS email_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid REFERENCES emails ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  store_id uuid REFERENCES stores ON DELETE CASCADE NOT NULL,
  graph_id text,
  content text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(graph_id, user_id)
);

-- Add thread_id and parent_id to emails table
ALTER TABLE emails 
ADD COLUMN IF NOT EXISTS thread_id text,
ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES emails(id);

-- Create index on thread_id
CREATE INDEX IF NOT EXISTS emails_thread_id_idx ON emails(thread_id);

-- Enable RLS
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;

-- Create policies for email_replies
CREATE POLICY "Users can manage their own replies"
  ON email_replies
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);