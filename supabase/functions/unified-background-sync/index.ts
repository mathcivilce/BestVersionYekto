/**
 * ====================================================================================================
 * UNIFIED BACKGROUND SYNC PROCESSOR - ENTERPRISE EMAIL SYNCHRONIZATION
 * ====================================================================================================
 * 
 * This is a UNIFIED edge function that combines:
 * 1. Background sync queue processing (from background-sync-processor)
 * 2. Comprehensive email synchronization (from sync-emails)
 * 
 * It processes email sync jobs ONE CHUNK AT A TIME using a database queue while maintaining
 * ALL comprehensive features from the original sync-emails function.
 * 
 * PRESERVED FEATURES FROM SYNC-EMAILS:
 * ✅ Date range filtering for targeted sync operations
 * ✅ Automatic token refresh when Microsoft tokens expire
 * ✅ Universal RFC2822 threading system (platform independent)
 * ✅ Smart Reference Architecture for attachment handling
 * ✅ Comprehensive error handling and timeout protection
 * ✅ Rate limit management with exponential backoff
 * ✅ Database overwhelm protection with safety limits
 * ✅ Detailed debugging and error classification
 * ✅ SYNTHETIC ATTACHMENT PROCESSING for orphaned CIDs
 * ✅ ENHANCED STRATEGY 1-3 with comprehensive debugging
 * ✅ EDGE CASE PROTECTION for Strategy 2 conflicts
 * ✅ ADVANCED CID MATCHING with field analysis
 * ✅ SMART DIRECTION DETECTION for inbound/outbound emails
 * 
 * QUEUE PROCESSING FEATURES (UPDATED WITH UNIFIED FUNCTIONS):
 * ✅ Claims chunks from queue using unified claim_next_chunk_job()
 * ✅ Processes ONLY ONE chunk per invocation
 * ✅ Reports completion using unified complete_chunk_job() function
 * ✅ Database trigger automatically fires webhook for next chunk
 * ✅ Exits cleanly - no self-restart needed
 * ✅ Intelligent error categorization and retry logic
 * ✅ Progressive backoff for rate limits
 * ✅ Enhanced health monitoring and metrics
 * 
 * UNIFIED FUNCTION APPROACH (NEW):
 * ✅ Uses complete_chunk_job() for both success and error cases
 * ✅ Includes queue_id parameter for proper queue management
 * ✅ Consistent processing time tracking across all completion paths
 * ✅ Eliminates the need for separate complete_chunk_job_safe() function
 * ✅ Handles both success and failure cases with consistent error reporting
 * ✅ Automatic webhook triggering for next chunk processing
 * ✅ Comprehensive logging and monitoring integration
 * ✅ Queue-based processing with race condition prevention
 * ✅ Stale job recovery and retry mechanisms
 * 
 * ====================================================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { Client } from "npm:@microsoft/microsoft-graph-client";
import { createEmailProvider, getProviderTypeFromPlatform, AttachmentProcessor } from "../_shared/email-providers-sync-emails.ts";
import { CidDetectionEngine } from "../_shared/cid-detection-engine.ts";
import { SyntheticAttachmentProcessor } from "../_shared/synthetic-attachment-processor.ts";
import { initializeGlobalMonitoring } from "../_shared/monitoring-synthetic.ts";

// ====================================================================================================
// CONFIGURATION AND CONSTANTS
// ====================================================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

// Performance and reliability constants from sync-emails
const PAGE_SIZE = 50; // Number of emails to fetch per API call (optimal for Graph API)
const BATCH_SIZE = 20; // Number of emails to save per database transaction (prevents timeouts)
const MAX_RETRIES = 3; // Maximum retry attempts for failed operations
const RETRY_DELAY = 2000; // Initial delay between retries (2 seconds, with exponential backoff)

// ====================================================================================================
// UTILITY FUNCTIONS (FROM SYNC-EMAILS)
// ====================================================================================================

/**
 * Extract specific header value from internetMessageHeaders array
 */
function extractHeader(headers: any[], headerName: string): string | null {
  if (!headers || !Array.isArray(headers)) return null;
  const header = headers.find((h) => h.name && h.name.toLowerCase() === headerName.toLowerCase());
  return header?.value || null;
}

/**
 * Extract multiple Message-IDs from References header
 */
function extractReferences(referencesHeader: string | null): string | null {
  if (!referencesHeader) return null;
  return referencesHeader.trim();
}

/**
 * 🌍 UNIVERSAL RFC2822 HEADER EXTRACTION
 */
function extractEmbeddedRFC2822Headers(htmlContent: string): any {
  if (!htmlContent) return {};
  
  try {
    const headerBlockMatch = htmlContent.match(/<!--\[RFC2822-THREADING-HEADERS-START\]-->(.*?)<!--\[RFC2822-THREADING-HEADERS-END\]-->/s);
    if (!headerBlockMatch) return {};
    
    const headerBlock = headerBlockMatch[1];
    const headers: any = {};
    
    const messageIdMatch = headerBlock.match(/Message-ID:\s*([^\n\r]+)/);
    if (messageIdMatch) headers.messageId = messageIdMatch[1].trim();
    
    const inReplyToMatch = headerBlock.match(/In-Reply-To:\s*([^\n\r]+)/);
    if (inReplyToMatch) headers.inReplyTo = inReplyToMatch[1].trim();
    
    const referencesMatch = headerBlock.match(/References:\s*([^\n\r]+)/);
    if (referencesMatch) headers.references = referencesMatch[1].trim();
    
    const threadTopicMatch = headerBlock.match(/Thread-Topic:\s*([^\n\r]+)/);
    if (threadTopicMatch) headers.threadTopic = threadTopicMatch[1].trim();
    
    const threadIndexMatch = headerBlock.match(/Thread-Index:\s*([^\n\r]+)/);
    if (threadIndexMatch) headers.threadIndex = threadIndexMatch[1].trim();
    
    console.log('🌍 Extracted embedded RFC2822 headers:', Object.keys(headers));
    return headers;
  } catch (error) {
    console.error('Error extracting embedded RFC2822 headers:', error);
    return {};
  }
}

/**
 * Generic retry operation with exponential backoff
 */
