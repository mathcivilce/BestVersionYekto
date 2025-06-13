/**
 * Synthetic Attachment Operations Monitoring
 * Phase 1: Foundation Monitoring Infrastructure
 * 
 * Provides comprehensive monitoring, metrics, and logging for synthetic
 * attachment operations including orphaned CID detection, resolution
 * strategies, and performance tracking.
 */

import { 
  SyntheticOperationStats, 
  OrphanedCidBatchResult, 
  ResolutionStrategyResult,
  CidDetectionStats 
} from './types.ts';

export class SyntheticMonitoring {
  private sessionId: string;
  private operationStats: Map<string, SyntheticOperationStats> = new Map();
  private supabaseClient: any;

  constructor(supabaseClient: any) {
    this.sessionId = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.supabaseClient = supabaseClient;
    console.log(`🔍 [SYNC-MONITOR] Initialized monitoring session: ${this.sessionId}`);
  }

  // Start tracking an operation
  startOperation(operation: 'detection' | 'creation' | 'resolution'): string {
    const operationId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const stats: SyntheticOperationStats = {
      sessionId: this.sessionId,
      operation,
      startTime: new Date(),
      emailsProcessed: 0,
      syntheticAttachmentsCreated: 0,
      resolutionAttempts: 0,
      successfulResolutions: 0,
      errors: 0,
      averageResolutionTimeMs: 0
    };

    this.operationStats.set(operationId, stats);
    console.log(`📊 [SYNC-MONITOR] Started ${operation} operation: ${operationId}`);
    
    return operationId;
  }

  // Update operation statistics
  updateOperation(operationId: string, updates: Partial<SyntheticOperationStats>): void {
    const stats = this.operationStats.get(operationId);
    if (!stats) {
      console.warn(`⚠️ [SYNC-MONITOR] Operation ${operationId} not found`);
      return;
    }

    Object.assign(stats, updates);
    this.operationStats.set(operationId, stats);
  }

  // Complete an operation
  completeOperation(operationId: string): SyntheticOperationStats {
    const stats = this.operationStats.get(operationId);
    if (!stats) {
      console.warn(`⚠️ [SYNC-MONITOR] Operation ${operationId} not found`);
      return {} as SyntheticOperationStats;
    }

    stats.endTime = new Date();
    const durationMs = stats.endTime.getTime() - stats.startTime.getTime();
    
    // Calculate average resolution time if there were attempts
    if (stats.resolutionAttempts > 0) {
      stats.averageResolutionTimeMs = durationMs / stats.resolutionAttempts;
    }

    console.log(`✅ [SYNC-MONITOR] Completed ${stats.operation} operation: ${operationId}`, {
      duration: `${durationMs}ms`,
      processed: stats.emailsProcessed,
      created: stats.syntheticAttachmentsCreated,
      resolved: stats.successfulResolutions,
      errors: stats.errors
    });

    return stats;
  }

  // Record orphaned CID detection metrics
  recordCidDetection(stats: CidDetectionStats): void {
    console.log(`🔍 [CID-METRICS] Detection completed:`, {
      emails: `${stats.emailsWithCids}/${stats.totalEmails} with CIDs`,
      orphaned: `${stats.orphanedCidEmails} orphaned`,
      cids: `${stats.totalOrphanedCids} total orphaned CIDs`,
      duration: `${stats.detectionTimeMs}ms`
    });

    // Log detailed breakdown
    console.log(`📊 [CID-BREAKDOWN]`, {
      totalEmails: stats.totalEmails,
      emailsWithCids: stats.emailsWithCids,
      emailsWithAttachments: stats.emailsWithAttachments,
      orphanedEmails: stats.orphanedCidEmails,
      totalCids: stats.totalCidsDetected,
      orphanedCids: stats.totalOrphanedCids,
      orphanPercentage: stats.totalEmails > 0 ? 
        `${((stats.orphanedCidEmails / stats.totalEmails) * 100).toFixed(1)}%` : '0%'
    });
  }

  // Record batch processing results
  recordBatchResult(result: OrphanedCidBatchResult): void {
    console.log(`📦 [BATCH-RESULT] Processed orphaned CID batch:`, {
      emails: `${result.orphanedEmails}/${result.totalEmails}`,
      attachments: result.syntheticAttachmentsCreated,
      errors: result.errors.length,
      duration: `${result.processingTimeMs}ms`
    });

    if (result.errors.length > 0) {
      console.error(`🚫 [BATCH-ERRORS] ${result.errors.length} errors during batch processing:`, 
        result.errors.map(e => ({ email: e.emailId, error: e.error }))
      );
    }
  }

  // Record resolution strategy results
  recordResolutionStrategy(result: ResolutionStrategyResult): void {
    const status = result.success ? '✅' : '❌';
    console.log(`🎯 [RESOLUTION] ${status} Strategy "${result.strategy}" (${result.attemptTimeMs}ms):`, {
      success: result.success,
      attachment: result.attachmentId,
      filename: result.filename,
      contentType: result.contentType,
      error: result.error
    });
  }

