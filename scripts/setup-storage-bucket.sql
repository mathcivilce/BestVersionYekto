-- ============================================
-- 🚀 Phase 4: Storage Bucket Setup Script
-- ============================================
-- Run this script in your Supabase SQL Editor to set up complete storage infrastructure

-- ============================================
-- 1. Create Storage Bucket
-- ============================================

-- Create email-attachments bucket with proper configuration
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'email-attachments',
    'email-attachments',
    false, -- Private bucket (requires authentication)
    104857600, -- 100MB max file size
    ARRAY[
        -- Image files
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 
        'image/svg+xml', 'image/bmp', 'image/tiff',
        
        -- Document files
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/csv', 'text/html', 'text/rtf',
        
        -- Archive files
        'application/zip', 'application/x-zip-compressed', 
        'application/x-rar-compressed', 'application/x-7z-compressed',
        
        -- Video files
        'video/mp4', 'video/avi', 'video/quicktime', 'video/x-msvideo', 
        'video/webm', 'video/x-ms-wmv', 'video/3gpp',
        
        -- Audio files
        'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'
    ]
) ON CONFLICT (id) DO UPDATE SET
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================
-- 2. Set up Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean setup)
DROP POLICY IF EXISTS "Users can upload email attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own email attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own email attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own email attachments" ON storage.objects;
DROP POLICY IF EXISTS "System can manage all email attachments" ON storage.objects;

-- Policy 1: Users can upload files to their own folder
CREATE POLICY "Users can upload email attachments" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'email-attachments' 
        AND (
            -- Users can upload to their own folder
            auth.uid()::text = (storage.foldername(name))[1]
            OR 
            -- Users can upload to temp folder
            (storage.foldername(name))[1] = 'temp'
        )
    );

-- Policy 2: Users can view their own files
CREATE POLICY "Users can view own email attachments" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'email-attachments' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy 3: Users can update their own files
CREATE POLICY "Users can update own email attachments" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'email-attachments' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy 4: Users can delete their own files
CREATE POLICY "Users can delete own email attachments" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'email-attachments' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- Policy 5: System/Service role can manage all files (for cleanup operations)
CREATE POLICY "System can manage all email attachments" ON storage.objects
    FOR ALL USING (
        bucket_id = 'email-attachments' 
        AND (
            -- Service role can access everything
            auth.jwt() ->> 'role' = 'service_role'
            OR 
            -- Admin users can access everything
            EXISTS (
                SELECT 1 FROM auth.users 
                WHERE auth.users.id = auth.uid() 
                AND (
                    auth.users.raw_user_meta_data ->> 'role' IN ('admin', 'system')
                    OR auth.users.email LIKE '%@yourdomain.com' -- Replace with your admin domain
                )
            )
        )
    );

-- ============================================
-- 3. Create Storage Helper Functions
-- ============================================

-- Function to get comprehensive user storage statistics
CREATE OR REPLACE FUNCTION get_user_storage_stats(user_id UUID)
RETURNS TABLE(
    total_files BIGINT,
    total_size BIGINT,
    temp_files BIGINT,
    temp_size BIGINT,
    month_files BIGINT,
    month_size BIGINT,
    last_upload TIMESTAMP WITH TIME ZONE,
    quota_used_percentage NUMERIC
) AS $$
DECLARE
    v_quota_gb INTEGER := 1; -- Default 1GB quota, can be made configurable
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_files,
        COALESCE(SUM(file_size), 0)::BIGINT as total_size,
        COUNT(CASE WHEN storage_strategy = 'temp_storage' THEN 1 END)::BIGINT as temp_files,
        COALESCE(SUM(CASE WHEN storage_strategy = 'temp_storage' THEN file_size ELSE 0 END), 0)::BIGINT as temp_size,
        COUNT(CASE WHEN created_at >= DATE_TRUNC('month', NOW()) THEN 1 END)::BIGINT as month_files,
        COALESCE(SUM(CASE WHEN created_at >= DATE_TRUNC('month', NOW()) THEN file_size ELSE 0 END), 0)::BIGINT as month_size,
        MAX(created_at) as last_upload,
        ROUND(
            (COALESCE(SUM(file_size), 0)::NUMERIC / (v_quota_gb * 1024 * 1024 * 1024)) * 100, 
            2
        ) as quota_used_percentage
    FROM email_attachments 
    WHERE email_attachments.user_id = get_user_storage_stats.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup storage files (called by cleanup service)
CREATE OR REPLACE FUNCTION cleanup_storage_files(file_paths TEXT[])
RETURNS TABLE(deleted_count INTEGER, errors TEXT[]) AS $$
DECLARE
    v_deleted_count INTEGER := 0;
    v_errors TEXT[] := ARRAY[]::TEXT[];
    v_file_path TEXT;
    v_error TEXT;
