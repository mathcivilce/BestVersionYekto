// SECURITY AUDIT SCRIPT
// Run this to check for potential business_id data corruption issues

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'your-supabase-url';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditBusinessSecurity() {
  console.log('🔍 SECURITY AUDIT: Checking for business_id data corruption issues...\n');

  try {
    // 1. Check for users with duplicate business access
    console.log('1. Checking for users with access to multiple businesses...');
    
    const { data: userProfiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('user_id, business_id, first_name, last_name');

    if (profilesError) {
      console.error('❌ Error fetching user profiles:', profilesError);
      return;
    }

    // Group users by user_id to find duplicates
    const userBusinessMap = {};
    userProfiles.forEach(profile => {
      if (!userBusinessMap[profile.user_id]) {
        userBusinessMap[profile.user_id] = [];
      }
      userBusinessMap[profile.user_id].push(profile.business_id);
    });

    // Find users with multiple business_ids
    const usersWithMultipleBusinesses = Object.entries(userBusinessMap)
      .filter(([userId, businessIds]) => businessIds.length > 1);

    if (usersWithMultipleBusinesses.length > 0) {
      console.log('⚠️  WARNING: Found users with access to multiple businesses:');
      usersWithMultipleBusinesses.forEach(([userId, businessIds]) => {
        console.log(`   User ID: ${userId} -> Business IDs: ${businessIds.join(', ')}`);
      });
    } else {
      console.log('✅ No users found with multiple business access');
    }

    // 2. Check specific problematic users
    console.log('\n2. Checking specific user accounts mentioned...');
    
    const problematicEmails = [
      'mathcivilce@gmail.com',
      'mathcivilceface@gmail.com'
    ];

    for (const email of problematicEmails) {
      const { data: authUser, error: authError } = await supabase
        .from('auth.users')
        .select('id, email')
        .eq('email', email)
        .single();

      if (authError) {
        console.log(`❌ Could not find auth user for ${email}:`, authError.message);
        continue;
      }

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id, first_name, last_name, role')
        .eq('user_id', authUser.id)
        .single();

      if (profileError) {
        console.log(`❌ Could not find profile for ${email}:`, profileError.message);
        continue;
      }

      console.log(`   ${email}:`);
      console.log(`     User ID: ${authUser.id}`);
      console.log(`     Business ID: ${profile.business_id}`);
      console.log(`     Name: ${profile.first_name} ${profile.last_name}`);
      console.log(`     Role: ${profile.role}`);

      // Check what stores this user can access
      const { data: userStores, error: storesError } = await supabase
        .from('stores')
        .select('id, name, email, business_id')
        .eq('business_id', profile.business_id);

      if (storesError) {
        console.log(`❌ Error fetching stores for ${email}:`, storesError.message);
      } else {
        console.log(`     Can access ${userStores.length} stores:`);
        userStores.forEach(store => {
          console.log(`       - ${store.name} (${store.email}) - Business: ${store.business_id}`);
        });
      }
    }

    // 3. Check for stores with missing business_id
    console.log('\n3. Checking for stores with missing business_id...');
    
    const { data: storesWithoutBusiness, error: storesError } = await supabase
      .from('stores')
      .select('id, name, email, business_id, user_id')
      .is('business_id', null);

    if (storesError) {
      console.error('❌ Error checking stores:', storesError);
    } else if (storesWithoutBusiness.length > 0) {
      console.log(`⚠️  WARNING: Found ${storesWithoutBusiness.length} stores without business_id:`);
      storesWithoutBusiness.forEach(store => {
        console.log(`   Store: ${store.name} (${store.email}) - User: ${store.user_id}`);
      });
    } else {
      console.log('✅ All stores have business_id assigned');
    }

    // 4. Check RLS policies are working
    console.log('\n4. Testing RLS policy effectiveness...');
    
    // This will help identify if RLS policies are actually filtering data
    const { data: allStoresCount, error: countError } = await supabase
      .from('stores')
      .select('id', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error counting stores:', countError);
    } else {
      console.log(`   Current user can see ${allStoresCount} stores total`);
      console.log('   (This should be limited to user\'s business only)');
    }

    console.log('\n🔍 AUDIT COMPLETE');
    console.log('\n📋 RECOMMENDATIONS:');
    console.log('   1. Fix any users with multiple business access');
    console.log('   2. Ensure all stores have business_id assigned');
    console.log('   3. Verify RLS policies are working correctly');
    console.log('   4. Test with different user accounts to confirm isolation');

  } catch (error) {
    console.error('❌ Audit failed:', error);
  }
}

// Run the audit
auditBusinessSecurity().catch(console.error); 