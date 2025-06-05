import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TokenRefreshRequest {
  storeId?: string;
  refreshAllExpiring?: boolean;
}

interface MSALTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

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

    const body: TokenRefreshRequest = await req.json().catch(() => ({}));
    const { storeId, refreshAllExpiring = false } = body;

    let stores = [];

    if (storeId) {
      // Refresh specific store
      const { data: store, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .eq('platform', 'outlook')
        .single();

      if (error) throw error;
      if (!store) throw new Error('Store not found');
      
      stores = [store];
    } else if (refreshAllExpiring) {
      // Refresh all stores with tokens expiring in the next hour
      const oneHourFromNow = new Date();
      oneHourFromNow.setHours(oneHourFromNow.getHours() + 1);

      const { data: expiringStores, error } = await supabase
        .from('stores')
        .select('*')
        .eq('platform', 'outlook')
        .eq('connected', true)
        .lt('token_expires_at', oneHourFromNow.toISOString())
        .not('refresh_token', 'is', null);

      if (error) throw error;
      stores = expiringStores || [];
    } else {
      throw new Error('Either storeId or refreshAllExpiring must be specified');
    }

    const results = [];

    for (const store of stores) {
      try {
        console.log(`Refreshing token for store ${store.id}`);

        if (!store.refresh_token) {
          console.warn(`No refresh token available for store ${store.id}`);
          continue;
        }

        // Microsoft OAuth2 token refresh
        const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
        const refreshParams = new URLSearchParams({
          client_id: Deno.env.get('AZURE_CLIENT_ID') || '',
          scope: 'User.Read Mail.Read Mail.ReadBasic Mail.Send Mail.ReadWrite offline_access',
          refresh_token: store.refresh_token,
          grant_type: 'refresh_token'
        });

        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: refreshParams.toString()
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`Token refresh failed for store ${store.id}:`, errorData);
          
          // If refresh token is invalid, mark store as disconnected
          if (response.status === 400 && errorData.error === 'invalid_grant') {
            await supabase
              .from('stores')
              .update({
                connected: false,
                status: 'issue',
                token_last_refreshed: new Date().toISOString()
              })
              .eq('id', store.id);
            
            results.push({
              storeId: store.id,
              success: false,
              error: 'Invalid refresh token - store disconnected'
            });
            continue;
          }
          
          throw new Error(`HTTP ${response.status}: ${errorData.error_description || 'Token refresh failed'}`);
        }

        const tokenData: MSALTokenResponse = await response.json();
        
        // Calculate expiration time (expires_in is in seconds)
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

        // Update store with new tokens
        const updateData: any = {
          access_token: tokenData.access_token,
          token_expires_at: expiresAt.toISOString(),
          token_last_refreshed: new Date().toISOString(),
          connected: true,
          status: 'active'
        };

        // Update refresh token if provided (some flows don't return new refresh tokens)
        if (tokenData.refresh_token) {
          updateData.refresh_token = tokenData.refresh_token;
        }

        const { error: updateError } = await supabase
          .from('stores')
          .update(updateData)
          .eq('id', store.id);

        if (updateError) throw updateError;

        console.log(`Successfully refreshed token for store ${store.id}`);
        results.push({
          storeId: store.id,
          success: true,
          expiresAt: expiresAt.toISOString()
        });

      } catch (error) {
        console.error(`Error refreshing token for store ${store.id}:`, error);
        
        // Update last refresh attempt timestamp
        await supabase
          .from('stores')
          .update({
            token_last_refreshed: new Date().toISOString(),
            status: 'issue'
          })
          .eq('id', store.id);

        results.push({
          storeId: store.id,
          success: false,
          error: error.message
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        refreshed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in refresh-tokens function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}); 