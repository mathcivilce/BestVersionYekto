// Test script to verify realtime internal notes functionality
// Run this to test if realtime is working properly

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'your-supabase-url';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRealtimeNotes() {
  console.log('=== Testing Realtime Internal Notes ===\n');

  // Test 1: Check if realtime is enabled for internal_notes table
  console.log('1. Testing realtime connection...');
  
  const testEmailId = 'test-email-id'; // Replace with actual email ID
  
  const subscription = supabase
    .channel(`test_internal_notes_${testEmailId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'internal_notes',
        filter: `email_id=eq.${testEmailId}`
      },
      (payload) => {
        console.log('✅ Realtime event received:', payload);
      }
    )
    .on('subscribe', (status) => {
      console.log('📡 Subscription status:', status);
    })
    .subscribe();

  // Wait for subscription to establish
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('2. Testing note insertion...');
  
  // Test 2: Insert a test note (this would normally trigger the realtime event)
  try {
    // Note: This will only work if you have proper auth and valid email_id
    console.log('   (To test properly, add a note through the UI while watching console)');
    console.log('   Expected: You should see a realtime event logged above');
  } catch (error) {
    console.log('   Note: Authentication required for actual insert test');
  }

  // Cleanup
  setTimeout(() => {
    supabase.removeChannel(subscription);
    console.log('\n✅ Test completed! If you see subscription status "SUBSCRIBED", realtime is working.');
    console.log('   To test fully: Open two browser tabs with the same email and add notes from each.');
  }, 3000);
}

// Run the test
testRealtimeNotes().catch(console.error); 