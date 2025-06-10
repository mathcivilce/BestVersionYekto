-- Migration: Add Email Attachments and Cleanup Management Tables
-- Description: Tables for tracking email attachments, storage management, and automatic cleanup

-- Email attachments tracking table
CREATE TABLE IF NOT EXISTS email_attachments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email_id UUID REFERENCES emails(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    content_id VARCHAR(100), -- For inline images (cid: references)
    is_inline BOOLEAN DEFAULT FALSE,
    storage_path TEXT, -- Path in Supabase storage (for temp_storage strategy)
    storage_strategy VARCHAR(20) NOT NULL CHECK (storage_strategy IN ('base64', 'temp_storage')),
    base64_content TEXT, -- Store base64 for small files or backup
    auto_delete_at TIMESTAMP WITH TIME ZONE, -- When this attachment should be cleaned up
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Metadata for tracking and analytics
    upload_session_id UUID, -- Track batch uploads
    processed BOOLEAN DEFAULT FALSE, -- Whether the attachment was successfully sent
    error_details TEXT -- Store any processing errors
);

-- Cleanup log table for audit and monitoring
CREATE TABLE IF NOT EXISTS cleanup_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cleanup_type VARCHAR(50) NOT NULL, -- 'temp_files', 'resolved_emails', 'inactive_users', etc.
    files_deleted INTEGER DEFAULT 0,
    storage_freed_bytes BIGINT DEFAULT 0,
    execution_time_ms INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    cleanup_criteria JSONB, -- Store the criteria used for cleanup
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    executed_by VARCHAR(100) DEFAULT 'system' -- 'system', 'manual', or user_id
);

-- File retention policies table
CREATE TABLE IF NOT EXISTS retention_policies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    policy_name VARCHAR(100) UNIQUE NOT NULL,
    policy_type VARCHAR(50) NOT NULL, -- 'temp_files', 'resolved_emails', etc.
    retention_days INTEGER NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Storage usage tracking table
CREATE TABLE IF NOT EXISTS storage_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    total_attachments INTEGER DEFAULT 0,
    total_storage_bytes BIGINT DEFAULT 0,
    temp_storage_bytes BIGINT DEFAULT 0,
    last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Monthly usage tracking
    current_month_uploads INTEGER DEFAULT 0,
    current_month_bytes BIGINT DEFAULT 0,
    month_year VARCHAR(7), -- Format: 2024-12
    UNIQUE(user_id, month_year)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_user_id ON email_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_auto_delete ON email_attachments(auto_delete_at) WHERE auto_delete_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_attachments_storage_strategy ON email_attachments(storage_strategy);
CREATE INDEX IF NOT EXISTS idx_email_attachments_content_id ON email_attachments(content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cleanup_logs_executed_at ON cleanup_logs(executed_at);
CREATE INDEX IF NOT EXISTS idx_cleanup_logs_cleanup_type ON cleanup_logs(cleanup_type);
CREATE INDEX IF NOT EXISTS idx_storage_usage_user_month ON storage_usage(user_id, month_year);

-- Insert default retention policies
INSERT INTO retention_policies (policy_name, policy_type, retention_days) VALUES
    ('Temporary Files', 'temp_files', 7),
    ('Resolved Email Files', 'resolved_email_files', 30),
    ('Open Email Files', 'open_email_files', 90),
    ('Inactive User Files', 'inactive_user_files', 180),
    ('Cleanup Logs', 'cleanup_logs', 365)
ON CONFLICT (policy_name) DO UPDATE SET
    retention_days = EXCLUDED.retention_days,
    updated_at = NOW();

-- RLS Policies for email_attachments
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;

-- Users can only see their own attachments
CREATE POLICY "Users can view own attachments" ON email_attachments
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own attachments
CREATE POLICY "Users can insert own attachments" ON email_attachments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own attachments
CREATE POLICY "Users can update own attachments" ON email_attachments
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own attachments
CREATE POLICY "Users can delete own attachments" ON email_attachments
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for storage_usage
ALTER TABLE storage_usage ENABLE ROW LEVEL SECURITY;

-- Users can only see their own storage usage
CREATE POLICY "Users can view own storage usage" ON storage_usage
    FOR SELECT USING (auth.uid() = user_id);

-- System can manage all storage usage records
CREATE POLICY "System can manage storage usage" ON storage_usage
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email LIKE '%@yourdomain.com' -- Replace with your admin domain
        )
    );

-- RLS for cleanup_logs and retention_policies (admin only)
ALTER TABLE cleanup_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;

