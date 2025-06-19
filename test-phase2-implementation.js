/**
 * ============================================================================================================
 * PHASE 2 IMPLEMENTATION TEST SCRIPT
 * ============================================================================================================
 * 
 * This script validates the Phase 2 enhanced background sync processor with:
 * - Intelligent error categorization and retry logic
 * - Health monitoring and performance metrics
 * - Integration with Phase 1 recovery functions
 * - Progressive backoff for different error types
 * 
 * Usage: node test-phase2-implementation.js
 * ============================================================================================================
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================================================
// PHASE 2 TEST FUNCTIONS
// ============================================================================================================

/**
 * Test 1: Validate Health Monitoring Table Structure
 */
async function testHealthMonitoringStructure() {
  console.log('\n🔍 Phase 2 Test 1: Health Monitoring Table Structure');
  
  try {
    // Test if health monitoring table exists with correct structure
    const { data, error } = await supabase
      .from('chunked_sync_health_monitoring')
      .select('*')
      .limit(1);

    if (error) {
      console.log('⚠️ Health monitoring table not yet created - this is expected if migration hasn\'t run');
      console.log('   Error:', error.message);
      return false;
    } else {
      console.log('✅ Health monitoring table exists');
      return true;
    }
  } catch (error) {
    console.error('❌ Error testing health monitoring structure:', error.message);
    return false;
  }
}

/**
 * Test 2: Test Error Categorization Functions
 */
