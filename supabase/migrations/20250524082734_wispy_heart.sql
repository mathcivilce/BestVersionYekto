/*
  # Add rate limiting and caching tables

  1. New Tables
    - `rate_limits`
      - Track API call limits for external services
      - Store remaining quota and reset time
    
    - `cache_entries`
      - Cache frequently accessed data
      - Support TTL-based expiration
      
  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users
*/

-- Create rate_limits table
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  service text NOT NULL,
  endpoint text NOT NULL,
  remaining_calls integer NOT NULL,
  reset_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, service, endpoint)
);

-- Create cache_entries table
CREATE TABLE IF NOT EXISTS cache_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Enable RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_entries ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their rate limits"
  ON rate_limits
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their cache entries"
  ON cache_entries
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add updated_at trigger for rate_limits
CREATE TRIGGER update_rate_limits_updated_at
    BEFORE UPDATE ON rate_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add cleanup function for expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS trigger AS $$
BEGIN
  DELETE FROM cache_entries WHERE expires_at < NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to clean up expired cache entries
CREATE TRIGGER cleanup_expired_cache_trigger
  AFTER INSERT OR UPDATE ON cache_entries
  EXECUTE FUNCTION cleanup_expired_cache();