/**
 * Enterprise-Grade Email Content Parser - Browser Compatible
 * 
 * This implementation follows RFC 5322 standards and uses content structure analysis
 * rather than pattern matching, which is how enterprise email parsing actually works.
 * 
 * Industry Standard Approach:
 * 1. Content segmentation based on structural markers
 * 2. Header pattern recognition with confidence scoring
 * 3. Context-aware validation rather than regex pattern matching
 * 4. Graceful fallback with detailed reporting
 * 5. HTML formatting preservation through position mapping
 */

/*
 * ENTERPRISE EMAIL PARSER - BROWSER VERSION
 * 
 * ⚠️  CRITICAL THREADING SYSTEM DOCUMENTATION ⚠️
 * 
 * This parser is responsible for maintaining EMAIL THREADING INTEGRITY while parsing quoted content.
 * The threading system depends on RFC2822 headers embedded as HTML comments in email content:
 * 
 * <!--[RFC2822-THREADING-HEADERS-START]-->
 * Message-ID: <unique-message-id@domain.com>
 * In-Reply-To: <parent-message-id@domain.com>
 * References: <thread-root-id@domain.com> <parent-message-id@domain.com>
 * Thread-Topic: Subject of the conversation
 * Thread-Index: Base64-encoded threading information
 * <!--[RFC2822-THREADING-HEADERS-END]-->
 * 
 * CRITICAL RULES FOR THREADING HEADER PRESERVATION:
 * 
 * 1. ALWAYS extract threading headers BEFORE any content processing
 * 2. NEVER include threading headers in quoted content detection
 * 3. ALWAYS restore threading headers with the original content
 * 4. NEVER move or modify threading headers during parsing
 * 5. Preserve threading headers even in error/fallback scenarios
 * 
 * If these rules are violated, the get_or_create_thread_id_universal function
 * will fail to identify thread relationships, causing emails to appear as
 * separate threads instead of grouped conversations.
 * 
 * TESTING: After any changes to this file, verify that:
 * - Existing email threads remain properly grouped
 * - New emails are correctly threaded with their parents
 * - Threading headers are present in parsed original content
 * - Rich text formatting is still preserved
 */

// Core interface for parsed email content
export interface EnterpriseEmailContent {
  originalContent: string;
  quotedContent: string;
  hasQuotedContent: boolean;
  quotedHeaders?: {
    from?: string;
    date?: string;
    to?: string;
    cc?: string;
    subject?: string;
  };
  metadata: {
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
    threadId?: string;
    isMultipart: boolean;
    hasAttachments: boolean;
    contentType: string;
  };
}

/**
 * ENTERPRISE APPROACH: Content Structure Analysis with Formatting Preservation
 * Instead of pattern matching, analyze content structure markers
 */
interface ContentSegment {
  content: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  markers: string[];
  originalStartIndex: number; // Position in original HTML
  originalEndIndex: number;   // Position in original HTML
}

/**
 * Industry-standard structural markers for quoted content
 * Enhanced patterns based on real-world email formats from major email clients
 */
