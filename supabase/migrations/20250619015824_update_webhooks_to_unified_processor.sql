-- ============================================================================================================
-- UPDATE WEBHOOKS TO UNIFIED BACKGROUND SYNC PROCESSOR
-- ============================================================================================================
-- 
-- This migration updates all database functions that call background-sync-processor 
-- to use the new unified-background-sync function instead.
-- 
-- Updated Functions:
-- 1. trigger_next_chunk_processing() - Safe chunk processing system
-- 2. trigger_sync_webhook_safe() - Safe chunk processing system 
-- 3. trigger_sync_webhook() - Event driven sync queue system
-- 
-- This eliminates function-to-function call issues by using the unified processor.
-- ============================================================================================================

-- 1. Update trigger_next_chunk_processing function from safe chunk processing system
CREATE OR REPLACE FUNCTION trigger_next_chunk_processing(p_parent_sync_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_webhook_url TEXT;
    v_webhook_payload JSONB;
    v_pending_count INT;
BEGIN
    -- Check if there are pending chunks
    SELECT COUNT(*) INTO v_pending_count
    FROM chunk_processing_queue cpq
    JOIN chunked_sync_jobs csj ON cpq.chunk_id = csj.id
    WHERE csj.parent_sync_job_id = p_parent_sync_job_id
      AND cpq.status = 'pending';
    
    IF v_pending_count > 0 THEN
        -- Trigger webhook for next chunk using UNIFIED PROCESSOR
        v_webhook_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/unified-background-sync';
        
        v_webhook_payload := jsonb_build_object(
            'trigger_source', 'chunk_completion',
            'parent_sync_job_id', p_parent_sync_job_id
        );
        
        PERFORM net.http_post(
            url := v_webhook_url,
            headers := jsonb_build_object(
                'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
                'Content-Type', 'application/json'
            ),
            body := v_webhook_payload::text
        );
        
        RAISE NOTICE 'Triggered UNIFIED webhook for next chunk processing: %', p_parent_sync_job_id;
    ELSE
        -- All chunks completed, update parent sync job
        UPDATE sync_queue
        SET 
            status = 'completed',
            completed_at = NOW()
        WHERE id = p_parent_sync_job_id
          AND NOT EXISTS (
              SELECT 1 FROM chunk_processing_queue cpq
              JOIN chunked_sync_jobs csj ON cpq.chunk_id = csj.id
              WHERE csj.parent_sync_job_id = p_parent_sync_job_id
                AND cpq.status != 'completed'
          );
        
        RAISE NOTICE 'All chunks completed for sync job %', p_parent_sync_job_id;
    END IF;
END;
$$;

-- 2. Update trigger_sync_webhook_safe function from safe chunk processing system
CREATE OR REPLACE FUNCTION trigger_sync_webhook_safe()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    webhook_url TEXT;
    webhook_payload JSONB;
BEGIN
    -- Only trigger for pending jobs
    IF NEW.status != 'pending' THEN
        RETURN NEW;
    END IF;
    
    -- Construct webhook URL using UNIFIED PROCESSOR
    webhook_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/unified-background-sync';
    
    -- Build payload
    webhook_payload := jsonb_build_object(
        'trigger_source', 'sync_queue',
        'parent_sync_job_id', NEW.id,
        'store_id', NEW.store_id
    );
    
    -- Fire webhook
    PERFORM net.http_post(
        url := webhook_url,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := webhook_payload::text
    );
    
    RETURN NEW;
END;
$$;

-- 3. Update trigger_sync_webhook function from event driven sync queue system
CREATE OR REPLACE FUNCTION trigger_sync_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    webhook_url TEXT;
    webhook_payload JSONB;
    webhook_response RECORD;
BEGIN
    -- Only trigger for pending jobs (including retries)
    IF NEW.status != 'pending' THEN
        RETURN NEW;
    END IF;
    
    -- Construct webhook URL using UNIFIED PROCESSOR
    webhook_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/unified-background-sync';
    
    -- Prepare webhook payload
    webhook_payload := jsonb_build_object(
        'job_id', NEW.id,
        'business_id', NEW.business_id,
        'store_id', NEW.store_id,
        'sync_type', NEW.sync_type,
        'priority', NEW.priority,
        'triggered_at', NOW()
    );
    
    -- Fire webhook asynchronously
    PERFORM net.http_post(
        url := webhook_url,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := webhook_payload::text
    );
    
    -- Update webhook tracking
    NEW.webhook_triggered_at := NOW();
    NEW.webhook_attempts := COALESCE(NEW.webhook_attempts, 0) + 1;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log webhook failure but don't block the insert
    RAISE WARNING 'Webhook trigger failed for job %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ============================================================================================================
-- MIGRATION COMPLETION
-- ============================================================================================================

DO $$
BEGIN
    RAISE LOG 'Updated all database webhooks to use unified-background-sync processor';
    RAISE LOG 'Functions updated: trigger_next_chunk_processing, trigger_sync_webhook_safe, trigger_sync_webhook';
    RAISE LOG 'All webhook calls now point to /functions/v1/unified-background-sync';
END;
$$;
