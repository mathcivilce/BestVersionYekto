/**
 * Synthetic Attachment Processor
 * Phase 2: Core Synthetic Logic
 * 
 * Handles the creation, validation, and persistence of synthetic attachments
 * for orphaned CIDs found during email sync operations.
 */

import { 
  AttachmentMetadata,
  OrphanedEmailRecord,
  SyntheticAttachmentResult,
  OrphanedCidBatchResult
} from './types.ts';

import { CidDetectionEngine } from './cid-detection-engine.ts';
import { SyntheticMonitoring } from './monitoring-synthetic.ts';

export interface SyntheticProcessingConfig {
  maxSyntheticPerEmail: number;
  batchSize: number;
  enableValidation: boolean;
  persistToDatabase: boolean;
  skipLowConfidence: boolean;
  confidenceThreshold: number;
}

export interface SyntheticValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  confidence: number;
  recommended: boolean;
}

export class SyntheticAttachmentProcessor {
  private cidEngine: CidDetectionEngine;
  private monitoring: SyntheticMonitoring;
  private supabaseClient: any;
  private config: SyntheticProcessingConfig;

  constructor(
    supabaseClient: any, 
    monitoring: SyntheticMonitoring,
    config?: Partial<SyntheticProcessingConfig>
  ) {
    this.supabaseClient = supabaseClient;
    this.monitoring = monitoring;
    this.cidEngine = new CidDetectionEngine(supabaseClient);
    
    // Default configuration
    this.config = {
      maxSyntheticPerEmail: 5,
      batchSize: 50,
      enableValidation: true,
      persistToDatabase: true,
      skipLowConfidence: false,
      confidenceThreshold: 40,
      ...config
    };

    console.log(`🔧 [SYNTHETIC-PROCESSOR] Initialized with config:`, this.config);
  }

