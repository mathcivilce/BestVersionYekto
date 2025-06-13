/**
 * Email Provider Abstraction Layer - SYNC EMAILS ENHANCED VERSION
 * Smart Reference Architecture - Phase 2 with Synthetic Attachment Support
 * 
 * This is an enhanced version specifically for sync-emails function that includes:
 * - All original functionality from email-providers.ts
 * - Synthetic attachment creation for orphaned CIDs
 * - Enhanced CID detection and linking
 * - Multi-strategy attachment resolution
 * 
 * CRITICAL: This file is separate from email-providers.ts to ensure
 * zero impact on the existing webhook functionality
 */

// Enhanced type definitions with synthetic attachment support
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
  // NEW: Synthetic attachment support
  synthetic?: boolean;                    // Flag for synthetic attachments
  originalMessageId?: string;             // For synthetic attachment resolution
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

// NEW: Email record interface for orphan detection
export interface EmailRecord {
  id: string;
  content: string;
  graph_id?: string;
  has_attachments?: boolean;
  attachment_reference_count?: number;
  [key: string]: any;
}

// NEW: Synthetic attachment interface
export interface SyntheticAttachment extends AttachmentMetadata {
  synthetic: true;
  originalMessageId: string;
  detectedCid: string;
}

// Provider interface (unchanged from original)
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

  // NEW: Abstract method for synthetic attachment download
  abstract downloadSyntheticAttachment?(syntheticId: string): Promise<AttachmentContent>;

  // Common utility methods
  protected generateCacheKey(attachmentId: string, checksum?: string): string {
    const base = `attachment:${this.getProviderType()}:${attachmentId}`;
    return checksum ? `${base}:${checksum}` : base;
  }

  protected abstract getProviderType(): 'outlook' | 'gmail' | 'imap';
}

