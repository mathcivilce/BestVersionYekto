/**
 * Universal Email Content Parser
 * 
 * Detects and separates quoted/original content from emails across all providers:
 * - Microsoft Outlook / Exchange
 * - Gmail
 * - Yahoo Mail  
 * - Apple Mail
 * - Thunderbird
 * - Any RFC2822 compliant email client
 */

export interface ParsedEmailContent {
  originalContent: string;
  quotedContent: string;
  hasQuotedContent: boolean;
  quotedHeaders?: {
    from?: string;
    sent?: string;
    to?: string;
    cc?: string;
    subject?: string;
  };
}

/**
 * Pattern definition interface
 */
interface QuotedContentPattern {
  name: string;
  pattern: RegExp;
  type: 'html' | 'plain' | 'divider';
  validate?: (content: string, match: RegExpMatchArray) => boolean;
}

/**
 * Universal quoted content patterns for all major email providers
 * These patterns are ordered by specificity - most specific first
 */
const QUOTED_CONTENT_PATTERNS: QuotedContentPattern[] = [
  // Microsoft Outlook / Exchange patterns (most specific first)
  {
    name: 'outlook_divider',
    pattern: /-----Original Message-----[\s\S]*/i,
    type: 'divider'
  },
  {
    name: 'outlook_html_specific',
    pattern: /(<div[^>]*class="?OutlookMessageHeader"?[^>]*>[\s\S]*?<\/div>)/i,
    type: 'html'
  },
  {
    name: 'outlook_headers_block',
    // Must have multiple headers in sequence to avoid false positives
    pattern: /(From:[\s\S]*?Sent:[\s\S]*?To:[\s\S]*?Subject:[\s\S]*?)(?=\r?\n\r?\n|$)/i,
    type: 'plain',
    validate: (content: string, match: RegExpMatchArray) => {
      // Must have at least 3 of the 4 headers
      const headerCount = (match[1].match(/(?:From|Sent|To|Subject):/gi) || []).length;
      return headerCount >= 3;
    }
  },

  // Gmail patterns (very specific)
  {
    name: 'gmail_quote_div',
    pattern: /(<div class="gmail_quote">[\s\S]*?<\/div>)/i,
    type: 'html'
  },
  {
    name: 'gmail_quote_blockquote',
    pattern: /(<blockquote[^>]*class="gmail_quote"[^>]*>[\s\S]*?<\/blockquote>)/i,
    type: 'html'
  },
  {
    name: 'gmail_wrote_pattern',
    // Must have date and "wrote:" to be valid Gmail quote
    pattern: /(On\s+[^<\n]*\d{4}[^<\n]*wrote:[\s\S]*)/i,
    type: 'plain',
    validate: (content: string, match: RegExpMatchArray) => {
      // Must contain a year and "wrote:" with reasonable email context
      return /\d{4}/.test(match[1]) && /wrote:/i.test(match[1]);
    }
  },

  // Yahoo Mail patterns
  {
    name: 'yahoo_quoted_div',
    pattern: /(<div[^>]*class="?yahoo_quoted"?[^>]*>[\s\S]*?<\/div>)/i,
    type: 'html'
  },
  {
    name: 'yahoo_divider',
    pattern: /(_{30,}[\s\S]*)/i, // 30+ underscores
    type: 'divider'
  },

  // Apple Mail patterns
  {
    name: 'apple_forwarded',
    pattern: /(Begin forwarded message:[\s\S]*)/i,
    type: 'plain'
  },
  {
    name: 'apple_cite_blockquote',
    pattern: /(<blockquote[^>]*type="cite"[^>]*>[\s\S]*?<\/blockquote>)/i,
    type: 'html'
  },

  // Thunderbird patterns
  {
    name: 'thunderbird_cite',
    pattern: /(<div[^>]*class="?moz-cite-prefix"?[^>]*>[\s\S]*?<blockquote[^>]*type="cite"[^>]*>[\s\S]*?<\/blockquote>)/i,
    type: 'html'
  },

  // Generic fallback patterns (very conservative)
  {
    name: 'generic_blockquote',
    pattern: /(<blockquote[^>]*>[\s\S]*?<\/blockquote>)/i,
    type: 'html',
    validate: (content: string, match: RegExpMatchArray) => {
      // Only match if blockquote contains email-like headers
      return /(?:From|Date|To|Subject):/i.test(match[1]);
    }
  },
  {
    name: 'generic_gt_prefix',
    pattern: /((?:^|\n)>.*(?:\n>.*){2,})/m, // At least 3 lines with > prefix
    type: 'plain'
  }
];

