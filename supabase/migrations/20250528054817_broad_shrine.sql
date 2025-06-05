/*
  # Add reply templates table

  1. New Tables
    - `reply_templates`
      - Store email reply templates
      - Links to auth.users table
      - Includes template name and content

  2. Security
    - Enable RLS
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE reply_templates ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their own templates"
  ON reply_templates
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_reply_templates_updated_at
    BEFORE UPDATE ON reply_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();