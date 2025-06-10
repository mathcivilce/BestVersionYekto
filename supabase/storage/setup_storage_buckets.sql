-- Storage bucket setup for email attachments
-- This script sets up the storage buckets and policies for the rich text editor

-- Create the email-attachments bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'email-attachments',
    'email-attachments',
    false, -- Not public, requires authentication
    104857600, -- 100MB max file size
    ARRAY[
        -- Images
        'image/jpeg',
        'image/png', 
        'image/gif',
        'image/webp',
        'image/svg+xml',
        -- Documents
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
        'application/zip',
        'application/x-zip-compressed',
        -- Videos (common formats)
        'video/mp4',
        'video/avi',
        'video/quicktime',
        'video/x-msvideo',
        'video/webm'
    ]
) ON CONFLICT (id) DO UPDATE SET
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for email-attachments bucket

-- Policy 1: Users can upload their own files
CREATE POLICY "Users can upload email attachments" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'email-attachments' 
        AND auth.uid()::text = (storage.foldername(name))[1]
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

-- Policy 5: System/Admin can manage all files (for cleanup processes)
CREATE POLICY "System can manage all email attachments" ON storage.objects
    FOR ALL USING (
        bucket_id = 'email-attachments' 
        AND EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND (
                auth.users.email LIKE '%@yourdomain.com' -- Replace with your admin domain
                OR auth.users.raw_user_meta_data->>'role' = 'admin'
                OR auth.users.raw_user_meta_data->>'role' = 'system'
            )
        )
    );

-- Create RLS policies for the bucket itself
CREATE POLICY "Bucket access for authenticated users" ON storage.buckets
    FOR SELECT USING (
        id = 'email-attachments' 
        AND auth.role() = 'authenticated'
    );

-- Function to cleanup storage files (called by the cleanup service)
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
            -- Delete the file from storage
            DELETE FROM storage.objects 
            WHERE bucket_id = 'email-attachments' 
            AND name = v_file_path;
            
            -- Check if deletion was successful
            IF FOUND THEN
                v_deleted_count := v_deleted_count + 1;
            ELSE
                v_errors := array_append(v_errors, 'File not found: ' || v_file_path);
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            v_error := 'Error deleting ' || v_file_path || ': ' || SQLERRM;
            v_errors := array_append(v_errors, v_error);
        END;
    END LOOP;
    
    deleted_count := v_deleted_count;
    errors := v_errors;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get storage statistics
CREATE OR REPLACE FUNCTION get_storage_statistics()
RETURNS TABLE(
    total_files BIGINT,
    total_size_bytes BIGINT,
    temp_files BIGINT,
    temp_size_bytes BIGINT,
    expired_files BIGINT,
    expired_size_bytes BIGINT
) AS $$
BEGIN
    SELECT 
        COUNT(*) AS total_files,
        COALESCE(SUM(ea.file_size), 0) AS total_size_bytes,
        COUNT(*) FILTER (WHERE ea.storage_strategy = 'temp_storage') AS temp_files,
        COALESCE(SUM(ea.file_size) FILTER (WHERE ea.storage_strategy = 'temp_storage'), 0) AS temp_size_bytes,
        COUNT(*) FILTER (WHERE ea.auto_delete_at IS NOT NULL AND ea.auto_delete_at <= NOW()) AS expired_files,
        COALESCE(SUM(ea.file_size) FILTER (WHERE ea.auto_delete_at IS NOT NULL AND ea.auto_delete_at <= NOW()), 0) AS expired_size_bytes
    INTO total_files, total_size_bytes, temp_files, temp_size_bytes, expired_files, expired_size_bytes
    FROM email_attachments ea
    WHERE ea.storage_path IS NOT NULL;
    
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION cleanup_storage_files(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_storage_statistics() TO authenticated; 