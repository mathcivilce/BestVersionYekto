/**
 * Email Provider Abstraction Layer
 * Smart Reference Architecture - Phase 1
 * 
 * Provides a unified interface for extracting attachment metadata
 * from different email providers (Outlook, Gmail, IMAP)
 */

// Type definitions
export interface AttachmentMetadata {
  filename: string;
  contentType: string;
  fileSize: number;
  contentId?: string; // For inline images (cid: references)
  isInline: boolean;
  providerAttachmentId: string;
  providerType: 'outlook' | 'gmail' | 'imap';
  checksum?: string;
  providerMetadata?: Record<string, any>;
}

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

// Provider interface
export abstract class EmailProvider {
  protected storeId: string;
  protected accessToken: string;

  constructor(storeId: string, accessToken: string) {
    this.storeId = storeId;
    this.accessToken = accessToken;
  }

  // Abstract methods that each provider must implement
  abstract extractAttachmentMetadata(messageId: string): Promise<AttachmentMetadata[]>;
  abstract downloadAttachment(attachmentId: string): Promise<AttachmentContent>;
  abstract checkHealth(): Promise<ProviderHealthStatus>;
  abstract validateAccess(): Promise<boolean>;

  // Common utility methods
  protected generateCacheKey(attachmentId: string, checksum?: string): string {
    const base = `attachment:${this.getProviderType()}:${attachmentId}`;
    return checksum ? `${base}:${checksum}` : base;
  }

  protected abstract getProviderType(): 'outlook' | 'gmail' | 'imap';
}

// Microsoft Outlook/Graph API Provider
export class OutlookProvider extends EmailProvider {
  private graphClient: any;

  constructor(storeId: string, accessToken: string) {
    super(storeId, accessToken);
    // We'll initialize Graph client when needed to avoid import issues
  }

  private async getGraphClient() {
    if (!this.graphClient) {
      const { Client } = await import("npm:@microsoft/microsoft-graph-client");
      this.graphClient = Client.init({
        authProvider: (done: any) => {
          done(null, this.accessToken);
        }
      });
    }
    return this.graphClient;
  }

  protected getProviderType(): 'outlook' {
    return 'outlook';
  }

  async extractAttachmentMetadata(messageId: string): Promise<AttachmentMetadata[]> {
    try {
      const startTime = Date.now();
      const client = await this.getGraphClient();

      // Fetch attachments from Microsoft Graph API
      // Note: contentId is not always available in select, we'll get it from the full object
      const attachments = await client
        .api(`/me/messages/${messageId}/attachments`)
        .select('id,name,contentType,size,isInline')
        .get();

      const responseTime = Date.now() - startTime;

      // Update provider health status
      await this.updateProviderStatus('healthy', responseTime);

      if (!attachments.value || attachments.value.length === 0) {
        return [];
      }

      // Transform Graph API response to our standard format
      const metadata: AttachmentMetadata[] = [];
      
      for (const att of attachments.value) {
        let contentId: string | undefined = undefined;
        
        // For inline attachments, try to get contentId from individual attachment
        if (att.isInline) {
          try {
            const detailedAttachment = await client
              .api(`/me/messages/${messageId}/attachments/${att.id}`)
              .get();
            contentId = detailedAttachment.contentId;
          } catch (error) {
            console.warn(`Could not fetch contentId for attachment ${att.id}:`, error);
          }
        }
        
        metadata.push({
          filename: att.name || 'unnamed_attachment',
          contentType: att.contentType || 'application/octet-stream',
          fileSize: att.size || 0,
          contentId: contentId,
          isInline: att.isInline || false,
          providerAttachmentId: att.id,
          providerType: 'outlook' as const,
          providerMetadata: {
            graphAttachmentId: att.id,
            hasContentLocation: !!att.contentLocation,
            lastModifiedDateTime: att.lastModifiedDateTime,
          }
        });
      }
      
      return metadata;

    } catch (error: any) {
      console.error('Error extracting Outlook attachment metadata:', error);
      
      // Update provider health status
      await this.updateProviderStatus('down', 0, error.message);
      
      // Don't throw error, return empty array to avoid breaking email processing
      return [];
    }
  }

