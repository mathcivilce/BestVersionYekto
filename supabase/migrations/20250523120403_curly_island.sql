/*
  # Create stores and emails tables

  1. New Tables
    - `stores`
      - `id` (uuid, primary key)
      - `name` (text)
      - `platform` (text)
      - `color` (text)
      - `email` (text)
      - `user_id` (uuid, references auth.users)
      - `connected` (boolean)
      - `status` (text)
      - `last_synced` (timestamptz)
      - `created_at` (timestamptz)
      
    - `emails`
      - `id` (uuid, primary key)
      - `subject` (text)
      - `from` (text)
      - `snippet` (text)
      - `content` (text)
      - `status` (text)
      - `priority` (integer)
      - `read` (boolean)
      - `date` (timestamptz)
      - `store_id` (uuid, references stores)
      - `user_id` (uuid, references auth.users)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to manage their own data
*/

-- Create stores table
CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  platform text NOT NULL,
  color text NOT NULL,
  email text NOT NULL,
  user_id uuid REFERENCES auth.users NOT NULL,
  connected boolean DEFAULT false,
  status text DEFAULT 'pending',
  last_synced timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(email, user_id)
);

-- Create emails table
CREATE TABLE IF NOT EXISTS emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  "from" text NOT NULL,
  snippet text,
  content text,
  status text DEFAULT 'open',
  priority integer DEFAULT 1,
  read boolean DEFAULT false,
  date timestamptz NOT NULL,
  store_id uuid REFERENCES stores ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

-- Create policies for stores
CREATE POLICY "Users can manage their own stores"
  ON stores
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create policies for emails
CREATE POLICY "Users can manage their own emails"
  ON emails
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);