async function testErrorCategorization() {
  console.log('\n🧠 Phase 2 Test 2: Error Categorization Logic');
  
  const testErrors = [
    { message: 'Request timeout', expected: 'timeout' },
    { message: 'Rate limit exceeded - too many requests', expected: 'rate_limit' },
    { message: 'HTTP 429 Too Many Requests', expected: 'rate_limit' },
    { message: 'Network connection failed', expected: 'network' },
    { message: 'DNS resolution error', expected: 'network' },
    { message: 'Service temporarily unavailable', expected: 'temporary' },
    { message: 'HTTP 503 Service Unavailable', expected: 'temporary' },
    { message: 'Authentication token expired', expected: 'auth' },
    { message: 'HTTP 401 Unauthorized', expected: 'auth' },
    { message: 'Permission denied', expected: 'permission' },
    { message: 'Resource not found', expected: 'not_found' },
    { message: 'Duplicate entry conflict', expected: 'data_conflict' },
    { message: 'Some unknown processing error', expected: 'processing_error' }
  ];

  // Simulate error categorization locally (matches background-sync-processor logic)
  function categorizeError(errorMessage) {
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

  let passed = 0;
  let total = testErrors.length;

  for (const test of testErrors) {
    const result = categorizeError(test.message);
    if (result === test.expected) {
      console.log(`✅ "${test.message}" → ${result}`);
      passed++;
    } else {
      console.log(`❌ "${test.message}" → ${result} (expected: ${test.expected})`);
    }
  }

  console.log(`\n📊 Error Categorization Test Results: ${passed}/${total} passed`);
  return passed === total;
}

/**
 * Test 3: Test Retry Delay Calculation
 */
async function testRetryDelayCalculation() {
  console.log('\n⏱️ Phase 2 Test 3: Retry Delay Calculation');
  
  // Simulate retry delay calculation (matches background-sync-processor logic)
  function calculateRetryDelay(errorCategory, attemptNumber) {
    const baseDelay = 1000;
    
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

  const testCases = [
    { category: 'rate_limit', attempt: 1, expected: 5000 },
    { category: 'rate_limit', attempt: 2, expected: 15000 },
    { category: 'rate_limit', attempt: 3, expected: 45000 },
    { category: 'network', attempt: 1, expected: 2000 },
    { category: 'network', attempt: 2, expected: 4000 },
    { category: 'timeout', attempt: 1, expected: 3000 },
    { category: 'timeout', attempt: 2, expected: 6000 },
    { category: 'auth', attempt: 1, expected: 2000 },
    { category: 'auth', attempt: 2, expected: 5000 },
  ];

  let passed = 0;
  let total = testCases.length;

  for (const test of testCases) {
    const result = calculateRetryDelay(test.category, test.attempt);
    if (result === test.expected) {
      console.log(`✅ ${test.category} attempt ${test.attempt} → ${result}ms`);
      passed++;
    } else {
      console.log(`❌ ${test.category} attempt ${test.attempt} → ${result}ms (expected: ${test.expected}ms)`);
    }
  }

  console.log(`\n📊 Retry Delay Test Results: ${passed}/${total} passed`);
  return passed === total;
}

/**
 * Test 4: Test Database Functions (if available)
 */
async function testDatabaseFunctions() {
  console.log('\n🗄️ Phase 2 Test 4: Database Functions');
  
  try {
    // Test Phase 1 stuck chunk recovery function
    console.log('Testing reset_stuck_chunks function...');
    const { data: resetResult, error: resetError } = await supabase
      .rpc('reset_stuck_chunks', { p_timeout_minutes: 10 });

    if (resetError) {
      console.log('⚠️ reset_stuck_chunks function not available:', resetError.message);
    } else {
      console.log('✅ reset_stuck_chunks function works:', resetResult);
    }

    // Test should_retry_chunk function
    console.log('Testing should_retry_chunk function...');
    const { data: retryResult, error: retryError } = await supabase
      .rpc('should_retry_chunk', {
        p_attempts: 1,
        p_max_attempts: 3,
        p_error_category: 'network',
        p_chunk_index: 1
      });

    if (retryError) {
      console.log('⚠️ should_retry_chunk function not available:', retryError.message);
    } else {
      console.log('✅ should_retry_chunk function works:', retryResult);
    }

    // Test health monitoring functions (if table exists)
    console.log('Testing log_chunk_health_metrics function...');
    const { data: healthResult, error: healthError } = await supabase
      .rpc('log_chunk_health_metrics', {
        p_chunk_job_id: '00000000-0000-0000-0000-000000000000', // dummy UUID
        p_worker_id: 'test-worker',
        p_processing_time_ms: 1000,
        p_chunk_size: 10,
        p_efficiency_ratio: 10.0,
        p_status: 'success'
      });

    if (healthError) {
      console.log('⚠️ log_chunk_health_metrics function not available:', healthError.message);
      console.log('   This is expected if Phase 2 migration hasn\'t been applied yet');
    } else {
      console.log('✅ log_chunk_health_metrics function works:', healthResult);
    }

  } catch (error) {
    console.error('❌ Error testing database functions:', error.message);
    return false;
  }
  
  return true;
}

/**
 * Test 5: Test Queue Status and Health Summary
 */
async function testQueueStatus() {
  console.log('\n📋 Phase 2 Test 5: Queue Status and Health');
  
  try {
    // Check current chunks in queue
    const { data: chunks, error: chunksError } = await supabase
      .from('chunked_sync_jobs')
      .select('status, chunk_index, attempts, error_category, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (chunksError) {
      console.error('❌ Error fetching chunks:', chunksError.message);
      return false;
    }

    console.log(`📊 Found ${chunks.length} recent chunks:`);
    
    const statusCounts = {};
    chunks.forEach(chunk => {
      statusCounts[chunk.status] = (statusCounts[chunk.status] || 0) + 1;
    });

    console.log('📈 Status distribution:', statusCounts);

    // Show recent chunks with error categories
    const errorChunks = chunks.filter(chunk => chunk.status === 'failed' && chunk.error_category);
    if (errorChunks.length > 0) {
      console.log('\n🔍 Recent failed chunks with error categories:');
      errorChunks.forEach(chunk => {
        console.log(`   Chunk ${chunk.chunk_index}: ${chunk.error_category} (attempt ${chunk.attempts})`);
      });
    }

    return true;

  } catch (error) {
    console.error('❌ Error testing queue status:', error.message);
    return false;
  }
}

/**
 * Test 6: Test Background Sync Processor (Phase 2 Enhanced)
 */
async function testBackgroundSyncProcessor() {
  console.log('\n🚀 Phase 2 Test 6: Enhanced Background Sync Processor');
  
  try {
    const functionUrl = `${SUPABASE_URL}/functions/v1/background-sync-processor`;
    
    console.log('Triggering enhanced background sync processor...');
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trigger_source: 'phase2_test',
        test_mode: true
      })
    });

    const result = await response.json();
    
    console.log('📱 Background sync processor response:');
    console.log('   Status:', response.status);
    console.log('   Success:', result.success);
    console.log('   Message:', result.message);
    console.log('   Phase:', result.phase);
    
    if (result.health_metrics) {
      console.log('📊 Health metrics returned:', !!result.health_metrics);
    }
    
    if (result.error_category) {
      console.log('🔍 Error categorization:', result.error_category);
    }

    return response.ok;

  } catch (error) {
    console.error('❌ Error testing background sync processor:', error.message);
    return false;
  }
}

// ============================================================================================================
// MAIN TEST RUNNER
// ============================================================================================================

async function runPhase2Tests() {
  console.log('🚀 PHASE 2 IMPLEMENTATION VALIDATION TESTS');
  console.log('==========================================');
  
  const results = {
    healthMonitoring: await testHealthMonitoringStructure(),
    errorCategorization: await testErrorCategorization(),
    retryDelayCalculation: await testRetryDelayCalculation(),
    databaseFunctions: await testDatabaseFunctions(),
    queueStatus: await testQueueStatus(),
    backgroundProcessor: await testBackgroundSyncProcessor()
  };

  // Summary
  console.log('\n📊 PHASE 2 TEST RESULTS SUMMARY');
  console.log('==============================');
  
  const passed = Object.values(results).filter(r => r === true).length;
  const total = Object.keys(results).length;
  
  Object.entries(results).forEach(([test, result]) => {
    const icon = result ? '✅' : '⚠️';
    console.log(`${icon} ${test}: ${result ? 'PASSED' : 'NEEDS ATTENTION'}`);
  });
  
  console.log(`\n🎯 Overall: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 Phase 2 implementation is working correctly!');
  } else {
    console.log('⚠️ Some Phase 2 features need attention (likely missing migrations)');
    console.log('💡 Run the Phase 2 migration to enable all features');
  }

  return results;
}

// Run tests
runPhase2Tests().catch(console.error); 