-- Only system/admin users can access cleanup logs and policies
CREATE POLICY "Admin can manage cleanup logs" ON cleanup_logs
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email LIKE '%@yourdomain.com' -- Replace with your admin domain
        )
    );

CREATE POLICY "Admin can manage retention policies" ON retention_policies
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email LIKE '%@yourdomain.com' -- Replace with your admin domain
        )
    );

-- Function to update storage usage statistics
CREATE OR REPLACE FUNCTION update_storage_usage(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_total_attachments INTEGER;
    v_total_storage_bytes BIGINT;
    v_temp_storage_bytes BIGINT;
    v_current_month VARCHAR(7);
    v_month_uploads INTEGER;
    v_month_bytes BIGINT;
BEGIN
    v_current_month := TO_CHAR(NOW(), 'YYYY-MM');
    
    -- Calculate totals
    SELECT 
        COUNT(*),
        COALESCE(SUM(file_size), 0),
        COALESCE(SUM(CASE WHEN storage_strategy = 'temp_storage' THEN file_size ELSE 0 END), 0)
    INTO v_total_attachments, v_total_storage_bytes, v_temp_storage_bytes
    FROM email_attachments 
    WHERE user_id = p_user_id;
    
    -- Calculate current month statistics
    SELECT 
        COUNT(*),
        COALESCE(SUM(file_size), 0)
    INTO v_month_uploads, v_month_bytes
    FROM email_attachments 
    WHERE user_id = p_user_id 
    AND created_at >= DATE_TRUNC('month', NOW());
    
    -- Upsert storage usage record
    INSERT INTO storage_usage (
        user_id, total_attachments, total_storage_bytes, temp_storage_bytes,
        current_month_uploads, current_month_bytes, month_year, last_calculated_at
    ) VALUES (
        p_user_id, v_total_attachments, v_total_storage_bytes, v_temp_storage_bytes,
        v_month_uploads, v_month_bytes, v_current_month, NOW()
    )
    ON CONFLICT (user_id, month_year)
    DO UPDATE SET
        total_attachments = EXCLUDED.total_attachments,
        total_storage_bytes = EXCLUDED.total_storage_bytes,
        temp_storage_bytes = EXCLUDED.temp_storage_bytes,
        current_month_uploads = EXCLUDED.current_month_uploads,
        current_month_bytes = EXCLUDED.current_month_bytes,
        last_calculated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update storage usage when attachments change
CREATE OR REPLACE FUNCTION trigger_update_storage_usage()
RETURNS TRIGGER AS $$
BEGIN
    -- Update storage usage for the affected user
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM update_storage_usage(NEW.user_id);
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        PERFORM update_storage_usage(OLD.user_id);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS storage_usage_trigger ON email_attachments;
CREATE TRIGGER storage_usage_trigger
    AFTER INSERT OR UPDATE OR DELETE ON email_attachments
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_storage_usage();

-- Function to clean up expired attachments
CREATE OR REPLACE FUNCTION cleanup_expired_attachments()
RETURNS TABLE(deleted_count INTEGER, storage_freed BIGINT) AS $$
DECLARE
    v_deleted_count INTEGER := 0;
    v_storage_freed BIGINT := 0;
    v_attachment RECORD;
BEGIN
    -- Get expired attachments
    FOR v_attachment IN
        SELECT id, file_size, storage_path, user_id
        FROM email_attachments 
        WHERE auto_delete_at IS NOT NULL 
        AND auto_delete_at <= NOW()
        AND processed = TRUE  -- Only delete if email was successfully sent
    LOOP
        -- Delete from storage if it exists
        IF v_attachment.storage_path IS NOT NULL THEN
            -- Note: Actual storage deletion would be handled by the cleanup service
            -- This function just marks for deletion and logs
            NULL;
        END IF;
        
        -- Update counters
        v_deleted_count := v_deleted_count + 1;
        v_storage_freed := v_storage_freed + v_attachment.file_size;
        
        -- Delete the attachment record
        DELETE FROM email_attachments WHERE id = v_attachment.id;
        
        -- Update user's storage usage
        PERFORM update_storage_usage(v_attachment.user_id);
    END LOOP;
    
    -- Log the cleanup operation
    INSERT INTO cleanup_logs (
        cleanup_type, files_deleted, storage_freed_bytes, 
        cleanup_criteria, executed_at
    ) VALUES (
        'auto_cleanup_expired', v_deleted_count, v_storage_freed,
        jsonb_build_object('criteria', 'auto_delete_at <= NOW() AND processed = TRUE'),
        NOW()
    );
    
    deleted_count := v_deleted_count;
    storage_freed := v_storage_freed;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated; 