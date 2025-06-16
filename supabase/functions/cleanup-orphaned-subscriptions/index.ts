/**
 * Cleanup Orphaned Subscriptions Edge Function
 * 
 * This function identifies and removes orphaned Microsoft Graph webhook subscriptions
 * that exist on Microsoft's servers but not in our local database. This prevents
 * webhook errors and ensures clean subscription management.
 * 
 * Orphaned subscriptions can occur when:
 * - Database records are deleted but Microsoft subscriptions aren't cleaned up
 * - Webhook creation succeeds on Microsoft but fails to store in database
 * - Manual database operations remove subscription records
 * - Development/testing leaves behind test subscriptions
 * 
 * Process:
 * 1. Query all active Microsoft Graph subscriptions for our app
 * 2. Compare with local database subscription records
 * 3. Identify orphaned subscriptions (exist on Microsoft, not in database)
 * 4. Clean up orphaned subscriptions from Microsoft Graph
 * 5. Log cleanup activities for monitoring
 * 
 * Security:
 * - Requires service role access for database operations
 * - Uses store access tokens for Microsoft Graph API calls
 * - Validates webhook URLs to ensure they belong to our app
 * - Comprehensive error handling and logging
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { Client } from "npm:@microsoft/microsoft-graph-client";

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CleanupResult {
  storeId: string;
  storeName: string;
  storeEmail: string;
  microsoftSubscriptions: number;
  databaseSubscriptions: number;
  orphanedSubscriptions: string[];
  cleanedUpSubscriptions: string[];
  errors: string[];
  success: boolean;
}

interface CleanupSummary {
  totalStoresProcessed: number;
  totalOrphanedFound: number;
  totalCleanedUp: number;
  totalErrors: number;
  results: CleanupResult[];
  executionTime: number;
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    // Initialize Supabase client with service role for admin operations
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

    console.log('=== ORPHANED SUBSCRIPTION CLEANUP STARTED ===');

    // Check for scheduled cleanups from failed disconnections
    const { data: scheduledCleanups } = await supabase
      .from('webhook_cleanup_log')
      .select('subscription_id, details')
      .eq('action', 'cleanup_scheduled_on_disconnect')
      .is('resolved_at', null);

    if (scheduledCleanups && scheduledCleanups.length > 0) {
      console.log(`📋 Found ${scheduledCleanups.length} scheduled cleanups from failed disconnections`);
    }

    // Get all connected Outlook stores with valid access tokens
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('*')
      .eq('platform', 'outlook')
      .eq('connected', true)
      .not('access_token', 'is', null);

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      throw storesError;
    }

    console.log(`Found ${stores.length} connected Outlook stores to process`);

    const results: CleanupResult[] = [];
    const ourWebhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-webhook`;

    // Process each store individually for error isolation
    for (const store of stores) {
      const result: CleanupResult = {
        storeId: store.id,
        storeName: store.name,
        storeEmail: store.email,
        microsoftSubscriptions: 0,
        databaseSubscriptions: 0,
        orphanedSubscriptions: [],
        cleanedUpSubscriptions: [],
        errors: [],
        success: false
      };

      try {
        console.log(`\n--- Processing store: ${store.name} (${store.email}) ---`);

        // Initialize Microsoft Graph client
        const graphClient = Client.init({
          authProvider: (done) => {
            done(null, store.access_token);
          }
        });

        // Test token validity first
        try {
          await graphClient.api('/me').get();
          console.log('✅ Token validation successful');
        } catch (tokenError) {
          console.error('❌ Token validation failed:', tokenError);
          result.errors.push('Invalid or expired access token');
          results.push(result);
          continue;
        }

        // Get all Microsoft Graph subscriptions for this store
        let microsoftSubscriptions: any[] = [];
        try {
          const subscriptionsResponse = await graphClient
            .api('/subscriptions')
            .get();
          
          // Filter subscriptions that belong to our app (by webhook URL)
          microsoftSubscriptions = subscriptionsResponse.value.filter((sub: any) => 
            sub.notificationUrl && sub.notificationUrl.includes('/functions/v1/email-webhook')
          );
          
          result.microsoftSubscriptions = microsoftSubscriptions.length;
          console.log(`Found ${microsoftSubscriptions.length} Microsoft Graph subscriptions for our app`);
        } catch (msError) {
          console.error('Error fetching Microsoft subscriptions:', msError);
          result.errors.push(`Microsoft Graph API error: ${msError.message}`);
          results.push(result);
          continue;
        }

        // Get database subscriptions for this store
        const { data: dbSubscriptions, error: dbError } = await supabase
          .from('graph_subscriptions')
          .select('subscription_id')
          .eq('store_id', store.id);

        if (dbError) {
          console.error('Error fetching database subscriptions:', dbError);
          result.errors.push(`Database error: ${dbError.message}`);
          results.push(result);
          continue;
        }

        result.databaseSubscriptions = dbSubscriptions.length;
        console.log(`Found ${dbSubscriptions.length} database subscription records`);

        // Identify orphaned subscriptions
        const dbSubscriptionIds = new Set(dbSubscriptions.map(sub => sub.subscription_id));
        const orphanedSubscriptions = microsoftSubscriptions.filter(msSub => 
          !dbSubscriptionIds.has(msSub.id)
        );

        result.orphanedSubscriptions = orphanedSubscriptions.map(sub => sub.id);
        console.log(`Found ${orphanedSubscriptions.length} orphaned subscriptions`);

        if (orphanedSubscriptions.length === 0) {
          console.log('✅ No orphaned subscriptions found for this store');
          result.success = true;
          results.push(result);
          continue;
        }

        // Clean up orphaned subscriptions
        console.log('🧹 Cleaning up orphaned subscriptions...');
        for (const orphanedSub of orphanedSubscriptions) {
          try {
            console.log(`Deleting orphaned subscription: ${orphanedSub.id}`);
            await graphClient
              .api(`/subscriptions/${orphanedSub.id}`)
              .delete();
            
            result.cleanedUpSubscriptions.push(orphanedSub.id);
            console.log(`✅ Successfully deleted subscription: ${orphanedSub.id}`);
            
            // Log the cleanup activity
            await supabase
              .from('webhook_cleanup_log')
              .insert({
                store_id: store.id,
                subscription_id: orphanedSub.id,
                action: 'orphaned_subscription_deleted',
                details: {
                  notificationUrl: orphanedSub.notificationUrl,
                  resource: orphanedSub.resource,
                  expirationDateTime: orphanedSub.expirationDateTime,
                  cleanupMethod: 'proactive_cleanup'
                },
                timestamp: new Date().toISOString()
              });

            // Mark any scheduled cleanups for this subscription as resolved
            await supabase
              .from('webhook_cleanup_log')
              .update({ resolved_at: new Date().toISOString() })
              .eq('subscription_id', orphanedSub.id)
              .eq('action', 'cleanup_scheduled_on_disconnect')
              .is('resolved_at', null);
              
          } catch (deleteError) {
            console.error(`❌ Failed to delete subscription ${orphanedSub.id}:`, deleteError);
            result.errors.push(`Failed to delete ${orphanedSub.id}: ${deleteError.message}`);
          }
        }

        result.success = result.errors.length === 0;
        console.log(`✅ Store processing complete. Cleaned up: ${result.cleanedUpSubscriptions.length}, Errors: ${result.errors.length}`);

      } catch (storeError) {
        console.error(`❌ Error processing store ${store.name}:`, storeError);
        result.errors.push(storeError.message || 'Unknown error');
      }

      results.push(result);
    }

    // Generate summary
    const summary: CleanupSummary = {
      totalStoresProcessed: results.length,
      totalOrphanedFound: results.reduce((sum, r) => sum + r.orphanedSubscriptions.length, 0),
      totalCleanedUp: results.reduce((sum, r) => sum + r.cleanedUpSubscriptions.length, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
      results,
      executionTime: Date.now() - startTime
    };

    console.log('\n=== CLEANUP SUMMARY ===');
    console.log(`📊 Stores processed: ${summary.totalStoresProcessed}`);
    console.log(`🔍 Orphaned subscriptions found: ${summary.totalOrphanedFound}`);
    console.log(`🧹 Subscriptions cleaned up: ${summary.totalCleanedUp}`);
    console.log(`❌ Errors encountered: ${summary.totalErrors}`);
    console.log(`⏱️ Execution time: ${summary.executionTime}ms`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Cleanup function error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Cleanup function failed',
        details: error.message,
        executionTime: Date.now() - startTime
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
}); 