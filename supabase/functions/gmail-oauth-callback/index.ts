import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// GMAIL OAUTH CALLBACK HANDLER
// =============================================
// Handles the OAuth callback from Google for Gmail integration
// Exchanges authorization code for access/refresh tokens
// Stores tokens securely for automated email processing

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

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    console.log('Gmail OAuth callback received:', { 
      hasCode: !!code, 
      hasState: !!state, 
      error,
      origin: req.headers.get('origin')
    });

    // Handle OAuth errors
    if (error) {
      console.error('Gmail OAuth error:', error);
      const errorDescription = url.searchParams.get('error_description') || 'Unknown error';
      
      return new Response(
        `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Gmail Connection Failed</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
            .error h2 { color: #c33; margin-top: 0; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>Gmail Connection Failed</h2>
            <p><strong>Error:</strong> ${error}</p>
            <p><strong>Description:</strong> ${errorDescription}</p>
            <p>Please close this window and try connecting your Gmail account again.</p>
          </div>
        </body>
        </html>
        `,
        { 
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
          status: 400
        }
      );
    }

    if (!code || !state) {
      throw new Error('Missing authorization code or state parameter');
    }

    // Verify and decode state parameter
    let stateData;
    try {
      stateData = JSON.parse(decodeURIComponent(state));
      console.log('Decoded state data:', stateData);
    } catch (err) {
      console.error('Failed to parse state parameter:', err);
      throw new Error('Invalid state parameter');
    }

    const { pendingId, userId } = stateData;
    if (!pendingId || !userId) {
      throw new Error('Invalid state data: missing pendingId or userId');
    }

    // Get pending OAuth request details
    const { data: pendingOAuth, error: pendingError } = await supabase
      .from('oauth_pending')
      .select('*')
      .eq('id', pendingId)
      .eq('user_id', userId)
      .eq('platform', 'gmail')
      .single();

    if (pendingError || !pendingOAuth) {
      console.error('Pending OAuth request not found:', pendingError);
      throw new Error('OAuth session not found or expired');
    }

    console.log('Found pending Gmail OAuth request:', {
      id: pendingOAuth.id,
      storeName: pendingOAuth.store_name,
      platform: pendingOAuth.platform
    });

    // Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') || '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '',
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth-callback`,
      code_verifier: pendingOAuth.code_verifier // PKCE verification
    });

    console.log('Exchanging authorization code for Gmail tokens...');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString()
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('Gmail token exchange failed:', {
        status: tokenResponse.status,
        error: errorData.error,
        description: errorData.error_description
      });
      throw new Error(`Token exchange failed: ${errorData.error_description || 'Unknown error'}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Gmail token exchange successful:', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope
    });

    // Calculate token expiration
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 3600));

    // Get user profile information from Google
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    let userEmail = 'Unknown';
    if (profileResponse.ok) {
      const profileData = await profileResponse.json();
      userEmail = profileData.email || 'Unknown';
      console.log('Retrieved Gmail user profile:', { email: userEmail });
    }

    // Create the store record with Gmail-specific configuration
    const storeData = {
      user_id: userId,
      name: pendingOAuth.store_name,
      platform: 'gmail', // Consistent platform naming
      oauth_method: 'server_side', // Always server-side for production
      connected: true,
      status: 'active',
      
      // OAuth token data
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt.toISOString(),
      token_last_refreshed: new Date().toISOString(),
      
      // Gmail-specific configuration
      email_address: userEmail,
      sync_from: pendingOAuth.sync_from,
      sync_to: pendingOAuth.sync_to,
      color: pendingOAuth.color || '#ea4335', // Gmail red
      
      // Tracking fields
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating Gmail store record...');

    const { data: newStore, error: storeError } = await supabase
      .from('stores')
      .insert(storeData)
      .select()
      .single();

    if (storeError) {
      console.error('Failed to create Gmail store:', storeError);
      throw new Error(`Failed to save Gmail connection: ${storeError.message}`);
    }

    console.log('Gmail store created successfully:', {
      id: newStore.id,
      name: newStore.name,
      email: newStore.email_address,
      platform: newStore.platform
    });

    // Clean up pending OAuth request
    await supabase
      .from('oauth_pending')
      .delete()
      .eq('id', pendingId);

    console.log('Cleaned up pending OAuth request');

    // Return success page
    return new Response(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Connected Successfully</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 600px; 
            margin: 50px auto; 
            padding: 20px; 
            text-align: center;
          }
          .success { 
            background: #eff; 
            border: 1px solid #cfc; 
            padding: 30px; 
            border-radius: 8px; 
            margin-bottom: 20px;
          }
          .success h2 { 
            color: #363; 
            margin-top: 0; 
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }
          .gmail-icon {
            width: 32px;
            height: 32px;
            background: #ea4335;
            border-radius: 4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
          }
          .details {
            background: #f9f9f9;
            padding: 20px;
            border-radius: 8px;
            text-align: left;
          }
          .close-btn {
            background: #ea4335;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
          }
          .close-btn:hover {
            background: #d33b2c;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h2>
            <span class="gmail-icon">G</span>
            Gmail Connected Successfully!
          </h2>
          <p>Your Gmail account has been connected and is ready for email management.</p>
        </div>
        
        <div class="details">
          <h3>Connection Details:</h3>
          <ul>
            <li><strong>Account Name:</strong> ${newStore.name}</li>
            <li><strong>Email Address:</strong> ${userEmail}</li>
            <li><strong>Platform:</strong> Google Gmail</li>
            <li><strong>OAuth Method:</strong> Server-side (Enterprise)</li>
            <li><strong>Status:</strong> Active & Connected</li>
            <li><strong>Token Expires:</strong> ${expiresAt.toLocaleString()}</li>
          </ul>
        </div>
        
        <button class="close-btn" onclick="window.close()">
          Close Window & Return to App
        </button>
        
        <script>
          // Auto-close after 10 seconds
          setTimeout(() => {
            window.close();
          }, 10000);
        </script>
      </body>
      </html>
      `,
      { 
        headers: { ...corsHeaders, 'Content-Type': 'text/html' }
      }
    );

  } catch (error) {
    console.error('Gmail OAuth callback error:', error);
    
    return new Response(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Connection Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .error { background: #fee; border: 1px solid #fcc; padding: 20px; border-radius: 8px; }
          .error h2 { color: #c33; margin-top: 0; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>Gmail Connection Error</h2>
          <p><strong>Error:</strong> ${error.message}</p>
          <p>Please close this window and try connecting your Gmail account again.</p>
          <p>If the problem persists, please contact support.</p>
        </div>
      </body>
      </html>
      `,
      { 
        headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        status: 500
      }
    );
  }
}); 