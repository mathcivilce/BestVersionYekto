/*
  # Enable Realtime for Internal Notes

  1. Changes
    - Enable realtime replication for internal_notes table
    - Update RLS policies to allow reading notes for team members in same business
    - This allows real-time collaboration on email notes

  2. Security
    - Maintain existing write restrictions (users can only create their own notes)
    - Allow read access to team members in the same business
*/

-- Enable realtime for internal_notes table
ALTER PUBLICATION supabase_realtime ADD TABLE internal_notes;

-- Drop existing policy to replace with more permissive read access
DROP POLICY IF EXISTS "Users can manage their own notes" ON internal_notes;

-- Create separate policies for read and write operations
CREATE POLICY "Users can read notes for their business emails"
ON internal_notes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM emails e
    INNER JOIN user_profiles up ON up.user_id = auth.uid()
    INNER JOIN user_profiles up2 ON up2.user_id = internal_notes.user_id
    WHERE e.id = internal_notes.email_id
    AND up.business_id = up2.business_id
  )
);

CREATE POLICY "Users can create their own notes"
ON internal_notes
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
ON internal_notes
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
ON internal_notes
FOR DELETE
TO authenticated
USING (auth.uid() = user_id); 