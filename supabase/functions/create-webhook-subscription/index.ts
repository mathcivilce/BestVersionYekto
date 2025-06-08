import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Client } from "https://esm.sh/@microsoft/microsoft-graph-client@3.0.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateWebhookRequest {
  storeId: string;
}

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

    // Parse request body
    const { storeId }: CreateWebhookRequest = await req.json();

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

    // Get store details and verify it exists
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .eq('platform', 'outlook') // Only for Outlook/Microsoft accounts
      .eq('connected', true)
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

    // Check if webhook subscription already exists
    const { data: existingSubscription } = await supabase
      .from('graph_subscriptions')
      .select('*')
      .eq('store_id', storeId)
      .eq('resource', '/me/mailFolders(\'Inbox\')/messages')
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

    console.log('Microsoft Graph subscription created:', subscription.id);

    // Store subscription details in database
    const { data: dbSubscription, error: insertError } = await supabase
      .from('graph_subscriptions')
      .insert({
        store_id: storeId,
        subscription_id: subscription.id,
        resource: '/me/mailFolders(\'Inbox\')/messages',
        client_state: clientState,
        expiration_date: expirationDate.toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to store subscription in database:', insertError);
      
      // Try to clean up the Microsoft Graph subscription
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

    return new Response(
      JSON.stringify({
        success: true,
        subscription: {
          id: dbSubscription.id,
          subscription_id: subscription.id,
          resource: dbSubscription.resource,
          expiration_date: dbSubscription.expiration_date,
          created_at: dbSubscription.created_at
        },
        message: 'Webhook subscription created successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error creating webhook subscription:', error);
    
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