// Enhanced Microsoft Outlook/Graph API Provider with synthetic support
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
            console.warn(`🔧 [SYNC-OUTLOOK] Could not fetch contentId for attachment ${att.id}:`, error);
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
      console.error('🚫 [SYNC-OUTLOOK] Error extracting attachment metadata:', error);
      
      // Update provider health status
      await this.updateProviderStatus('down', 0, error.message);
      
      // Don't throw error, return empty array to avoid breaking email processing
      return [];
    }
  }

  async downloadAttachment(attachmentId: string): Promise<AttachmentContent> {
    // Check if this is a synthetic attachment
    if (attachmentId.startsWith('synthetic-')) {
      return this.downloadSyntheticAttachment!(attachmentId);
    }

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
        ? new Uint8Array(atob(attachment.contentBytes).split('').map(c => c.charCodeAt(0)))
        : new Uint8Array(0);

      return {
        data: content,
        contentType: attachment.contentType || 'application/octet-stream',
        filename: attachment.name || 'unnamed_attachment'
      };

    } catch (error: any) {
      console.error('🚫 [SYNC-OUTLOOK] Error downloading attachment:', error);
      await this.updateProviderStatus('down', 0, error.message);
      throw new Error(`Failed to download attachment: ${error.message}`);
    }
  }

  // NEW: Synthetic attachment download with multiple resolution strategies
  async downloadSyntheticAttachment(syntheticId: string): Promise<AttachmentContent> {
    console.log(`🔧 [SYNC-SYNTHETIC] Starting synthetic attachment download: ${syntheticId}`);
    
    try {
      // Parse synthetic ID: synthetic-{messageId}-{cid}
      // IMPORTANT: Outlook message IDs contain hyphens, so we need to find the LAST occurrence
      // of a hyphen followed by what looks like a CID (typically starts with 'ii_')
      
      if (!syntheticId.startsWith('synthetic-')) {
        console.error(`🚫 [SYNC-SYNTHETIC] Invalid synthetic attachment ID format: ${syntheticId}`);
        throw new Error(`Invalid synthetic attachment ID format: ${syntheticId}`);
      }
      
      const withoutPrefix = syntheticId.substring('synthetic-'.length);
      
      // Find the last occurrence of '-ii_' which typically marks the start of the CID
      let cidStartIndex = withoutPrefix.lastIndexOf('-ii_');
      if (cidStartIndex === -1) {
        // Fallback: try to find the last hyphen and assume everything after is CID
        cidStartIndex = withoutPrefix.lastIndexOf('-');
      }
      
      if (cidStartIndex === -1) {
        console.error(`🚫 [SYNC-SYNTHETIC] Could not parse messageId and CID from: ${syntheticId}`);
        throw new Error(`Could not parse messageId and CID from: ${syntheticId}`);
      }
      
      const messageId = withoutPrefix.substring(0, cidStartIndex);
      const cid = withoutPrefix.substring(cidStartIndex + 1); // Remove the leading hyphen
      
      console.log(`🔧 [SYNC-SYNTHETIC] Parsed - messageId: ${messageId}, cid: ${cid}`);

      // Validate messageId format (should be a valid GUID/UUID)
      if (!messageId || messageId.length < 10) {
        console.error(`🚫 [SYNC-SYNTHETIC] Invalid message ID format: ${messageId}`);
        return this.createPlaceholderAttachment(cid);
      }

      console.log(`🔧 [SYNC-SYNTHETIC] Starting resolution strategies for ${syntheticId}`);

      // Strategy 1: Find attachment by content ID
      console.log(`🔧 [SYNC-SYNTHETIC] Trying strategy 1: CID resolution`);
      let attachment = await this.findAttachmentByCid(messageId, cid);
      if (attachment) {
        console.log(`✅ [SYNC-SYNTHETIC] Successfully resolved with CID strategy`);
        return attachment;
      }

      // Strategy 2: Find attachment by filename pattern
      console.log(`🔧 [SYNC-SYNTHETIC] Trying strategy 2: Filename pattern resolution`);
      attachment = await this.findAttachmentByFilename(messageId, cid);
      if (attachment) {
        console.log(`✅ [SYNC-SYNTHETIC] Successfully resolved with filename strategy`);
        return attachment;
      }

      // Strategy 3: Smart index selection (fallback)
      console.log(`🔧 [SYNC-SYNTHETIC] Trying strategy 3: Smart index resolution`);
      attachment = await this.findInlineAttachmentByIndex(messageId, cid);
      if (attachment) {
        console.log(`✅ [SYNC-SYNTHETIC] Successfully resolved with index strategy`);
        return attachment;
      }

      // If all strategies fail, return placeholder
      console.warn(`⚠️ [SYNC-SYNTHETIC] All resolution strategies failed for ${syntheticId}, returning placeholder`);
      return this.createPlaceholderAttachment(cid);

    } catch (error: any) {
      console.error(`🚫 [SYNC-SYNTHETIC] Critical error downloading synthetic attachment ${syntheticId}:`, error.message || error);
      
      // Extract CID for placeholder if possible
      const cidFallback = syntheticId.split('-').slice(2).join('-') || 'unknown';
      return this.createPlaceholderAttachment(cidFallback);
    }
  }

  // Enhanced Strategy 1: Bulletproof CID Matching with Enterprise-Grade Multi-Level Resolution
  private async findAttachmentByCid(messageId: string, cid: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔧 [STRATEGY-1-ENHANCED] Bulletproof CID resolution: ${cid}`);
      
      // LEVEL 1A: Microsoft API Enhanced Validation
      console.log(`🔍 [LEVEL-1A] Starting enhanced Microsoft API validation`);
      const microsoftResult = await this.tryMicrosoftApiCid(messageId, cid);
      if (microsoftResult) {
        console.log(`✅ [STRATEGY-1-ENHANCED] Success via Level 1A (Microsoft API)`);
        return microsoftResult;
      }
      
      // LEVEL 1B: Raw Message MIME Parsing  
      console.log(`🔍 [LEVEL-1B] Starting raw MIME message parsing`);
      const mimeResult = await this.tryMimeContentIdExtraction(messageId, cid);
      if (mimeResult) {
        console.log(`✅ [STRATEGY-1-ENHANCED] Success via Level 1B (MIME Parsing)`);
        return mimeResult;
      }
      
      // LEVEL 1C: Multi-Field CID Matching
      console.log(`🔍 [LEVEL-1C] Starting multi-field advanced matching`);
      const multiFieldResult = await this.tryMultiFieldMatching(messageId, cid);
      if (multiFieldResult) {
        console.log(`✅ [STRATEGY-1-ENHANCED] Success via Level 1C (Multi-Field)`);
        return multiFieldResult;
      }
      
      // LEVEL 1D: Deterministic CID Generation + Database Lookup
      console.log(`🔍 [LEVEL-1D] Starting deterministic database-backed resolution`);
      const deterministicResult = await this.tryDeterministicResolution(messageId, cid);
      if (deterministicResult) {
        console.log(`✅ [STRATEGY-1-ENHANCED] Success via Level 1D (Deterministic)`);
        return deterministicResult;
      }
      
      console.log(`❌ [STRATEGY-1-ENHANCED] All levels failed, falling back to Strategy 2`);
      return null; // Fall back to Strategy 2
      
    } catch (error: any) {
      console.warn(`🔧 [STRATEGY-1-ENHANCED] Enhanced Strategy 1 failed:`, error.code || error.message);
      return null;
    }
  }

  // LEVEL 1A: Microsoft API Enhanced Validation
  private async tryMicrosoftApiCid(messageId: string, targetCid: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔍 [LEVEL-1A] Enhanced Microsoft API validation for CID: ${targetCid}`);
      
      const client = await this.getGraphClient();
      
      // Verify message exists first
      try {
        await client.api(`/me/messages/${messageId}`).select('id').get();
      } catch (messageError: any) {
        console.warn(`🔧 [LEVEL-1A] Message not accessible (${messageError.code || 'unknown'})`);
        return null;
      }

      const attachments = await client.api(`/me/messages/${messageId}/attachments`).get();
      
      if (!attachments.value || attachments.value.length === 0) {
        console.log(`🔧 [LEVEL-1A] No attachments found`);
        return null;
      }
      
      const normalizedTarget = this.normalizeAdvancedCid(targetCid);
      console.log(`🔍 [LEVEL-1A] Normalized target CID: "${targetCid}" → "${normalizedTarget}"`);
      
      for (const att of attachments.value) {
        if (!att.isInline) continue;
        
        console.log(`🔍 [LEVEL-1A] Checking attachment "${att.name || 'unnamed'}" (isInline: ${att.isInline})`);
        
        // Enhanced field checking with multiple CID sources
        const cidSources = [
          { field: 'contentId', value: att.contentId },
          { field: 'contentLocation', value: att.contentLocation },
          { field: 'contentDisposition', value: att.contentDisposition?.parameters?.name },
        ].filter(source => source.value);
        
        console.log(`🔍 [LEVEL-1A] Available CID sources:`, cidSources.map(s => `${s.field}: "${s.value}"`));
        
        for (const source of cidSources) {
          const normalizedSource = this.normalizeAdvancedCid(source.value);
          
          console.log(`🔍 [LEVEL-1A] Comparing "${source.value}" → "${normalizedSource}" vs "${normalizedTarget}"`);
          
          if (this.cidMatches(normalizedSource, normalizedTarget)) {
            console.log(`✅ [LEVEL-1A] Microsoft API match found: ${source.field} = "${source.value}"`);
            
            try {
              const detailed = await client.api(`/me/messages/${messageId}/attachments/${att.id}`).get();
              return this.createAttachmentContent(detailed, targetCid);
            } catch (downloadError: any) {
              console.warn(`🔧 [LEVEL-1A] Failed to download matched attachment:`, downloadError.code);
              continue;
            }
          }
        }
      }
      
      console.log(`❌ [LEVEL-1A] No Microsoft API matches found for CID: ${targetCid}`);
      return null;
      
    } catch (error: any) {
      console.warn(`🔧 [LEVEL-1A] Microsoft API level failed:`, error.code || error.message);
      return null;
    }
  }

  // LEVEL 1B: Raw Message MIME Parsing (Enterprise Standard)
  private async tryMimeContentIdExtraction(messageId: string, targetCid: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔍 [LEVEL-1B] Raw MIME message parsing for CID: ${targetCid}`);
      
      const client = await this.getGraphClient();
      
      // Attempt to get raw message content (MIME format)
      let rawMessage;
      try {
        rawMessage = await client.api(`/me/messages/${messageId}/$value`).get();
      } catch (rawError: any) {
        console.log(`❌ [LEVEL-1B] Raw message not available (${rawError.code || 'unknown'})`);
        return null;
      }
      
      if (!rawMessage || typeof rawMessage !== 'string') {
        console.log(`❌ [LEVEL-1B] Invalid raw message format`);
        return null;
      }
      
      console.log(`🔍 [LEVEL-1B] Raw message length: ${rawMessage.length} chars`);
      
      // Parse MIME structure to extract Content-ID headers
      const mimeStructure = this.parseMimeMessage(rawMessage);
      const cidMap = this.buildContentIdMap(mimeStructure);
      
      console.log(`🔍 [LEVEL-1B] Extracted ${cidMap.size} CID mappings from MIME headers`);
      
      if (cidMap.size === 0) {
        console.log(`❌ [LEVEL-1B] No Content-ID headers found in MIME structure`);
        return null;
      }
      
      const normalizedTarget = this.normalizeAdvancedCid(targetCid);
      
      // Look for exact CID matches in MIME headers
      for (const [extractedCid, attachmentInfo] of cidMap.entries()) {
        const normalizedExtracted = this.normalizeAdvancedCid(extractedCid);
        
        console.log(`🔍 [LEVEL-1B] Comparing MIME CID: "${extractedCid}" → "${normalizedExtracted}" vs "${normalizedTarget}"`);
        
        if (this.cidMatches(normalizedExtracted, normalizedTarget)) {
          console.log(`✅ [LEVEL-1B] MIME header match found: "${extractedCid}" → attachment index ${attachmentInfo.index}`);
          
          // Get the actual attachment using the discovered mapping
          try {
            const attachments = await client.api(`/me/messages/${messageId}/attachments`).get();
            const inlineAttachments = attachments.value.filter(att => att.isInline);
            const targetAttachment = inlineAttachments[attachmentInfo.index];
            
            if (targetAttachment) {
              const detailed = await client.api(`/me/messages/${messageId}/attachments/${targetAttachment.id}`).get();
              return this.createAttachmentContent(detailed, targetCid);
            } else {
              console.warn(`🔧 [LEVEL-1B] Attachment index ${attachmentInfo.index} not found in inline attachments`);
            }
          } catch (downloadError: any) {
            console.warn(`🔧 [LEVEL-1B] Failed to download MIME-matched attachment:`, downloadError.code);
            continue;
          }
        }
      }
      
      console.log(`❌ [LEVEL-1B] No MIME header matches found for CID: ${targetCid}`);
      return null;
      
    } catch (error: any) {
      console.warn(`🔧 [LEVEL-1B] MIME parsing level failed:`, error.message);
      return null;
    }
  }

  // LEVEL 1C: Multi-Field Advanced Matching
  private async tryMultiFieldMatching(messageId: string, targetCid: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔍 [LEVEL-1C] Multi-field advanced matching for CID: ${targetCid}`);
      
      const client = await this.getGraphClient();
      const attachments = await client.api(`/me/messages/${messageId}/attachments`).get();
      
      if (!attachments.value || attachments.value.length === 0) {
        console.log(`❌ [LEVEL-1C] No attachments available`);
        return null;
      }
      
      const inlineAttachments = attachments.value.filter(att => att.isInline);
      if (inlineAttachments.length === 0) {
        console.log(`❌ [LEVEL-1C] No inline attachments available`);
        return null;
      }
      
      const normalizedTarget = this.normalizeAdvancedCid(targetCid);
      const targetBase = this.extractCidBase(targetCid);
      const targetHex = this.extractHexFromCid(targetCid);
      
      console.log(`🔍 [LEVEL-1C] Analysis: target="${normalizedTarget}", base="${targetBase}", hex="${targetHex}"`);
      
      // Scoring system for fuzzy matching
      const scoredAttachments = [];
      
      for (const att of inlineAttachments) {
        let score = 0;
        const reasons = [];
        
        console.log(`🔍 [LEVEL-1C] Analyzing attachment: "${att.name || 'unnamed'}" (contentId: "${att.contentId || 'none'}")`);
        
        // Score 1: Exact CID match (any field) - Highest priority
        const cidFields = [
          { name: 'contentId', value: att.contentId },
          { name: 'contentLocation', value: att.contentLocation },
          { name: 'filename', value: att.name }
        ];
        
        for (const field of cidFields) {
          if (field.value && this.cidMatches(this.normalizeAdvancedCid(field.value), normalizedTarget)) {
            score += 100;
            reasons.push(`exact_match:${field.name}:${field.value}`);
            console.log(`🔍 [LEVEL-1C] Exact match found in ${field.name}: "${field.value}"`);
          }
        }
        
        // Score 2: Base CID match (hex pattern) - High priority
        if (targetBase && score < 100) {
          for (const field of cidFields) {
            if (field.value && field.value.toLowerCase().includes(targetBase.toLowerCase())) {
              score += 80;
              reasons.push(`base_match:${field.name}:${targetBase}`);
              console.log(`🔍 [LEVEL-1C] Base match found in ${field.name}: "${targetBase}"`);
            }
          }
        }
        
        // Score 3: Hex pattern match in filename - Medium priority
        if (targetHex && att.name && score < 80) {
          if (att.name.toLowerCase().includes(targetHex.toLowerCase())) {
            score += 60;
            reasons.push(`hex_match:filename:${targetHex}`);
            console.log(`🔍 [LEVEL-1C] Hex match found in filename: "${targetHex}"`);
          }
        }
        
        // Score 4: Partial pattern matches - Lower priority
        if (score < 60 && att.name) {
          const partialMatches = this.findPartialMatches(att.name.toLowerCase(), targetCid.toLowerCase());
          if (partialMatches > 2) {
            score += partialMatches * 5;
            reasons.push(`partial_match:${partialMatches}`);
            console.log(`🔍 [LEVEL-1C] Partial matches found: ${partialMatches}`);
          }
        }
        
        if (score > 0) {
          scoredAttachments.push({ 
            attachment: att, 
            score, 
            reasons,
            name: att.name || 'unnamed'
          });
          console.log(`🔍 [LEVEL-1C] Scored "${att.name || 'unnamed'}": ${score} points (${reasons.join(', ')})`);
        }
      }
      
      if (scoredAttachments.length === 0) {
        console.log(`❌ [LEVEL-1C] No scored matches found`);
        return null;
      }
      
      // Sort by score and take best match
      scoredAttachments.sort((a, b) => b.score - a.score);
      const best = scoredAttachments[0];
      
      // Confidence threshold check
      if (best.score < 50) {
        console.log(`⚠️ [LEVEL-1C] Best match score ${best.score} below threshold (50), skipping`);
        return null;
      }
      
      console.log(`✅ [LEVEL-1C] Best match selected: "${best.name}" (score: ${best.score})`);
      console.log(`🔍 [LEVEL-1C] Match reasons: ${best.reasons.join(', ')}`);
      
      try {
        const detailed = await client.api(`/me/messages/${messageId}/attachments/${best.attachment.id}`).get();
        return this.createAttachmentContent(detailed, targetCid);
      } catch (downloadError: any) {
        console.warn(`🔧 [LEVEL-1C] Failed to download best match:`, downloadError.code);
        return null;
      }
      
    } catch (error: any) {
      console.warn(`🔧 [LEVEL-1C] Multi-field matching level failed:`, error.message);
      return null;
    }
  }

  // LEVEL 1D: Deterministic Database-Backed Resolution
  private async tryDeterministicResolution(messageId: string, targetCid: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔍 [LEVEL-1D] Deterministic database-backed resolution for CID: ${targetCid}`);
      
      // Generate deterministic mapping for this message
      const deterministicMapping = await this.generateDeterministicMapping(messageId);
      
      if (deterministicMapping.size === 0) {
        console.log(`❌ [LEVEL-1D] No attachments available for deterministic mapping`);
        return null;
      }
      
      console.log(`🔍 [LEVEL-1D] Generated ${deterministicMapping.size} deterministic mappings`);
      
      // Try direct CID lookup
      let attachmentIndex = deterministicMapping.get(targetCid);
      
      // Try normalized CID lookup
      if (attachmentIndex === undefined) {
        const normalizedTarget = this.normalizeAdvancedCid(targetCid);
        attachmentIndex = deterministicMapping.get(normalizedTarget);
      }
      
      // Try generated CID pattern lookup
      if (attachmentIndex === undefined) {
        for (const [mappedCid, index] of deterministicMapping.entries()) {
          if (this.cidMatches(mappedCid, targetCid) || this.cidMatches(mappedCid, this.normalizeAdvancedCid(targetCid))) {
            attachmentIndex = index;
            console.log(`🔍 [LEVEL-1D] Found pattern match: "${mappedCid}" matches "${targetCid}"`);
            break;
          }
        }
      }
      
      if (attachmentIndex !== undefined) {
        console.log(`✅ [LEVEL-1D] Deterministic mapping found: ${targetCid} → attachment index ${attachmentIndex}`);
        
        return this.getAttachmentByIndex(messageId, attachmentIndex, targetCid);
      }
      
      console.log(`❌ [LEVEL-1D] No deterministic mapping available for CID: ${targetCid}`);
      return null;
      
    } catch (error: any) {
      console.warn(`🔧 [LEVEL-1D] Deterministic resolution level failed:`, error.message);
      return null;
    }
  }

  // Helper Methods for Enhanced Strategy 1

  private cidMatches(cid1: string, cid2: string): boolean {
    if (!cid1 || !cid2) return false;
    return cid1.toLowerCase() === cid2.toLowerCase();
  }

  private extractHexFromCid(cid: string): string | null {
    const hexMatch = cid.match(/([a-f0-9]{8,})/i);
    return hexMatch ? hexMatch[1] : null;
  }

  // MIME parsing helper methods
  private parseMimeMessage(rawMessage: string): any[] {
    try {
      // Simplified MIME parser - looks for Content-ID and Content-Location headers
      const parts = rawMessage.split(/\r?\n\r?\n/);
      const mimeParts = [];
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const contentIdMatch = part.match(/Content-ID:\s*([^\r\n]+)/i);
        const locationMatch = part.match(/Content-Location:\s*([^\r\n]+)/i);
        
        if (contentIdMatch || locationMatch) {
          mimeParts.push({
            index: i,
            contentId: contentIdMatch ? contentIdMatch[1].trim().replace(/[<>]/g, '') : null,
            contentLocation: locationMatch ? locationMatch[1].trim() : null,
            content: part
          });
        }
      }
      
      console.log(`🔍 [MIME-PARSER] Found ${mimeParts.length} MIME parts with Content-ID/Location headers`);
      return mimeParts;
      
    } catch (error: any) {
      console.warn(`🔧 [MIME-PARSER] MIME parsing failed:`, error.message);
      return [];
    }
  }

  private buildContentIdMap(mimeParts: any[]): Map<string, any> {
    const cidMap = new Map();
    
    mimeParts.forEach((part, index) => {
      if (part.contentId) {
        cidMap.set(part.contentId, { index, source: 'contentId' });
        console.log(`🔍 [CID-MAP] Mapped Content-ID: "${part.contentId}" → index ${index}`);
      }
      if (part.contentLocation) {
        cidMap.set(part.contentLocation, { index, source: 'contentLocation' });
        console.log(`🔍 [CID-MAP] Mapped Content-Location: "${part.contentLocation}" → index ${index}`);
      }
    });
    
    return cidMap;
  }

  private async generateDeterministicMapping(messageId: string): Promise<Map<string, number>> {
    try {
      const client = await this.getGraphClient();
      const attachments = await client.api(`/me/messages/${messageId}/attachments`).get();
      
      if (!attachments.value) return new Map();
      
      const inlineAttachments = attachments.value.filter(att => att.isInline);
      const mapping = new Map();
      
      inlineAttachments.forEach((att, index) => {
        // Map any existing contentId
        if (att.contentId) {
          mapping.set(this.normalizeAdvancedCid(att.contentId), index);
          console.log(`🔍 [DETERMINISTIC] Mapped existing CID: "${att.contentId}" → index ${index}`);
        }
        
        // Generate consistent CID based on attachment properties
        const deterministicCid = this.generateConsistentCid(att, index);
        mapping.set(deterministicCid, index);
        console.log(`🔍 [DETERMINISTIC] Generated CID: "${deterministicCid}" → index ${index}`);
      });
      
      return mapping;
      
    } catch (error: any) {
      console.warn(`🔧 [DETERMINISTIC] Mapping generation failed:`, error.message);
      return new Map();
    }
  }

  private generateConsistentCid(attachment: any, index: number): string {
    const baseString = `${attachment.name || 'attachment'}_${attachment.size || 0}_${index}`;
    const hash = this.simpleHash(baseString);
    return `generated_${hash}@local`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private async getAttachmentByIndex(messageId: string, index: number, targetCid: string): Promise<AttachmentContent | null> {
    try {
      const client = await this.getGraphClient();
      const attachments = await client.api(`/me/messages/${messageId}/attachments`).get();
      
      if (!attachments.value) return null;
      
      const inlineAttachments = attachments.value.filter(att => att.isInline);
      
      if (index >= 0 && index < inlineAttachments.length) {
        const targetAttachment = inlineAttachments[index];
        const detailed = await client.api(`/me/messages/${messageId}/attachments/${targetAttachment.id}`).get();
        return this.createAttachmentContent(detailed, targetCid);
      }
      
      return null;
      
    } catch (error: any) {
      console.warn(`🔧 [GET-BY-INDEX] Failed to get attachment by index ${index}:`, error.code);
      return null;
    }
  }

  // Helper method for Level 1C scoring calculations
  private checkCidMatchWithDebug(attachment: any, normalizedTarget: string, originalCid: string): any {
    const results = [];
    let matched = false;
    let matchStrategy = '';
    let matchValue = '';
    let confidence = 0;

    // Check multiple fields for CID matches
    const fields = [
      { name: 'contentId', value: attachment.contentId },
      { name: 'contentLocation', value: attachment.contentLocation },
      { name: 'name', value: attachment.name }
    ];

    for (const field of fields) {
      if (!field.value) continue;
      
      const normalized = this.normalizeAdvancedCid(field.value);
      const match = this.cidMatches(normalized, normalizedTarget);
      
      results.push({
        field: field.name,
        value: field.value,
        normalized,
        matched: match
      });

      if (match && !matched) {
        matched = true;
        matchStrategy = field.name;
        matchValue = field.value;
        confidence = field.name === 'contentId' ? 100 : (field.name === 'contentLocation' ? 80 : 60);
      }
    }

    return {
      matched,
      strategy: matchStrategy,
      value: matchValue,
      confidence,
      debugResults: results
    };
  }

  // Enhanced Strategy 2: Intelligent Filename Analysis with edge case protection
  private async findAttachmentByFilename(messageId: string, pattern: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔧 [STRATEGY-2] Enhanced filename strategy: ${pattern}`);
      
      const client = await this.getGraphClient();
      
      // Check if message is accessible first
      try {
        await client
          .api(`/me/messages/${messageId}`)
          .select('id')
          .get();
      } catch (messageError: any) {
        console.warn(`🔧 [STRATEGY-2] Message not accessible (${messageError.code || 'unknown'})`);
        return null;
      }

      const attachments = await client
        .api(`/me/messages/${messageId}/attachments`)
        .get();

      if (!attachments.value || attachments.value.length === 0) {
        console.log(`🔧 [STRATEGY-2] No attachments found`);
        return null;
      }

      // Generate multiple filename patterns to search for
      const searchPatterns = this.generateFilenamePatterns(pattern);
      console.log(`🔍 [STRATEGY-2-DEBUG] Generated patterns:`, searchPatterns);

      // Score and rank attachments by relevance with detailed logging
      const scoredAttachments = [];
      
      for (const att of attachments.value) {
        if (att.isInline && att.name) {
          const scoreDetails = this.calculateFilenameScoreWithDebug(att.name, searchPatterns, pattern);
          if (scoreDetails.totalScore > 0) {
            scoredAttachments.push({ 
              attachment: att, 
              score: scoreDetails.totalScore, 
              name: att.name,
              scoreDetails: scoreDetails
            });
            
            console.log(`🔍 [STRATEGY-2-DEBUG] Scored "${att.name}": ${scoreDetails.totalScore} (${JSON.stringify(scoreDetails.breakdown)})`);
          }
        }
      }

      if (scoredAttachments.length === 0) {
        console.log(`❌ [STRATEGY-2] No scored attachments found`);
        return null;
      }

      // Sort by score (highest first)
      scoredAttachments.sort((a, b) => b.score - a.score);
      
      // EDGE CASE PROTECTION: Check for exact matches first
      const exactMatch = this.findExactCidMatch(scoredAttachments, pattern);
      if (exactMatch) {
        console.log(`✅ [STRATEGY-2-EXACT] Found exact CID match: "${exactMatch.name}" (score: ${exactMatch.score})`);
        try {
          const detailed = await client
            .api(`/me/messages/${messageId}/attachments/${exactMatch.attachment.id}`)
            .get();
          return this.createAttachmentContent(detailed, pattern);
        } catch (attError: any) {
          console.warn(`🔧 [STRATEGY-2] Failed to get exact match:`, attError.code);
        }
      }

      // EDGE CASE PROTECTION: Check for score conflicts
      const topScore = scoredAttachments[0].score;
      const tiedAttachments = scoredAttachments.filter(att => att.score === topScore);
      
      if (tiedAttachments.length > 1) {
        console.warn(`⚠️ [STRATEGY-2-CONFLICT] ${tiedAttachments.length} attachments tied with score ${topScore}`);
        console.log(`🔍 [STRATEGY-2-DEBUG] Tied attachments:`, tiedAttachments.map(att => ({
          name: att.name,
          score: att.score,
          breakdown: att.scoreDetails.breakdown
        })));
        
        // Try to resolve conflict with additional matching
        const resolvedMatch = this.resolveScoreConflict(tiedAttachments, pattern);
        if (resolvedMatch) {
          console.log(`✅ [STRATEGY-2-RESOLVED] Conflict resolved: "${resolvedMatch.name}"`);
          try {
            const detailed = await client
              .api(`/me/messages/${messageId}/attachments/${resolvedMatch.attachment.id}`)
              .get();
            return this.createAttachmentContent(detailed, pattern);
          } catch (attError: any) {
            console.warn(`🔧 [STRATEGY-2] Failed to get resolved match:`, attError.code);
          }
        }
      }

      // EDGE CASE PROTECTION: Confidence threshold check
      const best = scoredAttachments[0];
      const confidenceThreshold = 50; // Minimum confidence score
      
      if (best.score < confidenceThreshold) {
        console.warn(`⚠️ [STRATEGY-2-LOW-CONFIDENCE] Best match "${best.name}" score ${best.score} below threshold ${confidenceThreshold}`);
        console.log(`🔍 [STRATEGY-2-DEBUG] All scored attachments:`, scoredAttachments.map(att => ({
          name: att.name,
          score: att.score
        })));
        return null; // Let Strategy 3 handle it
      }
      
      console.log(`✅ [STRATEGY-2-SUCCESS] Best match: "${best.name}" (score: ${best.score}, confidence: HIGH)`);
      
      try {
        const detailed = await client
          .api(`/me/messages/${messageId}/attachments/${best.attachment.id}`)
          .get();
        return this.createAttachmentContent(detailed, pattern);
      } catch (attError: any) {
        console.warn(`🔧 [STRATEGY-2] Failed to get best match:`, attError.code);
      }

      return null;
    } catch (error: any) {
      console.warn(`🔧 [STRATEGY-2] Strategy failed:`, error.code || error.message);
      return null;
    }
  }

  // Enhanced Strategy 3: Smart Index Selection with improved logging
  private async findInlineAttachmentByIndex(messageId: string, originalCid: string): Promise<AttachmentContent | null> {
    try {
      console.log(`🔧 [STRATEGY-3] Smart index strategy for CID: ${originalCid}`);
      
      const client = await this.getGraphClient();
      
      // Check if message is accessible first
      try {
        await client
          .api(`/me/messages/${messageId}`)
          .select('id')
          .get();
      } catch (messageError: any) {
        console.warn(`🔧 [STRATEGY-3] Message not accessible (${messageError.code || 'unknown'})`);
        return null;
      }

      const attachments = await client
        .api(`/me/messages/${messageId}/attachments`)
        .get();

      if (!attachments.value || attachments.value.length === 0) {
        console.log(`🔧 [STRATEGY-3] No attachments found`);
        return null;
      }

      const inlineAttachments = attachments.value.filter((att: any) => att.isInline);
      console.log(`🔍 [STRATEGY-3-DEBUG] Found ${inlineAttachments.length} inline attachments of ${attachments.value.length} total`);
      
      if (inlineAttachments.length === 0) {
        console.log(`❌ [STRATEGY-3] No inline attachments available`);
        return null;
      }

      // Log all available inline attachments for debugging
      console.log(`🔍 [STRATEGY-3-DEBUG] Available inline attachments:`, 
        inlineAttachments.map((att: any, idx: number) => ({
          index: idx,
          name: att.name || 'unnamed',
          size: att.size
        }))
      );

      // Smart index selection based on CID analysis
      const targetIndex = this.calculateSmartIndex(originalCid, inlineAttachments.length);
      console.log(`🔍 [STRATEGY-3-DEBUG] Calculated target index: ${targetIndex} (from CID analysis)`);
      
      // Try the calculated index first, then fallback to others
      const indexesToTry = [targetIndex, 0, 1, 2].filter((idx, pos, arr) => 
        idx < inlineAttachments.length && arr.indexOf(idx) === pos
      );
      
      console.log(`🔍 [STRATEGY-3-DEBUG] Will try indexes in order: [${indexesToTry.join(', ')}]`);
      
      for (const index of indexesToTry) {
        try {
          const att = inlineAttachments[index];
          const detailed = await client
            .api(`/me/messages/${messageId}/attachments/${att.id}`)
            .get();
          
          console.log(`✅ [STRATEGY-3-SUCCESS] Using attachment at index ${index}: "${att.name || 'unnamed'}" (size: ${att.size})`);
          return this.createAttachmentContent(detailed, originalCid);
        } catch (attError: any) {
          console.warn(`🔧 [STRATEGY-3] Failed to get attachment at index ${index}:`, attError.code);
          continue;
        }
      }

      console.log(`❌ [STRATEGY-3-FAILED] All index attempts failed for ${indexesToTry.length} indexes`);
      return null;
    } catch (error: any) {
      console.warn(`🔧 [STRATEGY-3] Strategy failed:`, error.code || error.message);
      return null;
    }
  }

  // NEW: Create placeholder attachment for failed resolutions
  private createPlaceholderAttachment(cid: string): AttachmentContent {
    const placeholderText = `Image not available (CID: ${cid})`;
    return {
      data: new TextEncoder().encode(placeholderText),
      contentType: 'text/plain',
      filename: `missing-image-${cid.substring(0, 8)}.txt`
    };
  }

  // Enhanced scoring with detailed breakdown for debugging
  private calculateFilenameScoreWithDebug(filename: string, patterns: string[], originalCid: string): any {
    let totalScore = 0;
    const lowerFilename = filename.toLowerCase();
    const breakdown = {};
    
    for (const pattern of patterns) {
      const lowerPattern = pattern.toLowerCase();
      let patternScore = 0;
      
      // Exact match (highest score)
      if (lowerFilename.includes(lowerPattern)) {
        if (pattern.length > 8) {
          patternScore = 100; // Long hex matches are very reliable
          breakdown[`hex_${pattern}`] = 100;
        } else if (pattern.startsWith('ii_')) {
          patternScore = 80;  // CID-like patterns
          breakdown[`cid_${pattern}`] = 80;
        } else if (pattern.match(/image\d+/)) {
          patternScore = 60;  // Numbered images
          breakdown[`numbered_${pattern}`] = 60;
        } else {
          patternScore = 20;  // Generic matches
          breakdown[`generic_${pattern}`] = 20;
        }
        totalScore += patternScore;
      }
      
      // Partial hex matches
      if (pattern.length >= 8) {
        const partialMatches = this.findPartialMatches(lowerFilename, lowerPattern);
        const partialScore = partialMatches * 10;
        if (partialScore > 0) {
          breakdown[`partial_${pattern}`] = partialScore;
          totalScore += partialScore;
        }
      }
    }
    
    // Bonus for image file extensions
    if (lowerFilename.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
      breakdown['image_extension'] = 10;
      totalScore += 10;
    }
    
    // Penalty for very generic names
    if (lowerFilename === 'image.jpg' || lowerFilename === 'untitled') {
      breakdown['generic_penalty'] = -30;
      totalScore = Math.max(0, totalScore - 30);
    }
    
    return {
      totalScore: totalScore,
      breakdown: breakdown
    };
  }

  // Find exact CID matches (handles edge case of similar patterns)
  private findExactCidMatch(scoredAttachments: any[], targetCid: string): any | null {
    const normalizedTarget = this.normalizeAdvancedCid(targetCid);
    
    // Look for exact CID in filename
    for (const scored of scoredAttachments) {
      const filename = scored.name.toLowerCase();
      
      // Check for exact full CID match
      if (filename.includes(normalizedTarget.toLowerCase())) {
        console.log(`🔍 [STRATEGY-2-DEBUG] Exact CID match found: "${normalizedTarget}" in "${scored.name}"`);
        return scored;
      }
      
      // Check for exact hex pattern match
      const targetHex = this.extractCidBase(targetCid);
      if (targetHex && filename.includes(targetHex.toLowerCase())) {
        // Ensure it's not just a partial match by checking context
        const hexPattern = new RegExp(`\\b${targetHex.toLowerCase()}\\b`, 'i');
        if (hexPattern.test(filename)) {
          console.log(`🔍 [STRATEGY-2-DEBUG] Exact hex match found: "${targetHex}" in "${scored.name}"`);
          return scored;
        }
      }
    }
    
    return null;
  }

  // Resolve score conflicts with advanced matching
  private resolveScoreConflict(tiedAttachments: any[], targetCid: string): any | null {
    console.log(`🔍 [STRATEGY-2-DEBUG] Resolving conflict between ${tiedAttachments.length} attachments`);
    
    // Priority 1: Exact CID substring match
    const targetHex = this.extractCidBase(targetCid);
    if (targetHex) {
      for (const tied of tiedAttachments) {
        if (tied.name.toLowerCase().includes(targetHex.toLowerCase())) {
          console.log(`🔍 [STRATEGY-2-DEBUG] Conflict resolved by hex match: "${targetHex}" in "${tied.name}"`);
          return tied;
        }
      }
    }
    
    // Priority 2: Longest filename (more specific)
    const longestName = tiedAttachments.reduce((prev, current) => 
      (current.name.length > prev.name.length) ? current : prev
    );
    console.log(`🔍 [STRATEGY-2-DEBUG] Conflict resolved by longest filename: "${longestName.name}"`);
    return longestName;
  }

  private normalizeAdvancedCid(cid: string): string {
    if (!cid) return '';
    
    return cid
      .replace(/^cid:/i, '')           // Remove cid: prefix
      .replace(/^<|>$/g, '')          // Remove < > wrappers
      .replace(/['"]/g, '')           // Remove quotes
      .replace(/\s+/g, '')            // Remove whitespace
      .toLowerCase()                   // Case insensitive
      .replace(/^ii_/, '')            // Remove ii_ prefix for comparison
      .replace(/@.*$/, '');           // Remove @domain suffix if present
  }

  private extractCidBase(cid: string): string | null {
    // Extract the core identifier from CIDs like "ii_19768a017303187840e1"
    const match = cid.match(/([a-f0-9]{16,})/i);
    return match ? match[1] : null;
  }

  private extractCidFromFilename(filename: string): string | null {
    // Look for CID patterns in filenames like "image_ii_19768a017303187840e1.jpg"
    const cidMatch = filename.match(/ii_([a-f0-9]+)/i);
    return cidMatch ? `ii_${cidMatch[1]}` : null;
  }

  private generateFilenamePatterns(cid: string): string[] {
    const patterns = [];
    
    // Extract potential identifiers from CID
    const hexMatch = cid.match(/([a-f0-9]{8,})/i);
    const numMatch = cid.match(/(\d+)/);
    
    if (hexMatch) {
      const hex = hexMatch[1];
      patterns.push(hex);                           // "19768a017303187840e1"
      patterns.push(hex.substring(0, 8));          // "19768a01"
      patterns.push(`ii_${hex}`);                  // "ii_19768a017303187840e1"
    }
    
    if (numMatch) {
      const num = numMatch[1];
      patterns.push(`image${num}`);                // "image1", "image2"
      patterns.push(`img${num}`);                  // "img1", "img2"
      patterns.push(`attachment${num}`);           // "attachment1"
    }
    
    // Common image filename patterns
    patterns.push('image');
    patterns.push('inline');
    patterns.push('embedded');
    
    return patterns;
  }

  private findPartialMatches(filename: string, pattern: string): number {
    // Find overlapping substrings
    let matches = 0;
    for (let i = 0; i <= pattern.length - 4; i++) {
      const substr = pattern.substring(i, i + 4);
      if (filename.includes(substr)) {
        matches++;
      }
    }
    return matches;
  }

  private calculateSmartIndex(cid: string, totalAttachments: number): number {
    // Extract number from CID if present
    const numberMatch = cid.match(/(\d+)/);
    if (numberMatch) {
      const num = parseInt(numberMatch[1]);
      // Convert 1-based numbering to 0-based index
      const index = Math.max(0, num - 1);
      return Math.min(index, totalAttachments - 1);
    }
    
    // Extract position hints from hex patterns
    const hexMatch = cid.match(/([a-f0-9]+)/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      // Use last few digits as a simple hash to distribute across attachments
      const lastDigits = hex.slice(-2);
      const hashValue = parseInt(lastDigits, 16) || 0;
      return hashValue % totalAttachments;
    }
    
    return 0; // Default to first attachment
  }

  private createAttachmentContent(detailed: any, cid: string): AttachmentContent {
    const content = detailed.contentBytes 
      ? new Uint8Array(atob(detailed.contentBytes).split('').map(c => c.charCodeAt(0)))
      : new Uint8Array(0);

    return {
      data: content,
      contentType: detailed.contentType || 'application/octet-stream',
      filename: detailed.name || `resolved-${cid.substring(0, 8)}.unknown`
    };
  }

  // Legacy method for backwards compatibility
  private normalizeCid(cid?: string): string {
    if (!cid) return '';
    return cid.replace(/^cid:/i, '').replace(/[<>]/g, '').toLowerCase();
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

// Gmail Provider (unchanged from original - placeholder for Phase 4)
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

// IMAP Provider (unchanged from original - placeholder for Phase 4)
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

// Provider factory (unchanged from original)
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

// Helper function to determine provider type from store platform (unchanged from original)
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

// Utility: Normalize a CID (strip <>, cid:, lowercase) - unchanged from original
function normalizeCid(cid?: string): string {
  if (!cid) return '';
  return cid.replace(/^cid:/i, '').replace(/[<>]/g, '').toLowerCase();
}

// Enhanced Attachment metadata processing utilities with synthetic support
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
        // NEW: Synthetic attachment fields
        synthetic: att.synthetic || false,
        original_message_id: att.originalMessageId,
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

  // NEW: Detect emails with orphaned CIDs (CIDs in HTML but no attachment metadata)
  static detectOrphanedCids(emails: EmailRecord[]): EmailRecord[] {
    console.log(`🔍 [CID-ORPHAN] Checking ${emails.length} emails for orphaned CIDs`);
    
    const orphanedEmails: EmailRecord[] = [];
    
    for (const email of emails) {
      if (!email.content) continue;
      
      // Extract CIDs from HTML content
      const htmlCids = this.extractContentIdFromHtml(email.content);
      const attachmentCount = email.attachment_reference_count || 0;
      
      // Check if email has CIDs but no attachments
      if (htmlCids.length > 0 && attachmentCount === 0) {
        console.log(`🔍 [CID-ORPHAN] FOUND orphaned email "${email.id}" - ${htmlCids.length} CIDs, ${attachmentCount} attachments`);
        orphanedEmails.push({
          ...email,
          orphanedCids: htmlCids
        });
      }
    }
    
    console.log(`🔍 [CID-ORPHAN] Detection complete - Found ${orphanedEmails.length} emails with orphaned CIDs`);
    return orphanedEmails;
  }

  // NEW: Create synthetic attachments for orphaned CIDs
  static createSyntheticAttachments(htmlContent: string, messageId: string): AttachmentMetadata[] {
    console.log(`🔧 [SYNTHETIC] Creating synthetic attachments for message ${messageId}`);
    
    const contentIds = this.extractContentIdFromHtml(htmlContent);
    
    if (contentIds.length === 0) {
      console.log(`🔧 [SYNTHETIC] No CIDs found, returning empty array`);
      return [];
    }

    const syntheticAttachments = contentIds.map((cid, index) => {
      const synthetic: AttachmentMetadata = {
        filename: `inline-image-${cid.substring(0, 8)}.unknown`,
        contentType: 'image/unknown', // Will be determined on download
        fileSize: 0, // Unknown until downloaded
        contentId: cid,
        isInline: true,
        providerAttachmentId: `synthetic-${messageId}-${cid}`,
        providerType: 'outlook' as const,
        synthetic: true,
        originalMessageId: messageId,
        providerMetadata: {
          syntheticGenerated: true,
          detectedFromHtml: true,
          cidExtracted: cid
        }
      };
      
      console.log(`🔧 [SYNTHETIC] Created synthetic attachment ${index + 1}:`, {
        filename: synthetic.filename,
        contentId: synthetic.contentId,
        providerAttachmentId: synthetic.providerAttachmentId
      });
      
      return synthetic;
    });

    console.log(`🔧 [SYNTHETIC] Generated ${syntheticAttachments.length} synthetic attachments for message ${messageId}`);
    return syntheticAttachments;
  }
} 