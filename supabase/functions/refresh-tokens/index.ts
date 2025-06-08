import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { JobMonitor, SystemHealthMonitor } from "../_shared/monitoring.ts";
import { OAuthRetryHandler, ErrorRecoveryStrategies } from "../_shared/retry-handler.ts";

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

// Platform-specific configuration for OAuth token refresh
interface PlatformConfig {
  platform: OAuthPlatform;
  tokenEndpoint: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv?: string; // Optional for PKCE-only flows
}

const PLATFORM_CONFIGS: Record<OAuthPlatform, PlatformConfig> = {
  outlook: {
    platform: 'outlook',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'User.Read Mail.Read Mail.ReadBasic Mail.Send Mail.ReadWrite offline_access',
    clientIdEnv: 'AZURE_CLIENT_ID',
    clientSecretEnv: 'AZURE_CLIENT_SECRET'
  },
  
  gmail: {
    platform: 'gmail',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET'
  }
  
  // Future platforms:
  // yahoo: { ... },
  // apple: { ... }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Initialize enhanced monitoring
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

  const monitor = new JobMonitor('OAuth Token Refresh', 'refresh_tokens', supabase);

  try {
    const body: TokenRefreshRequest = await req.json().catch(() => ({}));
    const { storeId, refreshAllExpiring = false } = body;

    let stores = [];

    if (storeId) {
      // Refresh specific store - ONLY if it's a server-side OAuth store
      console.log(`Refreshing specific store: ${storeId}`);
      
      const { data: store, error } = await monitor.trackDbQuery(
        () => supabase
          .from('stores')
          .select('*')
          .eq('id', storeId)
          .eq('connected', true)                    // FILTER: Only connected accounts
          .eq('oauth_method', 'server_side')       // FILTER: Only server OAuth (not MSAL popup)
          .in('platform', OAUTH_PLATFORMS)         // FILTER: Only OAuth platforms (not IMAP/POP3)
          .not('refresh_token', 'is', null)        // FILTER: Must have refresh token
          .single(),
        `Query specific store ${storeId} for token refresh`
      );

      if (error) {
        monitor.recordError({
          errorCode: 'STORE_QUERY_ERROR',
          errorMessage: `Store query error for ${storeId}: ${error.message}`,
          storeId,
          severity: 'high',
          isRetryable: false
        });
        throw error;
      }
      if (!store) {
        monitor.recordError({
          errorCode: 'STORE_NOT_ELIGIBLE',
          errorMessage: `Store not found or not eligible for refresh: ${storeId}. Store must be connected, use server_side OAuth, and have a refresh token.`,
          storeId,
          severity: 'medium',
          isRetryable: false
        });
        throw new Error(`Store not found or not eligible for refresh: ${storeId}`);
      }
      
      console.log(`Found eligible store: ${store.name} (${store.platform})`);
      stores = [store];
    } else if (refreshAllExpiring) {
      // Refresh all OAuth stores with tokens expiring in the next hour
      const oneHourFromNow = new Date();
      oneHourFromNow.setHours(oneHourFromNow.getHours() + 1);

      console.log(`Finding OAuth stores with tokens expiring before: ${oneHourFromNow.toISOString()}`);

      const { data: expiringStores, error } = await supabase
        .from('stores')
        .select('*')
        .eq('connected', true)                    // CRITICAL: Only connected accounts
        .eq('oauth_method', 'server_side')       // CRITICAL: Only server OAuth (excludes MSAL popup)
        .in('platform', OAUTH_PLATFORMS)         // CRITICAL: Only OAuth platforms (excludes IMAP/POP3)
        .lt('token_expires_at', oneHourFromNow.toISOString())
        .not('refresh_token', 'is', null);       // CRITICAL: Must have refresh token

      if (error) {
        console.error('Error querying expiring stores:', error);
        throw error;
      }
      
      stores = expiringStores || [];
      console.log(`Found ${stores.length} OAuth stores with expiring tokens`);
      
      // Log details for debugging
      stores.forEach(store => {
        console.log(`Expiring token: ${store.name} (${store.platform}, expires: ${store.token_expires_at})`);
      });
    } else {
      throw new Error('Either storeId or refreshAllExpiring must be specified');
    }

    const results = [];

    // Process each eligible OAuth store
    for (const store of stores) {
      const storeStartTime = performance.now();
      
      try {
        console.log(`=== REFRESHING TOKEN FOR STORE: ${store.id} ===`);
        console.log(`Store: ${store.name} (${store.platform}, oauth_method: ${store.oauth_method})`);

        // Double-check we have a refresh token (should always be true due to query filter)
        if (!store.refresh_token) {
          console.warn(`No refresh token available for store ${store.id} - this should not happen due to query filters`);
          
          monitor.recordStoreResult({
            storeId: store.id,
            storeName: store.name,
            platform: store.platform,
            oauthMethod: store.oauth_method,
            status: 'skipped',
            processingTimeMs: performance.now() - storeStartTime,
            errorMessage: 'No refresh token available',
            actionsTaken: ['skipped_no_refresh_token']
          });
          continue;
        }

        // Get platform-specific configuration
        const platformConfig = PLATFORM_CONFIGS[store.platform as OAuthPlatform];
        if (!platformConfig) {
          console.error(`No configuration found for platform: ${store.platform}`);
          continue;
        }

        console.log(`Using ${platformConfig.platform} OAuth configuration`);

        // Prepare platform-specific token refresh request
        const tokenUrl = platformConfig.tokenEndpoint;
        const refreshParams = new URLSearchParams({
          client_id: Deno.env.get(platformConfig.clientIdEnv) || '',
          scope: platformConfig.scope,
          refresh_token: store.refresh_token,
          grant_type: 'refresh_token'
        });

        // Add client secret if required (most OAuth providers need this)
        if (platformConfig.clientSecretEnv) {
          const clientSecret = Deno.env.get(platformConfig.clientSecretEnv);
          if (clientSecret) {
            refreshParams.set('client_secret', clientSecret);
          }
        }

        // Create retry handler for this OAuth operation
        const retryHandler = new OAuthRetryHandler();
        
        const retryResult = await retryHandler.refreshTokenWithRetry(
          () => monitor.trackApiCall(
            () => fetch(tokenUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: refreshParams.toString()
            }),
            `OAuth token refresh for ${store.platform} store ${store.name}`
          ),
          { id: store.id, name: store.name, platform: store.platform }
        );

        if (!retryResult.success) {
          // Apply error recovery strategy
          const recoveryStrategy = await ErrorRecoveryStrategies.handleOAuthError(
            retryResult.error, 
            store, 
            supabase
          );

          console.error(`🚨 Token refresh failed after ${retryResult.attemptsUsed} attempts (${retryResult.totalTimeMs}ms)`);
          console.error(`🔧 Recovery strategy: ${recoveryStrategy.action}`);

          if (recoveryStrategy.disconnectStore) {
            await supabase
              .from('stores')
              .update({
                connected: false,
                status: 'issue',
                token_last_refreshed: new Date().toISOString()
              })
              .eq('id', store.id);

            monitor.recordStoreResult({
              storeId: store.id,
              storeName: store.name,
              platform: store.platform,
              oauthMethod: store.oauth_method,
              status: 'failed',
              processingTimeMs: performance.now() - storeStartTime,
              errorCode: 'OAUTH_PERMANENT_FAILURE',
              errorMessage: `${retryResult.error?.message} - Store disconnected`,
              actionsTaken: ['disconnected_store', recoveryStrategy.action]
            });

            results.push({
              storeId: store.id,
              storeName: store.name,
              platform: store.platform,
              success: false,
              error: `Permanent failure - store disconnected: ${retryResult.error?.message}`,
              errorType: 'OAUTH_PERMANENT_FAILURE',
              attemptsUsed: retryResult.attemptsUsed,
              recoveryAction: recoveryStrategy.action
            });
            continue;
          }

          throw retryResult.error;
        }

        const response = retryResult.result;

        // Handle token refresh response
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error(`Token refresh failed for store ${store.id} (${store.platform}):`, {
            status: response.status,
            error: errorData.error,
            description: errorData.error_description
          });
          
          // Handle specific error cases based on OAuth standards
          if (response.status === 400 && errorData.error === 'invalid_grant') {
            // Refresh token is permanently invalid - disconnect the store
            console.error(`Invalid refresh token for store ${store.id} - marking as disconnected`);
            
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

        // Prepare store update with new token data
        const updateData: any = {
          access_token: tokenData.access_token,
          token_expires_at: expiresAt.toISOString(),
          token_last_refreshed: new Date().toISOString(),
          connected: true,  // Ensure store remains connected after successful refresh
          status: 'active'  // Reset status to active after successful refresh
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
        
        monitor.recordStoreResult({
          storeId: store.id,
          storeName: store.name,
          platform: store.platform,
          oauthMethod: store.oauth_method,
          status: 'success',
          processingTimeMs: performance.now() - storeStartTime,
          oldTokenExpiresAt: store.token_expires_at,
          newTokenExpiresAt: expiresAt.toISOString(),
          actionsTaken: [
            'token_refreshed',
            tokenData.refresh_token ? 'refresh_token_updated' : 'refresh_token_reused'
          ]
        });
        
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
        
        monitor.recordError({
          errorCode: 'TOKEN_REFRESH_ERROR',
          errorMessage: error.message,
          storeId: store.id,
          storeName: store.name,
          platform: store.platform,
          severity: 'high',
          isRetryable: true
        });

        monitor.recordStoreResult({
          storeId: store.id,
          storeName: store.name,
          platform: store.platform,
          oauthMethod: store.oauth_method,
          status: 'failed',
          processingTimeMs: performance.now() - storeStartTime,
          errorCode: 'TOKEN_REFRESH_ERROR',
          errorMessage: error.message,
          actionsTaken: ['marked_as_issue']
        });
        
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

    // Complete monitoring and generate final metrics
    const jobMetrics = monitor.complete(
      failed.length === 0 ? 'completed' : 
      successful.length > 0 ? 'partial' : 'failed'
    );

    const healthReport = monitor.generateHealthReport();

    return new Response(
      JSON.stringify({ 
        success: true, 
        refreshed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
        // Enhanced monitoring data
        jobMetrics: {
          duration: jobMetrics.performance.totalDurationMs,
          successRate: healthReport.successRate,
          itemsProcessed: jobMetrics.itemsProcessed,
          apiCalls: jobMetrics.performance.apiCallsCount,
          dbQueries: jobMetrics.performance.dbQueriesCount
        },
        healthScore: healthReport.health
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in refresh-tokens function:', error);
    
    // Record critical error in monitoring
    monitor.recordError({
      errorCode: 'FUNCTION_CRITICAL_ERROR',
      errorMessage: error.message,
      severity: 'critical',
      isRetryable: false
    });
    
    monitor.complete('failed');
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        healthScore: 0 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}); 