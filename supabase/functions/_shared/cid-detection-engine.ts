/**
 * Advanced CID Detection Engine
 * Phase 2: Core Synthetic Logic
 * 
 * Provides sophisticated CID detection, analysis, and orphaned CID identification
 * with support for various email formats, encoding patterns, and HTML structures.
 */

import { 
  EmailRecord, 
  OrphanedEmailRecord, 
  CidDetectionStats,
  AttachmentMetadata 
} from './types.ts';

export interface CidPattern {
  pattern: RegExp;
  type: 'src' | 'href' | 'background' | 'style';
  priority: number;
  description: string;
}

export interface CidExtractionResult {
  emailId: string;
  detectedCids: string[];
  normalizedCids: string[];
  htmlSample: string;
  patterns: { [key: string]: number };
  confidence: number;
  hasAttachments: boolean;
  attachmentCount: number;
}

export class CidDetectionEngine {
  private patterns: CidPattern[] = [
    // Standard IMG src with CID
    {
      pattern: /src=['"]?cid:([^'">\s]+)['"]?/gi,
      type: 'src',
      priority: 1,
      description: 'Standard IMG src with CID reference'
    },
    // Anchor href with CID
    {
      pattern: /href=['"]?cid:([^'">\s]+)['"]?/gi,
      type: 'href',
      priority: 2,
      description: 'Anchor href with CID reference'
    },
    // Background image with CID
    {
      pattern: /background(-image)?:\s*url\(['"]?cid:([^'")\s]+)['"]?\)/gi,
      type: 'background',
      priority: 3,
      description: 'CSS background image with CID'
    },
    // Style attribute with CID
    {
      pattern: /style=['"][^'"]*background[^'"]*cid:([^'">\s;]+)/gi,
      type: 'style',
      priority: 4,
      description: 'Inline style with CID reference'
    },
    // Alternative CID format without colon
    {
      pattern: /src=['"]?([A-Za-z0-9]{8,}@[A-Za-z0-9.-]+)['"]?/gi,
      type: 'src',
      priority: 5,
      description: 'Alternative CID format (email-like)'
    }
  ];

  private supabaseClient: any;

  constructor(supabaseClient: any) {
    this.supabaseClient = supabaseClient;
  }

  // Extract all CIDs from HTML content with detailed analysis
  extractCidsFromHtml(htmlContent: string, emailId?: string): CidExtractionResult {
    console.log(`🔍 [CID-ENGINE] Starting advanced CID extraction${emailId ? ` for email ${emailId}` : ''}`);
    
    if (!htmlContent) {
      return {
        emailId: emailId || 'unknown',
        detectedCids: [],
        normalizedCids: [],
        htmlSample: '',
        patterns: {},
        confidence: 0,
        hasAttachments: false,
        attachmentCount: 0
      };
    }

    const detectedCids: string[] = [];
    const patternMatches: { [key: string]: number } = {};
    const htmlSample = htmlContent.length > 300 ? 
      htmlContent.substring(0, 300) + '...' : htmlContent;

    // Apply each pattern and collect results
    for (const cidPattern of this.patterns) {
      let match;
      let matchCount = 0;
      cidPattern.pattern.lastIndex = 0; // Reset regex
      
      while ((match = cidPattern.pattern.exec(htmlContent)) !== null) {
        const cid = match[1] || match[2]; // Different capture groups for different patterns
        if (cid) {
          detectedCids.push(cid);
          matchCount++;
        }
      }
      
      if (matchCount > 0) {
        patternMatches[cidPattern.description] = matchCount;
        console.log(`🔍 [CID-ENGINE] Pattern "${cidPattern.type}" found ${matchCount} matches`);
      }
    }

    // Normalize and deduplicate CIDs
    const normalizedCids = [...new Set(detectedCids.map(cid => this.normalizeCid(cid)))];

    // Calculate confidence score
    const confidence = this.calculateConfidence(detectedCids, patternMatches, htmlContent);

    const result: CidExtractionResult = {
      emailId: emailId || 'unknown',
      detectedCids,
      normalizedCids,
      htmlSample,
      patterns: patternMatches,
      confidence,
      hasAttachments: false, // Will be set by caller
      attachmentCount: 0     // Will be set by caller
    };

    console.log(`🔍 [CID-ENGINE] Extraction complete:`, {
      totalDetected: detectedCids.length,
      uniqueNormalized: normalizedCids.length,
      confidence: `${confidence}%`,
      patternsUsed: Object.keys(patternMatches).length
    });

    return result;
  }

  // Batch detect orphaned CIDs across multiple emails
  async detectOrphanedCidsBatch(emails: EmailRecord[]): Promise<{
    orphanedEmails: OrphanedEmailRecord[];
    stats: CidDetectionStats;
  }> {
    const startTime = Date.now();
    console.log(`🔍 [CID-ENGINE] Starting batch orphaned CID detection for ${emails.length} emails`);

    const orphanedEmails: OrphanedEmailRecord[] = [];
    let totalCidsDetected = 0;
    let emailsWithCids = 0;
    let emailsWithAttachments = 0;
    let totalOrphanedCids = 0;

    for (const email of emails) {
      const extraction = this.extractCidsFromHtml(email.content, email.id);
      
      // Set attachment information
      extraction.hasAttachments = (email.attachment_reference_count || 0) > 0;
      extraction.attachmentCount = email.attachment_reference_count || 0;

      // Count statistics
      if (extraction.normalizedCids.length > 0) {
        emailsWithCids++;
        totalCidsDetected += extraction.normalizedCids.length;
      }

      if (extraction.hasAttachments) {
        emailsWithAttachments++;
      }

      // Check if email has orphaned CIDs
      if (extraction.normalizedCids.length > 0 && !extraction.hasAttachments) {
        console.log(`🔍 [CID-ENGINE] ORPHAN DETECTED: Email ${email.id} has ${extraction.normalizedCids.length} CIDs but 0 attachments`);
        
        totalOrphanedCids += extraction.normalizedCids.length;
        
        orphanedEmails.push({
          ...email,
          orphanedCids: extraction.normalizedCids,
          orphanDetectedAt: new Date()
        });
      }
    }

    const detectionTimeMs = Date.now() - startTime;

    const stats: CidDetectionStats = {
      totalEmails: emails.length,
      emailsWithCids,
      emailsWithAttachments,
      orphanedCidEmails: orphanedEmails.length,
      totalCidsDetected,
      totalOrphanedCids,
      detectionTimeMs
    };

    console.log(`🔍 [CID-ENGINE] Batch detection complete:`, {
      processed: emails.length,
      withCids: emailsWithCids,
      withAttachments: emailsWithAttachments,
      orphaned: orphanedEmails.length,
      duration: `${detectionTimeMs}ms`
    });

    return { orphanedEmails, stats };
  }

  // Advanced CID validation and analysis
  validateCid(cid: string): {
    valid: boolean;
    normalized: string;
    type: 'outlook' | 'gmail' | 'generic' | 'unknown';
    confidence: number;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const normalized = this.normalizeCid(cid);
    
    // Detect CID type patterns
    let type: 'outlook' | 'gmail' | 'generic' | 'unknown' = 'unknown';
    let confidence = 0;

    // Outlook pattern: usually contains hex-like strings
    if (/^[a-f0-9]{8,}/i.test(normalized)) {
      type = 'outlook';
      confidence = 85;
    }
    // Gmail pattern: usually has @ symbol
    else if (normalized.includes('@')) {
      type = 'gmail';
      confidence = 80;
    }
    // Generic patterns
    else if (/^[a-zA-Z0-9_-]{4,}$/.test(normalized)) {
      type = 'generic';
      confidence = 60;
    }

    // Validation checks
    let valid = true;

    if (normalized.length < 3) {
      valid = false;
      warnings.push('CID too short');
    }

    if (normalized.length > 100) {
      valid = false;
      warnings.push('CID unusually long');
    }

    if (/[<>'"\\]/.test(normalized)) {
      warnings.push('Contains potentially problematic characters');
      confidence -= 20;
    }

    return {
      valid,
      normalized,
      type,
      confidence: Math.max(0, confidence),
      warnings
    };
  }

  // Generate synthetic attachment metadata for orphaned CIDs
  generateSyntheticAttachments(
    orphanedCids: string[], 
    messageId: string, 
    emailId: string
  ): AttachmentMetadata[] {
    console.log(`🔧 [CID-ENGINE] Generating synthetic attachments for ${orphanedCids.length} orphaned CIDs`);

    return orphanedCids.map((cid, index) => {
      const validation = this.validateCid(cid);
      const filename = this.generateSyntheticFilename(cid, index, validation.type);
      
      // CRITICAL FIX: Ensure content_id doesn't exceed 100 character database limit
      const normalizedCid = validation.normalized;
      const truncatedContentId = normalizedCid.length > 95 
        ? normalizedCid.substring(0, 95) 
        : normalizedCid;
      
      // Ensure provider attachment ID uses the original (not truncated) CID for uniqueness
      const providerAttachmentId = `synthetic-${messageId}-${normalizedCid}`;
      
      const synthetic: AttachmentMetadata = {
        filename,
        contentType: this.predictContentType(cid, validation.type),
        fileSize: 0, // Unknown until resolved
        contentId: truncatedContentId,  // FIXED: Truncated to prevent constraint violation
        isInline: true,
        providerAttachmentId: providerAttachmentId,  // Full ID for uniqueness
        providerType: 'outlook' as const,
        synthetic: true,
        originalMessageId: messageId,
        orphanedCidDetectedAt: new Date(),
        providerMetadata: {
          syntheticGenerated: true,
          cidValidation: validation,
          detectionConfidence: validation.confidence,
          originalCid: cid,
          detectionIndex: index,
          // Store original CID if truncated
          originalContentId: normalizedCid !== truncatedContentId ? normalizedCid : undefined
        }
      };

      console.log(`🔧 [CID-ENGINE] Created synthetic attachment ${index + 1}:`, {
        filename: synthetic.filename,
        contentId: synthetic.contentId,
        contentIdLength: synthetic.contentId.length,
        truncated: normalizedCid !== truncatedContentId,
        confidence: validation.confidence,
        type: validation.type
      });

      return synthetic;
    });
  }

  // Helper: Normalize CID for consistent matching
  private normalizeCid(cid: string): string {
    if (!cid) return '';
    return cid
      .replace(/^cid:/i, '')
      .replace(/[<>]/g, '')
      .trim()
      .toLowerCase();
  }

  // Helper: Calculate confidence score for CID detection
  private calculateConfidence(
    detectedCids: string[], 
    patternMatches: { [key: string]: number }, 
    htmlContent: string
  ): number {
    let confidence = 0;

    // Base confidence from number of CIDs found
    confidence += Math.min(detectedCids.length * 10, 40);

    // Bonus for high-priority pattern matches
    for (const [pattern, count] of Object.entries(patternMatches)) {
      if (pattern.includes('IMG src')) confidence += count * 15;
      else if (pattern.includes('background')) confidence += count * 10;
      else confidence += count * 5;
    }

    // Bonus for HTML structure indicators
    if (htmlContent.includes('<img')) confidence += 10;
    if (htmlContent.includes('inline')) confidence += 5;
    if (htmlContent.includes('attachment')) confidence += 5;

    // Penalty for suspicious patterns
    if (detectedCids.some(cid => cid.length < 3)) confidence -= 10;
    if (detectedCids.length > 20) confidence -= 15; // Too many might be false positives

    return Math.min(100, Math.max(0, confidence));
  }

  // Helper: Generate appropriate filename for synthetic attachment
  private generateSyntheticFilename(cid: string, index: number, type: string): string {
    const normalized = this.normalizeCid(cid);
    const shortId = normalized.substring(0, 8);
    
    // Generate filename based on CID type
    switch (type) {
      case 'outlook':
        return `inline-image-${shortId}.jpg`;
      case 'gmail':
        return `embedded-${shortId}.png`;
      case 'generic':
        return `attachment-${shortId}.unknown`;
      default:
        return `image-${index + 1}-${shortId}.unknown`;
    }
  }

  // Helper: Predict content type based on CID characteristics
  private predictContentType(cid: string, type: string): string {
    // Most inline images are JPEG or PNG
    if (type === 'outlook') {
      return 'image/jpeg'; // Outlook commonly uses JPEG
    } else if (type === 'gmail') {
      return 'image/png'; // Gmail often uses PNG
    }
    
    // Default for unknown types
    return 'image/unknown';
  }

  // Analyze email content for attachment-related patterns
  analyzeEmailContext(htmlContent: string): {
    hasImageReferences: boolean;
    hasAttachmentKeywords: boolean;
    hasInlineIndicators: boolean;
    estimatedAttachmentCount: number;
    keywords: string[];
  } {
    const keywords: string[] = [];
    
    // Check for image-related keywords
    const imageKeywords = ['image', 'picture', 'photo', 'screenshot', 'attachment'];
    const hasImageReferences = imageKeywords.some(keyword => {
      const found = htmlContent.toLowerCase().includes(keyword);
      if (found) keywords.push(keyword);
      return found;
    });

    // Check for attachment keywords
    const attachmentKeywords = ['attached', 'attachment', 'enclosed', 'included'];
    const hasAttachmentKeywords = attachmentKeywords.some(keyword => {
      const found = htmlContent.toLowerCase().includes(keyword);
      if (found) keywords.push(keyword);
      return found;
    });

    // Check for inline indicators
    const inlineKeywords = ['inline', 'embedded', 'below', 'above'];
    const hasInlineIndicators = inlineKeywords.some(keyword => {
      const found = htmlContent.toLowerCase().includes(keyword);
      if (found) keywords.push(keyword);
      return found;
    });

    // Estimate attachment count from various indicators
    const imgTags = (htmlContent.match(/<img/gi) || []).length;
    const cidReferences = (htmlContent.match(/cid:/gi) || []).length;
    const estimatedAttachmentCount = Math.max(imgTags, cidReferences);

    return {
      hasImageReferences,
      hasAttachmentKeywords,
      hasInlineIndicators,
      estimatedAttachmentCount,
      keywords
    };
  }
} 