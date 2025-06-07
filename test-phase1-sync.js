/**
 * Test Script for Phase 1 Email Threading Optimization
 * 
 * This script tests the enhanced email sync function with:
 * - Graceful conversation error handling
 * - Performance monitoring
 * - Success/failure rate tracking
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key';
const SUPABASE_AUTH_TOKEN = process.env.SUPABASE_AUTH_TOKEN || 'your-auth-token';

/**
 * Test the enhanced email sync function
 */
async function testPhase1EmailSync() {
  console.log('🧪 Testing Phase 1 Email Threading Optimization');
  console.log('=' .repeat(50));
  
  // Get store ID from user input or environment
  const storeId = process.env.TEST_STORE_ID || prompt('Enter Store ID to test: ');
  
  if (!storeId) {
    console.error('❌ Store ID is required for testing');
    return;
  }
  
  const testPayload = {
    storeId: storeId,
    syncFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
    syncTo: new Date().toISOString()
  };
  
  console.log('📝 Test Configuration:');
  console.log(`   Store ID: ${testPayload.storeId}`);
  console.log(`   Sync From: ${testPayload.syncFrom}`);
  console.log(`   Sync To: ${testPayload.syncTo}`);
  console.log();
  
  const startTime = Date.now();
  
  try {
    console.log('🚀 Starting Phase 1 email sync test...');
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/sync-emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_AUTH_TOKEN}`,
      },
      body: JSON.stringify(testPayload)
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Sync completed successfully!');
    console.log('=' .repeat(50));
    console.log('📊 PHASE 1 TEST RESULTS:');
    console.log(`   Duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`   Emails Processed: ${result.emailsProcessed || 0}`);
    console.log(`   Last Synced: ${result.lastSynced}`);
    
    if (result.conversationFetchStats) {
      console.log();
      console.log('🧵 CONVERSATION FETCH STATISTICS:');
      console.log(`   Attempts: ${result.conversationFetchStats.attempts}`);
      console.log(`   Successes: ${result.conversationFetchStats.successes}`);
      console.log(`   Failures: ${result.conversationFetchStats.failures}`);
      console.log(`   Success Rate: ${result.conversationFetchStats.successRate}`);
      
      // Analyze results
      const attempts = parseInt(result.conversationFetchStats.attempts);
      const failures = parseInt(result.conversationFetchStats.failures);
      
      console.log();
      console.log('📈 PHASE 1 VALIDATION:');
      
      if (attempts > 0) {
        console.log(`   ✅ Conversation API calls were attempted (${attempts})`);
        
        if (failures > 0) {
          console.log(`   ✅ Failures were handled gracefully (${failures} failures)`);
          console.log('   ✅ Sync completed despite conversation API issues');
        } else {
          console.log('   ℹ️  All conversation fetches succeeded');
        }
      } else {
        console.log('   ℹ️  No conversation IDs found in emails');
      }
      
      console.log('   ✅ No InefficientFilter errors should appear in logs');
      console.log('   ✅ Email sync completed successfully regardless of conversation API');
    }
    
    console.log();
    console.log('🎯 NEXT STEPS:');
    console.log('   1. Check server logs for detailed conversation fetch statistics');
    console.log('   2. Verify no InefficientFilter errors in error logs');
    console.log('   3. Confirm all email threading functionality works normally');
    console.log('   4. Monitor performance improvements over time');
    
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.error('❌ Test failed after', duration + 'ms');
    console.error('Error:', error.message);
    
    if (error.message.includes('InefficientFilter')) {
      console.error('⚠️  CRITICAL: InefficientFilter error still occurring!');
      console.error('   Phase 1 implementation may need review');
    }
  }
}

/**
 * Monitor conversation fetch success rates from logs
 */
async function monitorConversationFetchRates() {
  console.log('📊 Monitoring Conversation Fetch Success Rates');
  console.log('=' .repeat(50));
  console.log('ℹ️  This would typically connect to your logging system');
  console.log('   Example log patterns to search for:');
  console.log();
  console.log('   Success: "Successfully fetched X messages from conversation"');
  console.log('   Failure: "Conversation fetch failed for [ID], using basic email data only"');
  console.log('   Summary: "Conversation success rate: X.X%"');
  console.log();
  console.log('📋 Recommended monitoring commands:');
  console.log('   # Count conversation fetch attempts');
  console.log('   grep -c "Attempting to fetch conversation" sync-logs.txt');
  console.log();
  console.log('   # Count successful fetches');  
  console.log('   grep -c "Successfully fetched.*messages from conversation" sync-logs.txt');
  console.log();
  console.log('   # Count failed fetches');
  console.log('   grep -c "Conversation fetch failed" sync-logs.txt');
  console.log();
  console.log('   # View success rate summaries');
  console.log('   grep "Conversation success rate" sync-logs.txt');
}

/**
 * Validate Phase 1 implementation checklist
 */
function validatePhase1Implementation() {
  console.log('✅ Phase 1 Implementation Validation Checklist');
  console.log('=' .repeat(50));
  
  const checklist = [
    'Email sync function handles conversation fetch failures gracefully',
    'Conversation API errors logged as warnings, not errors',
    'Email sync continues successfully even with conversation failures', 
    'Processing delays reduced from 1000ms to 500ms',
    'Comprehensive monitoring metrics added',
    'Success/failure rates tracked and reported',
    'Backward compatibility maintained',
    'No breaking changes to existing functionality'
  ];
  
  checklist.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item}`);
  });
  
  console.log();
  console.log('🔍 Manual Verification Steps:');
  console.log('   1. Run email sync and check for InefficientFilter errors');
  console.log('   2. Verify conversation failure logs show as warnings');
  console.log('   3. Confirm email threading still works correctly');
  console.log('   4. Test internal notes functionality');
  console.log('   5. Measure sync performance improvements');
}

// Main execution
if (require.main === module) {
  const command = process.argv[2] || 'test';
  
  switch (command) {
    case 'test':
      testPhase1EmailSync();
      break;
    case 'monitor':
      monitorConversationFetchRates();
      break;
    case 'validate':
      validatePhase1Implementation();
      break;
    default:
      console.log('Usage: node test-phase1-sync.js [test|monitor|validate]');
      console.log();
      console.log('Commands:');
      console.log('  test     - Test the Phase 1 implementation');
      console.log('  monitor  - Show monitoring guidance');
      console.log('  validate - Show validation checklist');
  }
}

module.exports = {
  testPhase1EmailSync,
  monitorConversationFetchRates,
  validatePhase1Implementation
}; 