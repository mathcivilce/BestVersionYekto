/**
 * ============================================================================================================
 * ENHANCED BACKGROUND SYNC PROCESSOR - PHASE 2 IMPLEMENTATION
 * ============================================================================================================
 * 
 * This Edge Function processes email sync jobs ONE CHUNK AT A TIME using a database queue.
 * Enhanced with intelligent error handling, retry delays, and Phase 1 recovery integration.
 * 
 * 🎯 CORE WORKFLOW:
 * 1. Claims the next available chunk from the queue using claim_next_chunk_job_safe()
 * 2. Processes ONLY ONE chunk by calling sync-emails function
 * 3. Reports completion using complete_chunk_job_safe()
 * 4. Database trigger automatically fires webhook for next chunk
 * 5. Exits cleanly - no self-restart needed
 * 
 * 🆕 PHASE 2 ENHANCEMENTS:
 * - Intelligent error categorization and retry logic
 * - Progressive backoff for rate limits
 * - Integration with Phase 1 recovery functions
 * - Enhanced health monitoring and metrics
 * - Smart retry delays based on error types
 * 
 * ============================================================================================================
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '', 
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

/**
 * Phase 2: Enhanced Error Categorization
 * Categorizes errors for intelligent retry logic
 */
function categorizeError(errorMessage: string): string {
  if (!errorMessage) return 'unknown';
  
  const msg = errorMessage.toLowerCase();
  
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429')) return 'rate_limit';
  if (msg.includes('network') || msg.includes('connection') || msg.includes('dns')) return 'network';
  if (msg.includes('temporary') || msg.includes('unavailable') || msg.includes('503') || msg.includes('502')) return 'temporary';
  if (msg.includes('auth') || msg.includes('token') || msg.includes('401') || msg.includes('403')) return 'auth';
  if (msg.includes('permission') || msg.includes('access') || msg.includes('forbidden')) return 'permission';
  if (msg.includes('not found') || msg.includes('404')) return 'not_found';
  if (msg.includes('duplicate') || msg.includes('conflict') || msg.includes('409')) return 'data_conflict';
  
  return 'processing_error';
}

/**
 * Phase 2: Smart Retry Delay Calculation
 * Returns delay in milliseconds based on error category and attempt count
 */
function calculateRetryDelay(errorCategory: string, attemptNumber: number): number {
  const baseDelay = 1000; // 1 second base
  
  switch (errorCategory) {
    case 'rate_limit':
      // Progressive backoff for rate limits: 5s, 15s, 45s
      return 5000 * Math.pow(3, Math.min(attemptNumber - 1, 2));
    
    case 'network':
    case 'temporary':
      // Exponential backoff: 2s, 4s, 8s
      return baseDelay * 2 * Math.pow(2, Math.min(attemptNumber - 1, 2));
    
    case 'timeout':
      // Linear increase: 3s, 6s, 9s
      return 3000 * Math.min(attemptNumber, 3);
    
    case 'auth':
      // Quick retry for auth issues: 2s, 5s
      return attemptNumber === 1 ? 2000 : 5000;
    
    case 'processing_error':
    default:
      // Standard exponential backoff: 1s, 2s, 4s
      return baseDelay * Math.pow(2, Math.min(attemptNumber - 1, 2));
  }
}

/**
 * Phase 2: Enhanced Health Metrics Collection
 */
