/**
 * Fix Missing Webhooks Edge Function
 * 
 * This Deno Edge Function identifies and repairs missing webhook subscriptions
 * for connected Outlook stores. It performs gap detection to find stores that
 * should have webhook subscriptions but don't, then creates the missing webhooks.
 * 
 * Repair Process:
 * 1. Query all connected Outlook stores
 * 2. Identify stores missing webhook subscriptions (LEFT JOIN)
 * 3. Validate access tokens for each store
 * 4. Create missing webhook subscriptions via Microsoft Graph API
 * 5. Store subscription details in local database
 * 6. Provide comprehensive success/failure reporting
 * 
 * Gap Detection Logic:
 * - Connected Outlook stores (connected: true, platform: 'outlook')
 * - Missing graph_subscriptions records (LEFT JOIN with NULL check)
 * - Stores with valid access tokens only
 * - Excludes disconnected or non-Outlook stores
 * 
 * Key Features:
 * - Automated gap detection and repair
 * - Token validation before webhook creation
 * - Batch processing with individual error handling
 * - Comprehensive cleanup on failures
 * - Detailed success/failure reporting
 * - Database consistency with atomic operations
 * 
 * Error Handling:
 * - Per-store error isolation (one failure doesn't stop batch)
 * - Token validation before expensive API calls
 * - Microsoft Graph subscription cleanup on database errors
 * - Detailed error classification and reporting
 * - Comprehensive logging for debugging
 * 
 * Security Features:
 * - Service role authentication for admin operations
 * - Token validation before API interactions
 * - Secure error handling without token exposure
 * - Database transaction-like behavior with cleanup
 * 
 * Used by:
 * - System maintenance and repair operations
 * - Manual troubleshooting for webhook issues
 * - Data migration and consistency checks
 * - Automated system health restoration
 * 
 * Monitoring & Reporting:
 * - Individual store processing results
 * - Success/failure statistics
 * - Detailed error messages for debugging
 * - Webhook subscription IDs for tracking
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Client } from "https://esm.sh/@microsoft/microsoft-graph-client@3.0.7";

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Fix Missing Webhooks Handler
 * 
 * Main function that orchestrates the webhook repair process for Outlook stores.
 * Implements gap detection, batch processing, and comprehensive error handling.
 */
serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Ensure only POST requests are accepted
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

    console.log('=== FIXING MISSING WEBHOOK SUBSCRIPTIONS ===');

    // Gap Detection Query: Find Connected Outlook Stores Without Webhooks
    // Uses LEFT JOIN to identify stores that should have webhooks but don't
    const { data: storesWithoutWebhooks, error: queryError } = await supabase
      .from('stores')
      .select(`
        *,
        graph_subscriptions!left (id)
      `)
      .eq('platform', 'outlook')                     // Only Outlook stores support webhooks
      .eq('connected', true)                         // Only connected stores need webhooks
      .is('graph_subscriptions.id', null);           // Stores without webhook subscriptions (NULL from LEFT JOIN)

    if (queryError) {
      console.error('Error finding stores without webhooks:', queryError);
      throw queryError;
    }

    console.log(`Found ${storesWithoutWebhooks.length} stores without webhook subscriptions`);

    // Initialize results tracking for batch processing
    const results = [];

    // Process Each Store Individually (Error Isolation)
    for (const store of storesWithoutWebhooks) {
      try {
        console.log(`\n--- Processing store: ${store.name} (${store.email}) ---`);

        // Validate Access Token Availability
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

        // Initialize Microsoft Graph Client
        const graphClient = Client.init({
          authProvider: (done) => {
            done(null, store.access_token);
          }
        });

        // Test Token Validity Before Expensive Operations
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

        // Create Webhook Subscription via Microsoft Graph API
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 3); // Microsoft Graph maximum: 3 days

        const clientState = crypto.randomUUID();               // Security verification token
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-webhook`; // Our webhook endpoint

        console.log('Creating Microsoft Graph webhook subscription...');
        console.log('Webhook URL:', webhookUrl);
        console.log('Expiration:', expirationDate.toISOString());

        const subscription = await graphClient
          .api('/subscriptions')
          .post({
            changeType: 'created',                              // Notify on new messages
            notificationUrl: webhookUrl,                        // Our webhook endpoint
            resource: '/me/mailFolders(\'Inbox\')/messages',   // Monitor inbox messages
            expirationDateTime: expirationDate.toISOString(),   // Subscription expiration
            clientState                                         // Security verification token
          });

        console.log('✅ Microsoft Graph subscription created:', subscription.id);

        // Store Subscription Details in Local Database
        const { data: dbSubscription, error: insertError } = await supabase
          .from('graph_subscriptions')
          .insert({
            store_id: store.id,                                 // Associated store ID
            subscription_id: subscription.id,                   // Microsoft Graph subscription ID
            resource: '/me/mailFolders(\'Inbox\')/messages',   // Monitored resource
            client_state: clientState,                          // Security verification token
            expiration_date: expirationDate.toISOString()       // Subscription expiration
          })
          .select()
          .single();

        // Handle Database Storage Failure with Cleanup
        if (insertError) {
          console.error('❌ Failed to store subscription in database:', insertError);
          
          // Attempt to clean up the Microsoft Graph subscription to prevent orphaned subscriptions
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

        // Record Successful Webhook Creation
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

    // Generate Comprehensive Processing Statistics
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`\n=== WEBHOOK CREATION SUMMARY ===`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📊 Total processed: ${results.length}`);

    // Return Success Response with Detailed Results
    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          totalProcessed: results.length,   // Total stores processed
          successful: successCount,         // Successfully created webhooks
          failed: failureCount             // Failed webhook creations
        },
        results                           // Detailed per-store results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fixing missing webhooks:', error);
    
    // Return Error Response with Details
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