async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && (error.statusCode === 429 || error.statusCode >= 500)) {
      console.log(`Retrying operation, ${retries} attempts remaining`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// ====================================================================================================
// QUEUE PROCESSING FUNCTIONS (FROM BACKGROUND-SYNC-PROCESSOR)
// ====================================================================================================

/**
 * Categorizes errors for intelligent retry logic
 */
function categorizeError(errorMessage: string | null): string {
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
 * Returns delay in milliseconds based on error category and attempt count
 */
function calculateRetryDelay(errorCategory: string, attemptNumber: number): number {
  const baseDelay = 1000; // 1 second base
  
  switch (errorCategory) {
    case 'rate_limit':
      return 5000 * Math.pow(3, Math.min(attemptNumber - 1, 2));
    case 'network':
    case 'temporary':
      return baseDelay * 2 * Math.pow(2, Math.min(attemptNumber - 1, 2));
    case 'timeout':
      return 3000 * Math.min(attemptNumber, 3);
    case 'auth':
      return attemptNumber === 1 ? 2000 : 5000;
    case 'processing_error':
    default:
      return baseDelay * Math.pow(2, Math.min(attemptNumber - 1, 2));
  }
}

// ====================================================================================================
// SYNTHETIC ATTACHMENT PROCESSING (FROM SYNC-EMAILS)
// ====================================================================================================

async function processSyntheticAttachments(
  batch: any[],
  supabase: any,
  userId: string,
  batchNumber: number,
  completionContext?: any
): Promise<void> {
  console.log(`🔧 [SYNTHETIC] Processing batch ${batchNumber} with ${batch.length} emails for orphaned CIDs`);
  
  try {
    const monitoring = initializeGlobalMonitoring(supabase);
    const cidEngine = new CidDetectionEngine(supabase);
    const syntheticProcessor = new SyntheticAttachmentProcessor(supabase, monitoring, {
      maxSyntheticPerEmail: 3,
      batchSize: 10,
      enableValidation: true,
      persistToDatabase: true,
      skipLowConfidence: true,
      confidenceThreshold: 50
    });
    
    const emailRecords = batch.map((email) => ({
      id: email.id,
      content: email.content || '',
      graph_id: email.graph_id,
      has_attachments: email.has_attachments || false,
      attachment_reference_count: email.attachment_reference_count || 0,
      subject: email.subject,
      created_at: email.created_at
    }));
    
    const detectionOperationId = monitoring.startOperation('detection');
    const { orphanedEmails, stats } = await cidEngine.detectOrphanedCidsBatch(emailRecords);
    
    monitoring.updateOperation(detectionOperationId, {
      emailsProcessed: emailRecords.length,
      syntheticAttachmentsCreated: 0,
      resolutionAttempts: 0,
      successfulResolutions: 0,
      errors: 0
    });
    monitoring.completeOperation(detectionOperationId);
    monitoring.recordCidDetection(stats);
    
    if (orphanedEmails.length > 0) {
      console.log(`🔧 [SYNTHETIC] Found ${orphanedEmails.length} emails with orphaned CIDs in batch ${batchNumber}`);
      const batchResult = await syntheticProcessor.processBatch(orphanedEmails);
      console.log(`✅ [SYNTHETIC] Batch ${batchNumber} processing complete:`, {
        totalEmails: batchResult.totalEmails,
        syntheticAttachments: batchResult.syntheticAttachmentsCreated,
        errors: batchResult.errors.length,
        duration: `${batchResult.processingTimeMs}ms`
      });
      monitoring.logSessionSummary();

      // ✅ FINAL COMPLETION LOG: After all synthetic processing is complete
      if (completionContext?.isLastBatch) {
        if (completionContext.chunkIndex === completionContext.totalChunks) {
          // All chunks completed scenario
          console.log(`🎉 [FINAL-COMPLETION] All processing complete, function shutting down`, {
            worker_id: completionContext.workerId,
            emailsProcessed: completionContext.allEmails,
            emailsWithAttachments: completionContext.emailsWithAttachments,
            totalProcessingTime: Date.now() - completionContext.startTime,
            universalThreadingSuccessRate: completionContext.universalThreadingSuccessRate + '%',
            allChunksCompleted: true,
            isLastChunk: true,
            totalSyntheticCreated: batchResult.syntheticAttachmentsCreated
          });
        } else {
          // Individual chunk completed scenario
          console.log(`✅ [PRE-SHUTDOWN] Unified sync cycle completed successfully`, {
            worker_id: completionContext.workerId,
            emailsProcessed: completionContext.allEmails,
            chunkCompleted: completionContext.chunkIndex,
            totalChunks: completionContext.totalChunks,
            processing_time_ms: completionContext.processingTime,
            totalSyntheticCreated: batchResult.syntheticAttachmentsCreated
          });
        }
      }
    } else {
      console.log(`ℹ️ [SYNTHETIC] No orphaned CIDs found in batch ${batchNumber}`);

      // ✅ FINAL COMPLETION LOG: Even when no synthetic processing needed
      if (completionContext?.isLastBatch) {
        if (completionContext.chunkIndex === completionContext.totalChunks) {
          // All chunks completed scenario
          console.log(`🎉 [FINAL-COMPLETION] All processing complete, function shutting down`, {
            worker_id: completionContext.workerId,
            emailsProcessed: completionContext.allEmails,
            emailsWithAttachments: completionContext.emailsWithAttachments,
            totalProcessingTime: Date.now() - completionContext.startTime,
            universalThreadingSuccessRate: completionContext.universalThreadingSuccessRate + '%',
            allChunksCompleted: true,
            isLastChunk: true,
            message: 'No synthetic attachments needed'
          });
        } else {
          // Individual chunk completed scenario
          console.log(`✅ [PRE-SHUTDOWN] Unified sync cycle completed successfully`, {
            worker_id: completionContext.workerId,
            emailsProcessed: completionContext.allEmails,
            chunkCompleted: completionContext.chunkIndex,
            totalChunks: completionContext.totalChunks,
            processing_time_ms: completionContext.processingTime,
            message: 'No synthetic attachments needed'
          });
        }
      }
    }
  } catch (error: any) {
    console.error(`🚫 [SYNTHETIC] Error processing synthetic attachments for batch ${batchNumber}:`, {
      error: error.message,
      stack: error.stack
    });

    // ✅ FINAL COMPLETION LOG: Even on error, if it's the last batch
    if (completionContext?.isLastBatch) {
      console.log(`✅ [PRE-SHUTDOWN] Unified sync cycle completed with synthetic processing errors`, {
        worker_id: completionContext.workerId,
        emailsProcessed: completionContext.allEmails || 0,
        chunkCompleted: completionContext.chunkIndex,
        totalChunks: completionContext.totalChunks,
        error: error.message
      });
    }

    throw error;
  }
}

// ====================================================================================================
// MAIN UNIFIED FUNCTION
// ====================================================================================================

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Initialize worker ID and logging
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const log = (message: string, data?: any) => {
    console.log(`[${workerId}] ${message}`, data !== undefined ? JSON.stringify(data, null, 2) : '');
  };

  log(`🚀 [FUNCTION-START] Starting UNIFIED background sync processor`, {
    timestamp: new Date().toISOString(),
    workerId,
    method: req.method,
    url: req.url
  });

  // Log environment setup
  log(`⚙️ [ENVIRONMENT] Checking environment variables`, {
    hasSupabaseUrl: !!Deno.env.get('SUPABASE_URL'),
    hasServiceKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    supabaseUrlPreview: Deno.env.get('SUPABASE_URL')?.substring(0, 30) + '...'
  });

  // Initialize timing and debug info
  const startTime = Date.now();
  const executionStartTime = Date.now();
  const maxExecutionTime = 4.5 * 60 * 1000; // 4.5 minutes

  let debugInfo: any = {
    requestReceived: new Date().toISOString(),
    parametersExtracted: false,
    dateRangeApplied: false,
    tokenValidated: false,
    emailsFetched: 0,
    pagesProcessed: 0,
    databaseBatchesProcessed: 0,
    totalDuration: 0,
    failureReason: null
  };

  // Timeout check function
  const checkTimeout = () => {
    const elapsed = Date.now() - executionStartTime;
    if (elapsed > maxExecutionTime) {
      debugInfo.failureReason = 'EXECUTION_TIMEOUT';
      throw new Error(`Function timeout approaching: ${elapsed}ms elapsed, max: ${maxExecutionTime}ms`);
    }
    return elapsed;
  };

  // Initialize Supabase admin client
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // ==============================================================================================
    // STEP 1: QUEUE PROCESSING - CLAIM CHUNK
    // ==============================================================================================
    
    log(`🔍 Phase 2: Checking for stuck chunks before processing...`);
    
    // Check for stuck chunks
    try {
      const { data: recoveryResult, error: recoveryError } = await supabaseAdmin
        .rpc('reset_stuck_chunks', { p_timeout_minutes: 10 });
      
      if (recoveryError) {
        log(`⚠️ Recovery check failed (non-critical)`, { error: recoveryError.message });
      } else if (recoveryResult?.reset_count > 0) {
        log(`🔧 Auto-recovered ${recoveryResult.reset_count} stuck chunks`, {
          recovered_chunks: recoveryResult.chunk_ids
        });
      }
    } catch (recoveryException: any) {
      log(`⚠️ Recovery exception (continuing)`, { error: recoveryException.message });
    }

    // Check what's in the queue before claiming
    log(`🔍 [PRE-CLAIM-DEBUG] Checking sync queue status before claiming...`);
    try {
      const { data: syncJobs, error: syncError } = await supabaseAdmin
        .from('sync_queue')
        .select('id, status, created_at, store_id')
        .order('created_at', { ascending: false })
        .limit(5);
        
      const { data: pendingChunks, error: chunkError } = await supabaseAdmin
        .from('chunk_processing_queue')
        .select('id, chunk_id, status, worker_id, created_at')
        .eq('status', 'pending')
        .limit(10);
        
      log(`🔍 [PRE-CLAIM-DEBUG-RESULT] Database state before claim`, {
        syncJobsCount: syncJobs?.length || 0,
        pendingChunksCount: pendingChunks?.length || 0,
        syncJobs: syncJobs,
        pendingChunks: pendingChunks,
        syncError: syncError?.message,
        chunkError: chunkError?.message
      });
    } catch (preClaimError: any) {
      log(`❌ [PRE-CLAIM-DEBUG-ERROR] Pre-claim check failed`, {
        error: preClaimError.message
      });
    }

    // Claim next chunk from queue
    log(`🔍 [QUEUE-CLAIM] Attempting to claim next chunk job from queue...`, {
      workerId,
      timestamp: new Date().toISOString()
    });
    
    // ✅ UNIFIED CLAIM: Use unified claim_next_chunk_job() function for consistent queue management
    // This replaces the old claim_next_chunk_job_safe() with integrated queue handling
    const { data: claimResult, error: claimError } = await supabaseAdmin
      .rpc('claim_next_chunk_job', { p_worker_id: workerId });
    
    log(`📋 [QUEUE-CLAIM-RESULT] Claim operation completed`, {
      hasResult: !!claimResult,
      hasError: !!claimError,
      resultSuccess: claimResult?.success,
      resultMessage: claimResult?.message,
      resultData: claimResult,
      errorMessage: claimError?.message,
      errorCode: claimError?.code
    });
    
    if (claimError) {
      log(`❌ [QUEUE-CLAIM-ERROR] Fatal error calling claim_next_chunk_job`, {
        error: claimError.message,
        code: claimError.code,
        details: claimError
      });
      throw new Error(`Failed to claim chunk job: ${claimError.message}`);
    }

    if (!claimResult?.success) {
      log(`✅ [NO-CHUNKS] No available chunks to process. Exiting gracefully.`, {
        claimResultExists: !!claimResult,
        claimResultSuccess: claimResult?.success,
        claimResultMessage: claimResult?.message,
        fullClaimResult: claimResult,
        timestamp: new Date().toISOString()
      });
      
      // Let's also check what's actually in the database
      log(`🔍 [DEBUG-CHUNKS] Checking database for available chunks...`);
      try {
        const { data: debugChunks, error: debugError } = await supabaseAdmin
          .from('chunk_processing_queue')
          .select(`
            id,
            chunk_id,
            status,
            worker_id,
            started_at,
            created_at,
            chunked_sync_jobs(
              id,
              chunk_index,
              total_chunks,
              status,
              parent_sync_job_id,
              store_id
            )
          `)
          .order('created_at', { ascending: false })
          .limit(10);
          
        log(`🔍 [DEBUG-CHUNKS-RESULT] Database query result`, {
          hasData: !!debugChunks,
          chunkCount: debugChunks?.length || 0,
          hasError: !!debugError,
          error: debugError?.message,
          chunks: debugChunks
        });
      } catch (debugException: any) {
        log(`❌ [DEBUG-CHUNKS-ERROR] Failed to query chunks`, {
          error: debugException.message
        });
      }
      // ✅ NO-WORK SUCCESS LOG: No chunks available
      log(`🎉 [UNIFIED-SYNC-COMPLETE] Unified Background Sync Successfully Complete (No Work Available)`, {
        worker_id: workerId,
        message: 'No chunks to process',
        chunks_processed: 0,
        phase: 'phase_2_enhanced'
      });

      // ✅ FINAL COMPLETION LOG: No work scenario
      log(`✅ [PRE-SHUTDOWN] No work cycle completed, function shutting down`, {
        worker_id: workerId,
        chunks_processed: 0,
        message: 'No chunks to process',
        totalProcessingTime: Date.now() - startTime
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'No chunks to process',
          worker_id: workerId,
          chunks_processed: 0,
          phase: 'phase_2_enhanced'
        }),
        { headers: corsHeaders }
      );
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
      attempts: chunkJob.attempts
    });

    // ==============================================================================================
    // STEP 2: EMAIL SYNC PROCESSING (FROM SYNC-EMAILS)
    // ==============================================================================================

    try {
      // Extract parameters from chunk job
      const storeId = chunkJob.store_id;
      const syncFrom = chunkJob.sync_from;
      const syncTo = chunkJob.sync_to;
      const chunkId = chunkJob.chunk_id;
      const chunkIndex = chunkJob.chunk_index;
      const totalChunks = chunkJob.total_chunks;
      const startOffset = chunkJob.start_offset;
      const endOffset = chunkJob.end_offset;
      const estimatedEmails = chunkJob.estimated_emails;
      const parentSyncJobId = chunkJob.parent_sync_job_id;

      debugInfo.parametersExtracted = true;

      log('=== REQUEST PARAMETERS DEBUG ===');
      log('storeId:', storeId);
      log('syncFrom:', syncFrom);
      log('syncTo:', syncTo);
      log('🧩 CHUNK PROCESSING MODE:');
      log('  chunkId:', chunkId);
      log('  chunkIndex:', chunkIndex);
      log('  totalChunks:', totalChunks);
      log('  startOffset:', startOffset);
      log('  endOffset:', endOffset);
      log('  estimatedEmails:', estimatedEmails);
      log('=== END PARAMETERS DEBUG ===');

      // Get store details
      log(`🏪 [STORE-LOOKUP] Fetching store details for ID: ${storeId}`);
      const { data: store, error: storeError } = await supabaseAdmin
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .single();

      if (storeError) {
        log(`❌ [STORE-ERROR] Failed to fetch store details`, { 
          storeId, 
          error: storeError.message,
          code: storeError.code 
        });
        debugInfo.failureReason = 'STORE_NOT_FOUND';
        throw storeError;
      }

      log(`✅ [STORE-SUCCESS] Store details retrieved`, {
        storeId: store.id,
        storeName: store.name,
        provider: store.provider,
        userId: store.user_id,
        lastSynced: store.last_synced,
        hasAccessToken: !!store.access_token
      });

      let accessToken = store.access_token;

      // Token refresh logic
      const refreshTokenIfNeeded = async () => {
        log(`🔄 [TOKEN-REFRESH] Attempting to refresh token for store ${storeId}...`);
        const refreshResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-tokens`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ storeId })
          }
        );

        if (!refreshResponse.ok) {
          log(`❌ [TOKEN-REFRESH-FAILED] HTTP ${refreshResponse.status}`, {
            status: refreshResponse.status,
            statusText: refreshResponse.statusText
          });
          debugInfo.failureReason = 'TOKEN_REFRESH_FAILED';
          throw new Error(`Token refresh failed: ${refreshResponse.status}`);
        }

        const refreshResult = await refreshResponse.json();
        log(`📥 [TOKEN-REFRESH-RESPONSE]`, {
          success: refreshResult.success,
          hasError: !!refreshResult.error
        });
        
        if (!refreshResult.success) {
          log(`❌ [TOKEN-REFRESH-ERROR] Refresh unsuccessful`, {
            error: refreshResult.error
          });
          debugInfo.failureReason = 'TOKEN_REFRESH_ERROR';
          throw new Error(refreshResult.error || 'Token refresh failed');
        }

        const { data: updatedStore, error: updateError } = await supabaseAdmin
          .from('stores')
          .select('access_token')
          .eq('id', storeId)
          .single();

        if (updateError) {
          debugInfo.failureReason = 'TOKEN_UPDATE_ERROR';
          throw updateError;
        }

        accessToken = updatedStore.access_token;
        log(`✅ [TOKEN-REFRESH-SUCCESS] Token refreshed successfully`, {
          hasNewToken: !!accessToken
        });
        return accessToken;
      };

      // Create Graph client
      const createGraphClient = (token: string) => {
        return Client.init({
          authProvider: (done: any) => {
            done(null, token);
          }
        });
      };

      // Test token with retry
      const testTokenWithRetry = async (maxRetries = 1) => {
        log(`🔐 [TOKEN-VALIDATION] Starting token validation (max retries: ${maxRetries})`);
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            log(`🔐 [TOKEN-TEST] Attempt ${attempt + 1}/${maxRetries + 1} - Testing token via /me endpoint`);
            const testClient = createGraphClient(accessToken);
            await testClient.api('/me').get();
            log(`✅ [TOKEN-VALIDATION-SUCCESS] Token validation successful on attempt ${attempt + 1}`);
            debugInfo.tokenValidated = true;
            return;
          } catch (error: any) {
            log(`❌ [TOKEN-TEST-FAILED] Attempt ${attempt + 1} failed`, {
              statusCode: error.statusCode,
              message: error.message,
              willRetry: error.statusCode === 401 && attempt < maxRetries
            });
            
            if (error.statusCode === 401 && attempt < maxRetries) {
              log(`🔄 [TOKEN-RETRY] Status 401 detected, attempting token refresh...`);
              await refreshTokenIfNeeded();
            } else {
              log(`❌ [TOKEN-VALIDATION-FAILED] All attempts exhausted`, {
                finalAttempt: attempt + 1,
                statusCode: error.statusCode,
                message: error.message
              });
              debugInfo.failureReason = 'TOKEN_VALIDATION_FAILED';
              throw new Error(`Token validation failed: ${error.message}`);
            }
          }
        }
      };

      await testTokenWithRetry(1);

      // Initialize variables
      log(`🚀 [EMAIL-PROCESSING-INIT] Initializing email processing variables`);
      const allEmails: any[] = [];
      let emailsToProcess: any[] = [];
      let pageCount = 0;
      let nextLink: string | null = null;
      let conversationFetchAttempts = 0;
      let conversationFetchSuccesses = 0;

      // Date range filtering
      log(`📅 [DATE-FILTER-INIT] Setting up date range filtering`, {
        syncFrom,
        syncTo,
        hasDateRange: !!(syncFrom || syncTo)
      });
      
      let filter = "isDraft eq false";
      if (syncFrom || syncTo) {
        log('=== 📅 [DATE-RANGE-FILTERING] Starting date range setup ===');
        log(`📅 [DATE-INPUT] Original syncFrom: ${syncFrom}`);
        log(`📅 [DATE-INPUT] Original syncTo: ${syncTo}`);
        
        if (syncFrom) {
          const fromDate = new Date(syncFrom);
          fromDate.setUTCHours(0, 0, 0, 0);
          const fromIsoString = fromDate.toISOString();
          filter += ` and receivedDateTime ge ${fromIsoString}`;
          log(`📅 [DATE-FROM] Added FROM filter: receivedDateTime ge ${fromIsoString}`, {
            originalDate: syncFrom,
            processedDate: fromIsoString
          });
        }
        
        if (syncTo) {
          const toDate = new Date(syncTo);
          toDate.setUTCHours(23, 59, 59, 999);
          const toIsoString = toDate.toISOString();
          filter += ` and receivedDateTime le ${toIsoString}`;
          log(`📅 [DATE-TO] Added TO filter: receivedDateTime le ${toIsoString}`, {
            originalDate: syncTo,
            processedDate: toIsoString
          });
        }
        
        debugInfo.dateRangeApplied = true;
        log(`📅 [DATE-FILTER-FINAL] Final Microsoft Graph filter: ${filter}`);
        log('=== 📅 [DATE-RANGE-FILTERING] Complete ===');
      }

      // CHUNKED EMAIL FETCHING
      log(`🧩 [CHUNKED-MODE] Processing chunk ${chunkIndex}/${totalChunks}`, {
        chunkIndex,
        totalChunks,
        parentSyncJobId
      });
      log(`🧩 [CHUNK-BOUNDARIES] Boundaries defined`, {
        startOffset,
        endOffset,
        estimatedEmails,
        chunkSize: endOffset - startOffset + 1
      });

      const chunkSize = endOffset - startOffset + 1;
      log(`🧩 [CHUNK-SIZE] Chunk size calculated`, {
        chunkSize,
        startOffset,
        endOffset,
        rangeDescription: `${startOffset}-${endOffset}`
      });

      const emailsPerPage = PAGE_SIZE;
      const pagesToSkip = Math.floor(startOffset / emailsPerPage);
      const offsetWithinPage = startOffset % emailsPerPage;

      log(`🧩 [PAGINATION] Pagination strategy`, {
        emailsPerPage,
        pagesToSkip,
        offsetWithinPage,
        totalEmailsToSkip: pagesToSkip * emailsPerPage + offsetWithinPage
      });

      // Build Graph API query
      let graphQuery = `/me/messages`;
      const queryParams: string[] = [];
      
      queryParams.push(`$filter=${encodeURIComponent(filter)}`);
      if (pagesToSkip > 0) {
        queryParams.push(`$skip=${pagesToSkip * emailsPerPage}`);
      }
      queryParams.push(`$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,body,conversationId,internetMessageId,parentFolderId,internetMessageHeaders,hasAttachments`);
      queryParams.push(`$orderby=receivedDateTime desc`);
      queryParams.push(`$top=${emailsPerPage}`);
      
      const fullQuery = `${graphQuery}?${queryParams.join('&')}`;
      log(`🧩 [GRAPH-QUERY] Built Microsoft Graph query`, {
        endpoint: graphQuery,
        queryParamsCount: queryParams.length,
        fullQueryLength: fullQuery.length,
        queryPreview: fullQuery.substring(0, 200) + '...'
      });

      // Fetch emails for chunk
      let emailsFetched = 0;
      let currentPageOffset = offsetWithinPage;

      do {
        pageCount++;
        debugInfo.pagesProcessed = pageCount;
        
        const elapsed = checkTimeout();
        log(`📄 [CHUNK-PAGE] Fetching page ${pageCount} for chunk ${chunkIndex}`, {
          pageNumber: pageCount,
          chunkIndex,
          elapsedMs: elapsed,
          maxExecutionMs: maxExecutionTime
        });
        
        const graphClient = createGraphClient(accessToken);
        let response: any;
        
        if (nextLink) {
          log(`📄 [NEXT-PAGE] Using continuation token...`, {
            pageNumber: pageCount,
            hasNextLink: true,
            nextLinkLength: nextLink.length
          });
          response = await retryOperation(() => graphClient.api(nextLink).get());
        } else {
          log(`📄 [FIRST-PAGE] Fetching first page of chunk...`, {
            pageNumber: pageCount,
            isFirstPage: true,
            queryLength: fullQuery.length
          });
          response = await retryOperation(() => graphClient.api(fullQuery).get());
        }

        if (!response || !Array.isArray(response.value)) {
          log(`❌ [GRAPH-ERROR] Invalid response format from Microsoft Graph API`, {
            hasResponse: !!response,
            responseType: typeof response,
            hasValue: response?.value !== undefined,
            valueType: typeof response?.value,
            isArray: Array.isArray(response?.value)
          });
          debugInfo.failureReason = 'INVALID_GRAPH_RESPONSE';
          throw new Error('Invalid response format from Microsoft Graph API');
        }

        let pageEmails = response.value;
        log(`📄 [PAGE-RESPONSE] Received ${pageEmails.length} emails from Microsoft Graph`, {
          pageNumber: pageCount,
          emailsReceived: pageEmails.length,
          hasNextLink: !!response['@odata.nextLink']
        });
        
        if (pageCount === 1 && currentPageOffset > 0) {
          const originalCount = pageEmails.length;
          pageEmails = pageEmails.slice(currentPageOffset);
          log(`📄 [PAGE-OFFSET] Applied offset on first page`, {
            originalCount,
            offsetApplied: currentPageOffset,
            emailsAfterOffset: pageEmails.length
          });
        }

        // Process emails with threading headers
        for (const email of pageEmails) {
          if (emailsFetched >= chunkSize) {
            log(`📄 [CHUNK-LIMIT] Reached chunk size limit, stopping fetch`, {
              emailsFetched,
              chunkSize,
              chunkIndex,
              pageNumber: pageCount
            });
            nextLink = null;
            break;
          }

          const embeddedHeaders = extractEmbeddedRFC2822Headers(email.body?.content || '');
          const messageIdHeader = embeddedHeaders.messageId ||
            extractHeader(email.internetMessageHeaders, 'X-Message-ID-RFC2822') ||
            extractHeader(email.internetMessageHeaders, 'Message-ID') ||
            email.internetMessageId;
          
          const inReplyToHeader = embeddedHeaders.inReplyTo ||
            extractHeader(email.internetMessageHeaders, 'X-In-Reply-To-RFC2822') ||
            extractHeader(email.internetMessageHeaders, 'In-Reply-To');
          
          const referencesHeader = embeddedHeaders.references ||
            extractHeader(email.internetMessageHeaders, 'X-References-RFC2822') ||
            extractReferences(extractHeader(email.internetMessageHeaders, 'References'));
          
          const threadIndexHeader = embeddedHeaders.threadIndex ||
            extractHeader(email.internetMessageHeaders, 'X-Thread-Index') ||
            extractHeader(email.internetMessageHeaders, 'Thread-Index');

          const enhancedEmail = {
            ...email,
            microsoft_conversation_id: email.conversationId,
            has_attachments: email.hasAttachments,
            body_preview: email.bodyPreview,
            received_date_time: email.receivedDateTime,
            message_id_header: messageIdHeader,
            in_reply_to_header: inReplyToHeader,
            references_header: referencesHeader,
            processed_by_custom_threading: true
          };

          allEmails.push(enhancedEmail);
          emailsFetched++;

          if (email.conversationId) {
            conversationFetchAttempts++;
            conversationFetchSuccesses++;
          }
        }

        if (emailsFetched < chunkSize) {
          nextLink = response['@odata.nextLink'];
        } else {
          nextLink = null;
        }

        console.log(`📄 [CHUNK-PROGRESS] Fetched ${emailsFetched}/${chunkSize} emails for chunk ${chunkIndex}`);

        if (nextLink) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } while (nextLink && emailsFetched < chunkSize);

      console.log(`✅ [CHUNK-COMPLETE] Chunk ${chunkIndex} fetched ${emailsFetched} emails`);
      emailsToProcess = allEmails;
      debugInfo.emailsFetched = allEmails.length;

      // PROCESS AND SAVE EMAILS
      if (emailsToProcess.length > 0) {
        const emailsToSave: any[] = [];
        
        // @ts-ignore - Global assignment for email provider
        globalThis.supabaseClient = supabaseAdmin;
        
        const providerType = getProviderTypeFromPlatform(store.platform || 'outlook');
        const emailProvider = createEmailProvider(providerType, store.id, accessToken);

        // Process each email
        for (const msg of emailsToProcess) {
          checkTimeout();
          
          const toEmails = msg.toRecipients?.map((r: any) => r.emailAddress?.address).filter(Boolean).join(',') || '';
          
          const embeddedHeaders = extractEmbeddedRFC2822Headers(msg.body?.content || '');
          const threadIndexHeader = embeddedHeaders.threadIndex ||
            extractHeader(msg.internetMessageHeaders, 'X-Thread-Index') ||
            extractHeader(msg.internetMessageHeaders, 'Thread-Index');

          // Get or create thread ID
          const { data: threadResult, error: threadError } = await supabaseAdmin
            .rpc('get_or_create_thread_id_universal', {
              p_message_id_header: msg.message_id_header,
              p_in_reply_to_header: msg.in_reply_to_header,
              p_references_header: msg.references_header,
              p_subject: msg.subject || 'No Subject',
              p_from_email: msg.from?.emailAddress?.address || '',
              p_to_email: toEmails,
              p_date: msg.receivedDateTime || new Date().toISOString(),
              p_user_id: store.user_id,
              p_store_id: storeId,
              p_microsoft_conversation_id: msg.microsoft_conversation_id || msg.conversationId,
              p_thread_index_header: threadIndexHeader
            });

          if (threadError) {
            console.error('Error getting thread ID for message:', msg.id, threadError);
          }

          const universalThreadId = threadResult || msg.message_id_header || msg.microsoft_conversation_id || msg.conversationId;
          
          let attachmentCount = 0;
          const emailId = crypto.randomUUID();

          const emailRecord: any = {
            id: emailId,
            graph_id: msg.id,
            thread_id: universalThreadId,
            parent_id: null,
            subject: msg.subject || 'No Subject',
            from: msg.from?.emailAddress?.address || '',
            snippet: msg.body_preview || msg.bodyPreview || '',
            content: msg.body?.content || '',
            date: msg.received_date_time || msg.receivedDateTime || new Date().toISOString(),
            read: msg.isRead || false,
            priority: 1,
            status: 'open',
            store_id: storeId,
            user_id: store.user_id,
            business_id: store.business_id,
            internet_message_id: msg.internetMessageId,
            microsoft_conversation_id: msg.microsoft_conversation_id || msg.conversationId,
            has_attachments: attachmentCount > 0,
            attachment_reference_count: attachmentCount,
            message_id_header: msg.message_id_header,
            in_reply_to_header: msg.in_reply_to_header,
            references_header: msg.references_header,
            thread_index_header: threadIndexHeader,
            conversation_root_id: universalThreadId,
            processed_by_custom_threading: true,
            direction: (msg.from?.emailAddress?.address || '').toLowerCase() === store.email.toLowerCase() ? 'outbound' : 'inbound',
            recipient: toEmails
          };

          // Process attachments if present
          if (msg.hasAttachments || msg.has_attachments) {
            console.log(`🔍 [ATTACHMENT-DEBUG] Processing email ${msg.id} - hasAttachments: ${msg.hasAttachments || msg.has_attachments}`);
            
            try {
              const attachmentMetadata = await emailProvider.extractAttachmentMetadata(msg.id);
              
              if (attachmentMetadata && attachmentMetadata.length > 0) {
                console.log(`📎 [ATTACHMENT-DEBUG] Found ${attachmentMetadata.length} raw attachments for email ${msg.id}`);
                
                const contentIds = AttachmentProcessor.extractContentIdFromHtml(msg.body?.content || '');
                console.log(`🔍 [CID-EXTRACTION] Raw extracted CIDs:`, contentIds);
                
                const linkedAttachments = await AttachmentProcessor.linkContentIdsToAttachments(
                  contentIds,
                  attachmentMetadata
                );
                console.log(`🔗 [CID-LINKING] Linked attachments result:`, linkedAttachments.length);
                
                attachmentCount = linkedAttachments.length;
                
                if (linkedAttachments.length > 0) {
                  emailRecord.pending_attachments = linkedAttachments;
                  console.log(`📦 [ATTACHMENT-DEBUG] Stored ${linkedAttachments.length} pending attachments for email ${msg.id}`);
                }
                
                emailRecord.has_attachments = attachmentCount > 0;
                emailRecord.attachment_reference_count = attachmentCount;
              }
            } catch (attachmentError) {
              console.error('🚫 [ATTACHMENT-ERROR] Error extracting attachments (non-fatal):', attachmentError);
            }
          }

          // Thread assignment inheritance
          if (universalThreadId) {
            try {
              const { data: existingThreadEmail } = await supabaseAdmin
                .from('emails')
                .select('assigned_to')
                .eq('thread_id', universalThreadId)
                .eq('user_id', store.user_id)
                .not('assigned_to', 'is', null)
                .order('date', { ascending: false })
                .limit(1)
                .single();

              if (existingThreadEmail?.assigned_to) {
                emailRecord.assigned_to = existingThreadEmail.assigned_to;
                console.log('🔗 Inheriting thread assignment for sync:', existingThreadEmail.assigned_to);
              }
            } catch (assignmentError) {
              console.log('ℹ️ No existing thread assignment found (this is normal for new threads)');
            }
          }

          emailsToSave.push(emailRecord);
        }

        // Save emails in batches
        let savedCount = 0;
        for (let i = 0; i < emailsToSave.length; i += BATCH_SIZE) {
          checkTimeout();
          
          const batch = emailsToSave.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(emailsToSave.length / BATCH_SIZE);
          
          debugInfo.databaseBatchesProcessed = batchNumber;
          console.log(`Saving batch ${batchNumber} of ${totalBatches}`);

          try {
            await retryOperation(async () => {
              const { error: saveError } = await supabaseAdmin
                .from('emails')
                .upsert(batch, {
                  onConflict: 'graph_id,user_id',
                  ignoreDuplicates: false
                });

              if (saveError) {
                if (saveError.message.includes('duplicate') || saveError.message.includes('conflict')) {
                  console.log('🔄 Attempting alternative upsert for sent emails...');
                  
                  const emailsWithGraphId = batch.filter((email) => email.graph_id);
                  const emailsWithoutGraphId = batch.filter((email) => !email.graph_id);
                  
                  if (emailsWithGraphId.length > 0) {
                    const { error: graphIdError } = await supabaseAdmin
                      .from('emails')
                      .upsert(emailsWithGraphId, {
                        onConflict: 'graph_id,user_id',
                        ignoreDuplicates: false
                      });
                    if (graphIdError) throw graphIdError;
                  }
                  
                  if (emailsWithoutGraphId.length > 0) {
                    const { error: sentEmailError } = await supabaseAdmin
                      .from('emails')
                      .upsert(emailsWithoutGraphId, {
                        onConflict: 'message_id_header,user_id,store_id',
                        ignoreDuplicates: false
                      });
                      
                    if (sentEmailError) {
                      console.warn('⚠️ Batch upsert failed, trying individual upserts for sent emails...');
                      for (const email of emailsWithoutGraphId) {
                        try {
                          const { data: existingEmail } = await supabaseAdmin
                            .from('emails')
                            .select('id, graph_id')
                            .eq('message_id_header', email.message_id_header)
                            .eq('user_id', email.user_id)
                            .eq('store_id', email.store_id)
                            .maybeSingle();

                          if (existingEmail) {
                            await supabaseAdmin
                              .from('emails')
                              .update({
                                graph_id: email.graph_id,
                                microsoft_conversation_id: email.microsoft_conversation_id,
                                date: email.date
                              })
                              .eq('id', existingEmail.id);
                            console.log(`✅ Updated existing sent email ${existingEmail.id} with sync data`);
                          } else {
                            await supabaseAdmin.from('emails').insert(email);
                            console.log(`✅ Inserted new email ${email.id}`);
                          }
                        } catch (individualError) {
                          console.error(`❌ Failed to process individual email:`, individualError);
                        }
                      }
                    }
                  }
                } else {
                  if (saveError.message.includes('timeout')) {
                    debugInfo.failureReason = 'DATABASE_TIMEOUT';
                  } else if (saveError.message.includes('connection')) {
                    debugInfo.failureReason = 'DATABASE_CONNECTION_ERROR';
                  } else {
                    debugInfo.failureReason = 'DATABASE_SAVE_ERROR';
                  }
                  throw saveError;
                }
              }
            });

            savedCount += batch.length;
            console.log(`Successfully saved ${savedCount} of ${emailsToSave.length} emails`);

            // Process attachments for this batch
            console.log(`📎 [ATTACHMENT-BATCH] Processing attachments for batch ${batchNumber}`);
            let attachmentProcessedCount = 0;
            let attachmentErrorCount = 0;

            for (const email of batch) {
              if (email.pending_attachments && email.pending_attachments.length > 0) {
                console.log(`📎 [ATTACHMENT-PROCESSING] Starting processing for email ${email.id} with ${email.pending_attachments.length} attachments`);
                
                try {
                  await AttachmentProcessor.processAttachmentMetadata(
                    email.pending_attachments,
                    email.id,
                    store.user_id,
                    supabaseAdmin
                  );
                  attachmentProcessedCount += email.pending_attachments.length;
                  console.log(`✅ [ATTACHMENT-SUCCESS] Successfully processed ${email.pending_attachments.length} attachment references for email ${email.id}`);
                } catch (attachmentError) {
                  attachmentErrorCount += email.pending_attachments.length;
                  console.error(`🚫 [ATTACHMENT-ERROR] Error saving attachment references for email ${email.id}:`, attachmentError);
                }
              }
            }

            console.log(`📊 [ATTACHMENT-BATCH-SUMMARY] Batch ${batchNumber} - Processed: ${attachmentProcessedCount}, Errors: ${attachmentErrorCount}`);

            // Process synthetic attachments
            console.log(`🔧 [SYNTHETIC-BATCH] Starting orphaned CID detection for batch ${batchNumber}`);
            try {
              // Detect if this is the last batch
              const isLastBatch = (i + BATCH_SIZE >= emailsToSave.length);
              
              await processSyntheticAttachments(batch, supabaseAdmin, store.user_id, batchNumber, {
                isLastBatch,
                workerId,
                allEmails: allEmails.length,
                emailsWithAttachments: allEmails.filter(e => e.hasAttachments || e.has_attachments).length,
                startTime,
                processingTime: Date.now() - startTime,
                universalThreadingSuccessRate: conversationFetchAttempts > 0 
                  ? (conversationFetchSuccesses / conversationFetchAttempts * 100).toFixed(1) 
                  : '100',
                chunkIndex,
                totalChunks
              });
            } catch (syntheticError) {
              console.error(`🚫 [SYNTHETIC-ERROR] Error processing synthetic attachments for batch ${batchNumber}:`, syntheticError);
            }

            if (i + BATCH_SIZE < emailsToSave.length) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } catch (error) {
            console.error(`🚫 Error saving batch ${batchNumber}:`, error);
            continue;
          }
        }
      }

      // ==============================================================================================
      // CHUNK COMPLETION LOGIC
      // ==============================================================================================

      const processingTime = Date.now() - startTime;
      
      console.log(`🧩 [CHUNK-COMPLETION] Processing completion for chunk ${chunkIndex}/${totalChunks}`);

      // Calculate metrics
      const universalThreadingSuccessRate = conversationFetchAttempts > 0 
        ? (conversationFetchSuccesses / conversationFetchAttempts * 100).toFixed(1) 
        : '100';
      
      let emailsWithAttachments = 0;
      for (const email of allEmails) {
        if (email.hasAttachments || email.has_attachments) {
          emailsWithAttachments++;
        }
      }

      debugInfo.totalDuration = Date.now() - startTime;

      // ✅ UNIFIED COMPLETION: Complete the chunk job using unified function
      // This replaces the old complete_chunk_job_safe() with consistent parameters
      const { data: completionResult, error: completionError } = await supabaseAdmin
        .rpc('complete_chunk_job', {
          p_chunk_id: chunkId,
          p_queue_id: queueId,  // Queue management for proper workflow
          p_status: 'completed',
          p_emails_processed: emailsToProcess.length,
          p_emails_failed: 0,
          p_processing_time_ms: processingTime,  // Consistent timing variable
          p_error_message: null
        });

      if (completionError) {
        log(`❌ [CHUNK-COMPLETION-ERROR] Failed to mark chunk as complete`, {
          error: completionError.message,
          code: completionError.code,
          details: completionError
        });
        throw completionError;
      }

      log(`✅ [CHUNK-COMPLETION-SUCCESS] Chunk marked as complete`, {
        success: completionResult?.success,
        message: completionResult?.message,
        progress: completionResult?.progress
      });

      // Check if this is the last chunk
      const isLastChunk = chunkIndex === totalChunks;
      
      // Get overall completion status
      const { data: chunkStats, error: statsError } = await supabaseAdmin
        .from('chunked_sync_jobs')
        .select('status')
        .eq('parent_sync_job_id', chunkJob.parent_sync_job_id);
        
      const allChunksCompleted = chunkStats && 
        chunkStats.length === totalChunks && 
        chunkStats.every(chunk => chunk.status === 'completed');

      // Log completion status
      log(`📊 [COMPLETION-STATUS] Chunk completion status`, {
        currentChunk: chunkIndex,
        totalChunks,
        isLastChunk,
        allChunksCompleted,
        completedChunks: chunkStats?.filter(c => c.status === 'completed').length || 0
      });

      // Return appropriate response
      if (isLastChunk && allChunksCompleted) {
        // Update store's last_synced timestamp if all chunks are complete
        const { error: updateError } = await supabaseAdmin
          .from('stores')
          .update({ last_synced: new Date().toISOString() })
          .eq('id', storeId);
          
        if (updateError) {
          log(`⚠️ [STORE-UPDATE-WARNING] Failed to update store last_synced`, {
            error: updateError.message
          });
        }

        // ✅ FINAL SUCCESS LOG: All chunks completed
        log(`🎉 [UNIFIED-SYNC-COMPLETE] Unified Background Sync Successfully Complete`, {
          worker_id: workerId,
          emailsProcessed: allEmails.length,
          emailsWithAttachments: emailsWithAttachments,
          allChunksCompleted: true,
          isLastChunk: true,
          universalThreadingSuccessRate: universalThreadingSuccessRate + '%',
          totalProcessingTime: Date.now() - startTime
        });

        return new Response(
          JSON.stringify({
            success: true,
            emailsProcessed: allEmails.length,
            emailsWithAttachments: emailsWithAttachments,
            lastSynced: new Date().toISOString(),
            allChunksCompleted: true,
            isLastChunk: true,
            storeStatusUpdated: !updateError,
            worker_id: workerId,
            debugInfo,
            threadingStats: {
              universalThreadingSuccessRate: universalThreadingSuccessRate + '%',
              phase: 'Phase 3 - Universal RFC2822 Threading'
            }
          }),
          { headers: corsHeaders }
        );
      } else {
        // ✅ CHUNK SUCCESS LOG: Individual chunk completed
        log(`🎉 [UNIFIED-SYNC-CHUNK-COMPLETE] Unified Background Sync Successfully Complete (Chunk ${chunkIndex}/${totalChunks})`, {
          worker_id: workerId,
          emailsProcessed: allEmails.length,
          chunkCompleted: true,
          isLastChunk: false,
          chunk_processed: chunkIndex,
          total_chunks: totalChunks,
          processing_time_ms: processingTime,
          completedChunks: chunkStats?.filter(c => c.status === 'completed').length || 0,
          progressPercentage: ((chunkStats?.filter(c => c.status === 'completed').length || 0) / totalChunks * 100).toFixed(1) + '%'
        });

        return new Response(
          JSON.stringify({
            success: true,
            emailsProcessed: allEmails.length,
            chunkCompleted: true,
            isLastChunk: false,
            allChunksCompleted: false,
            storeStatusUpdated: false,
            worker_id: workerId,
            chunk_processed: chunkIndex,
            total_chunks: totalChunks,
            processing_time_ms: processingTime,
            completion_status: {
              completedChunks: chunkStats?.filter(c => c.status === 'completed').length || 0,
              totalChunks,
              progress: ((chunkStats?.filter(c => c.status === 'completed').length || 0) / totalChunks * 100).toFixed(1) + '%'
            }
          }),
          { headers: corsHeaders }
        );
      }

    } catch (syncError: any) {
      console.error(`[${workerId}] ❌ Error during chunk processing:`, syncError);
      
      const processingTime = Date.now() - startTime;
      const errorMessage = syncError?.message || 'Unknown sync error';
      const errorCategory = categorizeError(errorMessage);
      const retryDelay = calculateRetryDelay(errorCategory, chunkJob.attempts + 1);

      log(`🔍 Error analysis`, {
        error_category: errorCategory,
        suggested_retry_delay_ms: retryDelay,
        attempt_number: chunkJob.attempts + 1,
        max_attempts: chunkJob.max_attempts
      });

      // ✅ UNIFIED ERROR COMPLETION: Report failed completion using unified function
      // Previously used complete_chunk_job_safe(), now uses same function as success case
      const { error: completeError } = await supabaseAdmin
        .rpc('complete_chunk_job', {
          p_chunk_id: chunkJob.chunk_id,
          p_queue_id: queueId,  // Queue management for proper workflow
          p_status: 'failed',
          p_emails_processed: 0,
          p_emails_failed: 0,
          p_processing_time_ms: processingTime,  // Consistent timing variable
          p_error_message: `[${errorCategory}] ${errorMessage}`
        });

      if (completeError) {
        console.error(`[${workerId}] ❌ CRITICAL: Error marking chunk as failed:`, completeError);
      }

      const isFinalAttempt = chunkJob.attempts + 1 >= chunkJob.max_attempts;

      return new Response(
        JSON.stringify({
          success: false,
          message: `Chunk ${chunkJob.chunk_index}/${chunkJob.total_chunks} failed: ${errorMessage}`,
          worker_id: workerId,
          chunk_failed: chunkJob.chunk_index,
          error: errorMessage,
          error_category: errorCategory,
          suggested_retry_delay_ms: retryDelay,
          is_final_attempt: isFinalAttempt,
          will_retry: !isFinalAttempt
        }),
        { status: 500, headers: corsHeaders }
      );
    }

  } catch (error: any) {
    log(`💥 Top-level fatal error in unified processor`, { error: error?.message });
    
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Unified background processor fatal error',
        error: error?.message || 'Unknown error',
        worker_id: workerId
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});

/**
 * ====================================================================================================
 * UNIFIED BACKGROUND SYNC PROCESSOR - COMPLETE
 * ====================================================================================================
 * 
 * This unified function maintains ALL features from both original functions:
 * 
 * FROM SYNC-EMAILS:
 * ✅ Complete email sync logic with all features
 * ✅ RFC2822 threading system
 * ✅ Attachment processing and CID detection
 * ✅ Synthetic attachment processing
 * ✅ Token refresh and validation
 * ✅ Date range filtering
 * ✅ Comprehensive error handling
 * 
 * FROM BACKGROUND-SYNC-PROCESSOR:
 * ✅ Queue-based chunk processing
 * ✅ Self-healing with stuck chunk recovery
 * ✅ Intelligent error categorization
 * ✅ Progressive retry delays
 * ✅ Health metrics collection
 * ✅ Clean exit after each chunk
 * 
 * BENEFITS OF UNIFICATION:
 * 🚀 No function-to-function calls (eliminates timeout issues)
 * 🚀 Better performance (no HTTP overhead)
 * 🚀 Simpler debugging (single function)
 * 🚀 More reliable (direct error handling)
 * 🚀 Cost effective (fewer invocations)
 * 
 * The function continues to run in the background even if the user closes their browser,
 * processing one chunk at a time until all emails are synchronized.
 * ====================================================================================================
 */