  // Process a batch of orphaned emails to create synthetic attachments
  async processBatch(orphanedEmails: OrphanedEmailRecord[]): Promise<OrphanedCidBatchResult> {
    const startTime = Date.now();
    const operationId = this.monitoring.startOperation('creation');
    
    console.log(`🔧 [SYNTHETIC-PROCESSOR] Processing batch of ${orphanedEmails.length} orphaned emails`);

    const results: SyntheticAttachmentResult[] = [];
    const errors: Array<{ emailId: string; error: string }> = [];
    let totalSyntheticCreated = 0;

    // Process emails in smaller batches to avoid overwhelming the system
    for (let i = 0; i < orphanedEmails.length; i += this.config.batchSize) {
      const batch = orphanedEmails.slice(i, i + this.config.batchSize);
      console.log(`🔧 [SYNTHETIC-PROCESSOR] Processing sub-batch ${Math.floor(i / this.config.batchSize) + 1}/${Math.ceil(orphanedEmails.length / this.config.batchSize)}`);

      for (const email of batch) {
        try {
          const result = await this.processEmail(email);
          results.push(result);
          totalSyntheticCreated += result.syntheticAttachments.length;

          // Update monitoring
          this.monitoring.updateOperation(operationId, {
            emailsProcessed: results.length,
            syntheticAttachmentsCreated: totalSyntheticCreated
          });

        } catch (error: any) {
          console.error(`🚫 [SYNTHETIC-PROCESSOR] Error processing email ${email.id}:`, error);
          errors.push({
            emailId: email.id,
            error: error.message || 'Unknown error'
          });

          this.monitoring.updateOperation(operationId, {
            errors: errors.length
          });
        }
      }

      // Brief pause between batches to prevent rate limiting
      if (i + this.config.batchSize < orphanedEmails.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const processingTimeMs = Date.now() - startTime;
    
    // Complete monitoring
    this.monitoring.completeOperation(operationId);

    const batchResult: OrphanedCidBatchResult = {
      totalEmails: orphanedEmails.length,
      orphanedEmails: orphanedEmails.length,
      syntheticAttachmentsCreated: totalSyntheticCreated,
      errors,
      processingTimeMs
    };

    console.log(`✅ [SYNTHETIC-PROCESSOR] Batch processing complete:`, {
      emails: batchResult.totalEmails,
      attachments: batchResult.syntheticAttachmentsCreated,
      errors: batchResult.errors.length,
      duration: `${processingTimeMs}ms`
    });

    // Record batch results in monitoring
    this.monitoring.recordBatchResult(batchResult);

    return batchResult;
  }

  // Process a single email to create synthetic attachments
  async processEmail(email: OrphanedEmailRecord): Promise<SyntheticAttachmentResult> {
    console.log(`🔧 [SYNTHETIC-PROCESSOR] Processing email ${email.id} with ${email.orphanedCids.length} orphaned CIDs`);

    try {
      // Limit the number of synthetic attachments per email
      const cidsToProcess = email.orphanedCids.slice(0, this.config.maxSyntheticPerEmail);
      
      if (cidsToProcess.length < email.orphanedCids.length) {
        console.warn(`⚠️ [SYNTHETIC-PROCESSOR] Limiting ${email.orphanedCids.length} CIDs to ${cidsToProcess.length} for email ${email.id}`);
      }

      // Generate synthetic attachment metadata
      const syntheticAttachments = this.cidEngine.generateSyntheticAttachments(
        cidsToProcess,
        email.graph_id || email.id,
        email.id
      );

      // Validate synthetic attachments if enabled
      if (this.config.enableValidation) {
        const validatedAttachments = await this.validateSyntheticAttachments(syntheticAttachments);
        
        // Filter out low-confidence attachments if configured
        const finalAttachments = this.config.skipLowConfidence
          ? validatedAttachments.filter(att => 
              (att.providerMetadata?.cidValidation?.confidence || 0) >= this.config.confidenceThreshold
            )
          : validatedAttachments;

        if (finalAttachments.length !== syntheticAttachments.length) {
          console.log(`🔧 [SYNTHETIC-PROCESSOR] Filtered ${syntheticAttachments.length - finalAttachments.length} low-confidence attachments`);
        }

        // Persist to database if enabled
        if (this.config.persistToDatabase && finalAttachments.length > 0) {
          await this.persistSyntheticAttachments(finalAttachments, email.id);
        }

        return {
          emailId: email.id,
          syntheticAttachments: finalAttachments,
          orphanedCids: cidsToProcess,
          processed: true
        };
      } else {
        // Persist without validation
        if (this.config.persistToDatabase && syntheticAttachments.length > 0) {
          await this.persistSyntheticAttachments(syntheticAttachments, email.id);
        }

        return {
          emailId: email.id,
          syntheticAttachments,
          orphanedCids: cidsToProcess,
          processed: true
        };
      }

    } catch (error: any) {
      console.error(`🚫 [SYNTHETIC-PROCESSOR] Error processing email ${email.id}:`, error);
      return {
        emailId: email.id,
        syntheticAttachments: [],
        orphanedCids: email.orphanedCids,
        processed: false,
        error: error.message
      };
    }
  }

  // Validate synthetic attachments for quality and consistency
  async validateSyntheticAttachments(attachments: AttachmentMetadata[]): Promise<AttachmentMetadata[]> {
    console.log(`🔍 [SYNTHETIC-VALIDATOR] Validating ${attachments.length} synthetic attachments`);

    const validatedAttachments: AttachmentMetadata[] = [];

    for (const attachment of attachments) {
      const validation = this.validateSyntheticAttachment(attachment);
      
      if (validation.valid && validation.recommended) {
        // Keep the attachment and add validation metadata
        const enhancedAttachment = {
          ...attachment,
          providerMetadata: {
            ...attachment.providerMetadata,
            validation: validation,
            validatedAt: new Date().toISOString()
          }
        };
        validatedAttachments.push(enhancedAttachment);
        
        console.log(`✅ [SYNTHETIC-VALIDATOR] Attachment ${attachment.filename} passed validation (confidence: ${validation.confidence}%)`);
      } else {
        console.warn(`⚠️ [SYNTHETIC-VALIDATOR] Attachment ${attachment.filename} failed validation:`, {
          valid: validation.valid,
          recommended: validation.recommended,
          warnings: validation.warnings,
          errors: validation.errors
        });
      }
    }

    console.log(`🔍 [SYNTHETIC-VALIDATOR] Validation complete: ${validatedAttachments.length}/${attachments.length} attachments passed`);
    return validatedAttachments;
  }

  // Validate a single synthetic attachment
  private validateSyntheticAttachment(attachment: AttachmentMetadata): SyntheticValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    let confidence = 0;

    // Basic validation checks
    if (!attachment.contentId) {
      errors.push('Missing content ID');
    } else {
      confidence += 20;
    }

    if (!attachment.filename) {
      errors.push('Missing filename');
    } else {
      confidence += 10;
    }

    if (!attachment.providerAttachmentId?.startsWith('synthetic-')) {
      errors.push('Invalid synthetic attachment ID format');
    } else {
      confidence += 10;
    }

    // Content ID validation
    if (attachment.contentId) {
      const cidValidation = attachment.providerMetadata?.cidValidation;
      if (cidValidation) {
        confidence += cidValidation.confidence || 0;
        
        if (cidValidation.warnings?.length > 0) {
          warnings.push(...cidValidation.warnings);
        }

        if (cidValidation.confidence < 30) {
          warnings.push('Low CID detection confidence');
        }
      }
    }

    // Filename validation
    if (attachment.filename) {
      if (attachment.filename.length > 100) {
        warnings.push('Filename unusually long');
        confidence -= 5;
      }

      if (!attachment.filename.includes('.')) {
        warnings.push('Filename missing extension');
        confidence -= 5;
      }
    }

    // Content type validation
    if (attachment.contentType === 'image/unknown') {
      warnings.push('Unknown content type - may cause display issues');
      confidence -= 10;
    }

    // Provider metadata validation
    if (!attachment.synthetic) {
      errors.push('Missing synthetic flag');
    }

    if (!attachment.originalMessageId) {
      errors.push('Missing original message ID');
    } else {
      confidence += 15;
    }

    const valid = errors.length === 0;
    const recommended = valid && confidence >= this.config.confidenceThreshold;

    return {
      valid,
      warnings,
      errors,
      confidence: Math.min(100, Math.max(0, confidence)),
      recommended
    };
  }

  // Persist synthetic attachments to the database
  private async persistSyntheticAttachments(
    attachments: AttachmentMetadata[], 
    emailId: string
  ): Promise<void> {
    console.log(`💾 [SYNTHETIC-PERSIST] Persisting ${attachments.length} synthetic attachments for email ${emailId}`);

    try {
      // Get user_id from email
      const { data: emailData, error: emailError } = await this.supabaseClient
        .from('emails')
        .select('user_id')
        .eq('id', emailId)
        .single();

      if (emailError) {
        throw new Error(`Failed to get user_id for email ${emailId}: ${emailError.message}`);
      }

      const userId = emailData.user_id;

      // Prepare attachment references for database insertion
      const attachmentReferences = attachments.map(att => ({
        id: crypto.randomUUID(),
        email_id: emailId,
        user_id: userId,
        filename: att.filename,
        content_type: att.contentType,
        file_size: att.fileSize,
        content_id: att.contentId,
        is_inline: att.isInline,
        provider_attachment_id: att.providerAttachmentId,
        provider_type: att.providerType,
        provider_metadata: att.providerMetadata,
        checksum: att.checksum,
        synthetic: att.synthetic || false,
        original_message_id: att.originalMessageId,
        orphaned_cid_detected_at: att.orphanedCidDetectedAt?.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Insert synthetic attachment references
      const { data: insertData, error: insertError } = await this.supabaseClient
        .from('attachment_references')
        .insert(attachmentReferences)
        .select('id, filename, content_id');

      if (insertError) {
        throw new Error(`Failed to insert synthetic attachment references: ${insertError.message}`);
      }

      // Update email with new attachment count
      const { error: updateError } = await this.supabaseClient
        .from('emails')
        .update({
          attachment_reference_count: attachments.length,
          has_attachments: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', emailId);

      if (updateError) {
        console.warn(`⚠️ [SYNTHETIC-PERSIST] Failed to update email attachment count: ${updateError.message}`);
      }

      console.log(`✅ [SYNTHETIC-PERSIST] Successfully persisted ${attachments.length} synthetic attachments`, {
        emailId,
        attachmentIds: insertData?.map(ref => ref.id) || [],
        contentIds: insertData?.map(ref => ref.content_id) || []
      });

    } catch (error: any) {
      console.error(`🚫 [SYNTHETIC-PERSIST] Error persisting synthetic attachments:`, error);
      throw error;
    }
  }

  // Get processing statistics
  getProcessingStats(): any {
    return {
      config: this.config,
      cidEngineStats: {
        patternsLoaded: 5, // Number of CID patterns
        confidenceThreshold: this.config.confidenceThreshold
      }
    };
  }

  // Update processing configuration
  updateConfig(newConfig: Partial<SyntheticProcessingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log(`🔧 [SYNTHETIC-PROCESSOR] Configuration updated:`, this.config);
  }

  // Cleanup synthetic attachments (for testing/maintenance)
  async cleanupSyntheticAttachments(emailId?: string): Promise<number> {
    console.log(`🧹 [SYNTHETIC-CLEANUP] Starting synthetic attachment cleanup${emailId ? ` for email ${emailId}` : ''}`);

    try {
      const query = this.supabaseClient
        .from('attachment_references')
        .delete()
        .eq('synthetic', true);

      if (emailId) {
        query.eq('email_id', emailId);
      }

      const { data, error } = await query.select('id');

      if (error) {
        throw new Error(`Cleanup failed: ${error.message}`);
      }

      const deletedCount = data?.length || 0;
      console.log(`🧹 [SYNTHETIC-CLEANUP] Cleaned up ${deletedCount} synthetic attachments`);

      return deletedCount;
    } catch (error: any) {
      console.error(`🚫 [SYNTHETIC-CLEANUP] Error during cleanup:`, error);
      throw error;
    }
  }
} 