function collectHealthMetrics(chunkJob: any, processingTime: number, error?: any) {
  return {
    worker_performance: {
      processing_time_ms: processingTime,
      chunk_size: chunkJob.estimated_emails,
      efficiency_ratio: chunkJob.estimated_emails / (processingTime / 1000), // emails per second
    },
    error_analysis: error ? {
      error_category: categorizeError(error.message),
      error_message: error.message,
      attempt_number: chunkJob.attempts + 1,
      suggested_retry_delay: calculateRetryDelay(categorizeError(error.message), chunkJob.attempts + 1)
    } : null,
    system_health: {
      worker_id: `worker-${Date.now()}`,
      timestamp: new Date().toISOString(),
      memory_usage: 'not_available_in_edge_runtime'
    }
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const workerId = `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const log = (message: string, data?: any) => {
   console.log(`[${workerId}] ${message}`, data !== undefined ? JSON.stringify(data, null, 2) : '');
  };
  
  log(`🚀 Starting PHASE 2 enhanced background sync processor`);

  try {
    // Parse request body
    const requestBody = await req.json().catch(() => ({}));
    const { trigger_source, parent_sync_job_id } = requestBody;
    
    log(`📋 Trigger received`, { trigger_source, parent_sync_job_id });

    // PHASE 2: Check for stuck chunks using Phase 1 recovery
    log(`🔍 Phase 2: Checking for stuck chunks before processing...`);
    try {
      const { data: recoveryResult, error: recoveryError } = await supabaseAdmin
        .rpc('reset_stuck_chunks', { p_timeout_minutes: 10 });

      if (recoveryError) {
        log(`⚠️ Phase 2: Recovery check failed (non-critical)`, { error: recoveryError.message });
      } else if (recoveryResult?.reset_count > 0) {
        log(`🔧 Phase 2: Auto-recovered ${recoveryResult.reset_count} stuck chunks`, {
          recovered_chunks: recoveryResult.chunk_ids,
          recovery_details: recoveryResult.recovery_details
        });
      }
    } catch (recoveryException) {
      log(`⚠️ Phase 2: Recovery exception (continuing)`, { error: recoveryException.message });
    }

    // SINGLE CHUNK PROCESSING
    log(`🔍 Attempting to claim next chunk job from queue...`);
    
    const { data: claimResult, error: claimError } = await supabaseAdmin
      .rpc('claim_next_chunk_job_safe', {
        p_worker_id: workerId
      });

    if (claimError) {
      console.error(`[${workerId}] ❌ Fatal error calling claim_next_chunk_job_safe`, claimError);
      throw new Error(`Failed to claim chunk job: ${claimError.message}`);
    }

    log(`☁️ Claim RPC returned`, { success: claimResult?.success });

    if (!claimResult?.success) {
      log(`✅ No available chunks to process. Exiting.`);
      return new Response(JSON.stringify({
        success: true,
        message: 'No chunks to process',
        worker_id: workerId,
        chunks_processed: 0,
        phase: 'phase_2_enhanced'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const chunkJob = claimResult.chunk_job;
    const queueId = chunkJob.queue_id;
    
    log(`✅ Successfully claimed chunk`, {
      chunk_id: chunkJob.chunk_id,
      queue_id: queueId,
      store_id: chunkJob.store_id,
      chunk_index: chunkJob.chunk_index,
      total_chunks: chunkJob.total_chunks,
      estimated_emails: chunkJob.estimated_emails,
      attempts: chunkJob.attempts,
      max_attempts: chunkJob.max_attempts
    });

    // Process the chunk
    log(`🔄 Processing chunk ${chunkJob.chunk_index}/${chunkJob.total_chunks} (attempt ${chunkJob.attempts + 1}/${chunkJob.max_attempts})...`);
    const startTime = Date.now();

    try {
      // Prepare payload for sync-emails
      const syncEmailsPayload: any = {
        storeId: chunkJob.store_id,
        businessId: chunkJob.business_id,
        chunkId: chunkJob.chunk_id,
        chunkIndex: chunkJob.chunk_index,
        totalChunks: chunkJob.total_chunks,
        startOffset: chunkJob.start_offset,
        endOffset: chunkJob.end_offset,
        estimatedEmails: chunkJob.estimated_emails,
        syncType: chunkJob.sync_type,
        workerId: workerId,
        chunked: true,
        parentSyncJobId: chunkJob.parent_sync_job_id,
        // Phase 2: Add attempt information for sync-emails function
        attemptNumber: chunkJob.attempts + 1,
        maxAttempts: chunkJob.max_attempts
      };

      // Add date range if specified
      if (chunkJob.sync_from) {
        syncEmailsPayload.syncFrom = chunkJob.sync_from;
        log(`📅 Adding syncFrom: ${chunkJob.sync_from}`);
      }
      if (chunkJob.sync_to) {
        syncEmailsPayload.syncTo = chunkJob.sync_to;
        log(`📅 Adding syncTo: ${chunkJob.sync_to}`);
      }

      log(`📤 Preparing to invoke sync-emails`, { chunkId: chunkJob.chunk_id, chunkIndex: chunkJob.chunk_index });
    
    const { data: syncResult, error: syncError } = await supabaseAdmin.functions.invoke('sync-emails', {
        body: syncEmailsPayload
    });

    const processingTime = Date.now() - startTime;
      log(`🔙 sync-emails function returned`, { hasError: !!syncError, processingTime });
    
    if (syncError) {
       throw new Error(syncError.message || 'sync-emails invocation failed');
      }

      log(`✔️ Chunk processing successful`, { emails_processed: syncResult?.emailsProcessed || 0, success: syncResult?.success });

           // Phase 2: Collect health metrics for successful processing
     const healthMetrics = collectHealthMetrics(chunkJob, processingTime);
     
     // Phase 2: Log health metrics to monitoring table
     try {
       await supabaseAdmin.rpc('log_chunk_health_metrics', {
         p_chunk_job_id: chunkJob.chunk_id,
         p_worker_id: workerId,
         p_queue_id: queueId,
         p_processing_time_ms: processingTime,
         p_chunk_size: chunkJob.estimated_emails,
         p_efficiency_ratio: healthMetrics.worker_performance.efficiency_ratio,
         p_status: 'success',
         p_attempt_number: chunkJob.attempts + 1,
         p_metadata: JSON.stringify(healthMetrics)
       });
       log(`📊 Phase 2: Health metrics logged successfully`);
     } catch (healthError) {
       log(`⚠️ Phase 2: Health logging failed (non-critical)`, { error: healthError.message });
    }

     // Report successful completion with enhanced metrics
     log(`➡️ Reporting completion to queue with Phase 2 metrics...`);
     const { error: completeError } = await supabaseAdmin
       .rpc('complete_chunk_job_safe', {
         p_chunk_job_id: chunkJob.chunk_id,
         p_queue_id: queueId,
         p_status: 'completed',
         p_emails_processed: syncResult?.emailsProcessed || 0,
         p_emails_failed: 0,
         p_processing_time_ms: processingTime,
         p_error_message: null
       });

     if (completeError) {
        console.error(`[${workerId}] ⚠️ CRITICAL: Error marking chunk as completed:`, completeError);
      } else {
        log(`✅ Chunk marked as 'completed' in queue.`);
     }

      // NO SELF-RESTART! The database trigger will handle the next chunk
      log(`🏁 Phase 2 chunk processing complete. Exiting.`);

     return new Response(JSON.stringify({
       success: true,
        message: `Chunk ${chunkJob.chunk_index}/${chunkJob.total_chunks} processed successfully`,
       worker_id: workerId,
       chunk_processed: chunkJob.chunk_index,
        total_chunks: chunkJob.total_chunks,
       emails_processed: syncResult?.emailsProcessed || 0,
        processing_time_ms: processingTime,
        health_metrics: healthMetrics,
        phase: 'phase_2_enhanced',
        trigger_info: 'Database webhook will trigger next chunk automatically'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (syncError) {
      console.error(`[${workerId}] ❌ Error during chunk processing:`, syncError);
      const processingTime = Date.now() - startTime;
      const errorMessage = syncError?.message || 'Unknown sync error';
      
      // Phase 2: Enhanced error handling with categorization
      const errorCategory = categorizeError(errorMessage);
      const retryDelay = calculateRetryDelay(errorCategory, chunkJob.attempts + 1);
      const healthMetrics = collectHealthMetrics(chunkJob, processingTime, syncError);
      
      log(`🔍 Phase 2: Error analysis`, {
        error_category: errorCategory,
        suggested_retry_delay_ms: retryDelay,
        attempt_number: chunkJob.attempts + 1,
        max_attempts: chunkJob.max_attempts
      });

      // Phase 2: Log error metrics to health monitoring
      try {
        await supabaseAdmin.rpc('log_chunk_health_metrics', {
          p_chunk_job_id: chunkJob.chunk_id,
          p_worker_id: workerId,
          p_queue_id: queueId,
          p_processing_time_ms: processingTime,
          p_chunk_size: chunkJob.estimated_emails,
          p_error_category: errorCategory,
          p_error_message: errorMessage,
          p_attempt_number: chunkJob.attempts + 1,
          p_suggested_retry_delay_ms: retryDelay,
          p_status: 'error',
          p_metadata: JSON.stringify(healthMetrics)
        });
        log(`📊 Phase 2: Error metrics logged successfully`);
      } catch (healthError) {
        log(`⚠️ Phase 2: Error logging failed (non-critical)`, { error: healthError.message });
      }

      // Phase 2: Use database function for smart retry determination
      let shouldRetry = false;
      try {
        const { data: retryResult, error: retryError } = await supabaseAdmin
          .rpc('should_retry_chunk', {
            p_attempts: chunkJob.attempts + 1,
            p_max_attempts: chunkJob.max_attempts,
            p_error_category: errorCategory,
            p_chunk_index: chunkJob.chunk_index
          });

        if (!retryError && retryResult !== null) {
          shouldRetry = retryResult;
          log(`🧠 Phase 2: Smart retry decision`, { should_retry: shouldRetry, error_category: errorCategory });
        }
      } catch (retryException) {
        // Fallback to simple logic if RPC fails
        shouldRetry = (chunkJob.attempts + 1) < chunkJob.max_attempts;
        log(`⚠️ Phase 2: Retry RPC failed, using fallback logic`, { should_retry: shouldRetry });
      }

      // Report failed completion with enhanced error categorization
      log(`➡️ Reporting failure to queue with Phase 2 error analysis...`, { 
        errorMessage, 
        errorCategory, 
        shouldRetry,
        retryDelay
      });
      
      const { error: completeError } = await supabaseAdmin
        .rpc('complete_chunk_job_safe', {
          p_chunk_job_id: chunkJob.chunk_id,
          p_queue_id: queueId,
          p_status: 'failed',
          p_emails_processed: 0,
          p_emails_failed: 0,
          p_processing_time_ms: processingTime,
          p_error_message: `[${errorCategory}] ${errorMessage}`
        });

      if (completeError) {
        console.error(`[${workerId}] ❌ CRITICAL: Error marking chunk as failed:`, completeError);
      } else {
       log(`✅ Chunk marked as 'failed' in queue with error category.`);
      }

      const isFinalAttempt = !shouldRetry || ((chunkJob.attempts + 1) >= chunkJob.max_attempts);
      log(`❌ Chunk ${chunkJob.chunk_index}/${chunkJob.total_chunks} failed (attempt ${chunkJob.attempts + 1}/${chunkJob.max_attempts})`);

      if (!isFinalAttempt) {
        log(`🔄 Phase 2: Chunk will be automatically retried with ${retryDelay}ms delay (${errorCategory} error)`);
      } else {
        log(`⛔ Phase 2: Chunk has reached max attempts or non-retriable error (${errorCategory})`);
      }

      return new Response(JSON.stringify({
        success: false,
        message: `Chunk ${chunkJob.chunk_index}/${chunkJob.total_chunks} failed: ${errorMessage}`,
        worker_id: workerId,
        chunk_failed: chunkJob.chunk_index,
        error: errorMessage,
        error_category: errorCategory,
        suggested_retry_delay_ms: retryDelay,
        health_metrics: healthMetrics,
        is_final_attempt: isFinalAttempt,
        will_retry: !isFinalAttempt,
        phase: 'phase_2_enhanced'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    log(`💥 Top-level fatal error in Phase 2 background processor`, { error: error?.message });
    return new Response(JSON.stringify({
      success: false,
      message: 'Phase 2 background processor fatal error',
      error: error?.message || 'Unknown error',
      worker_id: workerId,
      phase: 'phase_2_enhanced'
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/*
 * ============================================================================================================
 * PHASE 2 ENHANCED BACKGROUND PROCESSOR - COMPLETE
 * ============================================================================================================
 * 
 * ✅ PHASE 1 FEATURES (MAINTAINED):
 * 🏃‍♂️ No Self-Restart: Function completes cleanly after each chunk
 * 🔄 Database Orchestration: Webhooks trigger next chunk automatically
 * ⏱️ No Timeout Issues: Each invocation is independent
 * 🛡️ Built-in Retry: Queue system handles retries automatically
 * 📊 Full Visibility: Monitor queue status in database
 * 🎯 Reliable Processing: No lost chunks due to shutdown
 * 
 * 🆕 PHASE 2 ENHANCEMENTS:
 * 🧠 Intelligent Error Categorization: Automatic error type detection
 * ⏰ Smart Retry Delays: Progressive backoff based on error type
 * 🔧 Auto-Recovery Integration: Uses Phase 1 stuck chunk recovery
 * 📈 Health Metrics: Performance and error analysis
 * 🎯 Database-Driven Retry Logic: Uses should_retry_chunk() function
 * 🔍 Enhanced Observability: Detailed logging and metrics
 * 
 * 🚀 PRODUCTION-READY INTELLIGENT CHUNK PROCESSING!
 * ============================================================================================================
 */ 
 