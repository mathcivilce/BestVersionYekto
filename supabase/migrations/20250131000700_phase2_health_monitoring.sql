-- ============================================================================================================
-- PHASE 2 IMPLEMENTATION: HEALTH MONITORING & PERFORMANCE METRICS
-- ============================================================================================================
-- 
-- This migration adds enhanced health monitoring and performance tracking for the chunked sync system.
-- Phase 2 focuses on intelligent error handling, retry logic, and system observability.
-- 
-- 🎯 PHASE 2 FEATURES:
-- - Health monitoring table for chunk performance tracking
-- - Error categorization and retry analysis
-- - Performance metrics collection
-- - Integration with Phase 1 recovery functions
-- 
-- ============================================================================================================

-- Create health monitoring table for chunk performance metrics
CREATE TABLE IF NOT EXISTS chunked_sync_health_monitoring (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Chunk identification
    chunk_job_id UUID REFERENCES chunked_sync_jobs(chunk_id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL,
    queue_id UUID,
    
    -- Performance metrics
    processing_time_ms INTEGER,
    chunk_size INTEGER, -- estimated_emails from chunk
    efficiency_ratio DECIMAL(10,2), -- emails per second
    
    -- Error analysis (NULL for successful chunks)
    error_category TEXT CHECK (error_category IN (
        'timeout', 'rate_limit', 'network', 'temporary', 'auth', 
        'permission', 'not_found', 'data_conflict', 'processing_error', 'unknown'
    )),
    error_message TEXT,
    attempt_number INTEGER,
    suggested_retry_delay_ms INTEGER,
    
    -- System health
    memory_usage TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    
    -- Health status
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout', 'recovery')),
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    
    -- Indexes for performance
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for health monitoring
CREATE INDEX IF NOT EXISTS idx_health_monitoring_chunk_job_id ON chunked_sync_health_monitoring(chunk_job_id);
CREATE INDEX IF NOT EXISTS idx_health_monitoring_timestamp ON chunked_sync_health_monitoring(timestamp);
CREATE INDEX IF NOT EXISTS idx_health_monitoring_error_category ON chunked_sync_health_monitoring(error_category) WHERE error_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_health_monitoring_worker_id ON chunked_sync_health_monitoring(worker_id);
CREATE INDEX IF NOT EXISTS idx_health_monitoring_status ON chunked_sync_health_monitoring(status);

-- Enable RLS for health monitoring
ALTER TABLE chunked_sync_health_monitoring ENABLE ROW LEVEL SECURITY;

-- RLS policies for health monitoring (allow service role access)
CREATE POLICY "Allow service role access to health monitoring"
ON chunked_sync_health_monitoring
FOR ALL
TO service_role
USING (true);

-- Function to log chunk health metrics
CREATE OR REPLACE FUNCTION log_chunk_health_metrics(
    p_chunk_job_id UUID,
    p_worker_id TEXT,
    p_queue_id UUID DEFAULT NULL,
    p_processing_time_ms INTEGER DEFAULT NULL,
    p_chunk_size INTEGER DEFAULT NULL,
    p_efficiency_ratio DECIMAL DEFAULT NULL,
    p_error_category TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_attempt_number INTEGER DEFAULT NULL,
    p_suggested_retry_delay_ms INTEGER DEFAULT NULL,
    p_status TEXT DEFAULT 'success',
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    health_record_id UUID;
BEGIN
    INSERT INTO chunked_sync_health_monitoring (
        chunk_job_id,
        worker_id,
        queue_id,
        processing_time_ms,
        chunk_size,
        efficiency_ratio,
        error_category,
        error_message,
        attempt_number,
        suggested_retry_delay_ms,
        status,
        metadata
    ) VALUES (
        p_chunk_job_id,
        p_worker_id,
        p_queue_id,
        p_processing_time_ms,
        p_chunk_size,
        p_efficiency_ratio,
        p_error_category,
        p_error_message,
        p_attempt_number,
        p_suggested_retry_delay_ms,
        p_status,
        p_metadata
    ) RETURNING id INTO health_record_id;
    
    RETURN health_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get health summary for a queue
CREATE OR REPLACE FUNCTION get_queue_health_summary(p_queue_id UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'queue_id', p_queue_id,
        'total_chunks', COUNT(*),
        'successful_chunks', COUNT(*) FILTER (WHERE status = 'success'),
        'failed_chunks', COUNT(*) FILTER (WHERE status = 'error'),
        'recovered_chunks', COUNT(*) FILTER (WHERE status = 'recovery'),
        'avg_processing_time_ms', AVG(processing_time_ms)::INTEGER,
        'avg_efficiency_ratio', AVG(efficiency_ratio)::DECIMAL(10,2),
        'error_categories', json_agg(DISTINCT error_category) FILTER (WHERE error_category IS NOT NULL),
        'last_activity', MAX(timestamp),
        'performance_trend', json_build_object(
            'fastest_chunk_ms', MIN(processing_time_ms),
            'slowest_chunk_ms', MAX(processing_time_ms),
            'total_processing_time_ms', SUM(processing_time_ms)
        )
    ) INTO result
    FROM chunked_sync_health_monitoring
    WHERE queue_id = p_queue_id
    AND created_at >= NOW() - INTERVAL '24 hours'; -- Last 24 hours
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get system-wide health metrics
CREATE OR REPLACE FUNCTION get_system_health_metrics()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'overall_health', CASE 
            WHEN COUNT(*) FILTER (WHERE status = 'error' AND created_at >= NOW() - INTERVAL '1 hour') > 
                 COUNT(*) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '1 hour') 
            THEN 'degraded'
            WHEN COUNT(*) FILTER (WHERE status = 'error' AND created_at >= NOW() - INTERVAL '1 hour') > 0 
            THEN 'warning'
            ELSE 'healthy'
        END,
        'last_hour_stats', json_build_object(
            'total_chunks', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour'),
            'successful_chunks', COUNT(*) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '1 hour'),
            'failed_chunks', COUNT(*) FILTER (WHERE status = 'error' AND created_at >= NOW() - INTERVAL '1 hour'),
            'avg_processing_time_ms', AVG(processing_time_ms) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')
        ),
        'error_analysis', (
            SELECT json_agg(json_build_object(
                'error_category', error_category,
                'count', count,
                'percentage', ROUND((count::DECIMAL / total_errors::DECIMAL) * 100, 2)
            ))
            FROM (
                SELECT 
                    error_category,
                    COUNT(*) as count,
                    SUM(COUNT(*)) OVER () as total_errors
                FROM chunked_sync_health_monitoring
                WHERE error_category IS NOT NULL 
                AND created_at >= NOW() - INTERVAL '24 hours'
                GROUP BY error_category
                ORDER BY count DESC
            ) error_stats
        ),
        'performance_metrics', json_build_object(
            'avg_efficiency_ratio', AVG(efficiency_ratio) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'),
            'peak_efficiency', MAX(efficiency_ratio) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'),
            'total_chunks_processed', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')
        ),
        'generated_at', NOW()
    ) INTO result
    FROM chunked_sync_health_monitoring;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup old health monitoring records (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_health_monitoring()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM chunked_sync_health_monitoring
    WHERE created_at < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enhanced version of should_retry_chunk with health monitoring integration
CREATE OR REPLACE FUNCTION should_retry_chunk_enhanced(
    p_chunk_job_id UUID,
    p_attempts INTEGER,
    p_max_attempts INTEGER,
    p_error_category TEXT,
    p_chunk_index INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
    should_retry BOOLEAN := false;
    recent_failures INTEGER;
    system_health TEXT;
BEGIN
    -- Basic retry logic from Phase 1
    IF p_attempts >= p_max_attempts THEN
        RETURN false;
    END IF;
    
    -- Category-specific retry logic
    CASE p_error_category
        WHEN 'permission', 'not_found', 'data_conflict' THEN
            RETURN false; -- Don't retry these
        WHEN 'rate_limit' THEN
            should_retry := p_attempts <= 2; -- Max 2 retries for rate limits
        WHEN 'network', 'temporary', 'timeout' THEN
            should_retry := p_attempts <= 3; -- Max 3 retries for transient errors
        WHEN 'auth' THEN
            should_retry := p_attempts <= 1; -- Quick retry for auth
        ELSE
            should_retry := p_attempts < p_max_attempts; -- Standard logic
    END CASE;
    
    -- Phase 2: Check recent system health
    SELECT COUNT(*) INTO recent_failures
    FROM chunked_sync_health_monitoring
    WHERE status = 'error'
    AND created_at >= NOW() - INTERVAL '15 minutes'
    AND error_category = p_error_category;
    
    -- If too many recent failures of the same category, be more conservative
    IF recent_failures > 5 THEN
        should_retry := should_retry AND p_attempts <= 1;
    END IF;
    
    -- Log the retry decision
    INSERT INTO chunked_sync_health_monitoring (
        chunk_job_id,
        worker_id,
        status,
        error_category,
        attempt_number,
        metadata
    ) VALUES (
        p_chunk_job_id,
        'retry_decision_engine',
        CASE WHEN should_retry THEN 'recovery' ELSE 'error' END,
        p_error_category,
        p_attempts,
        json_build_object(
            'retry_decision', should_retry,
            'recent_failures', recent_failures,
            'chunk_index', p_chunk_index
        )
    );
    
    RETURN should_retry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a summary view for easy monitoring
CREATE OR REPLACE VIEW chunked_sync_health_summary AS
SELECT 
    DATE_TRUNC('hour', created_at) as hour,
    status,
    error_category,
    COUNT(*) as chunk_count,
    AVG(processing_time_ms) as avg_processing_time_ms,
    AVG(efficiency_ratio) as avg_efficiency_ratio,
    MIN(processing_time_ms) as min_processing_time_ms,
    MAX(processing_time_ms) as max_processing_time_ms
FROM chunked_sync_health_monitoring
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY DATE_TRUNC('hour', created_at), status, error_category
ORDER BY hour DESC, status, error_category;

-- Grant permissions
GRANT SELECT ON chunked_sync_health_summary TO service_role;
GRANT ALL ON chunked_sync_health_monitoring TO service_role;

-- ============================================================================================================
-- PHASE 2 HEALTH MONITORING SETUP COMPLETE
-- ============================================================================================================
-- 
-- ✅ FEATURES ADDED:
-- 
-- 📊 Health Monitoring Table: Tracks chunk performance and errors
-- 🔧 Smart Retry Logic: Enhanced retry decisions based on error patterns  
-- 📈 Performance Metrics: Efficiency tracking and system health
-- 🎯 Error Categorization: Intelligent error analysis and reporting
-- 📋 Health Summary Views: Easy monitoring and alerting
-- 🧹 Cleanup Functions: Automatic old data removal
-- 
-- 🚀 READY FOR PHASE 2 INTEGRATION WITH BACKGROUND PROCESSOR!
-- ============================================================================================================ 