const QUOTED_CONTENT_MARKERS = [
  // Microsoft Outlook HTML format (highest confidence) - EXACT PATTERN FROM SCREENSHOT
  { pattern: /From:\s*[^\n\r]+<[^>]+@[^>]+>[^\n\r]*[\s\S]*?Sent:\s*[^\n\r]+[\s\S]*?To:\s*[^\n\r]+[\s\S]*?Subject:/mi, confidence: 0.95, type: 'outlook_html_headers' },
  
  // Microsoft Outlook plain text format (high confidence)
  { pattern: /From:\s*[^\n\r]+[\n\r]+Sent:\s*[^\n\r]+[\n\r]+To:\s*[^\n\r]+[\n\r]+Subject:/mi, confidence: 0.90, type: 'outlook_plain_headers' },
  
  // Generic "From:" header block with multiple fields (high confidence)
  { pattern: /From:\s*[^\n\r]+[\s\S]*?(?:Sent|Date):\s*[^\n\r]+[\s\S]*?To:\s*[^\n\r]+[\s\S]*?Subject:\s*[^\n\r]+/mi, confidence: 0.85, type: 'generic_email_headers' },
  
  // RFC standard markers (highest confidence)
  { pattern: /^-{3,}\s*Original Message\s*-{3,}/mi, confidence: 0.95, type: 'rfc_original' },
  { pattern: /^-{3,}\s*Forwarded Message\s*-{3,}/mi, confidence: 0.95, type: 'rfc_forwarded' },
  { pattern: /^Begin forwarded message:/mi, confidence: 0.90, type: 'apple_forwarded' },
  
  // Email client specific markers (high confidence)
  { pattern: /gmail_quote/i, confidence: 0.90, type: 'gmail_wrapper' },
  { pattern: /type="cite"/i, confidence: 0.85, type: 'html_cite' },
  
  // Content structure markers (medium confidence)
  { pattern: /wrote:\s*$/mi, confidence: 0.75, type: 'inline_reply' },
  { pattern: /^On\s+.*wrote:/mi, confidence: 0.80, type: 'threaded_reply' },
  { pattern: /^>\s*/m, confidence: 0.60, type: 'quote_prefix' }
];

/**
 * ⚠️  CRITICAL THREADING FUNCTION ⚠️
 * Extract threading headers and preserve them separately from email content
 * 
 * This function is the cornerstone of email threading integrity. It:
 * 1. Extracts RFC2822 threading headers embedded as HTML comments
 * 2. Returns both the headers and content WITHOUT headers for separate processing
 * 3. Prevents threading headers from interfering with quoted content detection
 * 
 * The threading headers contain essential information for grouping emails:
 * - Message-ID: Unique identifier for this email
 * - In-Reply-To: ID of the email this is replying to
 * - References: Chain of all emails in the thread
 * - Thread-Topic: Subject line of the conversation
 * - Thread-Index: Microsoft-specific threading data
 * 
 * NEVER modify this function without understanding the threading implications!
 * 
 * @param html - Raw HTML email content with potential threading headers
 * @returns Object with threadingHeaders (as string) and htmlWithoutHeaders
 */
const extractAndPreserveThreadingHeaders = (html: string) => {
  // This regex pattern matches the EXACT format used by the backend threading system
  // Format: <!--[RFC2822-THREADING-HEADERS-START]-->...headers...<!--[RFC2822-THREADING-HEADERS-END]-->
  const threadingHeadersRegex = /<!--\[RFC2822-THREADING-HEADERS-START\]-->.*?<!--\[RFC2822-THREADING-HEADERS-END\]-->/gs;
  const threadingHeaders = html.match(threadingHeadersRegex) || [];
  
  // Remove threading headers from content for parsing, but preserve them separately
  // This prevents the headers from being detected as quoted content or email signatures
  const htmlWithoutHeaders = html.replace(threadingHeadersRegex, '');
  
  // Log for debugging - helps track if headers are being preserved correctly
  if (threadingHeaders.length > 0) {
    console.log('🧵 Threading headers extracted:', {
      count: threadingHeaders.length,
      totalLength: threadingHeaders.join('').length,
      preview: threadingHeaders[0].substring(0, 100) + '...'
    });
  }
  
  return {
    threadingHeaders: threadingHeaders.join('\n'), // Combine all headers into single string
    htmlWithoutHeaders: htmlWithoutHeaders
  };
};

/**
 * Find the actual HTML position of a quoted content pattern
 * This uses the pattern match from clean text to find the corresponding position in HTML
 */
