/**
 * OAuth Token Refresh Edge Function
 * 
 * This function manages automatic refresh of OAuth access tokens for email integrations.
 * It's designed specifically for server-side OAuth flows that use refresh tokens.
 * 
 * Supported Platforms:
 * - Microsoft Outlook/Office 365 (Azure AD OAuth)
 * - Google Gmail (Google OAuth) - Future implementation
 * - Other OAuth providers can be added via platform configuration
 * 
 * Key Features:
 * - Platform-agnostic OAuth token refresh
 * - Intelligent filtering (only processes eligible stores)
 * - Comprehensive error handling and recovery strategies
 * - Health tracking integration for connection validation
 * - Retry logic with exponential backoff
 * - Batch processing for multiple stores
 * 
 * Store Eligibility Criteria:
 * - Must be connected (connected: true)
 * - Must use server-side OAuth (oauth_method: 'server_side')
 * - Must be an OAuth platform (not IMAP/POP3)
 * - Must have a valid refresh token
 * 
 * Excluded Store Types:
 * - MSAL popup stores (manage tokens client-side)
 * - IMAP/POP3 stores (use username/password authentication)
 * - Disconnected stores
 * - Stores without refresh tokens
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// OAUTH-AWARE TOKEN REFRESH SYSTEM
// =============================================
// This system is designed ONLY for OAuth platforms that use refresh tokens.
// It does NOT process:
// - MSAL popup stores (oauth_method: 'msal_popup') - they manage tokens client-side
// - IMAP/POP3 stores (use username/password, no refresh tokens)
// - Disconnected stores (connected: false)

// OAuth platforms that support server-side token refresh
// Currently: Microsoft Outlook/Office 365, Google Gmail
// Future: Yahoo, Apple iCloud, etc.
const OAUTH_PLATFORMS = ['outlook', 'gmail'] as const;
type OAuthPlatform = typeof OAUTH_PLATFORMS[number];

// Request interface for token refresh operations
interface TokenRefreshRequest {
  storeId?: string;           // Refresh specific store by ID
  refreshAllExpiring?: boolean; // Refresh all stores with expiring tokens
}

// Microsoft OAuth token response format
interface MSALTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Platform-specific OAuth configuration
 * 
 * Each OAuth provider has different endpoints, scopes, and authentication requirements.
 * This configuration centralizes platform-specific settings for easy maintenance.
 */
interface PlatformConfig {
  platform: OAuthPlatform;
  tokenEndpoint: string;      // OAuth token refresh endpoint
  scope: string;              // Required OAuth scopes for email access
  clientIdEnv: string;        // Environment variable name for client ID
  clientSecretEnv?: string;   // Environment variable name for client secret (optional for PKCE)
}

/**
 * OAuth Platform Configurations
 * 
 * Centralized configuration for all supported OAuth platforms.
 * Makes it easy to add new platforms or modify existing ones.
 */
