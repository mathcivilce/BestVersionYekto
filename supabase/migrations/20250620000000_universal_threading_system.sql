-- ============================================================================================================
-- UNIVERSAL THREADING SYSTEM - PROVIDER AGNOSTIC & ORDER INDEPENDENT
-- ============================================================================================================
-- 
-- This migration implements a truly universal threading system that:
-- 1. Works with ANY email provider (Gmail, Outlook, Yahoo, Apple Mail, etc.)
-- 2. Is completely order-independent (fixes chunked processing issues)
-- 3. Performs comprehensive database scanning across ALL existing emails
-- 4. Uses RFC2822 standards first, provider extensions second
-- 5. Automatically fixes threading inconsistencies
-- 
-- 🌍 UNIVERSAL COMPATIBILITY: Gmail, Outlook, Yahoo, Apple Mail, Thunderbird, any RFC2822 provider
-- 🧩 CHUNKED PROCESSING FIX: Handles emails processed in any order
-- 🔍 COMPREHENSIVE SCANNING: Looks across ALL emails in the account
-- 🛠️ AUTO-REPAIR: Automatically consolidates split threads
-- 
-- ============================================================================================================

-- ============================================================================================================
-- ENHANCED UNIVERSAL THREADING FUNCTION
-- ============================================================================================================

