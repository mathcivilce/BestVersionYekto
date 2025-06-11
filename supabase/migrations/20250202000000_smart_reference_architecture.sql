-- Smart Reference Architecture: Foundation Migration
-- Phase 1: Metadata extraction and provider abstraction

-- Create attachment_references table for metadata-only storage
CREATE TABLE IF NOT EXISTS attachment_references (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email_id UUID REFERENCES emails(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- File metadata
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    content_id VARCHAR(100), -- For CID references (cid:xyz)
    is_inline BOOLEAN DEFAULT FALSE,
    
    -- Provider-specific data
    provider_attachment_id TEXT NOT NULL, -- Graph API/Gmail/IMAP attachment ID
    provider_type VARCHAR(20) NOT NULL CHECK (provider_type IN ('outlook', 'gmail', 'imap')),
    provider_metadata JSONB, -- Store provider-specific data
    
    -- Deduplication and caching
    checksum VARCHAR(64), -- SHA-256 for deduplication
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    access_count INTEGER DEFAULT 0,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attachment_references_email_id ON attachment_references(email_id);
CREATE INDEX IF NOT EXISTS idx_attachment_references_user_id ON attachment_references(user_id);
CREATE INDEX IF NOT EXISTS idx_attachment_references_content_id ON attachment_references(content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachment_references_provider ON attachment_references(provider_type, provider_attachment_id);
CREATE INDEX IF NOT EXISTS idx_attachment_references_checksum ON attachment_references(checksum) WHERE checksum IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachment_references_last_accessed ON attachment_references(last_accessed_at);

-- Create attachment_cache table for temporary storage
CREATE TABLE IF NOT EXISTS attachment_cache (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    attachment_reference_id UUID REFERENCES attachment_references(id) ON DELETE CASCADE,
    cache_key VARCHAR(255) UNIQUE NOT NULL,
    storage_path TEXT, -- Path in Supabase storage for L2 cache
    cache_level VARCHAR(10) NOT NULL CHECK (cache_level IN ('L1', 'L2')), -- L1: Redis, L2: Storage
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for cache table
CREATE INDEX IF NOT EXISTS idx_attachment_cache_key ON attachment_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_attachment_cache_expires ON attachment_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_attachment_cache_reference ON attachment_cache(attachment_reference_id);

-- Provider status tracking table
CREATE TABLE IF NOT EXISTS email_provider_status (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    provider_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
    last_check_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    error_count INTEGER DEFAULT 0,
    last_error_message TEXT,
    response_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(store_id, provider_type)
);

-- RLS Policies for attachment_references
ALTER TABLE attachment_references ENABLE ROW LEVEL SECURITY;

-- Users can only see their own attachment references
CREATE POLICY "Users can view own attachment references" ON attachment_references
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own attachment references  
CREATE POLICY "Users can insert own attachment references" ON attachment_references
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own attachment references
CREATE POLICY "Users can update own attachment references" ON attachment_references
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own attachment references
CREATE POLICY "Users can delete own attachment references" ON attachment_references
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for attachment_cache
ALTER TABLE attachment_cache ENABLE ROW LEVEL SECURITY;

-- System-level access for cache (service role only)
CREATE POLICY "Service role can manage cache" ON attachment_cache
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
    );

-- RLS Policies for provider status
ALTER TABLE email_provider_status ENABLE ROW LEVEL SECURITY;

-- Users can view status for their stores
CREATE POLICY "Users can view provider status for own stores" ON email_provider_status
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM stores 
            WHERE stores.id = email_provider_status.store_id 
            AND stores.user_id = auth.uid()
        )
    );

-- Service role can manage all provider status
CREATE POLICY "Service role can manage provider status" ON email_provider_status
    FOR ALL USING (
        current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
    );

-- Function to update access tracking
CREATE OR REPLACE FUNCTION update_attachment_access(p_attachment_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE attachment_references 
    SET 
        last_accessed_at = NOW(),
        access_count = access_count + 1,
        updated_at = NOW()
    WHERE id = p_attachment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete expired cache entries
    DELETE FROM attachment_cache 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get attachment metadata by content_id
CREATE OR REPLACE FUNCTION get_attachment_by_content_id(
    p_content_id TEXT,
    p_email_id UUID
)
RETURNS TABLE (
    id UUID,
    filename VARCHAR(255),
    content_type VARCHAR(100),
    file_size BIGINT,
    provider_attachment_id TEXT,
    provider_type VARCHAR(20),
    provider_metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ar.id,
        ar.filename,
        ar.content_type,
        ar.file_size,
        ar.provider_attachment_id,
        ar.provider_type,
        ar.provider_metadata
    FROM attachment_references ar
    WHERE ar.content_id = p_content_id 
    AND ar.email_id = p_email_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update provider status
CREATE OR REPLACE FUNCTION update_provider_status(
    p_store_id UUID,
    p_provider_type VARCHAR(20),
    p_status VARCHAR(20),
    p_response_time_ms INTEGER DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO email_provider_status (
        store_id,
        provider_type,
        status,
        response_time_ms,
        last_error_message,
        error_count,
        last_check_at,
        updated_at
    ) VALUES (
        p_store_id,
        p_provider_type,
        p_status,
        p_response_time_ms,
        p_error_message,
        CASE WHEN p_status = 'healthy' THEN 0 ELSE 1 END,
        NOW(),
        NOW()
    )
    ON CONFLICT (store_id, provider_type)
    DO UPDATE SET
        status = EXCLUDED.status,
        response_time_ms = EXCLUDED.response_time_ms,
        last_error_message = EXCLUDED.last_error_message,
        error_count = CASE 
            WHEN EXCLUDED.status = 'healthy' THEN 0
            ELSE email_provider_status.error_count + 1
        END,
        last_check_at = NOW(),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update updated_at on attachment_references
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_attachment_references_updated_at
    BEFORE UPDATE ON attachment_references
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_provider_status_updated_at
    BEFORE UPDATE ON email_provider_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add attachment reference tracking to emails table
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachment_reference_count INTEGER DEFAULT 0;

-- Create index for the new column
CREATE INDEX IF NOT EXISTS idx_emails_attachment_reference_count ON emails(attachment_reference_count) WHERE attachment_reference_count > 0;

-- Update existing emails to set has_attachments based on attachment_reference_count
CREATE OR REPLACE FUNCTION sync_email_attachment_flags()
RETURNS VOID AS $$
BEGIN
    UPDATE emails 
    SET has_attachments = (attachment_reference_count > 0)
    WHERE has_attachments != (attachment_reference_count > 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 