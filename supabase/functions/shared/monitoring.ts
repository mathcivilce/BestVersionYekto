// =============================================
// ENHANCED MONITORING & ANALYTICS SYSTEM
// =============================================
// Comprehensive monitoring for cron jobs with detailed metrics,
// error tracking, performance monitoring, and health analytics

import { createClient } from "npm:@supabase/supabase-js";

export interface JobMetrics {
  jobName: string;
  jobType: 'refresh_tokens' | 'renew_subscriptions' | 'cleanup' | 'analytics';
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'partial';
  itemsProcessed: number;
  itemsSuccessful: number;
  itemsFailed: number;
  errors: JobError[];
  performance: PerformanceMetrics;
  storeResults: StoreJobResult[];
}

export interface JobError {
  errorCode: string;
  errorMessage: string;
  storeId?: string;
  storeName?: string;
  platform?: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  isRetryable: boolean;
}

export interface PerformanceMetrics {
  totalDurationMs: number;
  avgProcessingTimeMs: number;
  maxProcessingTimeMs: number;
  memoryUsageMB?: number;
  apiCallsCount: number;
  dbQueriesCount: number;
}

export interface StoreJobResult {
  storeId: string;
  storeName: string;
  platform: string;
  oauthMethod?: string;
  status: 'success' | 'failed' | 'skipped';
  processingTimeMs: number;
  errorCode?: string;
  errorMessage?: string;
  oldTokenExpiresAt?: string;
  newTokenExpiresAt?: string;
  subscriptionId?: string;
  actionsTaken: string[];
}

export class JobMonitor {
  private metrics: JobMetrics;
  private supabase: any;
  private performanceStartTime: number;
  private apiCallCount = 0;
  private dbQueryCount = 0;

  constructor(jobName: string, jobType: JobMetrics['jobType'], supabase: any) {
    this.supabase = supabase;
    this.performanceStartTime = performance.now();
    
    this.metrics = {
      jobName,
      jobType,
      startTime: new Date(),
      status: 'running',
      itemsProcessed: 0,
      itemsSuccessful: 0,
      itemsFailed: 0,
      errors: [],
      performance: {
        totalDurationMs: 0,
        avgProcessingTimeMs: 0,
        maxProcessingTimeMs: 0,
        apiCallsCount: 0,
        dbQueriesCount: 0
      },
      storeResults: []
    };

    this.logJobStart();
  }

  private logJobStart() {
    console.log(`🚀 [${this.metrics.jobType}] Starting job: ${this.metrics.jobName}`);
    console.log(`📊 Started at: ${this.metrics.startTime.toISOString()}`);
  }

