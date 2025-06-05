/*
  # Email Presence System

  1. New Tables
    - `email_presence`
      - Track which users are currently viewing emails
      - Includes heartbeat mechanism for active detection
      - Business-scoped access

  2. Security
    - Enable RLS
    - Business members can see presence of other business members

  3. Functions
    - Cleanup stale presence records
    - Get current viewers for an email
*/

-- =============================================
-- 1. CREATE EMAIL_PRESENCE TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS email_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid REFERENCES emails(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  business_id uuid REFERENCES businesses(id) NOT NULL,
  last_seen timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  
  -- Ensure one presence record per user per email
  UNIQUE(email_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_presence_email_id ON email_presence(email_id);
CREATE INDEX IF NOT EXISTS idx_email_presence_user_id ON email_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_email_presence_business_id ON email_presence(business_id);
CREATE INDEX IF NOT EXISTS idx_email_presence_last_seen ON email_presence(last_seen);

-- =============================================
-- 2. ENABLE RLS AND CREATE POLICIES
-- =============================================

ALTER TABLE email_presence ENABLE ROW LEVEL SECURITY;

-- Business members can manage presence records
CREATE POLICY "Business members can manage email presence"
  ON email_presence
  FOR ALL
  TO authenticated
  USING (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT up.business_id 
      FROM user_profiles up 
      WHERE up.user_id = auth.uid()
    )
  );

-- =============================================
-- 3. HELPER FUNCTIONS
-- =============================================

-- Function to cleanup stale presence records (older than 2 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM email_presence 
  WHERE last_seen < (now() - interval '2 minutes');
END;
$$;

-- Function to get current viewers for an email
CREATE OR REPLACE FUNCTION get_email_viewers(email_uuid uuid)
RETURNS TABLE (
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  last_seen timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- First cleanup stale records
  PERFORM cleanup_stale_presence();
  
  -- Return active viewers
  RETURN QUERY
  SELECT 
    ep.user_id,
    up.first_name,
    up.last_name,
    u.email,
    ep.last_seen
  FROM email_presence ep
  JOIN user_profiles up ON ep.user_id = up.user_id
  JOIN auth.users u ON ep.user_id = u.id
  WHERE ep.email_id = email_uuid
    AND ep.last_seen > (now() - interval '2 minutes')
  ORDER BY ep.last_seen DESC;
END;
$$;

-- Function to update or insert presence
CREATE OR REPLACE FUNCTION upsert_email_presence(
  email_uuid uuid,
  user_uuid uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_business_id uuid;
BEGIN
  -- Get user's business_id
  SELECT business_id INTO user_business_id
  FROM user_profiles 
  WHERE user_id = user_uuid;
  
  IF user_business_id IS NULL THEN
    RAISE EXCEPTION 'User business not found';
  END IF;
  
  -- Upsert presence record
  INSERT INTO email_presence (email_id, user_id, business_id, last_seen)
  VALUES (email_uuid, user_uuid, user_business_id, now())
  ON CONFLICT (email_id, user_id)
  DO UPDATE SET 
    last_seen = now();
END;
$$;

-- =============================================
-- 4. AUTOMATIC CLEANUP JOB
-- =============================================

-- Note: In production, you'd typically set up a cron job or scheduled task
-- For now, we'll rely on the cleanup being called from the get_email_viewers function 