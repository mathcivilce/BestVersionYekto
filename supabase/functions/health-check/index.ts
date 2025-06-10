import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface HealthCheck {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: { status: string; error?: string; responseTime?: number };
    storage: { status: string; error?: string; responseTime?: number };
    cleanup: { status: string; lastRun?: string; error?: string };
  };
  version: string;
  uptime?: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const healthStatus: HealthCheck = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      services: {
        database: { status: 'unknown' },
        storage: { status: 'unknown' },
        cleanup: { status: 'unknown' },
      },
      version: '1.0.0',
      uptime: Date.now() - startTime,
    };

    // 1. Check Database Connectivity and Performance
    try {
      const dbStartTime = Date.now();
      
      // Test basic database connectivity
      const { data: dbTest, error: dbError } = await supabase
        .from('storage_usage')
        .select('count')
        .limit(1);

      const dbResponseTime = Date.now() - dbStartTime;

      if (dbError) {
        healthStatus.services.database = {
          status: 'unhealthy',
          error: dbError.message,
          responseTime: dbResponseTime,
        };
      } else {
        healthStatus.services.database = {
          status: dbResponseTime > 2000 ? 'degraded' : 'healthy',
          responseTime: dbResponseTime,
        };
      }
    } catch (error) {
      healthStatus.services.database = {
        status: 'unhealthy',
        error: `Database connection failed: ${error.message}`,
      };
    }

    // 2. Check Storage Bucket Health
    try {
      const storageStartTime = Date.now();
      
      // Test storage bucket accessibility
      const { data: storageTest, error: storageError } = await supabase
        .storage
        .from('email-attachments')
        .list('', { limit: 1 });

      const storageResponseTime = Date.now() - storageStartTime;

      if (storageError) {
        healthStatus.services.storage = {
          status: 'unhealthy',
          error: storageError.message,
          responseTime: storageResponseTime,
        };
      } else {
        healthStatus.services.storage = {
          status: storageResponseTime > 3000 ? 'degraded' : 'healthy',
          responseTime: storageResponseTime,
        };
      }
    } catch (error) {
      healthStatus.services.storage = {
        status: 'unhealthy',
        error: `Storage access failed: ${error.message}`,
      };
    }

    // 3. Check Cleanup System Health
    try {
      // Check recent cleanup operations
      const { data: cleanupLogs, error: cleanupError } = await supabase
        .from('cleanup_logs')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(5);

      if (cleanupError) {
        healthStatus.services.cleanup = {
          status: 'unhealthy',
          error: cleanupError.message,
        };
      } else {
        const recentLogs = cleanupLogs || [];
        const lastRun = recentLogs[0]?.executed_at;
        const lastRunTime = lastRun ? new Date(lastRun).getTime() : 0;
        const hoursSinceLastRun = (Date.now() - lastRunTime) / (1000 * 60 * 60);

        // Check if cleanup has run recently (within 48 hours)
        let cleanupStatus = 'healthy';
        if (hoursSinceLastRun > 48) {
          cleanupStatus = 'degraded';
        }
        if (hoursSinceLastRun > 72) {
          cleanupStatus = 'unhealthy';
        }

        // Check for recent failures
        const recentFailures = recentLogs.filter(log => !log.success).length;
        if (recentFailures >= 3) {
          cleanupStatus = 'unhealthy';
        } else if (recentFailures >= 1) {
          cleanupStatus = 'degraded';
        }

        healthStatus.services.cleanup = {
          status: cleanupStatus,
          lastRun: lastRun,
          error: recentFailures > 0 ? `${recentFailures} recent failures detected` : undefined,
        };
      }
    } catch (error) {
      healthStatus.services.cleanup = {
        status: 'unhealthy',
        error: `Cleanup system check failed: ${error.message}`,
      };
    }

    // 4. Determine Overall Health Status
    const serviceStatuses = Object.values(healthStatus.services).map(s => s.status);
    
    if (serviceStatuses.every(status => status === 'healthy')) {
      healthStatus.status = 'healthy';
    } else if (serviceStatuses.some(status => status === 'unhealthy')) {
      healthStatus.status = 'unhealthy';
    } else {
      healthStatus.status = 'degraded';
    }

    // 5. Add Additional Metrics
    healthStatus.uptime = Date.now() - startTime;

    // Log health check (optional, for monitoring)
    if (Deno.env.get('LOG_LEVEL') === 'debug') {
      console.log('Health Check Results:', {
        status: healthStatus.status,
        timestamp: healthStatus.timestamp,
        responseTime: healthStatus.uptime,
        services: healthStatus.services,
      });
    }

    // Return health status with appropriate HTTP status code
    const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 200 : 503;

    return new Response(
      JSON.stringify(healthStatus, null, 2),
      {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        status: httpStatus,
      }
    );

  } catch (error) {
    // Critical error - return unhealthy status
    const errorResponse = {
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: `Health check failed: ${error.message}`,
      version: '1.0.0',
      uptime: Date.now() - startTime,
    };

    console.error('Health Check Critical Error:', error);

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        status: 500,
      }
    );
  }
}); 