/**
 * Extract quoted headers from quoted content
 */
function extractQuotedHeaders(quotedContent: string): ParsedEmailContent['quotedHeaders'] {
  const headers: ParsedEmailContent['quotedHeaders'] = {};

  // Common header patterns across all providers
  const headerPatterns = {
    from: /From:\s*([^\r\n<]+)/i,
    sent: /(?:Sent|Date):\s*([^\r\n<]+)/i,
    to: /To:\s*([^\r\n<]+)/i,
    cc: /Cc:\s*([^\r\n<]+)/i,
    subject: /Subject:\s*([^\r\n<]+)/i
  };

  for (const [key, pattern] of Object.entries(headerPatterns)) {
    const match = quotedContent.match(pattern);
    if (match) {
      headers[key as keyof ParsedEmailContent['quotedHeaders']] = match[1].trim();
    }
  }

  return headers;
}

/**
 * Clean and normalize content by removing excessive whitespace
 */
function cleanContent(content: string): string {
  return content
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive line breaks
    .replace(/^\s+|\s+$/g, '') // Trim whitespace
    .replace(/\r\n/g, '\n'); // Normalize line endings
}

/**
 * Universal email content parser
 * Detects quoted content from any email provider
 */
export function parseEmailContent(htmlContent: string): ParsedEmailContent {
  if (!htmlContent || htmlContent.trim() === '') {
    return {
      originalContent: '',
      quotedContent: '',
      hasQuotedContent: false
    };
  }

  // Try each pattern until we find a valid match
  for (const pattern of QUOTED_CONTENT_PATTERNS) {
    const match = htmlContent.match(pattern.pattern);
    
    if (match) {
      // Run custom validation if it exists
      if (pattern.validate && !pattern.validate(htmlContent, match)) {
        continue; // Skip this match, try next pattern
      }

      const quotedContent = match[1] || match[0];
      const quotedStartIndex = match.index || 0;
      
      // Split content into original (before quoted) and quoted parts
      const originalContent = htmlContent.substring(0, quotedStartIndex);
      
      // Enhanced validation:
      // 1. Must have meaningful original content (at least 50 chars)
      // 2. Original content shouldn't be mostly whitespace/HTML tags
      // 3. Quoted content should look like actual quoted content
      const originalTrimmed = originalContent.trim();
      const quotedTrimmed = quotedContent.trim();
      
      if (originalTrimmed.length > 50 && quotedTrimmed.length > 20) {
        // Check if original content has substance (not just HTML tags)
        const originalTextContent = originalTrimmed.replace(/<[^>]*>/g, '').trim();
        
        // Check if quoted content actually looks like quoted content
        const hasQuoteIndicators = /(?:From|Date|To|Subject|wrote:|Original Message|Begin forwarded message)/i.test(quotedTrimmed);
        
        if (originalTextContent.length > 20 && hasQuoteIndicators) {
          const cleanedOriginal = cleanContent(originalContent);
          const cleanedQuoted = cleanContent(quotedContent);
          
          // Extract headers from quoted content
          const quotedHeaders = extractQuotedHeaders(cleanedQuoted);
          
          return {
            originalContent: cleanedOriginal,
            quotedContent: cleanedQuoted,
            hasQuotedContent: true,
            quotedHeaders
          };
        }
      }
    }
  }

  // No quoted content found, return original content as-is
  return {
    originalContent: cleanContent(htmlContent),
    quotedContent: '',
    hasQuotedContent: false
  };
}

/**
 * Check if content appears to be mostly quoted (heuristic)
 * Useful for avoiding false positives
 */
export function isContentMostlyQuoted(content: string): boolean {
  const lines = content.split('\n');
  const quotedLines = lines.filter(line => 
    line.trim().startsWith('>') || 
    line.includes('From:') || 
    line.includes('Sent:') ||
    line.includes('wrote:')
  );
  
  return quotedLines.length > lines.length * 0.7; // 70% threshold
}

/**
 * Extract just the essential quoted headers for display
 */
export function getQuotedHeadersSummary(headers?: ParsedEmailContent['quotedHeaders']): string {
  if (!headers) return '';
  
  const parts: string[] = [];
  
  if (headers.from) parts.push(`From: ${headers.from}`);
  if (headers.sent) parts.push(`Sent: ${headers.sent}`);
  if (headers.to) parts.push(`To: ${headers.to}`);
  if (headers.subject) parts.push(`Subject: ${headers.subject}`);
  
  return parts.join(' | ');
} 