/*
  # Fix stores table RLS policy

  1. Changes
    - Drop existing policies
    - Create new policies with proper user_id checks
    - Ensure authenticated users can only insert their own records
    - Maintain existing ALL policy for managing own stores

  2. Security
    - Strict user_id validation for inserts
    - Maintain existing row-level security
*/

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can insert their own stores" ON stores;
DROP POLICY IF EXISTS "Users can manage their own stores" ON stores;

-- Create insert-specific policy
CREATE POLICY "Users can insert their own stores"
ON stores
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id AND
  user_id IS NOT NULL
);

-- Create general management policy
CREATE POLICY "Users can manage their own stores"
ON stores
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);