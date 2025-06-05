import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { store_domain, access_token, store_name } = await req.json();

    // Validate required fields
    if (!store_domain || !access_token || !store_name) {
      throw new Error('Missing required fields');
    }

    // Test the Shopify credentials
    const shopifyResponse = await fetch(`https://${store_domain}/admin/api/2023-04/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': access_token,
        'Content-Type': 'application/json',
      },
    });

    if (!shopifyResponse.ok) {
      throw new Error('Invalid Shopify credentials');
    }

    const shopData = await shopifyResponse.json();

    // Get user_id from auth header
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role key to bypass RLS
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get the user's ID from the JWT token
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    
    if (userError || !user) {
      throw new Error('Failed to get user information');
    }

    // Get user's business_id
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('business_id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !userProfile?.business_id) {
      throw new Error('Business information not found. Please contact support.');
    }

    // First create the store record with explicit user_id
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({
        name: store_name,
        platform: 'shopify',
        email: shopData.shop.email,
        color: '#96bf48', // Shopify green
        connected: true,
        status: 'active',
        user_id: user.id, // Explicitly set the user_id
        business_id: userProfile.business_id
      })
      .select()
      .single();

    if (storeError) {
      throw storeError;
    }

    // Then create the Shopify store record with the access token
    const { error: shopifyStoreError } = await supabase
      .from('shopify_stores')
      .insert({
        store_id: store.id,
        shop_domain: store_domain,
        access_token: access_token,
      });

    if (shopifyStoreError) {
      // Rollback store creation if Shopify store creation fails
      await supabase.from('stores').delete().eq('id', store.id);
      throw shopifyStoreError;
    }

    return new Response(
      JSON.stringify({ success: true, store }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});