const PLATFORM_CONFIGS: Record<OAuthPlatform, PlatformConfig> = {
  // Microsoft Outlook/Office 365 OAuth Configuration
  outlook: {
    platform: 'outlook',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'User.Read Mail.Read Mail.ReadBasic Mail.Send Mail.ReadWrite offline_access',
    clientIdEnv: 'AZURE_CLIENT_ID',
    clientSecretEnv: 'AZURE_CLIENT_SECRET'
  },
  
  // Google Gmail OAuth Configuration (Future Implementation)
  gmail: {
    platform: 'gmail',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET'
  }
  
  // Future platforms can be added here:
  // yahoo: { ... },
  // apple: { ... }
};

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

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

  try {
    // Parse request body with fallback to empty object
    const body: TokenRefreshRequest = await req.json().catch(() => ({}));
    const { storeId, refreshAllExpiring = false } = body;

    let stores = [];

    if (storeId) {
      // Refresh specific store - ONLY if it's a server-side OAuth store
      console.log(`Refreshing specific store: ${storeId}`);
      
      // Query for specific store with strict eligibility filters
      const { data: store, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .eq('connected', true)                    // FILTER: Only connected accounts
        .eq('oauth_method', 'server_side')       // FILTER: Only server OAuth (not MSAL popup)
        .in('platform', OAUTH_PLATFORMS)         // FILTER: Only OAuth platforms (not IMAP/POP3)
        .not('refresh_token', 'is', null)        // FILTER: Must have refresh token
        .single();

      if (error) {
        throw error;
      }
      if (!store) {
        throw new Error(`Store not found or not eligible for refresh: ${storeId}. Store must be connected, use server_side OAuth, and have a refresh token.`);
      }
      
      console.log(`Found eligible store: ${store.name} (${store.platform})`);
      stores = [store];
    } else if (refreshAllExpiring) {
      // Refresh all OAuth stores with tokens expiring in the next hour
      const oneHourFromNow = new Date();
      oneHourFromNow.setHours(oneHourFromNow.getHours() + 1);

      console.log(`Finding OAuth stores with tokens expiring before: ${oneHourFromNow.toISOString()}`);

      // Query for all stores with expiring tokens that meet eligibility criteria
      const { data: expiringStores, error } = await supabase
        .from('stores')
        .select('*')
        .eq('connected', true)                    // CRITICAL: Only connected accounts
        .eq('oauth_method', 'server_side')       // CRITICAL: Only server OAuth (excludes MSAL popup)
        .in('platform', OAUTH_PLATFORMS)         // CRITICAL: Only OAuth platforms (excludes IMAP/POP3)
        .not('refresh_token', 'is', null)        // CRITICAL: Must have refresh token
        .lt('token_expires_at', oneHourFromNow.toISOString()) // FILTER: Expiring within 1 hour
        .order('token_expires_at', { ascending: true }); // Process most urgent first

      if (error) {
        throw error;
      }

      stores = expiringStores || [];
      console.log(`Found ${stores.length} OAuth stores with expiring tokens`);
    } else {
      throw new Error('Either storeId or refreshAllExpiring must be specified');
    }

    if (stores.length === 0) {
      console.log('No eligible stores found for token refresh');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No eligible stores found for token refresh',
          refreshed: 0,
          failed: 0,
          results: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    // Process each store for token refresh
    for (const store of stores) {
      try {
        console.log(`\n🔄 Processing store: ${store.name} (${store.platform})`);
        console.log(`Current token expires: ${store.token_expires_at}`);
        
        // Get platform-specific configuration
        const platformConfig = PLATFORM_CONFIGS[store.platform as OAuthPlatform];
        if (!platformConfig) {
          throw new Error(`Unsupported platform: ${store.platform}`);
        }

        // Get OAuth credentials from environment
        const clientId = Deno.env.get(platformConfig.clientIdEnv);
        const clientSecret = platformConfig.clientSecretEnv ? Deno.env.get(platformConfig.clientSecretEnv) : undefined;
        
        if (!clientId) {
          throw new Error(`Missing client ID for platform ${store.platform} (${platformConfig.clientIdEnv})`);
        }

        console.log(`Using ${platformConfig.platform} OAuth endpoint: ${platformConfig.tokenEndpoint}`);

        // Prepare token refresh request body
        const tokenRequestBody = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: store.refresh_token,
          client_id: clientId,
          scope: platformConfig.scope
        });

        // Add client secret if required (not needed for PKCE flows)
        if (clientSecret) {
          tokenRequestBody.append('client_secret', clientSecret);
        }

        console.log(`Making token refresh request to ${platformConfig.platform}...`);
        
        // Make token refresh request with platform-specific endpoint
        const response = await fetch(platformConfig.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: tokenRequestBody
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'unknown_error' }));
          console.error(`Token refresh failed for ${store.name}:`, response.status, errorData);
          
          // Handle different error types
          if (response.status === 400 && errorData.error === 'invalid_grant') {
            // Invalid or expired refresh token - disconnect the store
            console.log(`Invalid refresh token for store ${store.id} - marking as disconnected`);
            
            await supabase
              .from('stores')
              .update({
                connected: false,
                status: 'disconnected',
                access_token: null,
                refresh_token: null,
                token_expires_at: null,
                token_last_refreshed: new Date().toISOString()
              })
              .eq('id', store.id);
            
            results.push({
              storeId: store.id,
              storeName: store.name,
              platform: store.platform,
              success: false,
              error: 'Invalid refresh token - store disconnected',
              errorCode: 'INVALID_GRANT'
            });
            continue;
          }
          
          // Other errors (network, rate limiting, etc.) - don't disconnect, just log
          const errorMessage = `HTTP ${response.status}: ${errorData.error_description || errorData.error || 'Token refresh failed'}`;
          throw new Error(errorMessage);
        }

        // Parse successful token response
        const tokenData: MSALTokenResponse = await response.json();
        console.log(`Token refresh successful for store ${store.id}`);
        
        // Calculate expiration time (expires_in is in seconds)
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);
        console.log(`New token expires at: ${expiresAt.toISOString()}`);

        // Prepare store update with new token data and reset health tracking
        const updateData: any = {
          access_token: tokenData.access_token,
          token_expires_at: expiresAt.toISOString(),
          token_last_refreshed: new Date().toISOString(),
          connected: true,  // Ensure store remains connected after successful refresh
          status: 'active', // Reset status to active after successful refresh
          
          // Reset health tracking after successful token refresh
          health_check_failures: 0,
          last_validation_error: null,
          last_health_check: new Date().toISOString()
        };

        // Update refresh token if provided 
        // Note: Some OAuth providers (like Microsoft) may not return new refresh tokens
        // in every response - they remain valid until explicitly revoked
        if (tokenData.refresh_token) {
          updateData.refresh_token = tokenData.refresh_token;
          console.log(`Updated refresh token for store ${store.id}`);
        } else {
          console.log(`No new refresh token provided for store ${store.id} - keeping existing one`);
        }

        // Update store in database with new token information
        const { error: updateError } = await supabase
          .from('stores')
          .update(updateData)
          .eq('id', store.id);

        if (updateError) {
          console.error(`Failed to update store ${store.id} with new tokens:`, updateError);
          throw updateError;
        }

        console.log(`✅ Successfully refreshed token for store: ${store.name} (${store.platform})`);
        
        results.push({
          storeId: store.id,
          storeName: store.name,
          platform: store.platform,
          success: true,
          expiresAt: expiresAt.toISOString(),
          refreshedAt: new Date().toISOString()
        });

      } catch (error) {
        console.error(`❌ Error refreshing token for store ${store.id} (${store.name}):`, error);
        
        // Update last refresh attempt timestamp and mark as having issues
        // Don't disconnect the store unless it's a permanent error (handled above)
        await supabase
          .from('stores')
          .update({
            token_last_refreshed: new Date().toISOString(),
            status: 'issue'  // Mark as having issues, but keep connected for retry
          })
          .eq('id', store.id);

        results.push({
          storeId: store.id,
          storeName: store.name,
          platform: store.platform,
          success: false,
          error: error.message,
          errorType: 'REFRESH_ERROR'
        });
      }
    }

    // Log final summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`=== TOKEN REFRESH SUMMARY ===`);
    console.log(`Total processed: ${results.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);
    
    if (successful.length > 0) {
      console.log(`✅ Successfully refreshed tokens for:`, successful.map(s => `${s.storeName} (${s.platform})`));
    }
    
    if (failed.length > 0) {
      console.log(`❌ Failed to refresh tokens for:`, failed.map(f => `${f.storeName} (${f.platform}): ${f.error}`));
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
      JSON.stringify({ 
        error: error.message
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}); 