import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { Client } from "npm:@microsoft/microsoft-graph-client";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Handle subscription validation
    const url = new URL(req.url);
    const validationToken = url.searchParams.get('validationToken');
    
    if (validationToken) {
      console.log('Handling subscription validation');
      return new Response(validationToken, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

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

    // Parse notification payload
    const payload = await req.json();
    console.log('Received notification:', payload);

    // Process each notification
    for (const notification of payload.value) {
      const { subscriptionId, clientState, resource } = notification;
      
      // Verify subscription exists and clientState matches
      const { data: subscription, error: subError } = await supabase
        .from('graph_subscriptions')
        .select('store_id, client_state')
        .eq('subscription_id', subscriptionId)
        .single();

      if (subError || !subscription) {
        console.error('Subscription not found:', subscriptionId);
        continue;
      }

      if (subscription.client_state !== clientState) {
        console.error('Client state mismatch');
        continue;
      }

      // Get store details
      const { data: store, error: storeError } = await supabase
        .from('stores')
        .select('*')
        .eq('id', subscription.store_id)
        .single();

      if (storeError || !store) {
        console.error('Store not found:', subscription.store_id);
        continue;
      }

      // Initialize Graph client
      const graphClient = Client.init({
        authProvider: (done) => {
          done(null, store.access_token);
        }
      });

      try {
        // Fetch message details
        const message = await graphClient
          .api(`/me/messages/${resource.split('messages/')[1]}`)
          .select('id,subject,bodyPreview,from,receivedDateTime,isRead,body,conversationId,internetMessageId')
          .get();

        // Save email to database
        const { error: saveError } = await supabase
          .from('emails')
          .upsert({
            id: crypto.randomUUID(),
            graph_id: message.id,
            thread_id: message.conversationId,
            subject: message.subject || 'No Subject',
            from: message.from?.emailAddress?.address || '',
            snippet: message.bodyPreview || '',
            content: message.body?.content || '',
            date: message.receivedDateTime || new Date().toISOString(),
            read: message.isRead || false,
            priority: 1,
            status: 'open',
            store_id: store.id,
            user_id: store.user_id,
            internet_message_id: message.internetMessageId
          }, {
            onConflict: 'graph_id,user_id',
            ignoreDuplicates: true
          });

        if (saveError) {
          console.error('Error saving email:', saveError);
          continue;
        }

        console.log('Email saved successfully:', message.id);
      } catch (error) {
        console.error('Error processing message:', error);
        
        if (error.statusCode === 401) {
          // Token expired, update store status
          await supabase
            .from('stores')
            .update({ 
              status: 'issue',
              connected: false
            })
            .eq('id', store.id);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});