  async downloadAttachment(attachmentId: string): Promise<AttachmentContent> {
    try {
      const startTime = Date.now();
      const client = await this.getGraphClient();

      // Get attachment content from Microsoft Graph API
      const attachment = await client
        .api(`/me/messages/attachment/${attachmentId}`)
        .get();

      const responseTime = Date.now() - startTime;
      await this.updateProviderStatus('healthy', responseTime);

      // Convert base64 content to Uint8Array
      const content = attachment.contentBytes 
        ? new Uint8Array(Buffer.from(attachment.contentBytes, 'base64'))
        : new Uint8Array(0);

      return {
        data: content,
        contentType: attachment.contentType || 'application/octet-stream',
        filename: attachment.name || 'unnamed_attachment'
      };

    } catch (error: any) {
      console.error('Error downloading Outlook attachment:', error);
      await this.updateProviderStatus('down', 0, error.message);
      throw new Error(`Failed to download attachment: ${error.message}`);
    }
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    try {
      const startTime = Date.now();
      const client = await this.getGraphClient();

      // Simple health check - get user profile
      await client.api('/me').select('id').get();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTimeMs: responseTime
      };

    } catch (error: any) {
      return {
        status: 'down',
        responseTimeMs: 0,
        errorMessage: error.message
      };
    }
  }

  async validateAccess(): Promise<boolean> {
    try {
      const health = await this.checkHealth();
      return health.status === 'healthy';
    } catch {
      return false;
    }
  }

  private async updateProviderStatus(
    status: 'healthy' | 'degraded' | 'down', 
    responseTimeMs: number, 
    errorMessage?: string
  ): Promise<void> {
    try {
      // This will be called from edge functions with Supabase client available
      if (typeof globalThis !== 'undefined' && (globalThis as any).supabaseClient) {
        const supabase = (globalThis as any).supabaseClient;
        
        await supabase.rpc('update_provider_status', {
          p_store_id: this.storeId,
          p_provider_type: 'outlook',
          p_status: status,
          p_response_time_ms: responseTimeMs,
          p_error_message: errorMessage
        });
      }
    } catch (error) {
      console.error('Failed to update provider status:', error);
      // Don't throw - this is just for monitoring
    }
  }
}

// Gmail Provider (placeholder for Phase 4)
export class GmailProvider extends EmailProvider {
  protected getProviderType(): 'gmail' {
    return 'gmail';
  }

  async extractAttachmentMetadata(messageId: string): Promise<AttachmentMetadata[]> {
    // TODO: Implement Gmail API attachment extraction in Phase 4
    console.warn('Gmail provider not implemented yet');
    return [];
  }

  async downloadAttachment(attachmentId: string): Promise<AttachmentContent> {
    throw new Error('Gmail provider not implemented yet');
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    return { status: 'down', responseTimeMs: 0, errorMessage: 'Not implemented' };
  }

  async validateAccess(): Promise<boolean> {
    return false;
  }
}

// IMAP Provider (placeholder for Phase 4)
export class IMAPProvider extends EmailProvider {
  protected getProviderType(): 'imap' {
    return 'imap';
  }

  async extractAttachmentMetadata(messageId: string): Promise<AttachmentMetadata[]> {
    // TODO: Implement IMAP attachment extraction in Phase 4
    console.warn('IMAP provider not implemented yet');
    return [];
  }

  async downloadAttachment(attachmentId: string): Promise<AttachmentContent> {
    throw new Error('IMAP provider not implemented yet');
  }

  async checkHealth(): Promise<ProviderHealthStatus> {
    return { status: 'down', responseTimeMs: 0, errorMessage: 'Not implemented' };
  }

