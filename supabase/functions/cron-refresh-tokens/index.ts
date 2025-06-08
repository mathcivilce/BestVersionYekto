/**
 * Cron Token Refresh Edge Function
 * 
 * This Deno Edge Function serves as an automated cron job for refreshing
 * expiring OAuth access tokens across all connected email stores. It ensures
 * continuous email synchronization by proactively refreshing tokens before they expire.
 * 
 * Cron Job Functionality:
 * 1. Triggered automatically by Supabase Cron (or external cron service)
 * 2. Calls the refresh-tokens function with bulk refresh flag
 * 3. Processes all stores with expiring tokens
 * 4. Logs success/failure statistics for monitoring
 * 5. Returns summary of refresh operations
 * 
 * Token Refresh Strategy:
 * - Proactive refresh before expiration (prevents service interruption)
 * - Bulk processing of all expiring tokens in single operation
 * - Comprehensive error handling with detailed logging
 * - Service role authentication for system-level operations
 * 
 * Scheduling Considerations:
 * - Should run frequently enough to catch expiring tokens
 * - Recommended schedule: every 30 minutes or hourly
 * - Consider timezone and business hours for optimal scheduling
 * - Monitor execution time to avoid overlapping runs
 * 
 * Monitoring Features:
 * - Detailed logging of refresh statistics
 * - Timestamp tracking for audit trails
 * - Success/failure counts for alerting
 * - Error reporting for debugging
 * 
 * Integration Points:
 * - Called by Supabase Cron or external cron services
 * - Delegates actual refresh logic to refresh-tokens function
 * - Sends alerts/notifications on failures (future enhancement)
 * - Integrates with monitoring and logging systems
 * 
 * Security Features:
 * - Service role authentication for system access
 * - No user-specific data exposure in logs
 * - Secure internal function-to-function communication
 * - Comprehensive error handling without data leakage
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// CORS headers for cross-origin requests (mainly for manual testing)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Starting automatic token refresh cron job...');

    // Call Refresh Tokens Function with Bulk Flag
    // Delegate actual refresh logic to the dedicated refresh-tokens function
    // Using refreshAllExpiring flag to process all stores with expiring tokens
    const refreshResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` // Service role for system operations
      },
      body: JSON.stringify({ refreshAllExpiring: true }) // Flag to refresh all expiring tokens
    });

    // Handle Refresh Function Errors
    if (!refreshResponse.ok) {
      throw new Error(`Refresh request failed: ${refreshResponse.status}`);
    }

    // Parse Refresh Results
    const result = await refreshResponse.json();

    // Log Comprehensive Cron Job Statistics
    console.log(`Cron job completed:`, {
      refreshed: result.refreshed,        // Number of tokens successfully refreshed
      failed: result.failed,              // Number of token refresh failures
      timestamp: new Date().toISOString() // Execution timestamp for audit
    });

    // Return Success Response with Statistics
    // Useful for monitoring systems and manual debugging
    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Refreshed ${result.refreshed} tokens, ${result.failed} failed`,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in cron-refresh-tokens:', error);
    
    // Return Error Response with Timestamp
    // Include timestamp for correlation with monitoring systems
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString() 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
}); 