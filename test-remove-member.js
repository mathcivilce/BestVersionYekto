/**
 * Test Remove Member Functionality
 * 
 * This script tests the remove member functionality after fixing the RLS policies.
 * It simulates an admin removing a team member and verifies the operation works correctly.
 */

// Test configuration
const testConfig = {
  // Replace these with actual user IDs from your database
  adminUserId: 'ADMIN_USER_ID',           // mathcivilce@gmail.com user ID
  targetUserId: 'TARGET_USER_ID',         // omnicommerceclaidai@gmail.com user ID
  supabaseUrl: process.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL',
  supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'
};

console.log('🧪 Testing Remove Member Functionality');
console.log('=====================================');

async function testRemoveMember() {
  try {
    // 1. Check current state
    console.log('\n1️⃣ Checking current state...');
    
    // Query to check team members in the business
    const checkQuery = `
      SELECT 
        up.user_id,
        up.first_name,
        up.last_name,
        up.role,
        up.business_id,
        up.business_name,
        b.name as business_name_from_businesses
      FROM user_profiles up
      LEFT JOIN businesses b ON b.id = up.business_id
      WHERE up.business_id IS NOT NULL
      ORDER BY up.role DESC, up.first_name;
    `;
    
    console.log('Current team members query:');
    console.log(checkQuery);
    
    // 2. Test the RLS policy helper function
    console.log('\n2️⃣ Testing RLS policy helper function...');
    
    const testHelperQuery = `
      SELECT can_admin_remove_member('${testConfig.adminUserId}', '${testConfig.targetUserId}') as can_remove;
    `;
    
    console.log('Helper function test query:');
    console.log(testHelperQuery);
    
    // 3. Test the actual remove operation (SQL simulation)
    console.log('\n3️⃣ Testing remove member operation...');
    
    const removeQuery = `
      UPDATE user_profiles 
      SET 
        business_id = NULL,
        business_name = NULL,
        role = 'agent'
      WHERE user_id = '${testConfig.targetUserId}'
      RETURNING user_id, first_name, last_name, business_id, role;
    `;
    
    console.log('Remove member query:');
    console.log(removeQuery);
    
    // 4. Verify removal
    console.log('\n4️⃣ Verification queries...');
    
    console.log('After removal - check team members:');
    console.log(checkQuery);
    
    console.log('\nCheck removed user profile:');
    const removedUserQuery = `
      SELECT 
        user_id,
        first_name,
        last_name,
        role,
        business_id,
        business_name
      FROM user_profiles 
      WHERE user_id = '${testConfig.targetUserId}';
    `;
    console.log(removedUserQuery);
    
    // 5. Test re-invitation capability
    console.log('\n5️⃣ Testing re-invitation capability...');
    
    const reinviteQuery = `
      -- This should work since business_id is now NULL
      UPDATE user_profiles 
      SET 
        business_id = (SELECT business_id FROM user_profiles WHERE user_id = '${testConfig.adminUserId}'),
        business_name = (SELECT business_name FROM user_profiles WHERE user_id = '${testConfig.adminUserId}'),
        role = 'agent'
      WHERE user_id = '${testConfig.targetUserId}'
      RETURNING user_id, first_name, last_name, business_id, role;
    `;
    
    console.log('Re-invitation test query:');
    console.log(reinviteQuery);
    
    console.log('\n✅ Test queries generated successfully!');
    console.log('\n📋 To execute these tests:');
    console.log('1. Replace ADMIN_USER_ID and TARGET_USER_ID with actual values');
    console.log('2. Run the queries in your Supabase SQL editor');
    console.log('3. Verify each step produces expected results');
    
    // Generate a browser test
    console.log('\n🌐 Browser Test Instructions:');
    console.log('1. Log in as admin user (mathcivilce@gmail.com)');
    console.log('2. Go to Team Management page');
    console.log('3. Try to remove omnicommerceclaidai@gmail.com');
    console.log('4. Check browser console for detailed logs');
    console.log('5. Verify user disappears from team list');
    console.log('6. Try logging in as removed user - should not see business resources');
    
  } catch (error) {
    console.error('❌ Test setup error:', error);
  }
}

// Run the test
testRemoveMember();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testRemoveMember, testConfig };
} 