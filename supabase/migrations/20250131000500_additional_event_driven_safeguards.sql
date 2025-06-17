-- ============================================================================================================
-- ADDITIONAL EVENT-DRIVEN SAFEGUARDS
-- ============================================================================================================
--
-- This migration adds comprehensive additional safeguards for the event-driven sync system:
-- 1. Webhook Delivery Guarantees - Track webhook delivery success/failure
-- 2. Dead Letter Queue - Archive jobs that fail repeatedly  
-- 3. Rate Limiting Protection - Prevent overwhelming email providers
-- 4. Webhook Subscription Health - Monitor webhook subscription status
-- 5. Circuit Breaker Pattern - Prevent cascade failures
-- 6. Comprehensive Monitoring - Track all aspects of system health
--
-- ============================================================================================================

-- ============================================================================================================
-- 1. WEBHOOK DELIVERY GUARANTEES
-- ============================================================================================================

-- Track webhook delivery attempts and success rates
CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL, -- Multi-tenant support
  store_id UUID NOT NULL,
  webhook_id TEXT NOT NULL,
  webhook_type TEXT NOT NULL, -- 'email_sync', 'subscription_renewal', etc.
  delivery_attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  success BOOLEAN DEFAULT FALSE,
  response_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  delivery_duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes for performance
  CONSTRAINT fk_webhook_delivery_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhook_delivery_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Indexes for webhook delivery tracking
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_store_type ON webhook_delivery_log(store_id, webhook_type);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_retry ON webhook_delivery_log(next_retry_at) WHERE success = FALSE AND delivery_attempts < max_attempts;
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_business ON webhook_delivery_log(business_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_created ON webhook_delivery_log(created_at);

-- ============================================================================================================
-- 2. DEAD LETTER QUEUE
-- ============================================================================================================

-- Archive jobs that fail repeatedly for manual investigation
CREATE TABLE IF NOT EXISTS failed_job_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  original_job_id UUID,
  job_type TEXT NOT NULL, -- 'sync_job', 'chunked_sync_job', etc.
  store_id UUID,
  failure_reason TEXT NOT NULL,
  retry_count INTEGER NOT NULL,
  last_error_message TEXT,
  original_job_data JSONB, -- Complete job data for debugging
  error_context JSONB, -- Additional error context
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed BOOLEAN DEFAULT FALSE,
  resolution_notes TEXT,
  
  -- Constraints
  CONSTRAINT fk_failed_job_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_failed_job_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Indexes for failed job archive
CREATE INDEX IF NOT EXISTS idx_failed_job_business ON failed_job_archive(business_id);
CREATE INDEX IF NOT EXISTS idx_failed_job_store ON failed_job_archive(store_id);
CREATE INDEX IF NOT EXISTS idx_failed_job_type ON failed_job_archive(job_type);
CREATE INDEX IF NOT EXISTS idx_failed_job_unreviewed ON failed_job_archive(reviewed) WHERE reviewed = FALSE;
CREATE INDEX IF NOT EXISTS idx_failed_job_archived ON failed_job_archive(archived_at);

-- ============================================================================================================
-- 3. RATE LIMITING PROTECTION
-- ============================================================================================================

-- Track and enforce rate limits per email provider
CREATE TABLE IF NOT EXISTS provider_rate_limits (
  store_id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  platform TEXT NOT NULL, -- 'outlook', 'gmail'
  
  -- Rate limiting configuration
  requests_per_minute INTEGER DEFAULT 60,
  requests_per_hour INTEGER DEFAULT 3600,
  requests_per_day INTEGER DEFAULT 86400,
  
  -- Current usage tracking
  current_minute_requests INTEGER DEFAULT 0,
  current_hour_requests INTEGER DEFAULT 0,
  current_day_requests INTEGER DEFAULT 0,
  
  -- Time windows
  minute_window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  hour_window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  day_window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Throttling state
  is_throttled BOOLEAN DEFAULT FALSE,
  throttled_until TIMESTAMP WITH TIME ZONE,
  throttle_reason TEXT,
  
  -- Statistics
  total_requests_made BIGINT DEFAULT 0,
  total_throttle_events INTEGER DEFAULT 0,
  last_request_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_rate_limit_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_rate_limit_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Indexes for rate limiting
CREATE INDEX IF NOT EXISTS idx_rate_limit_business ON provider_rate_limits(business_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_platform ON provider_rate_limits(platform);
CREATE INDEX IF NOT EXISTS idx_rate_limit_throttled ON provider_rate_limits(is_throttled, throttled_until);

-- ============================================================================================================
-- 4. WEBHOOK SUBSCRIPTION HEALTH MONITORING
-- ============================================================================================================

-- Monitor webhook subscription status and health metrics
CREATE TABLE IF NOT EXISTS webhook_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  store_id UUID NOT NULL,
  
  -- Subscription details
  subscription_id TEXT,
  subscription_status TEXT NOT NULL, -- 'active', 'expired', 'failed', 'pending'
  subscription_type TEXT NOT NULL, -- 'outlook_subscription', 'gmail_pubsub'
  
  -- Health metrics
  health_score DECIMAL(3,2) DEFAULT 1.0, -- 0.0 to 1.0
  last_webhook_received TIMESTAMP WITH TIME ZONE,
  total_webhooks_received BIGINT DEFAULT 0,
  webhooks_in_last_hour INTEGER DEFAULT 0,
  webhooks_in_last_day INTEGER DEFAULT 0,
  
  -- Error tracking
  consecutive_failures INTEGER DEFAULT 0,
  last_failure_at TIMESTAMP WITH TIME ZONE,
  last_failure_reason TEXT,
  
  -- Renewal tracking
  subscription_expires_at TIMESTAMP WITH TIME ZONE,
  last_renewal_attempt TIMESTAMP WITH TIME ZONE,
  renewal_success BOOLEAN,
  next_renewal_due TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_webhook_health_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhook_health_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Indexes for webhook health monitoring
CREATE INDEX IF NOT EXISTS idx_webhook_health_business ON webhook_health_log(business_id);
CREATE INDEX IF NOT EXISTS idx_webhook_health_store ON webhook_health_log(store_id);
CREATE INDEX IF NOT EXISTS idx_webhook_health_status ON webhook_health_log(subscription_status);
CREATE INDEX IF NOT EXISTS idx_webhook_health_score ON webhook_health_log(health_score);
CREATE INDEX IF NOT EXISTS idx_webhook_health_renewal ON webhook_health_log(next_renewal_due) WHERE subscription_status = 'active';
CREATE INDEX IF NOT EXISTS idx_webhook_health_failures ON webhook_health_log(consecutive_failures) WHERE consecutive_failures > 0;

-- ============================================================================================================
-- 5. CIRCUIT BREAKER PATTERN
-- ============================================================================================================

-- Implement circuit breaker to prevent cascade failures
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  store_id UUID,
  circuit_name TEXT NOT NULL, -- 'email_sync', 'webhook_delivery', 'token_refresh'
  
  -- Circuit state
  state TEXT NOT NULL DEFAULT 'closed', -- 'closed', 'open', 'half_open'
  failure_count INTEGER DEFAULT 0,
  failure_threshold INTEGER DEFAULT 5,
  success_count INTEGER DEFAULT 0,
  success_threshold INTEGER DEFAULT 3, -- For half-open -> closed transition
  
  -- Timing
  last_failure_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  timeout_duration_seconds INTEGER DEFAULT 300, -- 5 minutes
  next_attempt_allowed_at TIMESTAMP WITH TIME ZONE,
  
  -- Statistics
  total_requests BIGINT DEFAULT 0,
  total_failures BIGINT DEFAULT 0,
  total_successes BIGINT DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_circuit_breaker_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_circuit_breaker_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT unique_circuit_per_store UNIQUE(store_id, circuit_name)
);

-- Indexes for circuit breaker
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_business ON circuit_breaker_state(business_id);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_store ON circuit_breaker_state(store_id);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_state ON circuit_breaker_state(state);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_retry ON circuit_breaker_state(next_attempt_allowed_at) WHERE state = 'open';

-- ============================================================================================================
-- 6. COMPREHENSIVE SYSTEM HEALTH METRICS
-- ============================================================================================================

-- Track comprehensive system health metrics
CREATE TABLE IF NOT EXISTS system_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  metric_type TEXT NOT NULL, -- 'sync_performance', 'webhook_health', 'error_rate', etc.
  metric_name TEXT NOT NULL,
  metric_value DECIMAL(10,2) NOT NULL,
  metric_unit TEXT, -- 'ms', 'count', 'percentage', 'bytes'
  
  -- Context
  store_id UUID,
  related_entity_id UUID,
  related_entity_type TEXT,
  
  -- Metadata
  tags JSONB DEFAULT '{}',
  additional_data JSONB DEFAULT '{}',
  
  -- Timestamps
  measured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT fk_health_metrics_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_health_metrics_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Indexes for system health metrics
CREATE INDEX IF NOT EXISTS idx_health_metrics_business ON system_health_metrics(business_id);
CREATE INDEX IF NOT EXISTS idx_health_metrics_type ON system_health_metrics(metric_type, metric_name);
CREATE INDEX IF NOT EXISTS idx_health_metrics_store ON system_health_metrics(store_id);
CREATE INDEX IF NOT EXISTS idx_health_metrics_measured ON system_health_metrics(measured_at);
CREATE INDEX IF NOT EXISTS idx_health_metrics_composite ON system_health_metrics(business_id, metric_type, measured_at);

-- ============================================================================================================
-- 7. SAFEGUARD FUNCTIONS
-- ============================================================================================================

-- Function to check if a store should be rate limited
CREATE OR REPLACE FUNCTION check_rate_limit(
  store_id_param UUID,
  operation_type TEXT DEFAULT 'email_sync'
) RETURNS JSONB AS $$
DECLARE
  rate_limit_record RECORD;
  current_time TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  -- Get or create rate limit record
  SELECT * INTO rate_limit_record
  FROM provider_rate_limits
  WHERE store_id = store_id_param;
  
  IF NOT FOUND THEN
    -- Create default rate limit record
    INSERT INTO provider_rate_limits (store_id, business_id, platform)
    SELECT store_id_param, s.business_id, s.platform
    FROM stores s
    WHERE s.id = store_id_param;
    
    RETURN jsonb_build_object(
      'allowed', true,
      'reason', 'new_store',
      'retry_after_seconds', 0
    );
  END IF;
  
  -- Check if currently throttled
  IF rate_limit_record.is_throttled AND current_time < rate_limit_record.throttled_until THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'throttled',
      'retry_after_seconds', EXTRACT(EPOCH FROM (rate_limit_record.throttled_until - current_time))::INTEGER
    );
  END IF;
  
  -- Check minute limit
  IF rate_limit_record.current_minute_requests >= rate_limit_record.requests_per_minute THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'minute_limit_exceeded',
      'retry_after_seconds', 60
    );
  END IF;
  
  -- Allow the request
  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'within_limits',
    'retry_after_seconds', 0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record a rate limit request
