/**
 * Create Webhook Subscription Edge Function
 * 
 * This Deno Edge Function creates Microsoft Graph webhook subscriptions for real-time
 * email notifications. It establishes a secure connection between Microsoft's email
 * servers and our application for instant email synchronization.
 * 
 * Microsoft Graph Webhook Flow:
 * 1. Validate store exists and has valid access token
 * 2. Test token validity with Microsoft Graph API
 * 3. Check for existing webhook subscriptions (prevent duplicates)
 * 4. Create new webhook subscription with Microsoft Graph
 * 5. Store subscription details in local database
 * 6. Handle cleanup if any step fails
 * 
 * Webhook Features:
 * - Real-time email notifications from Microsoft Graph
 * - Automatic expiration handling (3-day Microsoft limit)
 * - Secure client state verification for webhooks
 * - Duplicate subscription prevention
 * - Comprehensive error handling and cleanup
 * 
 * Security Features:
 * - Token validation before subscription creation
 * - Secure client state generation for webhook verification
 * - Platform-specific restrictions (Outlook only)
 * - Service role access for database operations
 * - Automatic cleanup on failures
 * 
 * Technical Considerations:
 * - Microsoft Graph subscription limits (3-day maximum)
 * - Webhook URL validation by Microsoft
 * - Client state verification for incoming webhooks
 * - Database transaction-like behavior with cleanup
 * 
 * Used by:
 * - Email store connection flows
 * - Real-time email synchronization setup
 * - Webhook management interfaces
 * - Email platform integrations
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
 * Create Webhook Request Interface
 * 
 * Defines the structure of webhook subscription creation requests.
 * Contains the store ID for which to create the webhook subscription.
 */
interface CreateWebhookRequest {
  storeId: string; // Email store ID for webhook subscription creation
}

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

    // Parse and validate request body
    const { storeId }: CreateWebhookRequest = await req.json();

    // Validate required store ID parameter
    if (!storeId) {
      return new Response(
        JSON.stringify({ error: 'Store ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('=== CREATING WEBHOOK SUBSCRIPTION ===');
    console.log('Store ID:', storeId);

    // Get and Validate Store Details
    // Verify store exists, is connected, and has valid access token
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .eq('platform', 'outlook')     // Only Microsoft/Outlook accounts support webhooks
      .eq('connected', true)         // Store must be connected and active
      .single();

    if (storeError || !store) {
      console.error('Store not found or not connected:', storeError);
      return new Response(
        JSON.stringify({ 
          error: 'Store not found or not connected', 
          details: storeError?.message 
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate Access Token Availability
    if (!store.access_token) {
      console.error('Store has no access token');
      return new Response(
        JSON.stringify({ error: 'Store has no valid access token' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Check for Existing Webhook Subscription
    // Prevent duplicate subscriptions for the same store and resource
    const { data: existingSubscription } = await supabase
      .from('graph_subscriptions')
      .select('*')
      .eq('store_id', storeId)
      .eq('resource', '/me/mailFolders(\'Inbox\')/messages') // Inbox messages resource
      .single();

    if (existingSubscription) {
      console.log('Webhook subscription already exists for store:', storeId);
      return new Response(
        JSON.stringify({ 
          success: true, 
          subscription: existingSubscription,
          message: 'Webhook subscription already exists'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Initialize Microsoft Graph Client
    // Use store's access token for authentication with Microsoft Graph API
    const graphClient = Client.init({
      authProvider: (done) => {
        done(null, store.access_token);
      }
    });

    // Validate Access Token with Microsoft Graph
    // Test token validity before attempting to create subscription
    try {
      console.log('Testing Microsoft Graph API token...');
      await graphClient.api('/me').get();
      console.log('Token validation successful');
    } catch (tokenError) {
      console.error('Token validation failed:', tokenError);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid or expired access token',
          details: 'Please reconnect your email account'
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Prepare Webhook Subscription Parameters
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 3); // Microsoft Graph maximum: 3 days

    const clientState = crypto.randomUUID();              // Secure state for webhook verification
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/email-webhook`; // Our webhook endpoint

    console.log('Creating Microsoft Graph webhook subscription...');
    console.log('Webhook URL:', webhookUrl);
    console.log('Expiration:', expirationDate.toISOString());

    // Create Webhook Subscription with Microsoft Graph
    const subscription = await graphClient
      .api('/subscriptions')
      .post({
        changeType: 'created',                              // Notify on new messages
        notificationUrl: webhookUrl,                        // Our webhook endpoint
        resource: '/me/mailFolders(\'Inbox\')/messages',   // Monitor inbox messages
        expirationDateTime: expirationDate.toISOString(),   // Subscription expiration
        clientState                                         // Security verification token
      });

    console.log('Microsoft Graph subscription created:', subscription.id);

    // Store Subscription Details in Database
    // Maintain local record of webhook subscription for management
    const { data: dbSubscription, error: insertError } = await supabase
      .from('graph_subscriptions')
      .insert({
        store_id: storeId,                                  // Associated email store
        subscription_id: subscription.id,                   // Microsoft Graph subscription ID
        resource: '/me/mailFolders(\'Inbox\')/messages',   // Monitored resource
        client_state: clientState,                          // Security verification token
        expiration_date: expirationDate.toISOString()       // Subscription expiration
      })
      .select()
      .single();

    // Handle Database Storage Failure with Cleanup
    if (insertError) {
      console.error('Failed to store subscription in database:', insertError);
      
      // Attempt to clean up the Microsoft Graph subscription to prevent orphaned subscriptions
      try {
        await graphClient.api(`/subscriptions/${subscription.id}`).delete();
        console.log('Cleaned up Microsoft Graph subscription due to database error');
      } catch (cleanupError) {
        console.error('Failed to cleanup Microsoft Graph subscription:', cleanupError);
      }

      return new Response(
        JSON.stringify({ 
          error: 'Failed to store subscription in database',
          details: insertError.message
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('✅ Webhook subscription created successfully');
    console.log('Subscription ID:', subscription.id);
    console.log('Database record ID:', dbSubscription.id);

    // Return Success Response with Subscription Details
    return new Response(
      JSON.stringify({
        success: true,
        subscription: {
          id: dbSubscription.id,                            // Database record ID
          subscription_id: subscription.id,                 // Microsoft Graph subscription ID
          resource: dbSubscription.resource,                // Monitored resource
          expiration_date: dbSubscription.expiration_date,  // Subscription expiration
          created_at: dbSubscription.created_at             // Creation timestamp
        },
        message: 'Webhook subscription created successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error creating webhook subscription:', error);
    
    // Return error response with details for debugging
    return new Response(
      JSON.stringify({ 
        error: 'Failed to create webhook subscription',
        details: error.message || 'Unknown error occurred'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}); 