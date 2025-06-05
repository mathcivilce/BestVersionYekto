/*
  # Add insert policy for stores table

  1. Changes
    - Add new RLS policy to allow authenticated users to insert rows into stores table
    - Policy ensures users can only insert rows with their own user_id

  2. Security
    - Users can only insert stores for themselves
    - Maintains existing RLS policies
*/

-- Drop existing policy if it exists to avoid conflicts
DROP POLICY IF EXISTS "Users can insert their own stores" ON stores;

-- Create new insert policy
CREATE POLICY "Users can insert their own stores"
ON stores
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);