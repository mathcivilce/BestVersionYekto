/*
  # Add Connection Health Tracking

  1. Changes
    - Add health tracking fields to stores table
    - Create connection_health_logs table for debugging
    - Add indexes for performance

  2. Security
    - All changes are additive and non-breaking
    - RLS policies protect health logs table
    - Existing stores automatically get default health values
*/

-- =============================================
-- 1. ADD HEALTH TRACKING FIELDS TO STORES TABLE
-- =============================================

-- Add connection health tracking fields
ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMPTZ;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS health_check_failures INTEGER DEFAULT 0;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_validation_error TEXT;

-- Add indexes for efficient health queries
CREATE INDEX IF NOT EXISTS idx_stores_health_check ON stores(last_health_check) WHERE connected = true;
CREATE INDEX IF NOT EXISTS idx_stores_health_failures ON stores(health_check_failures) WHERE health_check_failures > 0;

-- =============================================
-- 2. CREATE CONNECTION HEALTH LOGS TABLE
-- =============================================

-- Create table for connection health validation logs
CREATE TABLE IF NOT EXISTS connection_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  validation_level TEXT NOT NULL CHECK (validation_level IN ('basic_database', 'token_expiry', 'live_api')),
  is_valid BOOLEAN NOT NULL,
  error_type TEXT,
  error_message TEXT,
  error_details JSONB,
  validation_duration_ms INTEGER,
  recovery_strategy TEXT,
  recovery_success BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on health logs
ALTER TABLE connection_health_logs ENABLE ROW LEVEL SECURITY;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_health_logs_store_created ON connection_health_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_user_created ON connection_health_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_validation_level ON connection_health_logs(validation_level);
CREATE INDEX IF NOT EXISTS idx_health_logs_errors ON connection_health_logs(error_type) WHERE error_type IS NOT NULL;

-- =============================================
-- 3. RLS POLICIES FOR CONNECTION HEALTH LOGS
-- =============================================

-- Policy for connection_health_logs table - users can only see their own logs
CREATE POLICY "Users can view their own connection health logs" ON connection_health_logs
  FOR SELECT 
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy for inserting health logs
CREATE POLICY "Users can insert their own connection health logs" ON connection_health_logs
  FOR INSERT 
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =============================================
-- 4. FUNCTIONS FOR HEALTH TRACKING
-- =============================================

-- Function to log connection health validation attempts
CREATE OR REPLACE FUNCTION log_connection_health_validation(
  p_store_id UUID,
  p_validation_level TEXT,
  p_is_valid BOOLEAN,
  p_error_type TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_error_details JSONB DEFAULT NULL,
  p_validation_duration_ms INTEGER DEFAULT NULL,
  p_recovery_strategy TEXT DEFAULT NULL,
  p_recovery_success BOOLEAN DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
  store_user_id UUID;
BEGIN
  -- Get the user_id for the store
  SELECT user_id INTO store_user_id 
  FROM stores 
  WHERE id = p_store_id;
  
  IF store_user_id IS NULL THEN
    RAISE EXCEPTION 'Store not found: %', p_store_id;
  END IF;
  
  -- Insert health log
  INSERT INTO connection_health_logs (
    store_id,
    user_id,
    validation_level,
    is_valid,
    error_type,
    error_message,
    error_details,
    validation_duration_ms,
    recovery_strategy,
    recovery_success
  ) VALUES (
    p_store_id,
    store_user_id,
    p_validation_level,
    p_is_valid,
    p_error_type,
    p_error_message,
    p_error_details,
    p_validation_duration_ms,
    p_recovery_strategy,
    p_recovery_success
  ) RETURNING id INTO log_id;
  
  -- Update store health tracking
  UPDATE stores SET
    last_health_check = NOW(),
    health_check_failures = CASE 
      WHEN p_is_valid THEN 0 
      ELSE COALESCE(health_check_failures, 0) + 1 
    END,
    last_validation_error = CASE 
      WHEN p_is_valid THEN NULL 
      ELSE p_error_message 
    END
  WHERE id = p_store_id;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION log_connection_health_validation TO authenticated;

-- =============================================
-- 5. CLEANUP FUNCTION FOR OLD HEALTH LOGS
-- =============================================

-- Function to clean up old health logs (keep last 100 per store)
CREATE OR REPLACE FUNCTION cleanup_old_health_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
  store_record RECORD;
BEGIN
  -- For each store, keep only the latest 100 health logs
  FOR store_record IN 
    SELECT DISTINCT store_id FROM connection_health_logs
  LOOP
    WITH logs_to_keep AS (
      SELECT id 
      FROM connection_health_logs 
      WHERE store_id = store_record.store_id 
      ORDER BY created_at DESC 
      LIMIT 100
    )
    DELETE FROM connection_health_logs 
    WHERE store_id = store_record.store_id 
      AND id NOT IN (SELECT id FROM logs_to_keep);
    
    GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;
  END LOOP;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION cleanup_old_health_logs TO authenticated;

-- =============================================
-- 6. ADD TABLE COMMENTS FOR DOCUMENTATION
-- =============================================

-- Document the connection health logs table
COMMENT ON TABLE connection_health_logs IS 'Logs connection health validation attempts for debugging and monitoring OAuth connection reliability';

-- Document critical columns
COMMENT ON COLUMN connection_health_logs.validation_level IS 'Progressive validation level: basic_database, token_expiry, or live_api';
COMMENT ON COLUMN connection_health_logs.error_details IS 'Detailed error information as JSON for debugging';
COMMENT ON COLUMN connection_health_logs.recovery_strategy IS 'Recovery strategy attempted: start_oauth, attempt_token_refresh, mark_disconnected, no_action';

-- Document store health fields
COMMENT ON COLUMN stores.last_health_check IS 'Timestamp of last connection health validation';
COMMENT ON COLUMN stores.health_check_failures IS 'Count of consecutive health check failures (reset to 0 on success)';
COMMENT ON COLUMN stores.last_validation_error IS 'Last validation error message for debugging'; 