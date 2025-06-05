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

    // Get subscriptions expiring in the next 24 hours
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: subscriptions, error: subError } = await supabase
      .from('graph_subscriptions')
      .select(`
        *,
        store:stores (*)
      `)
      .lt('expiration_date', tomorrow.toISOString());

    if (subError) throw subError;

    console.log(`Found ${subscriptions.length} subscriptions to renew`);

    for (const subscription of subscriptions) {
      try {
        const graphClient = Client.init({
          authProvider: (done) => {
            done(null, subscription.store.access_token);
          }
        });

        // Renew subscription
        const newExpirationDate = new Date();
        newExpirationDate.setDate(newExpirationDate.getDate() + 3);

        await graphClient
          .api(`/subscriptions/${subscription.subscription_id}`)
          .update({
            expirationDateTime: newExpirationDate.toISOString()
          });

        // Update expiration date in database
        await supabase
          .from('graph_subscriptions')
          .update({
            expiration_date: newExpirationDate.toISOString()
          })
          .eq('id', subscription.id);

        console.log(`Renewed subscription ${subscription.subscription_id}`);
      } catch (error) {
        console.error(`Error renewing subscription ${subscription.subscription_id}:`, error);

        if (error.statusCode === 401) {
          // Token expired, update store status
          await supabase
            .from('stores')
            .update({ 
              status: 'issue',
              connected: false
            })
            .eq('id', subscription.store.id);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, renewed: subscriptions.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in renew-subscriptions:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});