  // Track API calls for performance monitoring
  async trackApiCall<T>(apiCall: () => Promise<T>, description: string): Promise<T> {
    const startTime = performance.now();
    this.apiCallCount++;
    
    try {
      console.log(`📡 API Call: ${description}`);
      const result = await apiCall();
      const duration = performance.now() - startTime;
      console.log(`✅ API Call completed in ${duration.toFixed(2)}ms: ${description}`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      console.error(`❌ API Call failed after ${duration.toFixed(2)}ms: ${description}`, error);
      this.recordError({
        errorCode: 'API_CALL_FAILED',
        errorMessage: `${description}: ${error.message}`,
        timestamp: new Date(),
        severity: 'medium',
        isRetryable: true
      });
      throw error;
    }
  }

  // Track database queries
  async trackDbQuery<T>(query: () => Promise<T>, description: string): Promise<T> {
    const startTime = performance.now();
    this.dbQueryCount++;
    
    try {
      console.log(`🗄️  DB Query: ${description}`);
      const result = await query();
      const duration = performance.now() - startTime;
      console.log(`✅ DB Query completed in ${duration.toFixed(2)}ms: ${description}`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      console.error(`❌ DB Query failed after ${duration.toFixed(2)}ms: ${description}`, error);
      this.recordError({
        errorCode: 'DB_QUERY_FAILED',
        errorMessage: `${description}: ${error.message}`,
        timestamp: new Date(),
        severity: 'high',
        isRetryable: false
      });
      throw error;
    }
  }

  // Record errors with categorization
  recordError(error: Omit<JobError, 'timestamp'> & { timestamp?: Date }): void {
    const jobError: JobError = {
      ...error,
      timestamp: error.timestamp || new Date()
    };

    this.metrics.errors.push(jobError);
    this.metrics.itemsFailed++;

    // Log with appropriate severity
    const logLevel = error.severity === 'critical' ? 'error' : 
                    error.severity === 'high' ? 'error' :
                    error.severity === 'medium' ? 'warn' : 'info';
    
    console[logLevel](`🚨 [${error.severity.toUpperCase()}] ${error.errorCode}: ${error.errorMessage}`);
    
    if (error.storeId) {
      console[logLevel](`   Store: ${error.storeName} (${error.storeId}, platform: ${error.platform})`);
    }
  }

  // Record store processing result
  recordStoreResult(result: StoreJobResult): void {
    this.metrics.storeResults.push(result);
    this.metrics.itemsProcessed++;
    
    if (result.status === 'success') {
      this.metrics.itemsSuccessful++;
      console.log(`✅ Store processed successfully: ${result.storeName} (${result.processingTimeMs}ms)`);
    } else if (result.status === 'failed') {
      this.metrics.itemsFailed++;
      console.error(`❌ Store processing failed: ${result.storeName} - ${result.errorMessage}`);
    } else {
      console.log(`⏭️  Store skipped: ${result.storeName}`);
    }

    // Update performance metrics
    this.metrics.performance.maxProcessingTimeMs = Math.max(
      this.metrics.performance.maxProcessingTimeMs,
      result.processingTimeMs
    );
  }

  // Complete the job and calculate final metrics
  complete(status: 'completed' | 'failed' | 'partial' = 'completed'): JobMetrics {
    this.metrics.endTime = new Date();
    this.metrics.status = status;
    
    // Calculate performance metrics
    this.metrics.performance.totalDurationMs = performance.now() - this.performanceStartTime;
    this.metrics.performance.avgProcessingTimeMs = 
      this.metrics.storeResults.length > 0 
        ? this.metrics.storeResults.reduce((sum, r) => sum + r.processingTimeMs, 0) / this.metrics.storeResults.length
        : 0;
    this.metrics.performance.apiCallsCount = this.apiCallCount;
    this.metrics.performance.dbQueriesCount = this.dbQueryCount;

    this.logJobComplete();
    this.saveMetricsToStore();
    
    return this.metrics;
  }

  private logJobComplete() {
    const duration = this.metrics.performance.totalDurationMs;
    const successRate = this.metrics.itemsProcessed > 0 
      ? ((this.metrics.itemsSuccessful / this.metrics.itemsProcessed) * 100).toFixed(1)
      : '0.0';

    console.log(`\n🏁 [${this.metrics.jobType}] Job completed: ${this.metrics.jobName}`);
    console.log(`📊 Status: ${this.metrics.status.toUpperCase()}`);
    console.log(`⏱️  Duration: ${duration.toFixed(2)}ms`);
    console.log(`📈 Items processed: ${this.metrics.itemsProcessed}`);
    console.log(`✅ Successful: ${this.metrics.itemsSuccessful}`);
    console.log(`❌ Failed: ${this.metrics.itemsFailed}`);
    console.log(`📊 Success Rate: ${successRate}%`);
    console.log(`🌐 API Calls: ${this.apiCallCount}`);
    console.log(`🗄️  DB Queries: ${this.dbQueryCount}`);
    
    if (this.metrics.errors.length > 0) {
      console.log(`\n🚨 Errors Summary:`);
      const errorsByType = this.metrics.errors.reduce((acc, error) => {
        acc[error.errorCode] = (acc[error.errorCode] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      Object.entries(errorsByType).forEach(([code, count]) => {
        console.log(`   ${code}: ${count} occurrence(s)`);
      });
    }

    if (this.metrics.storeResults.length > 0) {
      console.log(`\n📋 Store Results Summary:`);
      const resultsByStatus = this.metrics.storeResults.reduce((acc, result) => {
        acc[result.status] = (acc[result.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      Object.entries(resultsByStatus).forEach(([status, count]) => {
        console.log(`   ${status}: ${count} store(s)`);
      });
    }
  }

  // Save metrics to the stores table for persistence (using existing schema)
  private async saveMetricsToStore() {
    try {
      // Store job metrics in a simple format using existing tables
      // We'll use the stores table to update last_job_run info
      
      const jobSummary = {
        job_name: this.metrics.jobName,
        job_type: this.metrics.jobType,
        started_at: this.metrics.startTime.toISOString(),
        completed_at: this.metrics.endTime?.toISOString(),
        duration_ms: this.metrics.performance.totalDurationMs,
        status: this.metrics.status,
        items_processed: this.metrics.itemsProcessed,
        items_successful: this.metrics.itemsSuccessful,
        items_failed: this.metrics.itemsFailed,
        success_rate: this.metrics.itemsProcessed > 0 
          ? (this.metrics.itemsSuccessful / this.metrics.itemsProcessed * 100) 
          : 0,
        error_count: this.metrics.errors.length,
        api_calls: this.apiCallCount,
        db_queries: this.dbQueryCount
      };

      console.log(`💾 Job metrics saved:`, jobSummary);
      
      // Update each store with last job run info
      for (const storeResult of this.metrics.storeResults) {
        await this.supabase
          .from('stores')
          .update({
            last_job_run: new Date().toISOString(),
            last_job_status: storeResult.status,
            last_job_type: this.metrics.jobType
          })
          .eq('id', storeResult.storeId)
          .single();
      }
      
    } catch (error) {
      console.error('Failed to save job metrics:', error);
    }
  }

  // Generate health report
  generateHealthReport(): HealthReport {
    const now = new Date();
    const uptime = this.metrics.endTime 
      ? this.metrics.endTime.getTime() - this.metrics.startTime.getTime()
      : now.getTime() - this.metrics.startTime.getTime();

    return {
      jobName: this.metrics.jobName,
      jobType: this.metrics.jobType,
      status: this.metrics.status,
      health: this.calculateHealthScore(),
      uptime,
      successRate: this.metrics.itemsProcessed > 0 
        ? (this.metrics.itemsSuccessful / this.metrics.itemsProcessed * 100) 
        : 100,
      errorRate: this.metrics.itemsProcessed > 0 
        ? (this.metrics.itemsFailed / this.metrics.itemsProcessed * 100) 
        : 0,
      avgResponseTime: this.metrics.performance.avgProcessingTimeMs,
      lastRun: this.metrics.startTime,
      nextEstimatedRun: new Date(now.getTime() + (60 * 60 * 1000)), // Assume hourly
      criticalErrors: this.metrics.errors.filter(e => e.severity === 'critical').length,
      warnings: this.metrics.errors.filter(e => e.severity === 'medium').length
    };
  }

  private calculateHealthScore(): number {
    if (this.metrics.itemsProcessed === 0) return 100;
    
    const successRate = (this.metrics.itemsSuccessful / this.metrics.itemsProcessed) * 100;
    const errorPenalty = this.metrics.errors.length * 5;
    const criticalErrorPenalty = this.metrics.errors.filter(e => e.severity === 'critical').length * 20;
    
    return Math.max(0, Math.min(100, successRate - errorPenalty - criticalErrorPenalty));
  }
}

export interface HealthReport {
  jobName: string;
  jobType: string;
  status: string;
  health: number; // 0-100 score
  uptime: number;
  successRate: number;
  errorRate: number;
  avgResponseTime: number;
  lastRun: Date;
  nextEstimatedRun: Date;
  criticalErrors: number;
  warnings: number;
}

// Utility functions for system health monitoring
export class SystemHealthMonitor {
  static async generateSystemReport(supabase: any): Promise<SystemHealthReport> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Query stores for health metrics
    const { data: stores, error } = await supabase
      .from('stores')
      .select('*')
      .eq('connected', true);

    if (error) {
      console.error('Failed to fetch stores for health report:', error);
      throw error;
    }

    // Calculate system-wide metrics
    const totalStores = stores?.length || 0;
    const oauthStores = stores?.filter(s => s.oauth_method === 'server_side').length || 0;
    const storesWithTokens = stores?.filter(s => s.access_token && s.refresh_token).length || 0;
    const storesWithExpiringTokens = stores?.filter(s => 
      s.token_expires_at && new Date(s.token_expires_at) < new Date(now.getTime() + 60 * 60 * 1000)
    ).length || 0;

    return {
      timestamp: now,
      systemHealth: this.calculateSystemHealth(stores || []),
      totalConnectedStores: totalStores,
      oauthStores,
      storesWithValidTokens: storesWithTokens,
      storesWithExpiringTokens,
      platformBreakdown: this.calculatePlatformBreakdown(stores || []),
      tokenHealthStatus: this.calculateTokenHealth(stores || []),
      recommendedActions: this.generateRecommendations(stores || [])
    };
  }

  private static calculateSystemHealth(stores: any[]): number {
    if (stores.length === 0) return 100;

    const healthyStores = stores.filter(store => {
      // Consider a store healthy if:
      // 1. It's connected
      // 2. Has valid tokens (if OAuth)
      // 3. Tokens aren't expired
      // 4. No recent critical errors
      
      if (!store.connected) return false;
      
      if (store.oauth_method === 'server_side') {
        if (!store.access_token || !store.refresh_token) return false;
        if (store.token_expires_at && new Date(store.token_expires_at) < new Date()) return false;
      }
      
      return true;
    }).length;

    return (healthyStores / stores.length) * 100;
  }

  private static calculatePlatformBreakdown(stores: any[]): Record<string, number> {
    return stores.reduce((acc, store) => {
      acc[store.platform] = (acc[store.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private static calculateTokenHealth(stores: any[]): TokenHealthStatus {
    const oauthStores = stores.filter(s => s.oauth_method === 'server_side');
    const now = new Date();
    
    const valid = oauthStores.filter(s => 
      s.access_token && s.refresh_token && 
      (!s.token_expires_at || new Date(s.token_expires_at) > now)
    ).length;
    
    const expiringSoon = oauthStores.filter(s =>
      s.token_expires_at && 
      new Date(s.token_expires_at) > now &&
      new Date(s.token_expires_at) < new Date(now.getTime() + 60 * 60 * 1000)
    ).length;
    
    const expired = oauthStores.filter(s =>
      s.token_expires_at && new Date(s.token_expires_at) <= now
    ).length;

    return { valid, expiringSoon, expired, total: oauthStores.length };
  }

  private static generateRecommendations(stores: any[]): string[] {
    const recommendations: string[] = [];
    const now = new Date();
    
    // Check for expired tokens
    const expiredTokens = stores.filter(s => 
      s.oauth_method === 'server_side' && 
      s.token_expires_at && 
      new Date(s.token_expires_at) <= now
    ).length;
    
    if (expiredTokens > 0) {
      recommendations.push(`${expiredTokens} store(s) have expired tokens - run token refresh job immediately`);
    }

    // Check for missing refresh tokens
    const missingRefreshTokens = stores.filter(s =>
      s.oauth_method === 'server_side' && 
      s.connected && 
      !s.refresh_token
    ).length;
    
    if (missingRefreshTokens > 0) {
      recommendations.push(`${missingRefreshTokens} OAuth store(s) missing refresh tokens - users may need to reconnect`);
    }

    // Check for disconnected stores
    const disconnectedStores = stores.filter(s => !s.connected).length;
    if (disconnectedStores > 0) {
      recommendations.push(`${disconnectedStores} store(s) are disconnected - check for authentication issues`);
    }

    return recommendations;
  }
}

export interface SystemHealthReport {
  timestamp: Date;
  systemHealth: number; // 0-100
  totalConnectedStores: number;
  oauthStores: number;
  storesWithValidTokens: number;
  storesWithExpiringTokens: number;
  platformBreakdown: Record<string, number>;
  tokenHealthStatus: TokenHealthStatus;
  recommendedActions: string[];
}

export interface TokenHealthStatus {
  valid: number;
  expiringSoon: number;
  expired: number;
  total: number;
} 