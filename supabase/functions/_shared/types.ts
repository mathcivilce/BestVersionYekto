// Enhanced Type Definitions for Synthetic Attachment Support
// Phase 1: Foundation Types

// Base email record interface
export interface EmailRecord {
  id: string;
  content: string;
  graph_id?: string;
  has_attachments?: boolean;
  attachment_reference_count?: number;
  subject?: string;
  created_at?: string;
  [key: string]: any;
}

// Enhanced email record with orphaned CID detection
export interface OrphanedEmailRecord extends EmailRecord {
  orphanedCids: string[];
  orphanDetectedAt: Date;
}

// Synthetic attachment creation result
export interface SyntheticAttachmentResult {
  emailId: string;
  syntheticAttachments: AttachmentMetadata[];
  orphanedCids: string[];
  processed: boolean;
  error?: string;
}

// Batch processing result for orphaned CIDs
export interface OrphanedCidBatchResult {
  totalEmails: number;
  orphanedEmails: number;
  syntheticAttachmentsCreated: number;
  errors: Array<{
    emailId: string;
    error: string;
  }>;
  processingTimeMs: number;
}

// Enhanced attachment metadata for sync operations
export interface AttachmentMetadata {
  filename: string;
  contentType: string;
  fileSize: number;
  contentId?: string;
  isInline: boolean;
  providerAttachmentId: string;
  providerType: 'outlook' | 'gmail' | 'imap';
  checksum?: string;
  providerMetadata?: Record<string, any>;
  // Synthetic attachment fields
  synthetic?: boolean;
  originalMessageId?: string;
  orphanedCidDetectedAt?: Date;
}

// CID detection statistics
export interface CidDetectionStats {
  totalEmails: number;
  emailsWithCids: number;
  emailsWithAttachments: number;
  orphanedCidEmails: number;
  totalCidsDetected: number;
  totalOrphanedCids: number;
  detectionTimeMs: number;
}

// Provider resolution strategy result
export interface ResolutionStrategyResult {
  strategy: 'cid_match' | 'filename_pattern' | 'inline_index' | 'placeholder';
  success: boolean;
  attachmentId?: string;
  filename?: string;
  contentType?: string;
  error?: string;
  attemptTimeMs: number;
}

// Multi-strategy attachment resolution result
export interface MultiStrategyResolutionResult {
  syntheticId: string;
  resolved: boolean;
  finalStrategy: string;
  attemptedStrategies: ResolutionStrategyResult[];
  attachment?: any;
  totalResolutionTimeMs: number;
}

// Enhanced provider health with synthetic capability
export interface EnhancedProviderHealth {
  providerId: string;
  status: 'healthy' | 'degraded' | 'down';
  responseTimeMs: number;
  syntheticCapable: boolean;
  lastSyntheticResolution?: Date;
  syntheticSuccessRate?: number;
  errorMessage?: string;
}

// Orphaned CID detection configuration
export interface OrphanDetectionConfig {
  enabled: boolean;
  batchSize: number;
  maxRetries: number;
  backoffMultiplier: number;
  resolutionStrategies: string[];
  placeholderFallback: boolean;
}

// Real-time monitoring stats for synthetic operations
export interface SyntheticOperationStats {
  sessionId: string;
  operation: 'detection' | 'creation' | 'resolution';
  startTime: Date;
  endTime?: Date;
  emailsProcessed: number;
  syntheticAttachmentsCreated: number;
  resolutionAttempts: number;
  successfulResolutions: number;
  errors: number;
  averageResolutionTimeMs: number;
}

// Configuration for sync-specific email processing
export interface SyncEmailProcessingConfig {
  orphanDetection: OrphanDetectionConfig;
  syntheticAttachments: {
    enabled: boolean;
    maxAttachmentsPerEmail: number;
    defaultContentType: string;
    filenameTemplate: string;
  };
  resolutionStrategies: {
    cidMatch: { enabled: boolean; timeout: number };
    filenamePattern: { enabled: boolean; timeout: number };
    inlineIndex: { enabled: boolean; timeout: number };
    placeholder: { enabled: boolean };
  };
  monitoring: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    enableMetrics: boolean;
    enableTracing: boolean;
  };
}

// Backwards compatibility types from original email-providers.ts
export interface AttachmentContent {
  data: Uint8Array;
  contentType: string;
  filename: string;
}

export interface ProviderHealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  responseTimeMs: number;
  errorMessage?: string;
} 