  // Get current session statistics
  getSessionStats(): any {
    const operations = Array.from(this.operationStats.values());
    
    const summary = {
      sessionId: this.sessionId,
      totalOperations: operations.length,
      totalEmailsProcessed: operations.reduce((sum, op) => sum + op.emailsProcessed, 0),
      totalSyntheticAttachments: operations.reduce((sum, op) => sum + op.syntheticAttachmentsCreated, 0),
      totalResolutionAttempts: operations.reduce((sum, op) => sum + op.resolutionAttempts, 0),
      totalSuccessfulResolutions: operations.reduce((sum, op) => sum + op.successfulResolutions, 0),
      totalErrors: operations.reduce((sum, op) => sum + op.errors, 0),
      operations: operations.map(op => ({
        operation: op.operation,
        duration: op.endTime ? op.endTime.getTime() - op.startTime.getTime() : 'ongoing',
        processed: op.emailsProcessed,
        created: op.syntheticAttachmentsCreated,
        resolved: op.successfulResolutions,
        errors: op.errors
      }))
    };

    return summary;
  }

  // Log session summary
  logSessionSummary(): void {
    const stats = this.getSessionStats();
    
    console.log(`📋 [SESSION-SUMMARY] Synthetic operations session ${this.sessionId}:`, {
      operations: stats.totalOperations,
      emails: stats.totalEmailsProcessed,
      synthetics: stats.totalSyntheticAttachments,
      resolutions: `${stats.totalSuccessfulResolutions}/${stats.totalResolutionAttempts}`,
      errors: stats.totalErrors,
      successRate: stats.totalResolutionAttempts > 0 ? 
        `${((stats.totalSuccessfulResolutions / stats.totalResolutionAttempts) * 100).toFixed(1)}%` : 'N/A'
    });

    // Log operation breakdown
    stats.operations.forEach((op: any) => {
      console.log(`  📝 ${op.operation}: ${op.processed} emails, ${op.created} created, ${op.resolved} resolved (${op.duration})`);
    });
  }

  // Save metrics to database (for future analytics)
  async persistMetrics(): Promise<void> {
    try {
      const stats = this.getSessionStats();
      
      // Store session summary in monitoring table
      const { error } = await this.supabaseClient
        .from('synthetic_operation_logs')
        .insert({
          session_id: this.sessionId,
          total_operations: stats.totalOperations,
          total_emails_processed: stats.totalEmailsProcessed,
          total_synthetic_attachments: stats.totalSyntheticAttachments,
          total_resolution_attempts: stats.totalResolutionAttempts,
          total_successful_resolutions: stats.totalSuccessfulResolutions,
          total_errors: stats.totalErrors,
          operation_details: stats.operations,
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error(`🚫 [MONITOR-PERSIST] Failed to persist metrics:`, error);
      } else {
        console.log(`💾 [MONITOR-PERSIST] Metrics persisted for session ${this.sessionId}`);
      }
    } catch (error) {
      console.error(`🚫 [MONITOR-PERSIST] Error persisting metrics:`, error);
    }
  }

  // Helper method for performance timing
  timeOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    return new Promise(async (resolve, reject) => {
      const startTime = Date.now();
      console.log(`⏱️ [TIMING] Starting ${operationName}`);
      
      try {
        const result = await operation();
        const duration = Date.now() - startTime;
        console.log(`⏱️ [TIMING] Completed ${operationName} in ${duration}ms`);
        resolve(result);
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`⏱️ [TIMING] Failed ${operationName} after ${duration}ms:`, error);
        reject(error);
      }
    });
  }

  // Create alerting for critical issues
  alert(level: 'warning' | 'critical', message: string, metadata?: any): void {
    const prefix = level === 'critical' ? '🚨 [CRITICAL]' : '⚠️ [WARNING]';
    console.log(`${prefix} ${message}`, metadata || {});
    
    // Could integrate with external alerting systems here
    // e.g., Slack, PagerDuty, etc.
  }
}

// Utility functions for metric calculation
export class MetricsCalculator {
  static calculateSuccessRate(successful: number, total: number): number {
    return total > 0 ? (successful / total) * 100 : 0;
  }

  static calculateAverageTime(times: number[]): number {
    if (times.length === 0) return 0;
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  static calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  static formatPercentage(value: number, total: number): string {
    if (total === 0) return '0.0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  }
}

// Global monitoring instance
let globalMonitoringInstance: SyntheticMonitoring | null = null;

export function initializeGlobalMonitoring(supabaseClient: any): SyntheticMonitoring {
  globalMonitoringInstance = new SyntheticMonitoring(supabaseClient);
  return globalMonitoringInstance;
}

export function getGlobalMonitoring(): SyntheticMonitoring | null {
  return globalMonitoringInstance;
} 