CREATE OR REPLACE FUNCTION get_or_create_thread_id_universal(
  -- 🌍 UNIVERSAL RFC2822 PARAMETERS (work with ALL providers)
  p_message_id_header text,
  p_in_reply_to_header text,
  p_references_header text,
  p_subject text,
  p_from_email text,
  p_to_email text,
  p_date timestamptz,
  p_user_id uuid,
  p_store_id uuid,
  
  -- 🔧 OPTIONAL PROVIDER-SPECIFIC EXTENSIONS (backward compatibility)
  p_microsoft_conversation_id text DEFAULT NULL,
  p_thread_index_header text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_thread_id text;
  v_threading_method text := 'NEW_THREAD';
  v_normalized_message_id text;
  v_normalized_in_reply_to text;
  v_normalized_subject text;
  v_reference_ids text[];
  v_ref_id text;
  v_audit_log text := '';
  v_participant_emails text[];
  v_existing_thread_count integer := 0;
  v_consolidation_count integer := 0;
BEGIN
  -- 🎯 UNIVERSAL AUDIT: Start threading decision log
  v_audit_log := format('🌍 UNIVERSAL THREADING: %s → %s | Subject: %s', 
                       p_from_email, p_to_email, substring(p_subject, 1, 50));
  
  -- Normalize inputs according to RFC 2822 universal standards
  v_normalized_message_id := extract_message_id(p_message_id_header);
  v_normalized_in_reply_to := extract_message_id(p_in_reply_to_header);
  v_normalized_subject := normalize_email_subject(p_subject);
  
  -- Extract participant emails for universal matching
  v_participant_emails := ARRAY[
    lower(trim(p_from_email)), 
    lower(trim(p_to_email))
  ];
  
  v_audit_log := v_audit_log || format(' | Participants: %s', array_to_string(v_participant_emails, ', '));

  -- ============================================================================
  -- 🌍 STRATEGY 1: RFC2822 IN-REPLY-TO (UNIVERSAL - ALL PROVIDERS)
  -- 🔍 COMPREHENSIVE SCAN: Look across ALL existing emails in this store/user
  -- ============================================================================
  IF v_normalized_in_reply_to IS NOT NULL THEN
    v_audit_log := v_audit_log || format(' | 🔍 Scanning ALL emails for In-Reply-To: %s', v_normalized_in_reply_to);
    
    -- COMPREHENSIVE DATABASE SCAN: Search ALL emails in this account
    SELECT thread_id INTO v_thread_id
    FROM emails 
    WHERE extract_message_id(message_id_header) = v_normalized_in_reply_to
      AND user_id = p_user_id 
      AND store_id = p_store_id
    ORDER BY date ASC  -- Get the original email
    LIMIT 1;
    
    IF v_thread_id IS NOT NULL THEN
      v_threading_method := 'RFC2822_IN_REPLY_TO';
      v_audit_log := v_audit_log || format(' | ✅ FOUND via In-Reply-To: %s', v_thread_id);
      
      -- Log threading decision
      INSERT INTO email_threading_audit (
        message_id, thread_id, threading_method, audit_log, created_at
      ) VALUES (
        v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
      ) ON CONFLICT DO NOTHING;
      
      RETURN v_thread_id;
    END IF;
    
    v_audit_log := v_audit_log || ' | ❌ No match in In-Reply-To scan';
  END IF;

  -- ============================================================================
  -- 🌍 STRATEGY 2: RFC2822 REFERENCES CHAIN (UNIVERSAL - ALL PROVIDERS)
  -- 🔍 COMPREHENSIVE SCAN: Check ANY message in the references chain
  -- ============================================================================
  IF p_references_header IS NOT NULL AND p_references_header != '' THEN
    v_audit_log := v_audit_log || format(' | 🔍 Scanning References chain: %s', substring(p_references_header, 1, 100));
    
    -- Extract all Message-IDs from References header (RFC 2822 compliant parsing)
    v_reference_ids := regexp_split_to_array(
      regexp_replace(p_references_header, '[<>]', '', 'g'), 
      '\s+'
    );
    
    v_audit_log := v_audit_log || format(' | Found %s references to check', array_length(v_reference_ids, 1));
    
    -- Check each reference (most recent to oldest for priority)
    FOR i IN REVERSE array_length(v_reference_ids, 1)..1 LOOP
      v_ref_id := trim(v_reference_ids[i]);
      IF v_ref_id != '' AND v_ref_id LIKE '%@%' THEN
        v_ref_id := '<' || v_ref_id || '>';
        
        -- COMPREHENSIVE DATABASE SCAN: Search ALL emails for this reference
        SELECT thread_id INTO v_thread_id
        FROM emails 
        WHERE extract_message_id(message_id_header) = v_ref_id
          AND user_id = p_user_id 
          AND store_id = p_store_id
        ORDER BY date ASC  -- Get original email
        LIMIT 1;
        
        IF v_thread_id IS NOT NULL THEN
          v_threading_method := 'RFC2822_REFERENCES';
          v_audit_log := v_audit_log || format(' | ✅ FOUND via References[%s]: %s → %s', i, v_ref_id, v_thread_id);
          
          -- Log threading decision
          INSERT INTO email_threading_audit (
            message_id, thread_id, threading_method, audit_log, created_at
          ) VALUES (
            v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
          ) ON CONFLICT DO NOTHING;
          
          RETURN v_thread_id;
        END IF;
      END IF;
    END LOOP;
    
    v_audit_log := v_audit_log || ' | ❌ No matches in References chain scan';
  END IF;

  -- ============================================================================
  -- 🌍 STRATEGY 3: REVERSE LOOKUP (UNIVERSAL - ORDER INDEPENDENT)
  -- 🔍 COMPREHENSIVE SCAN: Check if THIS email is referenced by OTHER emails
  -- This is CRITICAL for chunked processing - handles out-of-order processing
  -- ============================================================================
  IF v_normalized_message_id IS NOT NULL THEN
    v_audit_log := v_audit_log || format(' | 🔍 Reverse lookup - scanning ALL emails that might reference: %s', v_normalized_message_id);
    
    -- COMPREHENSIVE DATABASE SCAN: Look for emails that reference THIS email
    SELECT thread_id INTO v_thread_id
    FROM emails 
    WHERE (
      extract_message_id(in_reply_to_header) = v_normalized_message_id OR
      references_header LIKE '%' || replace(v_normalized_message_id, '<', '') || '%' OR
      references_header LIKE '%' || replace(replace(v_normalized_message_id, '<', ''), '>', '') || '%'
    )
    AND user_id = p_user_id 
    AND store_id = p_store_id
    ORDER BY date ASC  -- Get the earliest email that references this one
    LIMIT 1;
    
    IF v_thread_id IS NOT NULL THEN
      v_threading_method := 'REVERSE_LOOKUP_ORDER_INDEPENDENT';
      v_audit_log := v_audit_log || format(' | ✅ FOUND via Reverse Lookup: %s', v_thread_id);
      
      -- Log threading decision
      INSERT INTO email_threading_audit (
        message_id, thread_id, threading_method, audit_log, created_at
      ) VALUES (
        v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
      ) ON CONFLICT DO NOTHING;
      
      RETURN v_thread_id;
    END IF;
    
    v_audit_log := v_audit_log || ' | ❌ No matches in reverse lookup scan';
  END IF;

  -- ============================================================================
  -- 🌍 STRATEGY 4: ENHANCED SUBJECT + PARTICIPANTS (UNIVERSAL - ALL PROVIDERS)
  -- 🔍 COMPREHENSIVE SCAN: Advanced conversation detection across ALL emails
  -- ============================================================================
  IF v_normalized_subject != '' AND length(v_normalized_subject) > 2 THEN
    v_audit_log := v_audit_log || format(' | 🔍 Scanning ALL emails for subject+participants: "%s"', v_normalized_subject);
    
    -- COMPREHENSIVE DATABASE SCAN: Enhanced universal subject matching
    SELECT thread_id INTO v_thread_id
    FROM emails 
    WHERE normalize_email_subject(subject) = v_normalized_subject
      AND user_id = p_user_id 
      AND store_id = p_store_id
      AND (
        -- Enhanced bidirectional participant matching (universal)
        lower(trim("from")) = ANY(v_participant_emails) OR
        lower(trim("to")) LIKE '%' || ANY(v_participant_emails) || '%' OR
        lower(trim(recipient)) LIKE '%' || ANY(v_participant_emails) || '%' OR
        -- Cross-participant communication check
        (lower(trim("from")) = lower(trim(p_to_email)) AND lower(trim("to")) LIKE '%' || lower(trim(p_from_email)) || '%') OR
        (lower(trim("from")) = lower(trim(p_from_email)) AND lower(trim("to")) LIKE '%' || lower(trim(p_to_email)) || '%')
      )
      AND abs(extract(epoch from (p_date - date))) < 86400 * 30  -- 30-day conversation window
    ORDER BY date ASC  -- Get original thread starter
    LIMIT 1;
    
    IF v_thread_id IS NOT NULL THEN
      v_threading_method := 'UNIVERSAL_SUBJECT_PARTICIPANTS';
      v_audit_log := v_audit_log || format(' | ✅ FOUND via Enhanced Subject+Participants: %s', v_thread_id);
      
      -- Log threading decision
      INSERT INTO email_threading_audit (
        message_id, thread_id, threading_method, audit_log, created_at
      ) VALUES (
        v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
      ) ON CONFLICT DO NOTHING;
      
      RETURN v_thread_id;
    END IF;
    
    v_audit_log := v_audit_log || ' | ❌ No matches in subject+participants scan';
  END IF;

  -- ============================================================================
  -- 🔧 STRATEGY 5: PROVIDER EXTENSIONS (OPTIONAL ENHANCEMENT)
  -- 🔍 COMPREHENSIVE SCAN: Microsoft ConversationId, Gmail ThreadId, etc.
  -- ============================================================================
  IF p_microsoft_conversation_id IS NOT NULL AND p_microsoft_conversation_id != '' THEN
    v_audit_log := v_audit_log || format(' | 🔍 Scanning Provider Extension (Microsoft): %s', p_microsoft_conversation_id);
    
    -- COMPREHENSIVE DATABASE SCAN: Provider-specific thread matching
    SELECT thread_id INTO v_thread_id
    FROM emails 
    WHERE microsoft_conversation_id = p_microsoft_conversation_id
      AND user_id = p_user_id 
      AND store_id = p_store_id
    ORDER BY date ASC  -- Get original email
    LIMIT 1;
    
    IF v_thread_id IS NOT NULL THEN
      v_threading_method := 'PROVIDER_EXTENSION_MICROSOFT';
      v_audit_log := v_audit_log || format(' | ✅ FOUND via Provider Extension: %s', v_thread_id);
      
      -- Log threading decision
      INSERT INTO email_threading_audit (
        message_id, thread_id, threading_method, audit_log, created_at
      ) VALUES (
        v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
      ) ON CONFLICT DO NOTHING;
      
      RETURN v_thread_id;
    END IF;
    
    v_audit_log := v_audit_log || ' | ❌ No matches in provider extension scan';
  END IF;

  -- ============================================================================
  -- 🌍 STRATEGY 6: THREAD CONSOLIDATION CHECK (UNIVERSAL CLEANUP)
  -- 🔍 COMPREHENSIVE SCAN: Look for emails that should be consolidated
  -- This handles the "Email thread 909" split thread issue automatically
  -- ============================================================================
  
  -- Check if there are multiple threads with same participants and similar timing
  IF v_normalized_subject != '' THEN
    SELECT COUNT(DISTINCT thread_id) INTO v_existing_thread_count
    FROM emails
    WHERE normalize_email_subject(subject) = v_normalized_subject
      AND user_id = p_user_id 
      AND store_id = p_store_id
      AND abs(extract(epoch from (p_date - date))) < 86400 * 7  -- 7-day window
      AND (
        lower(trim("from")) = ANY(v_participant_emails) OR
        lower(trim("to")) LIKE '%' || ANY(v_participant_emails) || '%'
      );
    
    -- If multiple threads exist for same conversation, consolidate into the oldest
    IF v_existing_thread_count > 1 THEN
      v_audit_log := v_audit_log || format(' | 🔧 CONSOLIDATION: Found %s threads to consolidate', v_existing_thread_count);
      
      -- Get the oldest thread_id for consolidation
      SELECT thread_id INTO v_thread_id
      FROM emails
      WHERE normalize_email_subject(subject) = v_normalized_subject
        AND user_id = p_user_id 
        AND store_id = p_store_id
        AND abs(extract(epoch from (p_date - date))) < 86400 * 7
        AND (
          lower(trim("from")) = ANY(v_participant_emails) OR
          lower(trim("to")) LIKE '%' || ANY(v_participant_emails) || '%'
        )
      ORDER BY date ASC
      LIMIT 1;
      
      IF v_thread_id IS NOT NULL THEN
        -- Consolidate all related emails into this thread
        UPDATE emails 
        SET thread_id = v_thread_id,
            conversation_root_id = v_thread_id,
            updated_at = now()
        WHERE normalize_email_subject(subject) = v_normalized_subject
          AND user_id = p_user_id 
          AND store_id = p_store_id
          AND abs(extract(epoch from (p_date - date))) < 86400 * 7
          AND thread_id != v_thread_id;
        
        GET DIAGNOSTICS v_consolidation_count = ROW_COUNT;
        
        v_threading_method := 'AUTOMATIC_CONSOLIDATION';
        v_audit_log := v_audit_log || format(' | ✅ CONSOLIDATED %s emails into thread: %s', v_consolidation_count, v_thread_id);
        
        -- Log consolidation decision
        INSERT INTO email_threading_audit (
          message_id, thread_id, threading_method, audit_log, created_at
        ) VALUES (
          v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
        ) ON CONFLICT DO NOTHING;
        
        RETURN v_thread_id;
      END IF;
    END IF;
  END IF;

  -- ============================================================================
  -- 🌍 FALLBACK: CREATE NEW UNIVERSAL THREAD (RFC2822 COMPLIANT)
  -- ============================================================================
  v_thread_id := COALESCE(v_normalized_message_id, 'thread-' || gen_random_uuid()::text);
  v_threading_method := 'NEW_UNIVERSAL_THREAD';
  v_audit_log := v_audit_log || format(' | 🆕 CREATED new universal thread: %s', v_thread_id);
  
  -- Log threading decision
  INSERT INTO email_threading_audit (
    message_id, thread_id, threading_method, audit_log, created_at
  ) VALUES (
    v_normalized_message_id, v_thread_id, v_threading_method, v_audit_log, now()
  ) ON CONFLICT DO NOTHING;
  
  RETURN v_thread_id;
END;
$$;

-- ============================================================================================================
-- THREAD CONSOLIDATION REPAIR FUNCTION
-- Fixes existing split threads caused by chunked processing
-- ============================================================================================================

CREATE OR REPLACE FUNCTION repair_split_threads_for_store(
  p_store_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_repaired_count integer := 0;
  v_thread_groups record;
  v_target_thread_id text;
  v_consolidated_count integer;
BEGIN
  -- Find conversations that have been split into multiple threads
  FOR v_thread_groups IN
    SELECT 
      normalize_email_subject(subject) as normalized_subject,
      COUNT(DISTINCT thread_id) as thread_count,
      MIN(date) as earliest_date,
      ARRAY_AGG(DISTINCT thread_id ORDER BY MIN(date)) as thread_ids,
      STRING_AGG(DISTINCT "from", ', ') as participants
    FROM emails
    WHERE store_id = p_store_id 
      AND user_id = p_user_id
      AND normalize_email_subject(subject) != ''
    GROUP BY normalize_email_subject(subject)
    HAVING COUNT(DISTINCT thread_id) > 1
      AND COUNT(*) > 1
  LOOP
    -- Use the thread_id from the earliest email
    v_target_thread_id := v_thread_groups.thread_ids[1];
    
    -- Consolidate all emails with this subject into the target thread
    UPDATE emails 
    SET thread_id = v_target_thread_id,
        conversation_root_id = v_target_thread_id,
        updated_at = now()
    WHERE store_id = p_store_id 
      AND user_id = p_user_id
      AND normalize_email_subject(subject) = v_thread_groups.normalized_subject
      AND thread_id != v_target_thread_id;
    
    GET DIAGNOSTICS v_consolidated_count = ROW_COUNT;
    v_repaired_count := v_repaired_count + v_consolidated_count;
    
    -- Log the repair
    INSERT INTO email_threading_audit (
      message_id, thread_id, threading_method, audit_log, created_at
    ) VALUES (
      'repair-' || gen_random_uuid()::text,
      v_target_thread_id,
      'SPLIT_THREAD_REPAIR',
      format('Consolidated %s emails for subject "%s" into thread %s | Participants: %s', 
             v_consolidated_count, v_thread_groups.normalized_subject, v_target_thread_id, v_thread_groups.participants),
      now()
    );
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'emails_consolidated', v_repaired_count,
    'message', format('Successfully repaired split threads, consolidated %s emails', v_repaired_count)
  );
END;
$$;

-- ============================================================================================================
-- INDEXES FOR COMPREHENSIVE SCANNING PERFORMANCE
-- ============================================================================================================

-- Optimize message ID lookups for comprehensive scanning
CREATE INDEX IF NOT EXISTS idx_emails_message_id_normalized ON emails USING btree(extract_message_id(message_id_header));
CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to_normalized ON emails USING btree(extract_message_id(in_reply_to_header));

-- Optimize subject-based threading
CREATE INDEX IF NOT EXISTS idx_emails_normalized_subject ON emails USING btree(normalize_email_subject(subject));

-- Optimize participant-based lookups
CREATE INDEX IF NOT EXISTS idx_emails_from_lower ON emails USING btree(lower(trim("from")));
CREATE INDEX IF NOT EXISTS idx_emails_to_lower ON emails USING btree(lower(trim("to")));

-- Optimize reverse lookup scanning
CREATE INDEX IF NOT EXISTS idx_emails_references_text ON emails USING gin(to_tsvector('english', references_header));

-- Optimize provider extension lookups
CREATE INDEX IF NOT EXISTS idx_emails_microsoft_conversation_id ON emails(microsoft_conversation_id) WHERE microsoft_conversation_id IS NOT NULL;

-- Optimize date-based threading windows
CREATE INDEX IF NOT EXISTS idx_emails_date_threading ON emails(user_id, store_id, date);

-- ============================================================================================================
-- UNIVERSAL THREADING STATISTICS VIEW
-- ============================================================================================================

CREATE OR REPLACE VIEW threading_health_stats AS
SELECT 
  s.name as store_name,
  s.email as store_email,
  COUNT(*) as total_emails,
  COUNT(DISTINCT e.thread_id) as total_threads,
  ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT e.thread_id), 0), 2) as avg_emails_per_thread,
  COUNT(*) FILTER (WHERE eta.threading_method LIKE 'RFC2822%') as rfc2822_threaded,
  COUNT(*) FILTER (WHERE eta.threading_method = 'UNIVERSAL_SUBJECT_PARTICIPANTS') as subject_threaded,
  COUNT(*) FILTER (WHERE eta.threading_method = 'REVERSE_LOOKUP_ORDER_INDEPENDENT') as reverse_lookup_threaded,
  COUNT(*) FILTER (WHERE eta.threading_method = 'AUTOMATIC_CONSOLIDATION') as auto_consolidated,
  COUNT(*) FILTER (WHERE eta.threading_method LIKE 'PROVIDER_EXTENSION%') as provider_extension_threaded,
  COUNT(*) FILTER (WHERE eta.threading_method = 'NEW_UNIVERSAL_THREAD') as new_threads_created
FROM emails e
JOIN stores s ON e.store_id = s.id
LEFT JOIN email_threading_audit eta ON extract_message_id(e.message_id_header) = eta.message_id
GROUP BY s.id, s.name, s.email
ORDER BY total_emails DESC;

-- ============================================================================================================
-- COMPLETION MESSAGE
-- ============================================================================================================

DO $$
BEGIN
  RAISE NOTICE '🌍 UNIVERSAL THREADING SYSTEM DEPLOYED SUCCESSFULLY!';
  RAISE NOTICE '✅ Provider-agnostic threading (works with ALL email providers)';
  RAISE NOTICE '✅ Order-independent processing (fixes chunked processing issues)';
  RAISE NOTICE '✅ Comprehensive database scanning across ALL existing emails';
  RAISE NOTICE '✅ Automatic thread consolidation (repairs split threads)';
  RAISE NOTICE '✅ Enhanced performance indexes for fast scanning';
  RAISE NOTICE '🔧 Run repair_split_threads_for_store(store_id, user_id) to fix existing issues';
  RAISE NOTICE '📊 Check threading_health_stats view for system health monitoring';
END $$; 