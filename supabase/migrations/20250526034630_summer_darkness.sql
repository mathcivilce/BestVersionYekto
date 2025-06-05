/*
  # Add internal notes table

  1. New Tables
    - `internal_notes`
      - `id` (uuid, primary key)
      - `email_id` (uuid, references emails)
      - `user_id` (uuid, references auth.users)
      - `content` (text)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid REFERENCES emails ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE internal_notes ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their own notes"
  ON internal_notes
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);