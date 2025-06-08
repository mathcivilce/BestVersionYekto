/**
 * OAuth Callback Edge Function
 * 
 * This Deno Edge Function handles the OAuth 2.0 callback from Microsoft Azure AD.
 * It's part of the server-side OAuth flow for connecting user email accounts.
 * 
 * Flow Overview:
 * 1. User initiates OAuth in frontend
 * 2. Frontend creates pending request with PKCE challenge
 * 3. User redirected to Microsoft OAuth
 * 4. Microsoft redirects back to this function with authorization code
 * 5. Function exchanges code for access/refresh tokens
 * 6. Function retrieves user info from Microsoft Graph
 * 7. Function creates/updates store record with tokens
 * 8. Function stores result for frontend polling
 * 
 * Key Features:
 * - PKCE (Proof Key for Code Exchange) for security
 * - Token refresh capability for long-term access
 * - Platform standardization (Microsoft → 'outlook')
 * - Comprehensive error handling with user-friendly responses
 * - Database polling pattern (instead of complex redirects)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TypeScript interfaces for API responses
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface MicrosoftUserInfo {
  id: string;
  mail?: string;
  userPrincipalName: string;
  displayName: string;
}

serve(async (req: Request) => {
  // CORS headers for cross-origin requests
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }

  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers })
  }

  try {
    console.log('=== OAUTH CALLBACK FUNCTION START ===');
    
    // Extract OAuth callback parameters from URL
    const url = new URL(req.url);
    const code = url.searchParams.get('code');              // Authorization code from Microsoft
    const state = url.searchParams.get('state');            // CSRF protection token
    const error = url.searchParams.get('error');            // OAuth error code
    const errorDescription = url.searchParams.get('error_description'); // OAuth error details

    console.log('OAuth callback received:', { code: !!code, state, error, errorDescription });

    // Initialize Supabase client with service role key for admin operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Handle OAuth errors from Microsoft
    if (error) {
      console.error('OAuth error:', error, errorDescription);
      const errorData = { success: false, error: 'oauth_error', description: `OAuth error: ${error}` };
      const errorString = encodeURIComponent(JSON.stringify(errorData));
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          'Location': `about:blank#oauth_error=${errorString}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    // Validate required OAuth parameters
    if (!code || !state) {
      console.error('Missing required parameters:', { code: !!code, state });
      const errorData = { success: false, error: 'invalid_request', description: 'Missing authorization code or state' };
      const errorString = encodeURIComponent(JSON.stringify(errorData));
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          'Location': `about:blank#oauth_error=${errorString}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    // Retrieve pending OAuth request using state parameter
    // The state parameter links this callback to the original OAuth initiation
    const { data: pendingRequest, error: fetchError } = await supabase
      .from('oauth_pending')
      .select('*')
      .eq('state', state)
      .single();

    if (fetchError || !pendingRequest) {
      console.error('Invalid or expired state:', fetchError);
      const errorData = { success: false, error: 'invalid_state', description: 'Invalid or expired state parameter' };
      const errorString = encodeURIComponent(JSON.stringify(errorData));
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          'Location': `about:blank#oauth_error=${errorString}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    console.log('Found pending request:', pendingRequest.id);

    // Exchange authorization code for access and refresh tokens
    // This is the core of the OAuth 2.0 Authorization Code flow with PKCE
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: Deno.env.get('AZURE_CLIENT_ID') || '',
        client_secret: Deno.env.get('AZURE_CLIENT_SECRET') || '',
        code,
        redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-callback`,
        grant_type: 'authorization_code',
        code_verifier: pendingRequest.code_verifier, // PKCE code verifier
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      const errorData = { success: false, error: 'token_exchange_failed', description: 'Failed to exchange authorization code' };
      const errorString = encodeURIComponent(JSON.stringify(errorData));
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          'Location': `about:blank#oauth_error=${errorString}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    const tokens = await tokenResponse.json();
    console.log('Token exchange successful');

    // Get user information from Microsoft Graph API to retrieve email address
    // This is necessary because the OAuth token doesn't include the email claim
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    });

    let userEmail = '';
    if (userInfoResponse.ok) {
      const userInfo: MicrosoftUserInfo = await userInfoResponse.json();
      // Try mail field first, fallback to userPrincipalName
      userEmail = userInfo.mail || userInfo.userPrincipalName;
      console.log('Retrieved user email:', userEmail);
    } else {
      console.error('Failed to get user info from Microsoft Graph');
      userEmail = 'unknown@example.com'; // Fallback email
    }

    // Create or update store with standardized platform naming
    // PLATFORM STANDARDIZATION: Microsoft OAuth = 'outlook' platform
    // This ensures compatibility with refresh token system and future multi-platform support
    // Platform naming convention:
    // - 'outlook' for Microsoft/Office 365 email accounts
    // - 'gmail' for Google email accounts (future implementation)
    // - 'imap' for generic IMAP servers (future implementation)
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .upsert({
        id: pendingRequest.store_data.id || crypto.randomUUID(),
        user_id: pendingRequest.user_id,
        business_id: pendingRequest.business_id,
        name: pendingRequest.store_data.name,
        platform: 'outlook', // FIXED: Use 'outlook' for Microsoft email accounts (was 'email')
        color: pendingRequest.store_data.color || '#3b82f6',
        email: userEmail,
        sync_from: pendingRequest.store_data.syncFrom,
        sync_to: pendingRequest.store_data.syncTo,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token, // Server OAuth stores refresh tokens for automatic renewal
        token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
        token_last_refreshed: new Date().toISOString(), // Track when token was last refreshed
        oauth_method: 'server_side', // Distinguishes from 'msal_popup' method
        connected: true,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (storeError) {
      console.error('Failed to create/update store:', storeError);
      const errorData = { success: false, error: 'store_creation_failed', description: 'Failed to save store configuration' };
      const errorString = encodeURIComponent(JSON.stringify(errorData));
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          'Location': `about:blank#oauth_error=${errorString}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    console.log('Store created/updated:', store.id);

    // WEBHOOK SUBSCRIPTION CREATION TEMPORARILY REMOVED FOR TESTING
    // TODO: Add webhook subscription creation back after OAuth flow is confirmed working

    // Prepare success response data for frontend
    const responseData = {
      success: true,
      store: {
        id: store.id,
        name: store.name,
        platform: store.platform,
        color: store.color,
        sync_from: store.sync_from,
        sync_to: store.sync_to,
        oauth_method: store.oauth_method,
        created_at: store.created_at
      }
    };

    // Update the pending request with the result (for frontend polling)
    // Instead of complex redirects, we use a polling pattern where the frontend
    // checks the database for the OAuth result
    const { error: updateError } = await supabase
      .from('oauth_pending')
      .update({
        result: responseData,
        completed_at: new Date().toISOString()
      })
      .eq('id', pendingRequest.id);

    if (updateError) {
      console.error('Failed to update pending request with result:', updateError);
    } else {
      console.log('✅ OAuth result stored in database for polling');
    }

    // Return a user-friendly success page that can close itself
    // This provides immediate feedback to the user while the frontend polls for results
    return new Response(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Connected Successfully</title>
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
          }
          .close-btn {
            background: #0078d4;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
          }
          .close-btn:hover {
            background: #106ebe;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <h2>✅ Email Account Connected!</h2>
          <p>Your ${store.platform} account has been connected successfully.</p>
          <p><strong>Account:</strong> ${userEmail}</p>
          <p><strong>Store Name:</strong> ${store.name}</p>
        </div>
        
        <button class="close-btn" onclick="window.close()">
          Close Window & Return to App
        </button>
        
        <script>
          // Auto-close after 3 seconds
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
      `,
      { 
        headers: { ...headers, 'Content-Type': 'text/html' }
      }
    );

  } catch (error) {
    console.error('OAuth callback error:', error);
    
    // Try to store error result in database if we have state parameter
    // This ensures the frontend polling can detect the error
    const url = new URL(req.url);
    const state = url.searchParams.get('state');
    
    if (state) {
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
        
        const errorData = { success: false, error: 'internal_error', description: error.message || 'An unexpected error occurred' };
        
        // Store error in pending request for frontend polling
        await supabase
          .from('oauth_pending')
          .update({
            result: errorData,
            completed_at: new Date().toISOString()
          })
          .eq('state', state);
      } catch (dbError) {
        console.error('Failed to store error in database:', dbError);
      }
    }
    
    // Return user-friendly error page
    return new Response(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Connection Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
          .error { background: #fee; border: 1px solid #fcc; padding: 30px; border-radius: 8px; }
          .error h2 { color: #c33; margin-top: 0; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>❌ Email Connection Error</h2>
          <p><strong>Error:</strong> ${error.message || 'An unexpected error occurred'}</p>
          <p>Please close this window and try connecting your email account again.</p>
        </div>
        
        <script>
          // Auto-close after 5 seconds
          setTimeout(() => {
            window.close();
          }, 5000);
        </script>
      </body>
      </html>
      `,
      { 
        headers: { ...headers, 'Content-Type': 'text/html' },
        status: 500
      }
    );
  }
});

 