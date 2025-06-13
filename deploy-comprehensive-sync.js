import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vjkofswgtffzyeuiainf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqa29mc3dndGZmenlldWlhaW5mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTc2NTM1MiwiZXhwIjoyMDUxMzQxMzUyfQ.J5L8lGc_T35L4zzaTYUAeJq8zS3IFO3AYfpAjhK8LfI';

const supabase = createClient(supabaseUrl, supabaseKey);

async function deployFunctions() {
  console.log('🚀 Deploying comprehensive sync-emails function...');

  try {
    // Deploy sync-emails function with dependencies
    const syncEmailsResponse = await fetch(`${supabaseUrl}/functions/v1/deploy/sync-emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        verify_jwt: false
      })
    });

    if (syncEmailsResponse.ok) {
      console.log('✅ sync-emails function deployed successfully');
    } else {
      const error = await syncEmailsResponse.text();
      console.error('❌ sync-emails deployment error:', error);
    }

    console.log('🎉 Deployment completed!');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
  }
}

deployFunctions(); 