CREATE OR REPLACE FUNCTION record_rate_limit_request(
  store_id_param UUID,
  success BOOLEAN DEFAULT TRUE
) RETURNS VOID AS $$
BEGIN
  UPDATE provider_rate_limits
  SET
    current_minute_requests = current_minute_requests + 1,
    current_hour_requests = current_hour_requests + 1,
    current_day_requests = current_day_requests + 1,
    total_requests_made = total_requests_made + 1,
    last_request_at = NOW(),
    updated_at = NOW(),
    is_throttled = CASE WHEN success THEN FALSE ELSE is_throttled END,
    throttled_until = CASE WHEN success THEN NULL ELSE throttled_until END
  WHERE store_id = store_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check circuit breaker state
CREATE OR REPLACE FUNCTION check_circuit_breaker(
  store_id_param UUID,
  circuit_name_param TEXT
) RETURNS JSONB AS $$
DECLARE
  breaker_record RECORD;
  current_time TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  -- Get or create circuit breaker record
  SELECT * INTO breaker_record
  FROM circuit_breaker_state
  WHERE store_id = store_id_param AND circuit_name = circuit_name_param;
  
  IF NOT FOUND THEN
    -- Create new circuit breaker in closed state
    INSERT INTO circuit_breaker_state (business_id, store_id, circuit_name)
    SELECT s.business_id, store_id_param, circuit_name_param
    FROM stores s
    WHERE s.id = store_id_param;
    
    RETURN jsonb_build_object(
      'state', 'closed',
      'allowed', true,
      'reason', 'new_circuit'
    );
  END IF;
  
  -- Return current state
  RETURN jsonb_build_object(
    'state', breaker_record.state,
    'allowed', breaker_record.state != 'open',
    'reason', 'circuit_' || breaker_record.state
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to record circuit breaker result
CREATE OR REPLACE FUNCTION record_circuit_breaker_result(
  store_id_param UUID,
  circuit_name_param TEXT,
  success BOOLEAN
) RETURNS VOID AS $$
DECLARE
  current_time TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  IF success THEN
    -- Record success
    UPDATE circuit_breaker_state
    SET
      failure_count = 0,
      success_count = success_count + 1,
      last_success_at = current_time,
      total_requests = total_requests + 1,
      total_successes = total_successes + 1,
      updated_at = current_time,
      state = CASE 
        WHEN state = 'half_open' AND success_count + 1 >= success_threshold THEN 'closed'
        ELSE state
      END
    WHERE store_id = store_id_param AND circuit_name = circuit_name_param;
  ELSE
    -- Record failure
    UPDATE circuit_breaker_state
    SET
      failure_count = failure_count + 1,
      success_count = 0,
      last_failure_at = current_time,
      total_requests = total_requests + 1,
      total_failures = total_failures + 1,
      updated_at = current_time,
      state = CASE 
        WHEN failure_count + 1 >= failure_threshold THEN 'open'
        ELSE state
      END,
      opened_at = CASE 
        WHEN failure_count + 1 >= failure_threshold THEN current_time
        ELSE opened_at
      END,
      next_attempt_allowed_at = CASE 
        WHEN failure_count + 1 >= failure_threshold THEN current_time + (timeout_duration_seconds || ' seconds')::INTERVAL
        ELSE next_attempt_allowed_at
      END
    WHERE store_id = store_id_param AND circuit_name = circuit_name_param;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log webhook delivery attempt
CREATE OR REPLACE FUNCTION log_webhook_delivery(
  store_id_param UUID,
  webhook_id_param TEXT,
  webhook_type_param TEXT,
  success BOOLEAN,
  response_code_param INTEGER DEFAULT NULL,
  error_message_param TEXT DEFAULT NULL,
  duration_ms INTEGER DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  delivery_id UUID;
  business_id_val UUID;
BEGIN
  -- Get business_id for the store
  SELECT business_id INTO business_id_val
  FROM stores
  WHERE id = store_id_param;
  
  -- Insert webhook delivery log
  INSERT INTO webhook_delivery_log (
    business_id,
    store_id,
    webhook_id,
    webhook_type,
    delivery_attempts,
    last_attempt_at,
    success,
    response_code,
    error_message,
    delivery_duration_ms,
    completed_at
  ) VALUES (
    business_id_val,
    store_id_param,
    webhook_id_param,
    webhook_type_param,
    1,
    NOW(),
    success,
    response_code_param,
    error_message_param,
    duration_ms,
    CASE WHEN success THEN NOW() ELSE NULL END
  ) RETURNING id INTO delivery_id;
  
  RETURN delivery_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to move failed jobs to dead letter queue
CREATE OR REPLACE FUNCTION move_to_dead_letter_queue(
  job_id_param UUID,
  job_type_param TEXT,
  failure_reason_param TEXT,
  retry_count_param INTEGER,
  job_data_param JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  archive_id UUID;
  business_id_val UUID;
  store_id_val UUID;
BEGIN
  -- Get business_id and store_id based on job type
  IF job_type_param = 'sync_job' THEN
    SELECT sq.business_id, sq.store_id INTO business_id_val, store_id_val
    FROM sync_queue sq
    WHERE sq.id = job_id_param;
  ELSIF job_type_param = 'chunked_sync_job' THEN
    SELECT csj.business_id, csj.store_id INTO business_id_val, store_id_val
    FROM chunked_sync_jobs csj
    WHERE csj.id = job_id_param;
  END IF;
  
  -- Archive the failed job
  INSERT INTO failed_job_archive (
    business_id,
    original_job_id,
    job_type,
    store_id,
    failure_reason,
    retry_count,
    original_job_data
  ) VALUES (
    business_id_val,
    job_id_param,
    job_type_param,
    store_id_val,
    failure_reason_param,
    retry_count_param,
    job_data_param
  ) RETURNING id INTO archive_id;
  
  RETURN archive_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================================================
-- 8. RLS POLICIES
-- ============================================================================================================

-- Enable RLS on all new tables
ALTER TABLE webhook_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_job_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_health_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE circuit_breaker_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_health_metrics ENABLE ROW LEVEL SECURITY;

-- User policies (read-only for business data)
CREATE POLICY "Users can view webhook delivery logs for their business" ON webhook_delivery_log
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM user_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view failed jobs for their business" ON failed_job_archive
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM user_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view rate limits for their business" ON provider_rate_limits
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM user_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view webhook health for their business" ON webhook_health_log
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM user_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view circuit breaker state for their business" ON circuit_breaker_state
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM user_profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view health metrics for their business" ON system_health_metrics
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM user_profiles WHERE user_id = auth.uid())
  );

-- Service role policies (full access for edge functions)
CREATE POLICY "Service role can manage webhook delivery logs" ON webhook_delivery_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage failed job archive" ON failed_job_archive
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage rate limits" ON provider_rate_limits
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage webhook health" ON webhook_health_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage circuit breaker state" ON circuit_breaker_state
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage health metrics" ON system_health_metrics
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
