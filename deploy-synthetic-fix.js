/**
 * Deployment Script for Synthetic Attachment Fix
 * 
 * This script deploys the enhanced sync-emails and download-attachment functions
 * with synthetic attachment capabilities to Supabase Edge Functions.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const PROJECT_REF = 'vjkofswgtffzyeuiainf';
const FUNCTIONS_TO_DEPLOY = [
  'sync-emails',
  'download-attachment'
];

/**
 * Execute command with promise
 */
function execAsync(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Verify Supabase CLI is installed and logged in
 */
async function verifySupabaseCLI() {
  console.log('🔍 Verifying Supabase CLI...');
  
  try {
    const { stdout } = await execAsync('supabase --version');
    console.log(`✅ Supabase CLI version: ${stdout.trim()}`);
  } catch (error) {
    console.error('❌ Supabase CLI not found. Please install it first:');
    console.error('   npm install -g supabase');
    console.error('   https://supabase.com/docs/guides/cli');
    throw error;
  }

  try {
    const { stdout } = await execAsync(`supabase projects list`);
    if (stdout.includes(PROJECT_REF)) {
      console.log(`✅ Authenticated with project ${PROJECT_REF}`);
    } else {
      console.error(`❌ Not authenticated with project ${PROJECT_REF}`);
      console.error('   Please run: supabase login');
      throw new Error('Authentication required');
    }
  } catch (error) {
    console.error('❌ Authentication check failed');
    throw error;
  }
}

/**
 * Deploy a single function
 */
async function deployFunction(functionName) {
  console.log(`\n🚀 Deploying ${functionName}...`);
  
  const functionPath = path.join('supabase', 'functions', functionName);
  
  // Verify function exists
  if (!fs.existsSync(functionPath)) {
    throw new Error(`Function directory not found: ${functionPath}`);
  }

  try {
    const { stdout, stderr } = await execAsync(
      `supabase functions deploy ${functionName} --project-ref ${PROJECT_REF}`,
      { cwd: process.cwd() }
    );
    
    console.log(`✅ ${functionName} deployed successfully`);
    if (stdout) console.log(`   Output: ${stdout.trim()}`);
    if (stderr) console.log(`   Info: ${stderr.trim()}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to deploy ${functionName}:`);
    console.error(`   Error: ${error.error?.message || error.stderr || error.message}`);
    if (error.stdout) console.error(`   Output: ${error.stdout}`);
    return false;
  }
}

/**
 * Verify deployment by checking function status
 */
async function verifyDeployment() {
  console.log('\n🔍 Verifying deployment...');
  
  try {
    const { stdout } = await execAsync(
      `supabase functions list --project-ref ${PROJECT_REF}`
    );
    
    console.log('📋 Deployed functions:');
    console.log(stdout);
    
    // Check if our functions are listed
    const deployedFunctions = FUNCTIONS_TO_DEPLOY.filter(func => 
      stdout.includes(func)
    );
    
    console.log(`✅ ${deployedFunctions.length}/${FUNCTIONS_TO_DEPLOY.length} functions verified`);
    
    if (deployedFunctions.length === FUNCTIONS_TO_DEPLOY.length) {
      console.log('🎉 All functions deployed successfully!');
    } else {
      console.warn('⚠️  Some functions may not have deployed correctly');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  }
}

/**
 * Create deployment checklist
 */
function printDeploymentChecklist() {
  console.log('\n📋 POST-DEPLOYMENT CHECKLIST');
  console.log('=' .repeat(50));
  console.log('1. ✅ Functions deployed to Supabase');
  console.log('2. 🔄 Test sync-emails function:');
  console.log('   POST https://vjkofswgtffzyeuiainf.supabase.co/functions/v1/sync-emails');
  console.log('   Body: { "storeId": "your-store-id" }');
  console.log('3. 🔍 Check logs for synthetic attachment processing');
  console.log('4. 📥 Test download-attachment function:');
  console.log('   GET https://vjkofswgtffzyeuiainf.supabase.co/functions/v1/download-attachment?cid=test-cid');
  console.log('5. 🧪 Run test script: node test-synthetic-attachments.js');
  console.log('6. 📧 Disconnect and reconnect email account');
  console.log('7. ✅ Verify "Test witj image 1:51" shows images');
  console.log('8. 📊 Monitor performance and logs');
}

/**
 * Main deployment function
 */
async function deploy() {
  console.log('🚀 SYNTHETIC ATTACHMENT DEPLOYMENT');
  console.log('=' .repeat(50));
  console.log(`Target project: ${PROJECT_REF}`);
  console.log(`Functions to deploy: ${FUNCTIONS_TO_DEPLOY.join(', ')}`);
  console.log('');

  try {
    // Step 1: Verify CLI
    await verifySupabaseCLI();

    // Step 2: Deploy functions
    let successCount = 0;
    for (const functionName of FUNCTIONS_TO_DEPLOY) {
      const success = await deployFunction(functionName);
      if (success) successCount++;
    }

    // Step 3: Verify deployment
    await verifyDeployment();

    // Step 4: Results
    console.log('\n📊 DEPLOYMENT SUMMARY');
    console.log('=' .repeat(30));
    console.log(`✅ Successfully deployed: ${successCount}/${FUNCTIONS_TO_DEPLOY.length} functions`);
    
    if (successCount === FUNCTIONS_TO_DEPLOY.length) {
      console.log('🎉 DEPLOYMENT COMPLETE!');
      console.log('The synthetic attachment system is now live.');
    } else {
      console.log('⚠️  PARTIAL DEPLOYMENT');
      console.log('Some functions failed to deploy. Check the errors above.');
    }

    // Print checklist
    printDeploymentChecklist();

  } catch (error) {
    console.error('\n❌ DEPLOYMENT FAILED');
    console.error('Error:', error.message);
    console.error('\nPlease fix the issues and try again.');
    process.exit(1);
  }
}

/**
 * Print usage instructions
 */
function printUsage() {
  console.log('📋 DEPLOYMENT INSTRUCTIONS');
  console.log('=' .repeat(50));
  console.log('1. Make sure you have Supabase CLI installed:');
  console.log('   npm install -g supabase');
  console.log('');
  console.log('2. Login to Supabase:');
  console.log('   supabase login');
  console.log('');
  console.log('3. Run this deployment script:');
  console.log('   node deploy-synthetic-fix.js');
  console.log('');
  console.log('4. Follow the post-deployment checklist');
  console.log('');
  console.log('🔧 TROUBLESHOOTING:');
  console.log('- If authentication fails: supabase login');
  console.log('- If functions fail to deploy: check file paths and syntax');
  console.log('- If verification fails: check project permissions');
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
  } else if (args.includes('--check') || args.includes('-c')) {
    // Just run verification
    verifySupabaseCLI().then(() => {
      console.log('✅ CLI verification passed');
    }).catch((error) => {
      console.error('❌ CLI verification failed:', error.message);
    });
  } else {
    // Run full deployment
    deploy();
  }
}

module.exports = { deploy, verifySupabaseCLI, deployFunction }; 