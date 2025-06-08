import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { JobMonitor } from "../_shared/monitoring.ts";
import { SubscriptionRetryHandler, ErrorRecoveryStrategies } from "../_shared/retry-handler.ts";
import { Client } from "npm:@microsoft/microsoft-graph-client";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// =============================================
// CONNECTION-AWARE SUBSCRIPTION RENEWAL SYSTEM
// =============================================
// This system renews email subscriptions ONLY for:
// - Connected accounts (connected: true)
// - Server-side OAuth accounts (oauth_method: 'server_side')
// - Outlook platform accounts (platform: 'outlook')
// - Accounts with valid access tokens
//
// It does NOT process:
// - Disconnected accounts (connected: false)
// - MSAL popup accounts (oauth_method: 'msal_popup') - they manage subscriptions client-side
// - Accounts with expired/invalid tokens

// Platform-specific subscription renewal configuration
interface SubscriptionConfig {
  platform: string;
  defaultRenewalDays: number;
  maxRenewalDays: number;
  requiresValidToken: boolean;
}

const SUBSCRIPTION_CONFIGS: Record<string, SubscriptionConfig> = {
  outlook: {
    platform: 'outlook',
    defaultRenewalDays: 3,     // Microsoft Graph subscriptions: max 3 days
    maxRenewalDays: 3,
    requiresValidToken: true
  },
  gmail: {
    platform: 'gmail',
    defaultRenewalDays: 7,     // Gmail Pub/Sub subscriptions: max 7 days
    maxRenewalDays: 7,
    requiresValidToken: true
  },
  imap: {
    platform: 'imap',
    defaultRenewalDays: 7,     // IMAP polling schedule
    maxRenewalDays: 14,
    requiresValidToken: false
  }
};

// PHASE 3: Platform-specific renewal implementation
async function performPlatformSpecificRenewal(
  subscription: any,
  config: SubscriptionConfig,
  monitor: any,
  subscriptionStartTime: number,
  supabase: any
): Promise<{ newExpirationDate: string } | null> {
  const platform = subscription.store.platform;
  const newExpirationDate = new Date();
  newExpirationDate.setDate(newExpirationDate.getDate() + config.defaultRenewalDays);
  
  console.log(`🔄 Performing ${platform} renewal until: ${newExpirationDate.toISOString()}`);

  try {
    switch (platform) {
      case 'outlook':
        return await renewOutlookSubscription(subscription, newExpirationDate, monitor, supabase);
      
      case 'gmail':
        return await renewGmailSubscription(subscription, newExpirationDate, monitor, supabase);
      
      case 'imap':
        return await renewImapSubscription(subscription, newExpirationDate, monitor, supabase);
      
      default:
        console.error(`❌ Unknown platform for renewal: ${platform}`);
        monitor.recordError({
          errorCode: 'UNKNOWN_PLATFORM',
          errorMessage: `Unknown platform for renewal: ${platform}`,
          storeId: subscription.store.id,
          storeName: subscription.store.name,
          platform: platform,
          severity: 'high',
          isRetryable: false
        });
        return null;
    }
  } catch (error) {
    console.error(`❌ Platform-specific renewal failed for ${platform}:`, error);
    throw error;
  }
}

// PHASE 3: Outlook Graph API renewal
async function renewOutlookSubscription(
  subscription: any,
  newExpirationDate: Date,
  monitor: any,
  supabase: any
): Promise<{ newExpirationDate: string }> {
  console.log(`📧 Renewing Outlook subscription via Microsoft Graph API`);
  
  // Initialize Microsoft Graph client with store's access token
  const graphClient = Client.init({
    authProvider: (done) => {
      done(null, subscription.store.access_token);
    }
  });

  // Renew the subscription via Microsoft Graph API
  await monitor.trackApiCall(
    () => graphClient
      .api(`/subscriptions/${subscription.subscription_id}`)
      .update({
        expirationDateTime: newExpirationDate.toISOString()
      }),
    `Microsoft Graph subscription renewal for ${subscription.store.name}`
  );

  // Update expiration date in our database
  const { error: updateError } = await monitor.trackDbQuery(
    () => supabase
      .from('graph_subscriptions')
      .update({
        expiration_date: newExpirationDate.toISOString(),
        last_renewed: new Date().toISOString()
      })
      .eq('id', subscription.id),
    `Update Outlook subscription expiration in database`
  );

  if (updateError) {
    console.error(`Failed to update Outlook subscription in database:`, updateError);
    throw updateError;
  }

  console.log(`✅ Outlook subscription renewed successfully`);
  return { newExpirationDate: newExpirationDate.toISOString() };
}

