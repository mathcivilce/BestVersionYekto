/**
 * Gmail OAuth Callback Edge Function
 * 
 * This Deno Edge Function handles the OAuth 2.0 callback from Google for Gmail integration.
 * It's part of the server-side OAuth flow for connecting user Gmail accounts to the
 * email management system with enterprise-grade security and token management.
 * 
 * OAuth Flow Overview:
 * 1. User initiates Gmail OAuth in frontend
 * 2. Frontend creates pending request with PKCE challenge
 * 3. User redirected to Google OAuth consent screen
 * 4. Google redirects back to this function with authorization code
 * 5. Function exchanges code for access/refresh tokens using PKCE
 * 6. Function retrieves user profile from Google APIs
 * 7. Function creates store record with Gmail configuration
 * 8. Function cleans up pending OAuth request
 * 9. Function displays success page with connection details
 * 
 * Google API Integration:
 * - OAuth 2.0 with PKCE for enhanced security
 * - Google APIs for user profile information
 * - Refresh token storage for long-term access
 * - Automatic token expiration calculation
 * - Gmail-specific platform configuration
 * 
 * Security Features:
 * - PKCE (Proof Key for Code Exchange) implementation
 * - State parameter validation with JSON encoding
 * - Secure token storage with expiration tracking
 * - Comprehensive error handling and user feedback
 * - Session cleanup and request validation
 * 
 * Platform Standardization:
 * - Consistent 'gmail' platform naming across system
 * - Server-side OAuth method for enterprise reliability
 * - Standardized store structure compatible with refresh system
 * - Gmail red color branding (#ea4335)
 * 
 * Error Handling:
 * - OAuth error detection and user-friendly display
 * - Token exchange failure handling with detailed logging
 * - State validation with comprehensive error messages
 * - HTML error pages for direct user feedback
 * 
 * Used by:
 * - Gmail account connection flows
 * - Multi-platform email integration
 * - Enterprise email management setup
 * - Google Workspace integrations
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Gmail OAuth Callback Handler
 * 
 * Processes OAuth callbacks from Google for Gmail integration, handling the complete
 * authorization flow from code exchange to store creation with comprehensive security.
 */
serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    // Extract OAuth callback parameters from URL
    const url = new URL(req.url);
    const code = url.searchParams.get('code');              // Authorization code from Google
    const state = url.searchParams.get('state');            // CSRF protection and session data
    const error = url.searchParams.get('error');            // OAuth error code

    console.log('Gmail OAuth callback received:', { 
      hasCode: !!code, 
      hasState: !!state, 
      error,
      origin: req.headers.get('origin')
    });

    // Handle OAuth Errors from Google
    if (error) {
      console.error('Gmail OAuth error:', error);
      const errorDescription = url.searchParams.get('error_description') || 'Unknown error';
      
      // Return user-friendly HTML error page
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

    // Validate Required OAuth Parameters
    if (!code || !state) {
      throw new Error('Missing authorization code or state parameter');
    }

    // Verify and Decode State Parameter
    // State contains encoded JSON with session information for security
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

    // Retrieve and Validate Pending OAuth Request
    // Verify the OAuth session exists and matches expected parameters
    const { data: pendingOAuth, error: pendingError } = await supabase
      .from('oauth_pending')
      .select('*')
      .eq('id', pendingId)
      .eq('user_id', userId)
      .eq('platform', 'gmail')            // Ensure platform consistency
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

    // Exchange Authorization Code for Access/Refresh Tokens
    // Use Google OAuth 2.0 token endpoint with PKCE verification
    const tokenParams = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') || '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '',
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth-callback`,
      code_verifier: pendingOAuth.code_verifier // PKCE code verifier for security
    });

    console.log('Exchanging authorization code for Gmail tokens...');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString()
    });

    // Handle Token Exchange Failures
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

    // Calculate Token Expiration Timestamp
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 3600));

    // Retrieve User Profile Information from Google APIs
    // Get user email address and profile details for store configuration
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

    // Create Gmail Store Record with Platform-Specific Configuration
    const storeData = {
      user_id: userId,
      name: pendingOAuth.store_name,
      platform: 'gmail',                     // Consistent platform naming for system compatibility
      oauth_method: 'server_side',            // Enterprise-grade server-side OAuth
      connected: true,
      status: 'active',
      
      // OAuth Token Data for API Access
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt.toISOString(),
      token_last_refreshed: new Date().toISOString(),
      
      // Gmail-Specific Configuration
      email_address: userEmail,
      sync_from: pendingOAuth.sync_from,      // Email sync start date
      sync_to: pendingOAuth.sync_to,          // Email sync end date  
      color: pendingOAuth.color || '#ea4335', // Gmail red branding
      
      // Tracking and Audit Fields
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating Gmail store record...');

    // Insert Store Record into Database
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

    // Clean Up Pending OAuth Request
    // Remove pending request to prevent replay attacks and maintain security
    await supabase
      .from('oauth_pending')
      .delete()
      .eq('id', pendingId);

    console.log('Cleaned up pending OAuth request');

    // Return Success Page with Connection Details
    // Provide comprehensive feedback to user about successful Gmail connection
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
          // Auto-close after 10 seconds for better UX
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
    
    // Return comprehensive error page for debugging and user feedback
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