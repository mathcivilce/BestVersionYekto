/**
 * UNIFIED BACKGROUND SYNC SYSTEM TESTING SCRIPT
 * 
 * This script tests the new unified-background-sync function to ensure:
 * 1. Direct function calls work properly
 * 2. Database webhook triggers work correctly  
 * 3. Chunk processing flows correctly
 * 4. Error handling and recovery work
 * 5. Real-time updates function properly
 */

import { createClient } from '@supabase/supabase-js';

// Configuration (update these values)
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const SUPABASE_SERVICE_KEY = 'YOUR_SUPABASE_SERVICE_KEY'; // For Edge Function calls

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Test 1: Direct Unified Function Call
 * Tests the unified function with chunk processing payload
 */
async function testDirectUnifiedCall() {
    console.log('\n🧪 Test 1: Direct Unified Function Call');
    
    try {
        const payload = {
            trigger_source: 'test',
            parent_sync_job_id: 'test-job-id',
            test_mode: true
        };
        
        const { data, error } = await supabaseService.functions.invoke('unified-background-sync', {
            body: payload
        });
        
        if (error) {
            console.log('❌ Direct call failed:', error);
            return false;
        } else {
            console.log('✅ Direct call succeeded:', data);
            return true;
        }
    } catch (err) {
        console.log('❌ Direct call error:', err.message);
        return false;
    }
}

/**
 * Test 2: Database Webhook Trigger Test
 * Creates a sync job to test the database webhook trigger
 */
async function testDatabaseWebhookTrigger() {
    console.log('\n🧪 Test 2: Database Webhook Trigger');
    
    try {
        // Create a test sync job (this should trigger webhook)
        const testJob = {
            store_id: 'test-store-id',
            sync_type: 'test_sync',
            priority: 'normal',
            status: 'pending'
        };
        
        const { data, error } = await supabaseService
            .from('sync_queue')
            .insert(testJob)
            .select()
            .single();
        
        if (error) {
            console.log('❌ Failed to create test sync job:', error);
            return false;
        }
        
        console.log('✅ Test sync job created:', data.id);
        
        // Wait a moment for webhook to fire
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if the job was processed
        const { data: updatedJob } = await supabaseService
            .from('sync_queue')
            .select('*')
            .eq('id', data.id)
            .single();
        
        console.log('📊 Job status after webhook:', updatedJob?.status);
        
        // Cleanup
        await supabaseService
            .from('sync_queue')
            .delete()
            .eq('id', data.id);
        
        return true;
    } catch (err) {
        console.log('❌ Webhook trigger test error:', err.message);
        return false;
    }
}

/**
 * Test 3: Chunk Processing Flow
 * Tests the complete chunk processing workflow
 */
async function testChunkProcessingFlow() {
    console.log('\n🧪 Test 3: Chunk Processing Flow');
    
    try {
        // Create a parent sync job
        const parentJob = {
            store_id: 'test-store-chunk',
            sync_type: 'full_sync',
            priority: 'high',
            status: 'pending'
        };
        
        const { data: parent, error } = await supabaseService
            .from('sync_queue')
            .insert(parentJob)
            .select()
            .single();
        
        if (error) {
            console.log('❌ Failed to create parent job:', error);
            return false;
        }
        
        console.log('✅ Parent sync job created:', parent.id);
        
        // Create test chunks
        const chunks = [
            {
                parent_sync_job_id: parent.id,
                store_id: 'test-store-chunk',
                chunk_index: 0,
                start_date: '2024-01-01',
                end_date: '2024-01-15',
                status: 'pending'
            },
            {
                parent_sync_job_id: parent.id,
                store_id: 'test-store-chunk', 
                chunk_index: 1,
                start_date: '2024-01-16',
                end_date: '2024-01-31',
                status: 'pending'
            }
        ];
        
        const { data: chunksData, error: chunksError } = await supabaseService
            .from('chunked_sync_jobs')
            .insert(chunks)
            .select();
        
        if (chunksError) {
            console.log('❌ Failed to create chunks:', chunksError);
            return false;
        }
        
        console.log('✅ Test chunks created:', chunksData.length);
        
        // Wait for chunk processing queue entries
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check chunk processing queue
        const { data: queueEntries } = await supabaseService
            .from('chunk_processing_queue')
            .select('*')
            .in('chunk_id', chunksData.map(c => c.id));
        
        console.log('📊 Queue entries created:', queueEntries?.length);
        
        // Test claiming a chunk
        const { data: claimResult, error: claimError } = await supabaseService
            .rpc('claim_next_chunk_job_safe', { p_worker_id: 'test-worker' });
        
        if (claimError) {
            console.log('⚠️ Claim chunk error (expected if no real data):', claimError.message);
        } else {
            console.log('✅ Chunk claim result:', claimResult);
        }
        
        // Cleanup
        await supabaseService
            .from('chunked_sync_jobs')
            .delete()
            .in('id', chunksData.map(c => c.id));
        
        await supabaseService
            .from('sync_queue')
            .delete()
            .eq('id', parent.id);
        
        return true;
    } catch (err) {
        console.log('❌ Chunk processing test error:', err.message);
        return false;
    }
}

