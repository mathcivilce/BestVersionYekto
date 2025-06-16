import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { Client } from 'npm:@microsoft/microsoft-graph-client@3.0.7';
import { TokenCredentialAuthenticationProvider } from 'npm:@azure/msal-node@2.13.0';
import { ClientCredentialRequest } from 'npm:@azure/msal-node@2.13.0';
import { ConfidentialClientApplication } from 'npm:@azure/msal-node@2.13.0';

interface Store {
  id: string;
  name: string;
  email: string;
  tenant_id: string;
  client_id: string;
  client_secret: string;
  access_token?: string;
  refresh_token?: string;
}

Deno.serve(async (req: Request) => {
  try {
    console.log('🧹 Starting historical cleanup of orphaned subscriptions...');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🔍 Running historical cleanup for user: ${user.id}`);

    // Get all stores for the user
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('*')
      .eq('user_id', user.id);

    if (storesError) {
      console.error('❌ Error fetching stores:', storesError);
      return new Response(JSON.stringify({ error: 'Failed to fetch stores' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!stores || stores.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No stores found for user',
        orphanedSubscriptions: [],
        cleanupResults: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`📊 Found ${stores.length} stores to check`);

    const allOrphanedSubscriptions: any[] = [];
    const cleanupResults: any[] = [];

    // Process each store
    for (const store of stores as Store[]) {
      try {
        console.log(`🔍 Checking store: ${store.name} (${store.email})`);

        // Create Microsoft Graph client for this store
        const clientApp = new ConfidentialClientApplication({
          auth: {
            clientId: store.client_id,
            clientSecret: store.client_secret,
            authority: `https://login.microsoftonline.com/${store.tenant_id}`
          }
        });

        // Get access token
        const clientCredentialRequest: ClientCredentialRequest = {
          scopes: ['https://graph.microsoft.com/.default']
        };

        const response = await clientApp.acquireTokenSilent(clientCredentialRequest);
        const accessToken = response?.accessToken;

        if (!accessToken) {
          console.warn(`⚠️ Could not get access token for store: ${store.name}`);
          continue;
        }

        // Create Graph client
        const graphClient = Client.init({
          authProvider: {
            getAccessToken: async () => accessToken
          }
        });

        // Get all subscriptions from Microsoft Graph
        const subscriptions = await graphClient
          .api('/subscriptions')
          .get();

        console.log(`📊 Found ${subscriptions.value?.length || 0} Microsoft Graph subscriptions for ${store.name}`);

        if (!subscriptions.value || subscriptions.value.length === 0) {
          continue;
        }

        // Get all subscription IDs from our database for this store
        const { data: dbSubscriptions } = await supabase
          .from('webhook_subscriptions')
          .select('subscription_id')
          .eq('store_id', store.id);

        const dbSubscriptionIds = new Set(
          dbSubscriptions?.map(sub => sub.subscription_id) || []
        );

        // Find orphaned subscriptions (exist in Microsoft Graph but not in our DB)
        const orphanedSubscriptions = subscriptions.value.filter(
          (sub: any) => !dbSubscriptionIds.has(sub.id)
        );

        console.log(`🔍 Found ${orphanedSubscriptions.length} orphaned subscriptions for ${store.name}`);

        if (orphanedSubscriptions.length > 0) {
          allOrphanedSubscriptions.push({
            store: {
              id: store.id,
              name: store.name,
              email: store.email
            },
            orphanedSubscriptions: orphanedSubscriptions.map((sub: any) => ({
              id: sub.id,
              resource: sub.resource,
              expirationDateTime: sub.expirationDateTime,
              notificationUrl: sub.notificationUrl
            }))
          });

          // Clean up each orphaned subscription
          for (const orphanedSub of orphanedSubscriptions) {
            try {
              console.log(`🧹 Cleaning up orphaned subscription: ${orphanedSub.id}`);

              // Attempt to delete the subscription
              await graphClient
                .api(`/subscriptions/${orphanedSub.id}`)
                .delete();

              console.log(`✅ Successfully deleted orphaned subscription: ${orphanedSub.id}`);

              // Log the cleanup
              await supabase
                .from('webhook_cleanup_log')
                .insert({
                  store_id: store.id,
                  subscription_id: orphanedSub.id,
                  action: 'historical_cleanup_orphaned_subscription',
                  details: {
                    trigger: 'manual_historical_cleanup',
                    resource: orphanedSub.resource,
                    expirationDateTime: orphanedSub.expirationDateTime,
                    notificationUrl: orphanedSub.notificationUrl,
                    cleanupStore: store.name,
                    timestamp: new Date().toISOString()
                  },
                  timestamp: new Date().toISOString()
                });

              cleanupResults.push({
                subscriptionId: orphanedSub.id,
                store: store.name,
                status: 'success',
                resource: orphanedSub.resource
              });

            } catch (deleteError: any) {
              console.error(`❌ Failed to delete orphaned subscription ${orphanedSub.id}:`, deleteError);

              let status = 'failed';
              let details = deleteError.message || 'Unknown error';

              // Handle 404 errors specially
              if (deleteError.statusCode === 404) {
                console.log(`🔍 Subscription ${orphanedSub.id} returned 404, verifying...`);
                
                try {
                  // Verify token still works
                  await graphClient.api('/me').get();
                  status = 'already_deleted';
                  details = 'Subscription already deleted (404 with valid token)';
                  console.log(`✅ Subscription ${orphanedSub.id} already deleted`);
                } catch (tokenError) {
                  details = `404 with token validation failure: ${tokenError.message}`;
                }
              }

              // Log the cleanup attempt
              await supabase
                .from('webhook_cleanup_log')
                .insert({
                  store_id: store.id,
                  subscription_id: orphanedSub.id,
                  action: status === 'already_deleted' ? 'historical_cleanup_already_deleted' : 'historical_cleanup_failed',
                  details: {
                    error: details,
                    statusCode: deleteError.statusCode,
                    trigger: 'manual_historical_cleanup',
                    resource: orphanedSub.resource,
                    cleanupStore: store.name,
                    timestamp: new Date().toISOString()
                  },
                  timestamp: new Date().toISOString()
                });

              cleanupResults.push({
                subscriptionId: orphanedSub.id,
                store: store.name,
                status: status,
                error: details,
                resource: orphanedSub.resource
              });
            }
          }
        }

      } catch (storeError) {
        console.error(`❌ Error processing store ${store.name}:`, storeError);
        cleanupResults.push({
          store: store.name,
          status: 'store_error',
          error: storeError.message || 'Unknown store error'
        });
      }
    }

    const summary = {
      totalStoresChecked: stores.length,
      totalOrphanedSubscriptions: allOrphanedSubscriptions.reduce(
        (sum, store) => sum + store.orphanedSubscriptions.length, 0
      ),
      successfulCleanups: cleanupResults.filter(r => r.status === 'success').length,
      alreadyDeleted: cleanupResults.filter(r => r.status === 'already_deleted').length,
      failedCleanups: cleanupResults.filter(r => r.status === 'failed').length,
      storeErrors: cleanupResults.filter(r => r.status === 'store_error').length
    };

    console.log('📊 Historical cleanup summary:', summary);

    return new Response(JSON.stringify({
      message: 'Historical cleanup completed',
      summary,
      orphanedSubscriptions: allOrphanedSubscriptions,
      cleanupResults,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Historical cleanup error:', error);
    return new Response(JSON.stringify({ 
      error: 'Historical cleanup failed',
      details: error.message || 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}); 