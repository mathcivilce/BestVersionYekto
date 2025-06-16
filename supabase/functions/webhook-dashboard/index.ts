/**
 * Webhook Dashboard Edge Function
 * 
 * Provides comprehensive monitoring and analytics for webhook operations.
 * This dashboard gives insights into webhook performance, error patterns,
 * cleanup activities, and overall system health.
 * 
 * Features:
 * - Real-time webhook performance metrics
 * - Error analysis and trending
 * - Cleanup activity monitoring
 * - Subscription health overview
 * - Performance optimization insights
 * 
 * Metrics Provided:
 * - Success/failure rates
 * - Processing time statistics
 * - Error categorization
 * - Cleanup effectiveness
 * - Subscription lifecycle tracking
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DashboardMetrics {
  overview: {
    totalWebhooks: number;
    successRate: number;
    averageProcessingTime: number;
    activeSubscriptions: number;
    errorCount: number;
    cleanupActivities: number;
  };
  performance: {
    hourlyStats: any[];
    processingTimeDistribution: any[];
    slowestWebhooks: any[];
  };
  errors: {
    errorsByType: any[];
    recentErrors: any[];
    unresolvedErrors: number;
    topErrorStores: any[];
  };
  cleanup: {
    recentCleanups: any[];
    cleanupSuccess: number;
    orphanedSubscriptionsFound: number;
  };
  subscriptions: {
    activeSubscriptions: any[];
    expiringSubscriptions: any[];
    subscriptionHealth: any[];
  };
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get user from authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Initialize Supabase client with user context
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          headers: {
            authorization: authHeader
          }
        }
      }
    );

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Generating webhook dashboard for user:', user.id);

    // Time ranges for analysis
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get user's stores for filtering
    const { data: userStores } = await supabase
      .from('stores')
      .select('id')
      .eq('user_id', user.id);

    const storeIds = userStores?.map(s => s.id) || [];

    if (storeIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No stores found',
          metrics: null
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // === OVERVIEW METRICS ===
    
    // Total webhooks processed (last 24 hours)
    const { count: totalWebhooks } = await supabase
      .from('webhook_metrics')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .gte('timestamp', last24Hours.toISOString());

    // Success rate
    const { count: successfulWebhooks } = await supabase
      .from('webhook_metrics')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .eq('success', true)
      .gte('timestamp', last24Hours.toISOString());

    const successRate = totalWebhooks > 0 ? (successfulWebhooks / totalWebhooks) * 100 : 100;

    // Average processing time
    const { data: processingTimes } = await supabase
      .from('webhook_metrics')
      .select('processing_time_ms')
      .in('store_id', storeIds)
      .eq('success', true)
      .gte('timestamp', last24Hours.toISOString());

    const averageProcessingTime = processingTimes?.length > 0 
      ? processingTimes.reduce((sum, m) => sum + m.processing_time_ms, 0) / processingTimes.length
      : 0;

    // Active subscriptions
    const { count: activeSubscriptions } = await supabase
      .from('graph_subscriptions')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds);

    // Error count (last 24 hours)
    const { count: errorCount } = await supabase
      .from('webhook_errors')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .gte('timestamp', last24Hours.toISOString());

    // Cleanup activities (last 7 days)
    const { count: cleanupActivities } = await supabase
      .from('webhook_cleanup_log')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .gte('timestamp', last7Days.toISOString());

    // === PERFORMANCE METRICS ===

    // Hourly stats (last 24 hours)
    const { data: hourlyStats } = await supabase
      .from('webhook_metrics')
      .select('timestamp, success, processing_time_ms')
      .in('store_id', storeIds)
      .gte('timestamp', last24Hours.toISOString())
      .order('timestamp');

    // Processing time distribution
    const { data: processingTimeDistribution } = await supabase
      .from('webhook_metrics')
      .select('processing_time_ms')
      .in('store_id', storeIds)
      .eq('success', true)
      .gte('timestamp', last7Days.toISOString())
      .order('processing_time_ms');

    // Slowest webhooks
    const { data: slowestWebhooks } = await supabase
      .from('webhook_metrics')
      .select('subscription_id, store_id, processing_time_ms, timestamp')
      .in('store_id', storeIds)
      .eq('success', true)
      .gte('timestamp', last7Days.toISOString())
      .order('processing_time_ms', { ascending: false })
      .limit(10);

    // === ERROR ANALYSIS ===

    // Errors by type
    const { data: errorsByType } = await supabase
      .from('webhook_errors')
      .select('error_type')
      .in('store_id', storeIds)
      .gte('timestamp', last7Days.toISOString());

    // Recent errors
    const { data: recentErrors } = await supabase
      .from('webhook_errors')
      .select('*')
      .in('store_id', storeIds)
      .order('timestamp', { ascending: false })
      .limit(20);

    // Unresolved errors
    const { count: unresolvedErrors } = await supabase
      .from('webhook_errors')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .eq('resolved', false);

    // Top error stores
    const { data: topErrorStores } = await supabase
      .from('webhook_errors')
      .select('store_id')
      .in('store_id', storeIds)
      .gte('timestamp', last7Days.toISOString());

    // === CLEANUP ANALYSIS ===

    // Recent cleanups
    const { data: recentCleanups } = await supabase
      .from('webhook_cleanup_log')
      .select('*')
      .in('store_id', storeIds)
      .order('timestamp', { ascending: false })
      .limit(20);

    // Cleanup success rate
    const { count: totalCleanups } = await supabase
      .from('webhook_cleanup_log')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .gte('timestamp', last7Days.toISOString());

    const { count: successfulCleanups } = await supabase
      .from('webhook_cleanup_log')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .neq('action', 'auto_cleanup_failed')
      .gte('timestamp', last7Days.toISOString());

    const cleanupSuccess = totalCleanups > 0 ? (successfulCleanups / totalCleanups) * 100 : 100;

    // Orphaned subscriptions found
    const { count: orphanedSubscriptionsFound } = await supabase
      .from('webhook_cleanup_log')
      .select('*', { count: 'exact', head: true })
      .in('store_id', storeIds)
      .eq('action', 'orphaned_subscription_deleted')
      .gte('timestamp', last7Days.toISOString());

    // === SUBSCRIPTION HEALTH ===

    // Active subscriptions with store details
    const { data: activeSubscriptionsDetails } = await supabase
      .from('graph_subscriptions')
      .select(`
        *,
        stores!inner(name, email, connected, status)
      `)
      .in('store_id', storeIds);

    // Expiring subscriptions (next 24 hours)
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { data: expiringSubscriptions } = await supabase
      .from('graph_subscriptions')
      .select(`
        *,
        stores!inner(name, email)
      `)
      .in('store_id', storeIds)
      .lt('expiration_date', tomorrow.toISOString());

    // Subscription health (recent activity)
    const { data: subscriptionHealth } = await supabase
      .from('webhook_metrics')
      .select('subscription_id, success, timestamp')
      .in('store_id', storeIds)
      .gte('timestamp', last24Hours.toISOString())
      .order('timestamp', { ascending: false });

    // Compile dashboard metrics
    const metrics: DashboardMetrics = {
      overview: {
        totalWebhooks: totalWebhooks || 0,
        successRate: Math.round(successRate * 100) / 100,
        averageProcessingTime: Math.round(averageProcessingTime),
        activeSubscriptions: activeSubscriptions || 0,
        errorCount: errorCount || 0,
        cleanupActivities: cleanupActivities || 0
      },
      performance: {
        hourlyStats: hourlyStats || [],
        processingTimeDistribution: processingTimeDistribution || [],
        slowestWebhooks: slowestWebhooks || []
      },
      errors: {
        errorsByType: errorsByType || [],
        recentErrors: recentErrors || [],
        unresolvedErrors: unresolvedErrors || 0,
        topErrorStores: topErrorStores || []
      },
      cleanup: {
        recentCleanups: recentCleanups || [],
        cleanupSuccess: Math.round(cleanupSuccess * 100) / 100,
        orphanedSubscriptionsFound: orphanedSubscriptionsFound || 0
      },
      subscriptions: {
        activeSubscriptions: activeSubscriptionsDetails || [],
        expiringSubscriptions: expiringSubscriptions || [],
        subscriptionHealth: subscriptionHealth || []
      }
    };

    console.log('Dashboard metrics generated successfully');

    return new Response(JSON.stringify(metrics), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Dashboard generation failed',
        details: error.message
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
}); 