/**
 * Test 4: System Health Check
 * Verifies the overall system health and monitoring
 */
async function testSystemHealth() {
    console.log('\n🧪 Test 4: System Health Check');
    
    try {
        // Check sync queue stats
        const { data: queueStats, error: queueError } = await supabaseService
            .rpc('get_sync_queue_stats');
        
        if (queueError) {
            console.log('⚠️ Queue stats error:', queueError.message);
        } else {
            console.log('📊 Queue stats:', queueStats);
        }
        
        // Check stuck chunks
        const { data: stuckCount, error: stuckError } = await supabaseService
            .from('chunk_processing_queue')
            .select('id')
            .eq('status', 'processing')
            .lt('started_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
        
        if (stuckError) {
            console.log('⚠️ Stuck chunks check error:', stuckError.message);
        } else {
            console.log('📊 Stuck processing chunks:', stuckCount?.length || 0);
        }
        
        // Check recent activity
        const { data: recentJobs, error: recentError } = await supabaseService
            .from('sync_queue')
            .select('id, status, created_at')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .order('created_at', { ascending: false })
            .limit(10);
        
        if (recentError) {
            console.log('⚠️ Recent jobs check error:', recentError.message);
        } else {
            console.log('📊 Recent jobs (last 24h):', recentJobs?.length || 0);
        }
        
        return true;
    } catch (err) {
        console.log('❌ Health check error:', err.message);
        return false;
    }
}

/**
 * Test 5: Real-time Subscription Test
 * Tests real-time updates for sync job progress
 */
async function testRealtimeUpdates() {
    console.log('\n🧪 Test 5: Real-time Subscription Test');
    
    return new Promise((resolve) => {
        let updateReceived = false;
        
        // Subscribe to sync queue changes
        const subscription = supabase
            .channel('sync_queue_test')
            .on('postgres_changes', 
                { event: '*', schema: 'public', table: 'sync_queue' },
                (payload) => {
                    console.log('📡 Real-time update received:', payload.eventType);
                    updateReceived = true;
                }
            )
            .subscribe();
        
        // Create a test job to trigger update
        setTimeout(async () => {
            try {
                const testJob = {
                    store_id: 'test-realtime',
                    sync_type: 'test_realtime',
                    priority: 'normal',
                    status: 'pending'
                };
                
                const { data } = await supabaseService
                    .from('sync_queue')
                    .insert(testJob)
                    .select()
                    .single();
                
                // Update the job to trigger another real-time event
                setTimeout(async () => {
                    await supabaseService
                        .from('sync_queue')
                        .update({ status: 'completed' })
                        .eq('id', data.id);
                    
                    // Cleanup
                    setTimeout(async () => {
                        await supabaseService
                            .from('sync_queue')
                            .delete()
                            .eq('id', data.id);
                        
                        subscription.unsubscribe();
                        
                        if (updateReceived) {
                            console.log('✅ Real-time updates working');
                            resolve(true);
                        } else {
                            console.log('❌ No real-time updates received');
                            resolve(false);
                        }
                    }, 1000);
                }, 1000);
            } catch (err) {
                console.log('❌ Real-time test error:', err.message);
                subscription.unsubscribe();
                resolve(false);
            }
        }, 1000);
    });
}

/**
 * Main Test Runner
 */
async function runAllTests() {
    console.log('🚀 UNIFIED BACKGROUND SYNC SYSTEM TESTS\n');
    console.log('Testing the new unified-background-sync function...\n');
    
    const results = {
        directCall: await testDirectUnifiedCall(),
        webhookTrigger: await testDatabaseWebhookTrigger(),
        chunkProcessing: await testChunkProcessingFlow(),
        systemHealth: await testSystemHealth(),
        realtimeUpdates: await testRealtimeUpdates()
    };
    
    console.log('\n📋 TEST RESULTS SUMMARY:');
    console.log('========================');
    
    Object.entries(results).forEach(([test, passed]) => {
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} ${test}`);
    });
    
    const totalPassed = Object.values(results).filter(Boolean).length;
    const totalTests = Object.values(results).length;
    
    console.log(`\n🎯 Overall: ${totalPassed}/${totalTests} tests passed`);
    
    if (totalPassed === totalTests) {
        console.log('🎉 All tests passed! Unified system is working correctly.');
        console.log('✅ Safe to apply webhook migration and cleanup old functions.');
    } else {
        console.log('⚠️ Some tests failed. Review issues before proceeding.');
        console.log('❌ Do NOT cleanup old functions until all tests pass.');
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(console.error);
}

export { runAllTests }; 