  async validateAccess(): Promise<boolean> {
    return false;
  }
}

// Provider factory
export function createEmailProvider(
  providerType: 'outlook' | 'gmail' | 'imap',
  storeId: string,
  accessToken: string
): EmailProvider {
  switch (providerType) {
    case 'outlook':
      return new OutlookProvider(storeId, accessToken);
    case 'gmail':
      return new GmailProvider(storeId, accessToken);
    case 'imap':
      return new IMAPProvider(storeId, accessToken);
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

// Helper function to determine provider type from store platform
export function getProviderTypeFromPlatform(platform: string): 'outlook' | 'gmail' | 'imap' {
  switch (platform.toLowerCase()) {
    case 'outlook':
    case 'microsoft':
    case 'office365':
    case 'exchange':
      return 'outlook';
    case 'gmail':
    case 'google':
      return 'gmail';
    case 'imap':
    case 'email':
    default:
      return 'imap'; // Default fallback
  }
}

// Utility: Normalize a CID (strip <>, cid:, lowercase)
function normalizeCid(cid?: string): string {
  if (!cid) return '';
  return cid.replace(/^cid:/i, '').replace(/[<>]/g, '').toLowerCase();
}

// Attachment metadata processing utilities
export class AttachmentProcessor {
  static async processAttachmentMetadata(
    attachments: AttachmentMetadata[],
    emailId: string,
    userId: string,
    supabaseClient: any
  ): Promise<void> {
    console.log(`💾 [DB-ATTACHMENT] Starting processAttachmentMetadata for email ${emailId} with ${attachments.length} attachments`);
    
    if (!attachments || attachments.length === 0) {
      console.log(`⚠️ [DB-ATTACHMENT] No attachments to process for email ${emailId}`);
      return;
    }

    // Log final metadata before DB insert
    console.log(`💾 [DB-ATTACHMENT] Final attachment metadata for DB insert (email ${emailId}):`, JSON.stringify(attachments, null, 2));

    try {
      // Prepare attachment references for batch insert
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      console.log(`💾 [DB-ATTACHMENT] Prepared ${attachmentReferences.length} attachment references for insertion`);

      // Batch insert attachment references
      console.log(`💾 [DB-INSERT] Inserting attachment references into attachment_references table...`);
      const { data: insertData, error: insertError } = await supabaseClient
        .from('attachment_references')
        .insert(attachmentReferences)
        .select();

      if (insertError) {
        console.error(`🚫 [DB-ERROR] Error inserting attachment references for email ${emailId}:`, {
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code,
          raw: insertError
        });
        throw insertError;
      } else {
        console.log(`✅ [DB-INSERT] Successfully inserted ${attachmentReferences.length} attachment references`);
        if (insertData) {
          console.log(`✅ [DB-INSERT] Inserted attachment IDs:`, insertData.map(ref => ref.id));
        }
      }

      // Update email attachment count
      console.log(`📊 [DB-UPDATE] Updating email ${emailId} with attachment count: ${attachments.length}`);
      const { data: updateData, error: updateError } = await supabaseClient
        .from('emails')
        .update({ 
          attachment_reference_count: attachments.length,
          has_attachments: true
        })
        .eq('id', emailId)
        .select('id, attachment_reference_count, has_attachments');

      if (updateError) {
        console.error(`🚫 [DB-ERROR] Error updating email ${emailId} attachment count:`, {
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code,
          raw: updateError
        });
        throw updateError;
      } else {
        console.log(`✅ [DB-UPDATE] Successfully updated email ${emailId} attachment metadata:`, updateData);
      }

      console.log(`✅ [DB-ATTACHMENT] Completed processing ${attachments.length} attachment references for email ${emailId}`);

    } catch (error) {
      console.error(`🚫 [DB-ATTACHMENT] Fatal error processing attachment metadata for email ${emailId}:`, {
        error: error.message,
        stack: error.stack,
        attachmentCount: attachments.length
      });
      throw error;
    }
  }

  static extractContentIdFromHtml(htmlContent: string): string[] {
    console.log(`🔍 [CID-EXTRACT] Starting CID extraction from HTML content (${htmlContent.length} chars)`);
    
    if (!htmlContent) {
      console.log(`⚠️ [CID-EXTRACT] No HTML content provided - returning empty CID array`);
      return [];
    }

    // Log a sample of the HTML content for debugging
    const htmlSample = htmlContent.length > 200 ? htmlContent.substring(0, 200) + '...' : htmlContent;
    console.log(`🔍 [CID-EXTRACT] HTML content sample:`, htmlSample);

    // Extract CID references from HTML content
    const cidRegex = /(?:src|href)=['"]?cid:([^'">\s]+)['"]?/gi;
    const contentIds: string[] = [];
    let match;
    let matchCount = 0;

    while ((match = cidRegex.exec(htmlContent)) !== null) {
      const rawCid = match[1];
      const normalizedCid = normalizeCid(rawCid);
      contentIds.push(normalizedCid);
      matchCount++;
      console.log(`🔍 [CID-EXTRACT] Match ${matchCount}: Raw CID "${rawCid}" → Normalized "${normalizedCid}"`);
    }

    const uniqueContentIds = [...new Set(contentIds)]; // Remove duplicates
    
    console.log(`🔍 [CID-EXTRACT] Extraction complete - Found ${matchCount} matches, ${uniqueContentIds.length} unique CIDs:`, uniqueContentIds);

    return uniqueContentIds;
  }

  static async linkContentIdsToAttachments(
    contentIds: string[],
    attachments: AttachmentMetadata[]
  ): Promise<AttachmentMetadata[]> {
    console.log(`🔗 [CID-LINK] Starting linkContentIdsToAttachments with ${contentIds.length} CIDs and ${attachments.length} attachments`);
    
    // Normalize all contentIds for matching
    const normalizedCids = contentIds.map(normalizeCid);
    console.log(`🔗 [CID-LINK] Normalized input CIDs:`, normalizedCids);
    console.log(`🔗 [CID-LINK] Input attachments:`, attachments.map(a => ({ 
      filename: a.filename, 
      isInline: a.isInline, 
      rawContentId: a.contentId,
      normalizedContentId: normalizeCid(a.contentId)
    })));

    const linkedAttachments = attachments.map((att, index) => {
      const attCid = normalizeCid(att.contentId);
      console.log(`🔗 [CID-LINK] Processing attachment ${index + 1}: "${att.filename}"`);
      console.log(`🔗 [CID-LINK]   - Raw contentId: "${att.contentId}"`);
      console.log(`🔗 [CID-LINK]   - Normalized contentId: "${attCid}"`);
      console.log(`🔗 [CID-LINK]   - Original isInline: ${att.isInline}`);
      
      // If this attachment's contentId matches a CID, mark as inline
      if (normalizedCids.includes(attCid) && attCid) {
        console.log(`🔗 [CID-LINK]   → MATCHED! Setting isInline=true for "${att.filename}"`);
        return { ...att, isInline: true, contentId: attCid };
      }
      
      // If attachment is inline but missing contentId, try to assign from available CIDs
      if (att.isInline && !attCid && normalizedCids.length > 0) {
        const assignedCid = normalizedCids[0];
        console.log(`🔗 [CID-LINK]   → ASSIGNED! Setting contentId="${assignedCid}" for inline attachment "${att.filename}"`);
        return { ...att, contentId: assignedCid };
      }
      
      console.log(`🔗 [CID-LINK]   → No changes for "${att.filename}"`);
      return att;
    });

    console.log(`🔗 [CID-LINK] Linking complete - Result:`, linkedAttachments.map(a => ({ 
      filename: a.filename, 
      isInline: a.isInline, 
      contentId: a.contentId 
    })));

    return linkedAttachments;
  }
} 