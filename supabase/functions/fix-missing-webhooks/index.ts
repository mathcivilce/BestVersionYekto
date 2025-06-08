import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Client } from "https://esm.sh/@microsoft/microsoft-graph-client@3.0.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    console.log('=== FIXING MISSING WEBHOOK SUBSCRIPTIONS ===');

    // Find all connected Outlook stores without webhook subscriptions
    const { data: storesWithoutWebhooks, error: queryError } = await supabase
      .from('stores')
      .select(`
        *,
        graph_subscriptions!left (id)
      `)
      .eq('platform', 'outlook')
      .eq('connected', true)
      .is('graph_subscriptions.id', null); // Stores without webhook subscriptions

    if (queryError) {
      console.error('Error finding stores without webhooks:', queryError);
      throw queryError;
    }

    console.log(`Found ${storesWithoutWebhooks.length} stores without webhook subscriptions`);

    const results = [];

    for (const store of storesWithoutWebhooks) {
      try {
        console.log(`\n--- Processing store: ${store.name} (${store.email}) ---`);

        if (!store.access_token) {
          console.log('⚠️ Store has no access token, skipping');
          results.push({
            storeId: store.id,
            storeName: store.name,
            success: false,
            error: 'No access token'
          });
          continue;
        }

        // Initialize Microsoft Graph client
        const graphClient = Client.init({
          authProvider: (done) => {
            done(null, store.access_token);
          }
        });

        // Test token validity first
        try {
          console.log('Testing Microsoft Graph API token...');
          await graphClient.api('/me').get();
          console.log('✅ Token validation successful');
        } catch (tokenError) {
          console.error('❌ Token validation failed:', tokenError);
          results.push({
            storeId: store.id,
            storeName: store.name,
            success: false,
            error: 'Invalid or expired access token'
          });
          continue;
        }

        // Create webhook subscription
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 3); // Microsoft Graph max: 3 days

        const clientState = crypto.randomUUID();
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-webhook`;

        console.log('Creating Microsoft Graph webhook subscription...');
        console.log('Webhook URL:', webhookUrl);
        console.log('Expiration:', expirationDate.toISOString());

        const subscription = await graphClient
          .api('/subscriptions')
          .post({
            changeType: 'created',
            notificationUrl: webhookUrl,
            resource: '/me/mailFolders(\'Inbox\')/messages',
            expirationDateTime: expirationDate.toISOString(),
            clientState
          });

        console.log('✅ Microsoft Graph subscription created:', subscription.id);

        // Store subscription details in database
        const { data: dbSubscription, error: insertError } = await supabase
          .from('graph_subscriptions')
          .insert({
            store_id: store.id,
            subscription_id: subscription.id,
            resource: '/me/mailFolders(\'Inbox\')/messages',
            client_state: clientState,
            expiration_date: expirationDate.toISOString()
          })
          .select()
          .single();

        if (insertError) {
          console.error('❌ Failed to store subscription in database:', insertError);
          
          // Try to clean up the Microsoft Graph subscription
          try {
            await graphClient.api(`/subscriptions/${subscription.id}`).delete();
            console.log('🧹 Cleaned up Microsoft Graph subscription due to database error');
          } catch (cleanupError) {
            console.error('Failed to cleanup Microsoft Graph subscription:', cleanupError);
          }

          results.push({
            storeId: store.id,
            storeName: store.name,
            success: false,
            error: `Database error: ${insertError.message}`
          });
          continue;
        }

        console.log('✅ Webhook subscription created successfully for store:', store.name);
        results.push({
          storeId: store.id,
          storeName: store.name,
          success: true,
          subscriptionId: subscription.id,
          expirationDate: expirationDate.toISOString()
        });

      } catch (storeError) {
        console.error(`❌ Error processing store ${store.name}:`, storeError);
        results.push({
          storeId: store.id,
          storeName: store.name,
          success: false,
          error: storeError.message || 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`\n=== WEBHOOK CREATION SUMMARY ===`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📊 Total processed: ${results.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          totalProcessed: results.length,
          successful: successCount,
          failed: failureCount
        },
        results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fixing missing webhooks:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fix missing webhooks',
        details: error.message || 'Unknown error occurred'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}); 