/**
 * Enterprise-Grade Email Content Parser - Browser Compatible
 * 
 * This file provides a robust, DOM-based method for parsing email content
 * directly in the browser. It is designed to safely identify and separate
 * quoted content from the main reply in an email's HTML body without
 * altering the original formatting.
 * 
 * Key Principles:
 * 1.  **DOM-based Parsing:** Uses the browser's native `DOMParser` for
 *     safe and accurate HTML manipulation. This avoids fragile regex
 *     and string manipulation on raw HTML.
 * 2.  **Formatting Preservation:** The original HTML and CSS of the email
 *     are 100% preserved because the content is handled as structured
 *     DOM nodes, not as text.
 * 3.  **Critical Threading Header Preservation:** Email threading depends
 *     on special RFC2822 headers embedded in HTML comments. This parser
 *     carefully extracts these headers before processing and re-attaches
 *     them, ensuring threading integrity is never compromised.
 * 4.  **Multi-Provider Support:** A series of selectors and heuristics
 *     are used to identify quoted content from major email providers like
 *     Gmail, Outlook, Apple Mail, etc.
 * 5.  **Simplicity and Robustness:** The logic is straightforward and
 *     prioritizes correctly identifying the main quote block, ensuring
 *     it is easy to debug and maintain.
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
    isMultipart: boolean;
    hasAttachments: boolean;
    contentType: string;
  };
}

// Selectors for well-structured quote containers from major email clients.
// These are tried first as they are the most reliable.
const QUOTE_SELECTORS = [
  'div.gmail_quote',
  'blockquote.gmail_quote',
  'blockquote[type="cite"]',
  'div[id^="divRplyFwdMsg"]',
  'div.WordSection1', // Often used by Outlook
];

// Selectors for elements that reliably precede a quoted section.
const QUOTE_PRECEDING_SELECTORS = [
  "hr[id='stopSpelling']", // Outlook's "From:" line separator
];

/**
 * Checks if a given HTML string contains any substantive content (visible text or images).
 * @param html The HTML string to check.
 * @returns True if the HTML has substantive content, false otherwise.
 */
const hasSubstantiveContent = (html: string): boolean => {
    if (!html) return false;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Check for any visible text content.
    const hasText = tempDiv.innerText.trim().length > 0;
    if (hasText) return true;

    // Check for any images, which are substantive even without text.
    const hasImages = tempDiv.querySelector('img') !== null;
    if (hasImages) return true;

    return false;
};

/**
 * Extracts the "From, To, Subject" headers from the text of a quote block.
 * @param quotedHtml The inner HTML of the quote block.
 * @returns An object containing any found headers.
 */
const extractHeadersFromQuotedHtml = (quotedHtml: string): EnterpriseEmailContent['quotedHeaders'] => {
  const headers: EnterpriseEmailContent['quotedHeaders'] = {};
  // Use a temporary DOM element to safely get the text content
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = quotedHtml;
  const text = tempDiv.innerText;

  const fromMatch = text.match(/From:\s*(.*)/i);
  if (fromMatch) headers.from = fromMatch[1].trim();

  const sentMatch = text.match(/(?:Sent|Date):\s*(.*)/i);
  if (sentMatch) headers.date = sentMatch[1].trim();
  
  const toMatch = text.match(/To:\s*(.*)/i);
  if (toMatch) headers.to = toMatch[1].trim();

  const ccMatch = text.match(/Cc:\s*(.*)/i);
  if (ccMatch) headers.cc = ccMatch[1].trim();

  const subjectMatch = text.match(/Subject:\s*(.*)/i);
  if (subjectMatch) headers.subject = subjectMatch[1].trim();

  return headers;
};

/**
 * ⚠️ CRITICAL THREADING FUNCTION ⚠️
 * Extracts RFC2822 threading headers, which are embedded as HTML comments.
 * This function is the cornerstone of the email threading system. It MUST be
 * called before any other parsing, and its output MUST be preserved.
 *
 * @param html Raw HTML email content.
 * @returns An object containing the extracted header comments, the HTML
 *          with headers removed, and parsed metadata from the headers.
 */
const extractAndPreserveThreadingHeaders = (html: string) => {
  const threadingHeadersRegex = /<!--\[RFC2822-THREADING-HEADERS-START\]-->([\s\S]*?)<!--\[RFC2822-THREADING-HEADERS-END\]-->/gs;
  const matches = [...html.matchAll(threadingHeadersRegex)];
  
  if (matches.length === 0) {
    return {
      threadingHeaders: '',
      htmlWithoutHeaders: html,
      metadata: {},
    };
  }

  const threadingHeaders = matches.map(match => match[0]).join('\n');
  const headersContent = matches.map(match => match[1]).join('\n');
  
  const htmlWithoutHeaders = html.replace(threadingHeadersRegex, '');

  const metadata = {
      messageId: headersContent.match(/Message-ID:\s*<(.*)>/)?.[1],
      inReplyTo: headersContent.match(/In-Reply-To:\s*<(.*)>/)?.[1],
      references: headersContent.match(/References:\s*(.*)/)?.[1]?.split(/\s*</).map(s => s.replace(/>/g, '')).filter(Boolean),
  };
  
  return {
    threadingHeaders,
    htmlWithoutHeaders,
    metadata,
  };
};

/**
 * The core parsing function. It converts HTML to a DOM, finds the quote
 * block, and splits the content.
 *
 * @param html The email HTML (with threading headers removed).
 * @returns An object with the original and quoted content.
 */
