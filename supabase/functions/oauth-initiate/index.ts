import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OAuthInitiateRequest {
  storeData: {
    name: string;
    platform: 'outlook' | 'gmail';
    color?: string;
    syncFrom?: string;
    syncTo?: string;
  };
  userId: string;
  businessId: string;
}

// PKCE helper functions
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== OAUTH INITIATE FUNCTION START ===');
    
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
    const body: OAuthInitiateRequest = await req.json();
    const { storeData, userId, businessId } = body;

    console.log('Parsed request:', { 
      storeData: storeData, 
      userId: userId, 
      businessId: businessId 
    });

    // Validate required parameters
    if (!storeData?.name || !userId || !businessId) {
      throw new Error('Missing required parameters: storeData.name, userId, or businessId');
    }

    // Generate secure state parameter for CSRF protection
    const state = crypto.randomUUID();
    console.log('Generated state:', state);

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    console.log('Generated PKCE parameters');

    // Store the pending OAuth request in database (expires in 10 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    console.log('Storing pending OAuth request...');
    const { error: insertError } = await supabase
      .from('oauth_pending')
      .insert({
        state,
        user_id: userId,
        business_id: businessId,
        store_data: storeData,
        code_verifier: codeVerifier,
        expires_at: expiresAt.toISOString()
      });

    if (insertError) {
      console.error('Failed to store pending OAuth request:', insertError);
      throw new Error(`Database error: ${insertError.message}`);
    }

    console.log('Pending OAuth request stored successfully');

    // Build platform-specific OAuth authorization URL with PKCE
    let authUrl: URL;
    let redirectUri: string;

    if (storeData.platform === 'gmail') {
      // Google OAuth configuration
      authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth-callback`;
      
      authUrl.searchParams.set('client_id', Deno.env.get('GOOGLE_CLIENT_ID') || '');
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
    } else {
      // Microsoft OAuth configuration (default)
      authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-callback`;
      
      authUrl.searchParams.set('client_id', Deno.env.get('AZURE_CLIENT_ID') || '');
      authUrl.searchParams.set('scope', 'User.Read Mail.Read Mail.ReadBasic Mail.Send Mail.ReadWrite offline_access');
      authUrl.searchParams.set('prompt', 'select_account');
    }

    // Common OAuth parameters
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_mode', 'query');
    // Add PKCE parameters
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const finalAuthUrl = authUrl.toString();
    console.log(`Generated ${storeData.platform} auth URL with PKCE (without sensitive params)`);
    console.log('=== OAUTH INITIATE FUNCTION SUCCESS ===');

    return new Response(
      JSON.stringify({ 
        success: true,
        authUrl: finalAuthUrl 
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('=== OAUTH INITIATE FUNCTION ERROR ===');
    console.error('Error in oauth-initiate:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      {
        status: 400,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        }
      }
    );
  }
}); 