// PHASE 3: Gmail Pub/Sub renewal (framework ready)
async function renewGmailSubscription(
  subscription: any,
  newExpirationDate: Date,
  monitor: any,
  supabase: any
): Promise<{ newExpirationDate: string }> {
  console.log(`📧 Renewing Gmail subscription via Google Pub/Sub`);
  
  // NOTE: Gmail Push notifications via Pub/Sub don't have renewable subscriptions
  // They expire after 7 days maximum and need to be recreated
  // This is a framework for when Gmail integration is fully implemented
  
  try {
    // For now, we just update our database record
    // In future Gmail implementation, this would call Google's Pub/Sub API
    const { error: updateError } = await monitor.trackDbQuery(
      () => supabase
        .from('graph_subscriptions')
        .update({
          expiration_date: newExpirationDate.toISOString(),
          last_renewed: new Date().toISOString()
        })
        .eq('id', subscription.id),
      `Update Gmail subscription expiration in database`
    );

    if (updateError) {
      console.error(`Failed to update Gmail subscription in database:`, updateError);
      throw updateError;
    }

    console.log(`✅ Gmail subscription framework renewed (awaiting full Gmail implementation)`);
    return { newExpirationDate: newExpirationDate.toISOString() };
    
  } catch (error) {
    console.error(`❌ Gmail subscription renewal failed:`, error);
    throw error;
  }
}