const parseHtmlUsingDOM = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let anchorElement: Element | null = null;
  let isGmailEdgeCase = false;

  // 1. Try direct selectors first
  const gmailContainer = doc.querySelector('div.gmail_quote');
  
  if (gmailContainer) {
    // Gmail edge case: The new content is sometimes INSIDE the quote container.
    // The actual quote is the blockquote *within* the container.
    const nestedQuote = gmailContainer.querySelector('blockquote.gmail_quote');
    if (nestedQuote) {
      anchorElement = nestedQuote;
      isGmailEdgeCase = true;
    } else {
      // It's a normal gmail_quote, use it as the anchor.
      anchorElement = gmailContainer;
    }
  }

  // 2. If no Gmail container, try other standard selectors
  if (!anchorElement) {
    for (const selector of QUOTE_SELECTORS) {
      // Skip gmail_quote as we've handled it.
      if (selector.includes('gmail')) continue; 
      anchorElement = doc.querySelector(selector);
      if (anchorElement) break;
    }
  }
  
  // 3. Try selectors for elements that precede a quote
  if (!anchorElement) {
    for (const selector of QUOTE_PRECEDING_SELECTORS) {
      const precedingElement = doc.querySelector(selector);
      if (precedingElement) {
        // The anchor is the very next element after the separator.
        anchorElement = precedingElement.nextElementSibling;
        break;
      }
    }
  }

  // 4. Fallback: Look for "On [date] ... wrote:" text block
  if (!anchorElement) {
    const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    // This regex is broad enough to catch various date/time formats.
    const regex = /On.*wrote:/i;
    while ((node = walker.nextNode())) {
      if (node.textContent && regex.test(node.textContent.trim())) {
        // The anchor is the parent element containing this text.
        anchorElement = node.parentElement;
        break;
      }
    }
  }
  
  if (anchorElement) {
    const quoteWrapper = document.createElement('div');
    
    if (isGmailEdgeCase) {
        // For the Gmail edge case, we only move the blockquote and its siblings.
        // The "Test3" content remains in the original document body.
        let currentNode: Node | null = anchorElement;
        while (currentNode) {
            const nextSibling = currentNode.nextSibling;
            quoteWrapper.appendChild(currentNode);
            currentNode = nextSibling;
        }
    } else {
        // Standard behavior: move the anchor and all its subsequent siblings.
        let currentNode: Node | null = anchorElement;
        while (currentNode) {
            const nextSibling = currentNode.nextSibling;
            quoteWrapper.appendChild(currentNode);
            currentNode = nextSibling;
        }
    }

    const quotedContent = quoteWrapper.innerHTML;
    
    // Final check: Does the quote we found actually have anything in it?
    if (!hasSubstantiveContent(quotedContent)) {
        // If not, it's an empty quote. Ignore it and return the whole email as original.
        return {
            originalContent: html, // Return the original, unmodified HTML
            quotedContent: '',
            hasQuotedContent: false,
            headers: {},
        };
    }

    const originalContent = doc.body.innerHTML;
    
    return {
      originalContent,
      quotedContent,
      hasQuotedContent: true,
      headers: extractHeadersFromQuotedHtml(quotedContent),
    };
  }
  
  // If no quote anchor was found, return the entire content as original.
  return {
    originalContent: html,
    quotedContent: '',
    hasQuotedContent: false,
    headers: {},
  };
};

/**
 * Main public function to parse email HTML content.
 * Orchestrates threading header preservation and DOM-based parsing.
 */
export async function parseHtmlEmailContent(htmlContent: string): Promise<EnterpriseEmailContent> {
  const { threadingHeaders, htmlWithoutHeaders, metadata } = extractAndPreserveThreadingHeaders(htmlContent);

  const { originalContent, quotedContent, hasQuotedContent, headers } = parseHtmlUsingDOM(htmlWithoutHeaders);
  
  // Re-attach threading headers to the original content to ensure they are preserved.
  const finalOriginalContent = `${originalContent.trim()}\n${threadingHeaders}`;

  return {
    originalContent: finalOriginalContent,
    quotedContent,
    hasQuotedContent,
    quotedHeaders: headers,
    metadata: {
      ...metadata,
      isMultipart: false, // This is a simplification. Real parsing would detect this.
      hasAttachments: false, // Simplification.
      contentType: 'text/html',
    }
  };
}

/**
 * A simple facade class for using the parser, consistent with the component's expectations.
 */
export class EnterpriseEmailParser {
  static async fromHtml(htmlContent: string): Promise<EnterpriseEmailContent> {
    if (!htmlContent || typeof htmlContent !== 'string') {
      return Promise.resolve({
        originalContent: '',
        quotedContent: '',
        hasQuotedContent: false,
        metadata: {
          isMultipart: false,
          hasAttachments: false,
          contentType: '',
        }
      });
    }
    return parseHtmlEmailContent(htmlContent);
  }

  static validateParsing(result: EnterpriseEmailContent): {
    quality: 'high' | 'medium' | 'low';
    confidence: number;
    issues: string[];
  } {
    const issues: string[] = [];
    let confidence = 0.0;
    
    if (result.hasQuotedContent) {
      confidence = 0.8; // Base confidence if we found something
      if (Object.keys(result.quotedHeaders || {}).length > 0) {
        confidence = 0.95; // High confidence if we also found headers
      }
    } else {
      issues.push("No quoted content found.");
      confidence = 0.5; // Low confidence, we are not sure
    }

    const quality = confidence > 0.7 ? 'high' : (confidence > 0.4 ? 'medium' : 'low');

    return { quality, confidence, issues };
  }
}
