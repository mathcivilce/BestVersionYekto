/**
 * Email Webhook Edge Function
 * 
 * This Deno Edge Function handles webhook notifications from Microsoft Graph API
 * for real-time email updates. It processes incoming email notifications and
 * synchronizes them with the local database.
 * 
 * Microsoft Graph Webhook Flow:
 * 1. Application creates webhook subscription via Graph API
 * 2. Microsoft Graph validates subscription by sending validation token
 * 3. Function responds with validation token to confirm subscription
 * 4. When new emails arrive, Microsoft Graph sends webhook notifications
 * 5. Function processes notifications and fetches email details
 * 6. Function saves emails to database with duplicate prevention
 * 
 * Key Features:
 * - Subscription validation handling for Graph API compliance
 * - Client state verification for security
 * - Real-time email synchronization
 * - Token expiration handling with automatic store status updates
 * - Duplicate prevention using composite unique constraints
 * - Multi-tenant support with business/user isolation
 * 
 * Security Measures:
 * - Client state verification to prevent unauthorized notifications
 * - Subscription ID validation against database records
 * - Token-based authentication with Graph API
 * - Error handling for expired or invalid tokens
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { Client } from "npm:@microsoft/microsoft-graph-client";

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Handle Microsoft Graph subscription validation
    // When creating a webhook subscription, Graph API sends a validation token
    // that must be returned immediately to confirm the subscription
    const url = new URL(req.url);
    const validationToken = url.searchParams.get('validationToken');
    
    if (validationToken) {
      console.log('Handling subscription validation');
      return new Response(validationToken, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

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

    // Parse webhook notification payload from Microsoft Graph
    // Graph API sends notifications in a standardized format with multiple notifications per request
    const payload = await req.json();
    console.log('Received notification:', payload);

    // Process each notification in the payload
    // Multiple notifications can be batched together for efficiency
    for (const notification of payload.value) {
      const { subscriptionId, clientState, resource } = notification;
      
      // Verify subscription exists and clientState matches for security
      // Client state acts as a shared secret to verify notification authenticity
      const { data: subscription, error: subError } = await supabase
        .from('graph_subscriptions')
        .select('store_id, client_state')
        .eq('subscription_id', subscriptionId)
        .single();

      if (subError || !subscription) {
        console.error('Subscription not found:', subscriptionId);
        continue; // Skip this notification if subscription is invalid
      }

      // Verify client state matches to prevent unauthorized notifications
      if (subscription.client_state !== clientState) {
        console.error('Client state mismatch');
        continue; // Skip this notification if client state doesn't match
      }

      // Get store details including access tokens for Graph API calls
      const { data: store, error: storeError } = await supabase
        .from('stores')
        .select('*')
        .eq('id', subscription.store_id)
        .single();

      if (storeError || !store) {
        console.error('Store not found:', subscription.store_id);
        continue; // Skip this notification if store is invalid
      }

      // Initialize Microsoft Graph client with store's access token
      // This allows us to fetch detailed email information from the Graph API
      const graphClient = Client.init({
        authProvider: (done) => {
          done(null, store.access_token);
        }
      });

      try {
        // Extract message ID from Graph API resource path
        // Resource format: "Users/{userId}/Messages/{messageId}"
        // We need the message ID to fetch detailed email information
        const messageId = resource.split('/Messages/')[1];
        
        if (!messageId) {
          console.error('Could not extract message ID from resource:', resource);
          continue; // Skip if we can't parse the message ID
        }
        
        console.log('Processing message ID:', messageId);
        
        // Fetch detailed message information from Microsoft Graph API
        // We select specific fields to optimize the API call and reduce payload size
        const message = await graphClient
          .api(`/me/messages/${messageId}`)
          .select('id,subject,bodyPreview,from,receivedDateTime,isRead,body,conversationId,internetMessageId')
          .get();

        // Save email to database with duplicate prevention
        // Using upsert with composite unique constraint (graph_id, user_id)
        // to prevent duplicate emails from being stored
        const { error: saveError } = await supabase
          .from('emails')
          .upsert({
            id: crypto.randomUUID(),                                  // Internal unique ID
            graph_id: message.id,                                     // Microsoft Graph message ID
            thread_id: message.conversationId,                       // Email thread/conversation ID
            subject: message.subject || 'No Subject',                // Email subject line
            from: message.from?.emailAddress?.address || '',         // Sender email address
            snippet: message.bodyPreview || '',                      // Email preview text
            content: message.body?.content || '',                    // Full email body content
            date: message.receivedDateTime || new Date().toISOString(), // Email received timestamp
            read: message.isRead || false,                           // Read status
            priority: 1,                                             // Default priority level
            status: 'open',                                          // Default email status
            store_id: store.id,                                      // Associated email store
            user_id: store.user_id,                                  // User who owns this email
            business_id: store.business_id,                          // Business context for multi-tenancy
            internet_message_id: message.internetMessageId          // Standard email message ID
          }, {
            onConflict: 'graph_id,user_id',                         // Composite unique constraint
            ignoreDuplicates: true                                   // Skip if duplicate exists
          });

        if (saveError) {
          console.error('Error saving email:', saveError);
          continue; // Continue processing other notifications even if one fails
        }

        console.log('Email saved successfully:', message.id);
        
      } catch (error) {
        console.error('Error processing message:', error);
        
        // Handle token expiration by updating store status
        // When access tokens expire, Graph API returns 401 Unauthorized
        if (error.statusCode === 401) {
          console.log('Access token expired for store:', store.id);
          
          // Mark store as having issues and disconnected
          // This will trigger token refresh logic in the frontend
          await supabase
            .from('stores')
            .update({ 
              status: 'issue',                // Indicates authentication issue
              connected: false                // Mark as disconnected for UI
            })
            .eq('id', store.id);
        }
      }
    }

    // Return success response to acknowledge webhook processing
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    
    // Return error response with details for debugging
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});