// PHASE 3: IMAP renewal (simpler, no external API calls)
async function renewImapSubscription(
  subscription: any,
  newExpirationDate: Date,
  monitor: any,
  supabase: any
): Promise<{ newExpirationDate: string }> {
  console.log(`📧 Renewing IMAP subscription (polling-based)`);
  
  // IMAP doesn't have real subscriptions, just update our polling schedule
  const { error: updateError } = await monitor.trackDbQuery(
    () => supabase
      .from('graph_subscriptions')
      .update({
        expiration_date: newExpirationDate.toISOString(),
        last_renewed: new Date().toISOString()
      })
      .eq('id', subscription.id),
    `Update IMAP subscription schedule in database`
  );

  if (updateError) {
    console.error(`Failed to update IMAP subscription in database:`, updateError);
    throw updateError;
  }

  console.log(`✅ IMAP subscription renewed successfully (polling schedule updated)`);
  return { newExpirationDate: newExpirationDate.toISOString() };
}

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

  const monitor = new JobMonitor('Microsoft Graph Subscription Renewal', 'renew_subscriptions', supabase);

  try {

    // Get subscriptions expiring in the next 24 hours
    // ONLY for connected, server-side OAuth stores
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log(`Finding subscriptions expiring before: ${tomorrow.toISOString()}`);

    // PHASE 3: Enhanced multi-platform subscription query
    const { data: subscriptions, error: subError } = await monitor.trackDbQuery(
      () => supabase
        .from('graph_subscriptions')
        .select(`
          *,
          store:stores!inner (*)
        `)
        .eq('store.connected', true)              // CRITICAL: Only connected stores
        .eq('store.oauth_method', 'server_side')  // CRITICAL: Only server OAuth (not MSAL popup)
        .in('store.platform', ['outlook', 'gmail', 'imap'])  // PHASE 3: Multi-platform support
        .not('store.access_token', 'is', null)   // PHASE 3: Ensure valid tokens exist
        .lt('expiration_date', tomorrow.toISOString()),
      `Query expiring subscriptions for connected OAuth stores (multi-platform)`
    );

    if (subError) {
      console.error('Error querying expiring subscriptions:', subError);
      throw subError;
    }

    console.log(`Found ${subscriptions.length} subscriptions to renew for connected OAuth stores`);
    
    // PHASE 3: Enhanced subscription analysis
    const platformBreakdown = subscriptions.reduce((acc, sub) => {
      acc[sub.store.platform] = (acc[sub.store.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log(`📊 Platform breakdown:`, platformBreakdown);
    
    // Log details for debugging
    subscriptions.forEach(sub => {
      console.log(`Expiring subscription: ${sub.store.name} (${sub.store.platform}, expires: ${sub.expiration_date})`);
    });

    // Process each eligible subscription
    const renewalResults = [];
    
    for (const subscription of subscriptions) {
      const subscriptionStartTime = performance.now();
      
      try {
        console.log(`=== RENEWING SUBSCRIPTION: ${subscription.subscription_id} ===`);
        console.log(`Store: ${subscription.store.name} (${subscription.store.platform})`);

        // PHASE 3: Enhanced Token Validation & Auto-Refresh
        if (!subscription.store.access_token) {
          console.error(`No access token for store ${subscription.store.id} - cannot renew subscription`);
          monitor.recordStoreResult({
            storeId: subscription.store.id,
            storeName: subscription.store.name,
            platform: subscription.store.platform,
            status: 'failed',
            processingTimeMs: 0,
            errorCode: 'NO_ACCESS_TOKEN',
            errorMessage: 'No access token available',
            subscriptionId: subscription.subscription_id,
            subscriptionRenewed: false,
            actionsTaken: ['skipped_no_token']
          });
          renewalResults.push({
            subscriptionId: subscription.subscription_id,
            storeName: subscription.store.name,
            success: false,
            error: 'No access token available'
          });
          continue;
        }

        // PHASE 3: Pre-renewal token validation
        const tokenExpiresAt = subscription.store.token_expires_at ? new Date(subscription.store.token_expires_at) : null;
        const now = new Date();
        const tokenExpiredOrExpiringSoon = tokenExpiresAt && tokenExpiresAt <= new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes buffer

        if (tokenExpiredOrExpiringSoon) {
          console.log(`🔄 Token expired/expiring for store ${subscription.store.id} - triggering refresh...`);
          
          try {
            // Call the refresh tokens function to get a fresh token
            const refreshResponse = await monitor.trackApiCall(
              () => fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-tokens`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  storeId: subscription.store.id
                })
              }),
              `Token refresh for store ${subscription.store.name} before subscription renewal`
            );

            if (!refreshResponse.ok) {
              const errorText = await refreshResponse.text();
              throw new Error(`Token refresh failed: ${errorText}`);
            }

            const refreshResult = await refreshResponse.json();
            console.log(`✅ Token refresh successful for store ${subscription.store.id}`);

            // Get the updated store data with fresh token
            const { data: updatedStore, error: storeError } = await monitor.trackDbQuery(
              () => supabase
                .from('stores')
                .select('*')
                .eq('id', subscription.store.id)
                .single(),
              `Fetch updated store data after token refresh`
            );

            if (storeError || !updatedStore) {
              throw new Error(`Failed to get updated store data: ${storeError?.message}`);
            }

            // Update the subscription object with fresh token
            subscription.store = updatedStore;
            console.log(`🔄 Updated store data with fresh token (expires: ${updatedStore.token_expires_at})`);

          } catch (tokenRefreshError) {
            console.error(`❌ Failed to refresh token for store ${subscription.store.id}:`, tokenRefreshError);
            
            monitor.recordError({
              errorCode: 'TOKEN_REFRESH_FAILED',
              errorMessage: tokenRefreshError.message,
              storeId: subscription.store.id,
              storeName: subscription.store.name,
              platform: subscription.store.platform,
              severity: 'high',
              isRetryable: true
            });

            monitor.recordStoreResult({
              storeId: subscription.store.id,
              storeName: subscription.store.name,
              platform: subscription.store.platform,
              status: 'failed',
              processingTimeMs: 0,
              errorCode: 'TOKEN_REFRESH_FAILED',
              errorMessage: `Failed to refresh token: ${tokenRefreshError.message}`,
              subscriptionId: subscription.subscription_id,
              subscriptionRenewed: false,
              actionsTaken: ['attempted_token_refresh', 'token_refresh_failed']
            });

            renewalResults.push({
              subscriptionId: subscription.subscription_id,
              storeName: subscription.store.name,
              success: false,
              error: `Token refresh failed: ${tokenRefreshError.message}`,
              errorCode: 'TOKEN_REFRESH_FAILED'
            });
            continue;
          }
        } else {
          console.log(`✅ Token valid for store ${subscription.store.id} (expires: ${tokenExpiresAt?.toISOString()})`);
        }

        // PHASE 3: Enhanced platform-specific configuration with Gmail support
        console.log(`🔧 Configuring platform-specific renewal for: ${subscription.store.platform}`);
        
        const config = SUBSCRIPTION_CONFIGS[subscription.store.platform];
        if (!config) {
          console.error(`❌ No subscription config for platform: ${subscription.store.platform}`);
          
          monitor.recordStoreResult({
            storeId: subscription.store.id,
            storeName: subscription.store.name,
            platform: subscription.store.platform,
            status: 'failed',
            processingTimeMs: performance.now() - subscriptionStartTime,
            errorCode: 'UNSUPPORTED_PLATFORM',
            errorMessage: `No subscription config for platform: ${subscription.store.platform}`,
            subscriptionId: subscription.subscription_id,
            subscriptionRenewed: false,
            actionsTaken: ['platform_config_missing']
          });
          
          renewalResults.push({
            subscriptionId: subscription.subscription_id,
            storeName: subscription.store.name,
            success: false,
            error: `No subscription config for platform: ${subscription.store.platform}`,
            errorCode: 'UNSUPPORTED_PLATFORM',
            processingTimeMs: performance.now() - subscriptionStartTime
          });
          continue;
        }
        
        console.log(`✅ Platform config loaded: ${config.platform}, renewal period: ${config.defaultRenewalDays} days`);

        // PHASE 3: Platform-specific renewal routing
        const renewalSuccess = await performPlatformSpecificRenewal(
          subscription,
          config,
          monitor,
          subscriptionStartTime,
          supabase
        );

        if (renewalSuccess) {
          console.log(`✅ Successfully renewed subscription: ${subscription.subscription_id}`);
          
          // PHASE 3: Enhanced monitoring for successful renewal
          monitor.recordStoreResult({
            storeId: subscription.store.id,
            storeName: subscription.store.name,
            platform: subscription.store.platform,
            status: 'success',
            processingTimeMs: performance.now() - subscriptionStartTime,
            subscriptionId: subscription.subscription_id,
            subscriptionRenewed: true,
            actionsTaken: [
              'token_validated',
              'platform_specific_renewal',
              'subscription_renewed',
              'expiration_updated'
            ]
          });
          
          renewalResults.push({
            subscriptionId: subscription.subscription_id,
            storeName: subscription.store.name,
            platform: subscription.store.platform,
            success: true,
            newExpirationDate: renewalSuccess.newExpirationDate,
            processingTimeMs: performance.now() - subscriptionStartTime
          });
        } else {
          throw new Error('Platform-specific renewal failed');
        }

        // Platform-specific renewal logic has been moved to performPlatformSpecificRenewal function

      } catch (error) {
        console.error(`❌ Error renewing subscription ${subscription.subscription_id}:`, error);

        // PHASE 3: Advanced error recovery with retry mechanisms
        const retryHandler = new SubscriptionRetryHandler();
        const recoveryStrategy = await ErrorRecoveryStrategies.handleSubscriptionError(
          error,
          subscription.store
        );

        console.error(`🔧 Recovery strategy: ${recoveryStrategy.action}`);

        monitor.recordError({
          errorCode: error.statusCode === 401 ? 'TOKEN_EXPIRED' : 'SUBSCRIPTION_RENEWAL_ERROR',
          errorMessage: error.message,
          storeId: subscription.store.id,
          storeName: subscription.store.name,
          platform: subscription.store.platform,
          severity: error.statusCode === 401 ? 'high' : 'medium',
          isRetryable: recoveryStrategy.shouldRetry
        });

        // Handle token-related errors (401 - Unauthorized)
        if (error.statusCode === 401 || recoveryStrategy.action.includes('unauthorized')) {
          console.error(`🚨 Access token expired for store ${subscription.store.id} - attempting recovery`);
          
          // Try to refresh token one more time as a recovery strategy
          try {
            console.log(`🔄 Attempting emergency token refresh for store ${subscription.store.id}`);
            
            const emergencyRefreshResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-tokens`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                storeId: subscription.store.id
              })
            });

            if (emergencyRefreshResponse.ok) {
              console.log(`✅ Emergency token refresh successful - store remains connected`);
              
              monitor.recordStoreResult({
                storeId: subscription.store.id,
                storeName: subscription.store.name,
                platform: subscription.store.platform,
                status: 'failed',
                processingTimeMs: performance.now() - subscriptionStartTime,
                errorCode: 'SUBSCRIPTION_FAILED_TOKEN_RECOVERED',
                errorMessage: 'Subscription renewal failed but token was recovered',
                subscriptionId: subscription.subscription_id,
                subscriptionRenewed: false,
                actionsTaken: ['subscription_failed', 'emergency_token_refresh', 'token_recovered']
              });

              // Update store status but keep connected
              await supabase
                .from('stores')
                .update({ 
                  status: 'issue',  // Mark as having issues but don't disconnect
                  token_last_refreshed: new Date().toISOString()
                })
                .eq('id', subscription.store.id);

              renewalResults.push({
                subscriptionId: subscription.subscription_id,
                storeName: subscription.store.name,
                success: false,
                error: 'Subscription renewal failed but token recovered',
                errorCode: 'SUBSCRIPTION_FAILED_TOKEN_RECOVERED',
                processingTimeMs: performance.now() - subscriptionStartTime
              });
            } else {
              throw new Error('Emergency token refresh also failed');
            }
          } catch (emergencyError) {
            console.error(`❌ Emergency token refresh failed - disconnecting store ${subscription.store.id}`);
            
            // Mark store as disconnected only if emergency refresh also fails
            await supabase
              .from('stores')
              .update({ 
                status: 'issue',
                connected: false,  // Disconnect store with permanently invalid token
                token_last_refreshed: new Date().toISOString()
              })
              .eq('id', subscription.store.id);

            monitor.recordStoreResult({
              storeId: subscription.store.id,
              storeName: subscription.store.name,
              platform: subscription.store.platform,
              status: 'failed',
              processingTimeMs: performance.now() - subscriptionStartTime,
              errorCode: 'TOKEN_PERMANENTLY_EXPIRED',
              errorMessage: 'Access token permanently expired - store disconnected',
              subscriptionId: subscription.subscription_id,
              subscriptionRenewed: false,
              actionsTaken: ['subscription_failed', 'emergency_token_refresh_failed', 'store_disconnected']
            });

            renewalResults.push({
              subscriptionId: subscription.subscription_id,
              storeName: subscription.store.name,
              success: false,
              error: 'Access token permanently expired - store disconnected',
              errorCode: 'TOKEN_PERMANENTLY_EXPIRED',
              processingTimeMs: performance.now() - subscriptionStartTime
            });
          }
        } else if (recoveryStrategy.skipStore) {
          // Skip this store (e.g., subscription not found)
          console.log(`⏭️  Skipping store ${subscription.store.id} based on recovery strategy`);
          
          monitor.recordStoreResult({
            storeId: subscription.store.id,
            storeName: subscription.store.name,
            platform: subscription.store.platform,
            status: 'skipped',
            processingTimeMs: performance.now() - subscriptionStartTime,
            errorCode: 'STORE_SKIPPED',
            errorMessage: `Store skipped: ${recoveryStrategy.action}`,
            subscriptionId: subscription.subscription_id,
            subscriptionRenewed: false,
            actionsTaken: ['store_skipped', recoveryStrategy.action]
          });

          renewalResults.push({
            subscriptionId: subscription.subscription_id,
            storeName: subscription.store.name,
            success: false,
            error: `Store skipped: ${recoveryStrategy.action}`,
            errorCode: 'STORE_SKIPPED',
            processingTimeMs: performance.now() - subscriptionStartTime
          });
        } else {
          // Other errors - don't disconnect, just mark as having issues
          await supabase
            .from('stores')
            .update({ 
              status: 'issue'
            })
            .eq('id', subscription.store.id);

          monitor.recordStoreResult({
            storeId: subscription.store.id,
            storeName: subscription.store.name,
            platform: subscription.store.platform,
            status: 'failed',
            processingTimeMs: performance.now() - subscriptionStartTime,
            errorCode: 'SUBSCRIPTION_RENEWAL_ERROR',
            errorMessage: error.message,
            subscriptionId: subscription.subscription_id,
            subscriptionRenewed: false,
            actionsTaken: ['subscription_renewal_failed', 'marked_as_issue']
          });

          renewalResults.push({
            subscriptionId: subscription.subscription_id,
            storeName: subscription.store.name,
            success: false,
            error: error.message,
            errorCode: 'SUBSCRIPTION_RENEWAL_ERROR',
            processingTimeMs: performance.now() - subscriptionStartTime
          });
        }
      }
    }

    // PHASE 3: Enhanced renewal summary with monitoring integration
    const summary = monitor.generateJobSummary();
    const successful = renewalResults.filter(r => r.success);
    const failed = renewalResults.filter(r => !r.success);
    
    console.log(`\n=== PHASE 3: SUBSCRIPTION RENEWAL SUMMARY ===`);
    console.log(`Total subscriptions processed: ${renewalResults.length}`);
    console.log(`Successful renewals: ${successful.length}`);
    console.log(`Failed renewals: ${failed.length}`);
    console.log(`📊 Platform success rates:`, Object.keys(platformBreakdown).map(platform => {
      const totalForPlatform = platformBreakdown[platform];
      const successfulForPlatform = successful.filter(r => r.platform === platform).length;
      return `${platform}: ${successfulForPlatform}/${totalForPlatform} (${Math.round((successfulForPlatform/totalForPlatform)*100)}%)`;
    }).join(', '));
    console.log(`⚡ Performance: ${summary.averageProcessingTimeMs.toFixed(2)}ms avg, ${summary.totalProcessingTimeMs.toFixed(2)}ms total`);
    
    if (successful.length > 0) {
      console.log(`✅ Successfully renewed subscriptions for:`, successful.map(s => s.storeName));
    }
    
    if (failed.length > 0) {
      console.log(`❌ Failed to renew subscriptions for:`, failed.map(f => `${f.storeName}: ${f.error}`));
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Phase 3 Complete: Processed ${renewalResults.length} subscription renewals across ${Object.keys(platformBreakdown).length} platforms`,
        processed: renewalResults.length,
        renewed: successful.length,
        failed: failed.length,
        results: renewalResults,
        summary: {
          platformBreakdown,
          successRateByPlatform: Object.keys(platformBreakdown).reduce((acc, platform) => {
            const totalForPlatform = platformBreakdown[platform];
            const successfulForPlatform = successful.filter(r => r.platform === platform).length;
            acc[platform] = Math.round((successfulForPlatform/totalForPlatform)*100);
            return acc;
          }, {} as Record<string, number>),
          performance: {
            averageProcessingTimeMs: summary.averageProcessingTimeMs,
            totalProcessingTimeMs: summary.totalProcessingTimeMs
          }
        },
        monitoring: summary
      }),
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