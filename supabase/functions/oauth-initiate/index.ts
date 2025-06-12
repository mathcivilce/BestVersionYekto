/**
 * OAuth Initiation Edge Function
 * 
 * This Deno Edge Function initiates the OAuth 2.0 authorization flow for email platform integrations.
 * It implements the secure PKCE (Proof Key for Code Exchange) flow to protect against authorization
 * code interception attacks.
 * 
 * Supported Platforms:
 * - Microsoft Outlook/Office 365 (Azure AD OAuth)
 * - Google Gmail (Google OAuth)
 * 
 * Security Features:
 * - PKCE (Proof Key for Code Exchange) for enhanced security
 * - CSRF protection with secure state parameters
 * - Temporary pending request storage with expiration
 * - Secure random value generation using Web Crypto API
 * 
 * Flow Overview:
 * 1. Frontend requests OAuth initiation with store configuration
 * 2. Function generates secure PKCE code verifier and challenge
 * 3. Function creates CSRF protection state parameter
 * 4. Function stores pending request in database with expiration
 * 5. Function builds platform-specific OAuth authorization URL
 * 6. Frontend redirects user to OAuth provider
 * 7. OAuth provider redirects to callback function with authorization code
 * 
 * The PKCE flow enhances security by:
 * - Eliminating the need to store client secrets on mobile/SPA clients
 * - Protecting against authorization code interception
 * - Ensuring only the original client can exchange the code for tokens
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * OAuth Initiation Request Interface
 * 
 * Defines the structure of the request payload from the frontend
 * when initiating an OAuth flow for a new email store connection.
 */
interface OAuthInitiateRequest {
  storeData: {
    name: string;                           // User-defined name for the email store
    platform: 'outlook' | 'gmail';         // Email platform to connect
    color?: string;                         // UI color for store identification
    syncFrom?: string;                      // Start date for email synchronization
    syncTo?: string;                        // End date for email synchronization
  };
  userId: string;                          // User ID from authentication context
  businessId: string;                     // Business ID for multi-tenant support
}

/**
 * Generate PKCE Code Verifier
 * 
 * Creates a cryptographically secure random string used as the PKCE code verifier.
 * The verifier is stored securely and used later to verify the authorization code exchange.
 * 
 * @returns string - URL-safe base64 encoded random string
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')    // Replace + with - for URL safety
    .replace(/\//g, '_')    // Replace / with _ for URL safety
    .replace(/=/g, '');     // Remove padding = characters
}

/**
 * Generate PKCE Code Challenge
 * 
 * Creates a SHA256 hash of the code verifier, base64url encoded.
 * This challenge is sent to the OAuth provider and used to verify
 * that the token exchange request comes from the same client.
 * 
 * @param verifier - The code verifier to hash
 * @returns Promise<string> - URL-safe base64 encoded SHA256 hash
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-')    // Replace + with - for URL safety
    .replace(/\//g, '_')    // Replace / with _ for URL safety
    .replace(/=/g, '');     // Remove padding = characters
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== OAUTH INITIATE FUNCTION START ===');
    
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

    // Parse and validate request body
    const body: OAuthInitiateRequest = await req.json();
    const { storeData, userId, businessId } = body;

    console.log('Parsed request:', { 
      storeData: storeData, 
      userId: userId, 
      businessId: businessId 
    });

    // Log duplicate prevention context for debugging
    console.log('=== DUPLICATE PREVENTION CONTEXT ===');
    console.log(`Platform: ${storeData.platform}`);
    console.log(`Store Name: ${storeData.name}`);
    console.log(`User ID: ${userId}`);
    console.log('Note: Frontend health validation may have already checked for duplicates');
    console.log('OAuth callback will handle smart duplicate resolution');
    console.log('=== END DUPLICATE PREVENTION CONTEXT ===');

    // Validate required parameters
    if (!storeData?.name || !userId || !businessId) {
      throw new Error('Missing required parameters: storeData.name, userId, or businessId');
    }

    // Generate secure state parameter for CSRF protection
    // This random UUID prevents cross-site request forgery attacks
    const state = crypto.randomUUID();
    console.log('Generated state:', state);

    // Generate PKCE parameters for enhanced security
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    console.log('Generated PKCE parameters');

    // Store the pending OAuth request in database with expiration
    // This allows the callback function to verify and complete the OAuth flow
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10-minute expiration for security

    console.log('Storing pending OAuth request...');
    const { error: insertError } = await supabase
      .from('oauth_pending')
      .insert({
        state,                              // CSRF protection token
        user_id: userId,                    // User initiating the OAuth flow
        business_id: businessId,            // Business context for multi-tenancy
        store_data: storeData,              // Store configuration from frontend
        code_verifier: codeVerifier,        // PKCE verifier for token exchange
        expires_at: expiresAt.toISOString() // Request expiration time
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
      // Google OAuth 2.0 Configuration
      authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth-callback`;
      
      authUrl.searchParams.set('client_id', Deno.env.get('GOOGLE_CLIENT_ID') || '');
      // Gmail API scopes for read, send, and modify operations
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email');
      authUrl.searchParams.set('access_type', 'offline');  // Request refresh token
      authUrl.searchParams.set('prompt', 'consent');       // Force consent screen for refresh token
    } else {
      // Microsoft OAuth 2.0 Configuration (default for Outlook/Office 365)
      authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-callback`;
      
      authUrl.searchParams.set('client_id', Deno.env.get('AZURE_CLIENT_ID') || '');
      // Microsoft Graph API scopes for user info and email operations
      authUrl.searchParams.set('scope', 'User.Read Mail.Read Mail.ReadBasic Mail.Send Mail.ReadWrite offline_access');
      authUrl.searchParams.set('prompt', 'select_account'); // Allow account selection
    }

    // Add common OAuth 2.0 parameters required by both platforms
    authUrl.searchParams.set('response_type', 'code');     // Authorization code flow
    authUrl.searchParams.set('redirect_uri', redirectUri); // Callback URL after authorization
    authUrl.searchParams.set('state', state);              // CSRF protection parameter
    authUrl.searchParams.set('response_mode', 'query');    // Return parameters in query string
    
    // Add PKCE parameters for enhanced security
    authUrl.searchParams.set('code_challenge', codeChallenge);        // SHA256 hash of verifier
    authUrl.searchParams.set('code_challenge_method', 'S256');        // Hashing method used

    const finalAuthUrl = authUrl.toString();
    console.log(`Generated ${storeData.platform} auth URL with PKCE (without sensitive params)`);
    console.log('=== OAUTH INITIATE FUNCTION SUCCESS ===');

    // Return the OAuth authorization URL for frontend redirection
    return new Response(
      JSON.stringify({ 
        success: true,
        authUrl: finalAuthUrl,  // Complete OAuth authorization URL
        state: state            // State parameter for verification
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
    
    // Return error response with details for debugging
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