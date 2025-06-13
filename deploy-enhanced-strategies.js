const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Configuration - CORRECTED PROJECT DETAILS
const SUPABASE_URL = 'https://vjkofswgtffzyeuiainf.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqa29mc3dndGZmenlldWlhaW5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNzYzNTQ2NSwiZXhwIjoyMDUzMjExNDY1fQ.RH1kWJVl_jGzKMhX9j3uoKAJVRpGSvp2YO77gNK6qLQ';
const PROJECT_REF = 'vjkofswgtffzyeuiainf';

console.log('🚀 Deploying Enhanced Synthetic Attachment Strategies...');

async function deployEnhancedStrategies() {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Read the enhanced email providers file
    const emailProvidersPath = './supabase/functions/_shared/email-providers-sync-emails.ts';
    const emailProvidersContent = fs.readFileSync(emailProvidersPath, 'utf8');

    // Read the synthetic attachment processor
    const syntheticProcessorPath = './supabase/functions/_shared/synthetic-attachment-processor.ts';
    const syntheticProcessorContent = fs.readFileSync(syntheticProcessorPath, 'utf8');

    // Read the CID detection engine
    const cidEnginePath = './supabase/functions/_shared/cid-detection-engine.ts';
    const cidEngineContent = fs.readFileSync(cidEnginePath, 'utf8');

    // Read the monitoring system
    const monitoringPath = './supabase/functions/_shared/monitoring-synthetic.ts';
    const monitoringContent = fs.readFileSync(monitoringPath, 'utf8');

    // Read the types file
    const typesPath = './supabase/functions/_shared/types.ts';
    const typesContent = fs.readFileSync(typesPath, 'utf8');

    // Read the CORS file
    const corsPath = './supabase/functions/_shared/cors.ts';
    const corsContent = fs.readFileSync(corsPath, 'utf8');

    // Read the main sync-emails function
    const syncEmailsPath = './supabase/functions/sync-emails/index.ts';
    const syncEmailsContent = fs.readFileSync(syncEmailsPath, 'utf8');

    console.log('📤 Deploying enhanced sync-emails with debugging and edge case protection...');

    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slug: 'sync-emails',
        name: 'sync-emails',
        source: `
// Enhanced Sync Emails Function with Advanced Debugging
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
${corsContent}
${typesContent}
${monitoringContent}
${cidEngineContent}
${syntheticProcessorContent}
${emailProvidersContent}

${syncEmailsContent.replace('import { serve } from "https://deno.land/std@0.168.0/http/server.ts";', '')}
        `,
        verify_jwt: false,
        import_map: `{
          "imports": {
            "supabase": "https://esm.sh/@supabase/supabase-js@2.38.0",
            "corsHeaders": "./cors.ts"
          }
        }`
      })
    });

    if (response.ok) {
      console.log('✅ Enhanced sync-emails deployed successfully!');
      
      // Log the new features
      console.log('\n🎯 Enhanced Features Deployed:');
      console.log('  Strategy 1: Comprehensive debugging with field analysis');
      console.log('  Strategy 2: Edge case protection with exact matching');
      console.log('  Strategy 2: Score conflict resolution');
      console.log('  Strategy 2: Confidence threshold validation');
      console.log('  Strategy 3: Improved logging and index analysis');
      console.log('  All: Consistent debug logging format');
      
      console.log('\n🔧 Debug Logging Levels:');
      console.log('  🔍 [STRATEGY-X-DEBUG] - Detailed internal analysis');
      console.log('  ✅ [STRATEGY-X-SUCCESS] - Successful matches');
      console.log('  ❌ [STRATEGY-X-FAILED] - Failed attempts');
      console.log('  ⚠️ [STRATEGY-X-CONFLICT] - Edge case detection');
      
      console.log('\n📊 Edge Case Protections:');
      console.log('  • Exact CID matching before scoring');
      console.log('  • Score conflict resolution (tied attachments)');
      console.log('  • Confidence threshold filtering (minimum 50 points)');
      console.log('  • Enhanced hex pattern matching');
      console.log('  • Comprehensive field validation');
      
    } else {
      const error = await response.text();
      console.error('❌ Enhanced sync-emails deployment error:', error);
    }

  } catch (error) {
    console.error('💥 Deployment failed:', error.message);
  }
}

// Execute deployment
deployEnhancedStrategies()
  .then(() => {
    console.log('\n🎉 Enhanced Synthetic Attachment Strategies deployment completed!');
    console.log('\n📝 Next Steps:');
    console.log('  1. Test with problematic email attachments');
    console.log('  2. Monitor debug logs for strategy performance');
    console.log('  3. Verify edge case protection effectiveness');
    console.log('  4. Check Strategy 1 field availability analysis');
  })
  .catch(console.error); 