function findQuotedContentInHtml(html: string, pattern: RegExp, startIdx: number, endIdx: number): QuotedMatch | null {
  // CRITICAL: First extract and preserve threading headers
  const { threadingHeaders, htmlWithoutHeaders } = extractAndPreserveThreadingHeaders(html);
  
  // Use the HTML without threading headers for parsing
  const workingHtml = htmlWithoutHeaders;
  
  // Convert to clean text for pattern matching while building position map
  const positionMap: Array<{ htmlIndex: number; textIndex: number }> = [];
  let cleanText = '';
  let htmlIndex = 0;
  let textIndex = 0;
  
  // Build position mapping between clean text and HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = workingHtml;
  
  const walker = document.createTreeWalker(
    tempDiv,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let node;
  while (node = walker.nextNode()) {
    const nodeText = node.textContent || '';
    const nodeStartInHtml = workingHtml.indexOf(nodeText, htmlIndex);
    
    if (nodeStartInHtml !== -1) {
      // Map each character
      for (let i = 0; i < nodeText.length; i++) {
        positionMap.push({
          htmlIndex: nodeStartInHtml + i,
          textIndex: textIndex + i
        });
      }
      
      cleanText += nodeText;
      textIndex += nodeText.length;
      htmlIndex = nodeStartInHtml + nodeText.length;
    }
  }
  
  // Test pattern on clean text
  const match = cleanText.match(pattern);
  if (!match || typeof match.index !== 'number') {
    return null;
  }
  
  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  
  // Ensure match is within specified bounds
  if (matchStart < startIdx || matchEnd > endIdx) {
    return null;
  }
  
  // Map back to HTML positions
  const htmlStart = positionMap.find(p => p.textIndex === matchStart)?.htmlIndex ?? 0;
  const htmlEnd = positionMap.find(p => p.textIndex === matchEnd - 1)?.htmlIndex ?? workingHtml.length;
  
  // Find appropriate HTML boundaries
  let htmlStartBoundary = htmlStart;
  let htmlEndBoundary = htmlEnd;
  
  // Expand to include complete HTML tags
  while (htmlStartBoundary > 0 && workingHtml[htmlStartBoundary] !== '<') {
    htmlStartBoundary--;
  }
  
  while (htmlEndBoundary < workingHtml.length && workingHtml[htmlEndBoundary] !== '>') {
    htmlEndBoundary++;
  }
  if (htmlEndBoundary < workingHtml.length) htmlEndBoundary++;
  
  return {
    originalContent: workingHtml.substring(0, htmlStartBoundary),
    quotedContent: workingHtml.substring(htmlStartBoundary, htmlEndBoundary),
    threadingHeaders, // Always preserve threading headers with original content
    confidence: 0.85
  };
}

/**
 * ENTERPRISE APPROACH: Analyze content structure with formatting preservation
 */
function analyzeContentStructure(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const normalizedContent = normalizeContent(content);
  
  console.log('🔍 Enterprise Analysis - Content Structure (Formatting Preserving):', {
    contentLength: content.length,
    hasHtmlTags: /<[^>]+>/.test(content),
    markerAnalysis: 'Starting structural analysis with position mapping...',
    contentPreview: content.substring(0, 300).replace(/\n/g, '\\n')
  });
  
  // Create clean text version for pattern matching
  let searchContent = normalizedContent;
  
  if (/<[^>]+>/.test(normalizedContent)) {
    // Create a clean text version for pattern matching
    searchContent = normalizedContent
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim();
    
    console.log('📋 Clean Text for Pattern Matching (first 1000 chars):', searchContent.substring(0, 1000));
  }
  
  // Find all structural markers
  for (const marker of QUOTED_CONTENT_MARKERS) {
    console.log(`🔍 Testing pattern: ${marker.type}`, {
      pattern: marker.pattern.source,
      confidence: marker.confidence
    });
    
    const matches = [...searchContent.matchAll(new RegExp(marker.pattern.source, marker.pattern.flags + 'g'))];
    
    if (matches.length > 0) {
      console.log(`✅ Pattern ${marker.type} found ${matches.length} matches`);
      
      for (const match of matches) {
        if (match.index !== undefined) {
          // Position in clean text
          const cleanSegmentStart = match.index;
          const cleanSegmentEnd = searchContent.length;
          const cleanSegmentContent = searchContent.slice(cleanSegmentStart, cleanSegmentEnd);
          
          // Find corresponding position in original HTML
          const originalStart = findQuotedContentInHtml(normalizedContent, marker.pattern, cleanSegmentStart, cleanSegmentEnd);
          const originalEnd = normalizedContent.length;
          
          if (originalStart === null) {
            console.log(`⚠️ Could not find HTML position for ${marker.type} marker, skipping...`);
            continue;
          }
          
          console.log('🗺️ Position mapping:', {
            cleanStart: cleanSegmentStart,
            originalStart: originalStart,
            cleanEnd: cleanSegmentEnd,
            originalEnd: originalEnd,
            patternPreview: cleanSegmentContent.substring(0, 100)
          });
          
          segments.push({
            content: cleanSegmentContent, // For header extraction (clean text)
            startIndex: cleanSegmentStart,
            endIndex: cleanSegmentEnd,
            originalStartIndex: originalStart,
            originalEndIndex: originalEnd,
            confidence: marker.confidence,
            markers: [marker.type]
          });
          
          console.log(`📍 Found ${marker.type} marker at position ${cleanSegmentStart}`, {
            confidence: marker.confidence,
            cleanSegmentLength: cleanSegmentContent.length,
            htmlPosition: originalStart,
            preview: cleanSegmentContent.substring(0, 300)
          });
        }
      }
    } else {
      console.log(`❌ Pattern ${marker.type} - no matches found`);
    }
  }
  
  // Additional fallback analysis - look for headers without strict patterns
  if (segments.length === 0) {
    console.log('🔄 No markers found, trying fallback header detection...');
    
    // Look for any content with multiple email headers (case insensitive)
    const headerPattern = /(From|To|Cc|Subject|Sent|Date):\s*[^\n\r]+/gi;
    const headerMatches = [...searchContent.matchAll(headerPattern)];
    
    if (headerMatches.length >= 2) {
      console.log(`🎯 Fallback: Found ${headerMatches.length} headers, creating segment`);
      
      const cleanFirstHeaderIndex = headerMatches[0].index || 0;
      const cleanSegmentContent = searchContent.slice(cleanFirstHeaderIndex);
      
      // Find corresponding position in original HTML
      const originalFirstHeaderIndex = findQuotedContentInHtml(normalizedContent, headerPattern, cleanFirstHeaderIndex, searchContent.length);
      
      if (originalFirstHeaderIndex !== null) {
        segments.push({
          content: cleanSegmentContent,
          startIndex: cleanFirstHeaderIndex,
          endIndex: searchContent.length,
          originalStartIndex: originalFirstHeaderIndex,
          originalEndIndex: normalizedContent.length,
          confidence: 0.70,
          markers: ['fallback_headers']
        });
        
        console.log('📍 Created fallback segment from headers', {
          headerCount: headerMatches.length,
          segmentLength: cleanSegmentContent.length,
          originalStartIndex: originalFirstHeaderIndex,
          preview: cleanSegmentContent.substring(0, 300)
        });
      } else {
        console.log('⚠️ Could not find HTML position for fallback headers, skipping fallback...');
      }
    }
  }
  
  console.log('📊 Structure Analysis Results:', {
    segmentsFound: segments.length,
    topConfidences: segments.slice(0, 3).map(s => ({ type: s.markers, confidence: s.confidence }))
  });
  
  return segments.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Find the end boundary of a quoted content segment
 */
function findSegmentEnd(content: string, startIndex: number): number {
  // Look for natural boundaries
  const boundaries = [
    /\n\n\s*[^\s>]/, // Double line break followed by non-quoted content
    /\n(?=\w+:\/\/)/, // URL on new line (often signatures)
    /<\/div>\s*<div/, // HTML div boundaries
    /\n\s*--\s*\n/, // Signature separator
  ];
  
  for (const boundary of boundaries) {
    const match = content.match(boundary);
    if (match && match.index) {
      return startIndex + match.index;
    }
  }
  
  // If no boundary found, use full content
  return startIndex + content.length;
}

/**
 * ENTERPRISE APPROACH: Extract headers using structure analysis
 */
function extractHeadersFromSegment(segment: ContentSegment): EnterpriseEmailContent['quotedHeaders'] {
  const content = segment.content;
  const headers: EnterpriseEmailContent['quotedHeaders'] = {};
  
  console.log('📧 Extracting headers from segment:', {
    segmentLength: content.length,
    markers: segment.markers,
    preview: content.substring(0, 200)
  });
  
  // Clean and normalize content for header extraction
  const cleanContent = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n');
  
  // Industry-standard header patterns (multi-language support)
  const headerPatterns = {
    from: /(?:From|De|Von|Da|От):\s*([^\n\r]+?)(?=(?:\n(?:Sent|Date|To|Cc|Subject|Objet|Para|An|Кому|Копия|Тема|Betreff|Assunto):|$))/i,
    date: /(?:Date|Sent|Envoyé|Data|Gesendet|Отправлено|Enviado):\s*([^\n\r]+?)(?=(?:\n(?:From|To|Cc|Subject|De|Von|Da|От|Para|An|Кому|Копия|Тема|Betreff|Assunto):|$))/i,
    to: /(?:To|À|Para|An|Кому):\s*([^\n\r]+?)(?=(?:\n(?:From|Sent|Date|Cc|Subject|De|Von|Da|От|Envoyé|Data|Gesendet|Копия|Тема|Betreff|Assunto):|$))/i,
    cc: /(?:Cc|Copie|Copia|Kopie|Копия):\s*([^\n\r]+?)(?=(?:\n(?:From|Sent|Date|To|Subject|De|Von|Da|От|Envoyé|Data|Gesendet|Para|An|Кому|Тема|Betreff|Assunto):|$))/i,
    subject: /(?:Subject|Objet|Assunto|Betreff|Тема):\s*([^\n\r]+?)(?=(?:\n(?:From|Sent|Date|To|Cc|De|Von|Da|От|Envoyé|Data|Gesendet|Para|An|Кому|Копия):|$))/i
  };
  
  // Extract headers with enhanced cleaning
  for (const [key, pattern] of Object.entries(headerPatterns)) {
    const match = cleanContent.match(pattern);
    if (match && match[1]) {
      let value = match[1].trim()
        .replace(/^\[|\]$/g, '') // Remove brackets
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      if (value && value.length > 0 && value.length < 300) {
        headers[key as keyof EnterpriseEmailContent['quotedHeaders']] = value;
        console.log(`✅ Extracted ${key}: ${value}`);
      }
    }
  }
  
  // Special handling for Microsoft Outlook "Previous Message" format
  if (segment.markers.includes('outlook_previous')) {
    const outlookMatch = cleanContent.match(/To:\s*([^C]+?)Cc:\s*([^S]+?)Subject:\s*([^\n]+)/i);
    if (outlookMatch) {
      headers.to = outlookMatch[1].trim();
      headers.cc = outlookMatch[2].trim();
      headers.subject = outlookMatch[3].trim();
      console.log('✅ Extracted Outlook-style headers');
    }
  }
  
  return headers;
}

/**
 * ENTERPRISE APPROACH: Content validation using industry standards
 */
function validateQuotedContentSegment(segment: ContentSegment): boolean {
  const { content, confidence, markers } = segment;
  
  // Extract headers to validate content structure
  const headers = extractHeadersFromSegment(segment);
  const headerCount = Object.keys(headers).length;
  
  console.log('🔍 Enterprise Validation:', {
    segmentMarkers: markers,
    baseConfidence: confidence,
    headerCount,
    hasEmailPattern: /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(content),
    contentLength: content.length
  });
  
  // Industry standard validation criteria:
  
  // 1. High-confidence structural markers (RFC, Gmail, etc.)
  if (confidence >= 0.85) {
    console.log('✅ High confidence structural marker detected');
    return true;
  }
  
  // 2. Medium confidence markers with supporting evidence
  if (confidence >= 0.70 && headerCount >= 1) {
    console.log('✅ Medium confidence marker with header support');
    return true;
  }
  
  // 3. Header-rich content (likely email regardless of markers)
  if (headerCount >= 2) {
    console.log('✅ Multiple email headers detected');
    return true;
  }
  
  // 4. Email pattern with reasonable structure
  if (confidence >= 0.60 && /@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(content) && content.length > 50) {
    console.log('✅ Email pattern with reasonable structure');
    return true;
  }
  
  console.log('❌ Failed enterprise validation criteria');
  return false;
}

/**
 * Normalize content for consistent analysis
 */
function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ') // Non-breaking spaces
    .replace(/\u2028/g, '\n') // Line separator
    .replace(/\u2029/g, '\n\n'); // Paragraph separator
}

/**
 * Extract metadata from content
 */
function extractMetadata(content: string): EnterpriseEmailContent['metadata'] {
  const hasHTML = /<[^>]+>/.test(content);
  const hasImages = /<img\s+[^>]*src=/i.test(content);
  const hasAttachments = /attachment|cid:|content-id/i.test(content);
  
  // Extract RFC headers if present
  const messageIdMatch = content.match(/Message-ID:\s*([^\n\r]+)/i);
  const inReplyToMatch = content.match(/In-Reply-To:\s*([^\n\r]+)/i);
  const referencesMatch = content.match(/References:\s*([^\n\r]+)/i);
  
  return {
    messageId: messageIdMatch ? messageIdMatch[1].trim() : undefined,
    inReplyTo: inReplyToMatch ? inReplyToMatch[1].trim() : undefined,
    references: referencesMatch ? referencesMatch[1].trim().split(/\s+/) : undefined,
    threadId: undefined,
    isMultipart: hasHTML && content.includes('Content-Type'),
    hasAttachments: hasAttachments || hasImages,
    contentType: hasHTML ? 'text/html' : 'text/plain'
  };
}

/**
 * MAIN ENTERPRISE PARSING FUNCTION
 * Uses content structure analysis with RFC2822 threading header preservation
 * 
 * ⚠️  THREADING PRESERVATION WORKFLOW ⚠️
 * 
 * This function follows a strict workflow to preserve email threading:
 * 
 * 1. EXTRACT threading headers FIRST (before any processing)
 * 2. ANALYZE content structure using content WITHOUT headers
 * 3. SPLIT content based on analysis (still without headers)
 * 4. RESTORE threading headers to original content section
 * 5. NEVER include threading headers in quoted content
 * 
 * This workflow ensures that:
 * - Threading headers don't interfere with quoted content detection
 * - Threading headers are always preserved with original content
 * - Email threading system continues to work correctly
 * - Rich text formatting is maintained
 * 
 * @param htmlContent - Raw HTML email content from the email system
 * @returns EnterpriseEmailContent with threading headers preserved in originalContent
 */
export async function parseHtmlEmailContent(htmlContent: string): Promise<EnterpriseEmailContent> {
  console.log('🚀 Enterprise Email Parser - Starting Analysis', {
    contentLength: htmlContent.length,
    approach: 'Content Structure Analysis with Threading Header Preservation'
  });
  
  try {
    // CRITICAL STEP 1: Extract and preserve threading headers before any processing
    // This MUST be done first to prevent headers from being lost or modified
    const { threadingHeaders, htmlWithoutHeaders } = extractAndPreserveThreadingHeaders(htmlContent);
    console.log(`🧵 Threading headers preserved: ${threadingHeaders ? 'YES' : 'NO'}`);
    
    // STEP 2: Analyze content structure (without threading headers to prevent interference)
    // Working with content that has threading headers removed prevents false positives
    // where threading headers might be detected as quoted content
    const segments = analyzeContentStructure(htmlWithoutHeaders);
    
    if (segments.length === 0) {
      console.log('ℹ️ No quoted content detected by enterprise analysis');
      
      // CRITICAL: Include threading headers with original content (no quoted content scenario)
      // Even when there's no quoted content, threading headers MUST be preserved
      const finalOriginalContent = threadingHeaders 
        ? `${threadingHeaders}\n${htmlWithoutHeaders}`
        : htmlWithoutHeaders;
      
      return {
        originalContent: finalOriginalContent,
        quotedContent: '',
        hasQuotedContent: false,
        metadata: extractMetadata(htmlContent)
      };
    }

    // STEP 3: Find the best segment (highest confidence quoted content)
    const bestSegment = segments[0];
    
    // STEP 4: Split content properly with formatting preservation
    // The segment contains positions mapped to both clean text and original HTML
    // We extract from the original HTML to preserve all formatting
    
    const normalizedContent = normalizeContent(htmlWithoutHeaders);
    
    // Use the original HTML positions from the segment
    const quotedStartIndex = bestSegment.originalStartIndex;
    const quotedEndIndex = bestSegment.originalEndIndex;
    
    // Split the content using original HTML positions (preserves formatting)
    const originalContentOnly = normalizedContent.substring(0, quotedStartIndex).trim();
    const quotedContent = normalizedContent.substring(quotedStartIndex, quotedEndIndex).trim();
    
    // CRITICAL STEP 5: Always include threading headers with original content
    // Threading headers MUST NEVER be placed in quoted content section
    // They belong with the original content to maintain thread relationships
    const finalOriginalContent = threadingHeaders 
      ? `${threadingHeaders}\n${originalContentOnly}`
      : originalContentOnly;
    
    console.log('✅ Enterprise Analysis Success:', {
      hasQuotedContent: true,
      quotedContentLength: quotedContent.length,
      originalContentLength: finalOriginalContent.length,
      headersExtracted: Object.keys(extractHeadersFromSegment(bestSegment)).length,
      confidence: bestSegment.confidence,
      markers: bestSegment.markers,
      threadingHeadersPreserved: !!threadingHeaders,
      quotedPreview: quotedContent.substring(0, 200) + '...',
      originalPreview: finalOriginalContent.substring(0, 200) + '...'
    });

    // STEP 6: Validate the split makes sense
    if (originalContentOnly.length === 0 && !threadingHeaders) {
      // If there's no original content and no threading headers, this might be a false positive
      console.log('⚠️ Warning: No original content found, treating as no quoted content');
      
      // CRITICAL: Even in validation failure, preserve threading headers
      const finalContent = threadingHeaders 
        ? `${threadingHeaders}\n${htmlWithoutHeaders}`
        : htmlWithoutHeaders;
      
      return {
        originalContent: finalContent,
        quotedContent: '',
        hasQuotedContent: false,
        metadata: extractMetadata(htmlContent)
      };
    }

    // STEP 7: Extract headers from quoted segment (separate from threading headers)
    const quotedHeaders = extractHeadersFromSegment(bestSegment);

    return {
      originalContent: finalOriginalContent, // Threading headers are included here
      quotedContent: quotedContent,         // Threading headers are NEVER here
      hasQuotedContent: true,
      quotedHeaders,
      metadata: extractMetadata(htmlContent)
    };

  } catch (error) {
    console.error('❌ Enterprise parsing failed:', error);
    
    // CRITICAL: Even in error cases, preserve threading headers
    // Error handling MUST NOT break the threading system
    const { threadingHeaders, htmlWithoutHeaders } = extractAndPreserveThreadingHeaders(htmlContent);
    const finalFallbackContent = threadingHeaders 
      ? `${threadingHeaders}\n${htmlWithoutHeaders}`
      : htmlWithoutHeaders;
    
    // Graceful fallback with threading preservation
    return {
      originalContent: finalFallbackContent,
      quotedContent: '',
      hasQuotedContent: false,
      metadata: extractMetadata(htmlContent)
    };
  }
}

/**
 * Enterprise Email Parser Class
 */
export class EnterpriseEmailParser {
  static async fromHtml(htmlContent: string): Promise<EnterpriseEmailContent> {
    return parseHtmlEmailContent(htmlContent);
  }
  
  static async fromEmailObject(emailObj: any): Promise<EnterpriseEmailContent> {
    const htmlContent = emailObj.body_html || emailObj.body || emailObj.content || '';
    return parseHtmlEmailContent(htmlContent);
  }
  
  static validateParsing(result: EnterpriseEmailContent): {
    quality: 'high' | 'medium' | 'low';
    confidence: number;
    issues: string[];
  } {
    const issues: string[] = [];
    let confidence = 1.0;
    
    if (!result.hasQuotedContent) {
      issues.push('No quoted content detected');
      confidence -= 0.5;
    }
    
    if (result.hasQuotedContent && (!result.quotedHeaders || Object.keys(result.quotedHeaders).length === 0)) {
      issues.push('Quoted content found but no headers extracted');
      confidence -= 0.3;
    }
    
    if (result.originalContent.length < 10) {
      issues.push('Very short original content');
      confidence -= 0.2;
    }
    
    const quality: 'high' | 'medium' | 'low' = 
      confidence >= 0.8 ? 'high' : 
      confidence >= 0.5 ? 'medium' : 'low';
    
    return { quality, confidence, issues };
  }
}

/**
 * Simplified interface for EmailContentWithAttachments component
 * Converts from full enterprise result to simpler ParsedEmailContent format
 */
export interface ParsedEmailContent {
  originalContent: string;
  quotedContent: string;
  hasQuotedContent: boolean;
  confidence: number;
  parsingMethod: string;
}

/**
 * ⚠️  CRITICAL THREADING FUNCTION - SIMPLIFIED INTERFACE ⚠️
 * Main parsing function compatible with EmailContentWithAttachments component
 * 
 * This is the PRIMARY ENTRY POINT for email parsing in the application.
 * It converts from the full enterprise result to the simpler ParsedEmailContent format
 * while PRESERVING RFC2822 threading headers essential for email threading.
 * 
 * THREADING PRESERVATION GUARANTEE:
 * - Threading headers are ALWAYS preserved in originalContent
 * - Threading headers are NEVER moved or modified
 * - Error cases still preserve threading headers
 * - Fallback scenarios maintain threading integrity
 * 
 * The EmailContentWithAttachments component depends on this function to:
 * 1. Parse quoted content correctly
 * 2. Preserve rich text formatting
 * 3. Maintain email threading through header preservation
 * 
 * DO NOT modify this function without verifying threading still works!
 * 
 * @param emailContent - Raw HTML email content with potential threading headers
 * @returns ParsedEmailContent with threading headers preserved in originalContent
 */
export const parseEmailContentEnterprise = async (emailContent: string): Promise<ParsedEmailContent> => {
  try {
    console.log('🚀 Starting enterprise email parsing (simplified interface)...');
    
    // Use the full enterprise parser with threading header preservation
    // This ensures all threading protection mechanisms are applied
    const enterpriseResult = await parseHtmlEmailContent(emailContent);
    
    console.log('🎯 Enterprise parsing completed:', {
      hasQuotedContent: enterpriseResult.hasQuotedContent,
      originalLength: enterpriseResult.originalContent.length,
      quotedLength: enterpriseResult.quotedContent.length,
      // Verify threading headers are preserved by checking for the marker comments
      threadingHeadersPreserved: enterpriseResult.originalContent.includes('RFC2822-THREADING-HEADERS')
    });
    
    // Convert to simpler format for compatibility with EmailContentWithAttachments
    // Threading headers are maintained in the originalContent field
    return {
      originalContent: enterpriseResult.originalContent,  // Threading headers are here
      quotedContent: enterpriseResult.quotedContent,      // Threading headers are NOT here
      hasQuotedContent: enterpriseResult.hasQuotedContent,
      confidence: enterpriseResult.hasQuotedContent ? 0.85 : 1.0,
      parsingMethod: 'enterprise-with-threading-preservation'
    };
    
  } catch (error) {
    console.error('❌ Enterprise email parsing error:', error);
    
    // CRITICAL: Even in error cases, preserve threading headers
    // Use the same extraction function to ensure consistency
    const { threadingHeaders, htmlWithoutHeaders } = extractAndPreserveThreadingHeaders(emailContent);
    const finalContent = threadingHeaders 
      ? `${threadingHeaders}\n${htmlWithoutHeaders}`
      : htmlWithoutHeaders;
    
    // Return fallback result with threading preservation
    return {
      originalContent: finalContent.trim(),  // Threading headers preserved even in errors
      quotedContent: '',
      hasQuotedContent: false,
      confidence: 0.0,
      parsingMethod: 'enterprise-fallback-with-threading-preservation'
    };
  }
}; 