BEGIN
    -- Loop through each file path and attempt deletion
    FOREACH v_file_path IN ARRAY file_paths
    LOOP
        BEGIN
            -- Delete from storage (this is a placeholder - actual deletion happens via API)
            -- Here we just mark the operation for the cleanup service
            v_deleted_count := v_deleted_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            v_error := 'Failed to delete ' || v_file_path || ': ' || SQLERRM;
            v_errors := array_append(v_errors, v_error);
        END;
    END LOOP;

    deleted_count := v_deleted_count;
    errors := v_errors;
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get storage usage by file type
CREATE OR REPLACE FUNCTION get_storage_usage_by_type(user_id UUID)
RETURNS TABLE(
    file_type TEXT,
    file_count BIGINT,
    total_size BIGINT,
    avg_size BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN content_type LIKE 'image/%' THEN 'images'
            WHEN content_type LIKE 'video/%' THEN 'videos'
            WHEN content_type LIKE 'application/pdf' OR content_type LIKE '%document%' OR content_type LIKE 'text/%' THEN 'documents'
            ELSE 'others'
        END as file_type,
        COUNT(*)::BIGINT as file_count,
        COALESCE(SUM(file_size), 0)::BIGINT as total_size,
        COALESCE(AVG(file_size), 0)::BIGINT as avg_size
    FROM email_attachments 
    WHERE email_attachments.user_id = get_storage_usage_by_type.user_id
    GROUP BY file_type
    ORDER BY total_size DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. Create Indexes for Performance
-- ============================================

-- Index for storage path lookups (cleanup operations)
CREATE INDEX IF NOT EXISTS idx_email_attachments_storage_path 
ON email_attachments(storage_path) 
WHERE storage_path IS NOT NULL;

-- Index for file type queries
CREATE INDEX IF NOT EXISTS idx_email_attachments_content_type 
ON email_attachments(content_type);

-- Index for expiration queries
CREATE INDEX IF NOT EXISTS idx_email_attachments_auto_delete 
ON email_attachments(auto_delete_at) 
WHERE auto_delete_at IS NOT NULL;

-- Index for user storage statistics
CREATE INDEX IF NOT EXISTS idx_email_attachments_user_created 
ON email_attachments(user_id, created_at DESC);

-- ============================================
-- 5. Grant Necessary Permissions
-- ============================================

-- Grant usage on storage schema to authenticated users
GRANT USAGE ON SCHEMA storage TO authenticated;

-- Grant access to storage functions for authenticated users
GRANT EXECUTE ON FUNCTION get_user_storage_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_storage_usage_by_type(UUID) TO authenticated;

-- Grant service role access to cleanup functions
GRANT EXECUTE ON FUNCTION cleanup_storage_files(TEXT[]) TO service_role;

-- ============================================
-- 6. Insert Default Configuration
-- ============================================

-- Update or insert default retention policies
INSERT INTO retention_policies (policy_name, policy_type, retention_days, enabled) VALUES
    ('Temporary Files', 'temp_files', 7, true),
    ('Resolved Email Files', 'resolved_email_files', 30, true),
    ('Open Email Files', 'open_email_files', 90, true),
    ('Inactive User Files', 'inactive_user_files', 180, true),
    ('Cleanup Logs', 'cleanup_logs', 365, true),
    ('Draft Email Files', 'draft_email_files', 14, true)
ON CONFLICT (policy_name) DO UPDATE SET
    retention_days = EXCLUDED.retention_days,
    enabled = EXCLUDED.enabled,
    updated_at = NOW();

-- ============================================
-- 7. Create Storage Monitoring View
-- ============================================

-- Create a view for easy storage monitoring
CREATE OR REPLACE VIEW storage_dashboard_summary AS
SELECT 
    u.id as user_id,
    u.email,
    COUNT(ea.id) as total_attachments,
    COALESCE(SUM(ea.file_size), 0) as total_storage_bytes,
    COUNT(CASE WHEN ea.storage_strategy = 'temp_storage' THEN 1 END) as temp_files,
    COALESCE(SUM(CASE WHEN ea.storage_strategy = 'temp_storage' THEN ea.file_size ELSE 0 END), 0) as temp_storage_bytes,
    COUNT(CASE WHEN ea.created_at >= DATE_TRUNC('month', NOW()) THEN 1 END) as month_uploads,
    MAX(ea.created_at) as last_upload,
    COUNT(CASE WHEN ea.auto_delete_at IS NOT NULL AND ea.auto_delete_at < NOW() THEN 1 END) as expired_files
FROM auth.users u
LEFT JOIN email_attachments ea ON u.id = ea.user_id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.email
ORDER BY total_storage_bytes DESC;

-- Grant access to the monitoring view
GRANT SELECT ON storage_dashboard_summary TO authenticated;
GRANT SELECT ON storage_dashboard_summary TO service_role;

-- ============================================
-- 8. Verification Queries
-- ============================================

-- Verify bucket creation
SELECT id, name, public, file_size_limit, array_length(allowed_mime_types, 1) as mime_types_count
FROM storage.buckets 
WHERE id = 'email-attachments';

-- Verify RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects';

-- Verify functions exist
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name IN ('get_user_storage_stats', 'cleanup_storage_files', 'get_storage_usage_by_type');

-- Verify indexes
SELECT indexname, tablename 
FROM pg_indexes 
WHERE tablename = 'email_attachments' 
AND indexname LIKE 'idx_email_attachments_%';

-- ============================================
-- 9. Success Message
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '✅ Storage bucket setup completed successfully!';
    RAISE NOTICE '';
    RAISE NOTICE '📋 Summary:';
    RAISE NOTICE '- Storage bucket "email-attachments" created with 100MB file limit';
    RAISE NOTICE '- RLS policies configured for secure access';
    RAISE NOTICE '- Helper functions created for storage management';
    RAISE NOTICE '- Performance indexes added';
    RAISE NOTICE '- Default retention policies configured';
    RAISE NOTICE '- Monitoring views created';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 Your storage infrastructure is ready for Phase 4 deployment!';
END $$; 