/**
 * Email Content with Attachments - Phase 3: Quoted Content Collapsing
 * 
 * This component processes email HTML content and automatically replaces
 * cid: references with lazily-loaded images. It provides seamless
 * integration between email content and the attachment system.
 * 
 * Features:
 * - Automatic CID detection and replacement
 * - Seamless integration with LazyAttachmentImage
 * - Universal quoted content detection and collapsing
 * - HTML sanitization for security
 * - Progressive enhancement of email content
 * - Responsive image handling
 * - Gmail-style quoted content UI
 */

import React, { useMemo, useEffect, useState } from 'react';
import LazyAttachmentImage from './LazyAttachmentImage';
import CollapsibleQuotedContent from './email/CollapsibleQuotedContent';
import EnterpriseCollapsibleQuotedContent from './email/EnterpriseCollapsibleQuotedContent';
import { EnterpriseEmailParser, EnterpriseEmailContent } from '../utils/enterpriseEmailParserBrowser';

interface EmailContentWithAttachmentsProps {
  htmlContent?: string;
  plainContent?: string;
  emailId?: string;
  className?: string;
  maxImageWidth?: number;
  maxImageHeight?: number;
  enableQuotedContentCollapsing?: boolean;
  useEnterpriseParser?: boolean;
}

interface ProcessedContent {
  parts: Array<{
    type: 'html' | 'cid-image';
    content: string;
    cid?: string;
    alt?: string;
  }>;
  cidCount: number;
}

export const EmailContentWithAttachments: React.FC<EmailContentWithAttachmentsProps> = ({
  htmlContent,
  plainContent,
  emailId,
  className = '',
  maxImageWidth = 600,
  maxImageHeight = 400,
  enableQuotedContentCollapsing = true,
  useEnterpriseParser = true
}) => {

  // Extract body content from complete HTML documents while preserving all formatting
  const extractBodyContent = (html: string): string => {
    // If it's a complete HTML document, extract body content while preserving formatting
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      let bodyContent = bodyMatch[1];
      
      // Preserve any styles that were in the head section for rich formatting
      const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      if (headMatch) {
        const styleMatch = headMatch[1].match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
        if (styleMatch) {
          // Prepend any styles to maintain formatting
          const styles = styleMatch.join('\n');
          bodyContent = styles + bodyContent;
        }
      }
      
      return bodyContent;
    }
    
    // If it's already just content (no html/body tags), return as is to preserve all formatting
    return html;
  };

  // Enterprise email parsing state
  const [parsedEmail, setParsedEmail] = useState<EnterpriseEmailContent | null>(null);
  const [isParsing, setIsParsing] = useState(true);

  // Parse with enterprise parser
  useEffect(() => {
    // Always use the enterprise parser if collapsing is enabled.
    if (!enableQuotedContentCollapsing) {
      setParsedEmail({
        originalContent: htmlContent || plainContent || '',
        quotedContent: '',
        hasQuotedContent: false,
        metadata: { isMultipart: false, hasAttachments: false, contentType: '' },
      });
      setIsParsing(false);
      return;
    }

    const content = htmlContent || plainContent || '';
    if (!content) {
      setParsedEmail(null);
      setIsParsing(false);
      return;
    }

    setIsParsing(true);
    
    EnterpriseEmailParser.fromHtml(content)
      .then(setParsedEmail)
      .catch(error => {
        console.error('Enterprise parsing failed:', error);
        // On failure, treat the whole content as original to avoid blank screens.
        setParsedEmail({
          originalContent: content,
          quotedContent: '',
          hasQuotedContent: false,
          metadata: { isMultipart: false, hasAttachments: false, contentType: '' },
        });
      })
      .finally(() => {
        setIsParsing(false);
      });
  }, [htmlContent, plainContent, enableQuotedContentCollapsing]);

  // Process email content and extract CID references
  const processedContent = useMemo((): ProcessedContent => {
    // Use the original (non-quoted) content for CID processing
    const contentToProcess = parsedEmail?.originalContent || '';
    
    if (!contentToProcess) {
      return { parts: [], cidCount: 0 };
    }

    // For plain text, just return it as a single part
    if (!htmlContent && plainContent) {
      return {
        parts: [{
          type: 'html',
          content: `<pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(contentToProcess)}</pre>`
        }],
        cidCount: 0
      };
    }

    // Extract body content from complete HTML documents to prevent duplication
    const cleanedHtmlContent = extractBodyContent(contentToProcess);

    // Find all CID references in HTML
    const cidRegex = /<img[^>]+src=["']cid:([^"']+)["'][^>]*>/gi;
    const parts: ProcessedContent['parts'] = [];
    let lastIndex = 0;
    let cidCount = 0;
    let match;

    // Reset regex lastIndex to avoid issues with global regex
    cidRegex.lastIndex = 0;

    while ((match = cidRegex.exec(cleanedHtmlContent)) !== null) {
      // Add HTML content before this image
      if (match.index > lastIndex) {
        const beforeContent = cleanedHtmlContent.substring(lastIndex, match.index);
        if (beforeContent.trim()) {
          parts.push({
            type: 'html',
            content: beforeContent
          });
        }
      }

      // Extract CID and alt attributes
      const cid = match[1];
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      const alt = altMatch ? altMatch[1] : 'Email image';

      // Add CID image part
      parts.push({
        type: 'cid-image',
        content: match[0],
        cid,
        alt
      });

      cidCount++;
      lastIndex = match.index + match[0].length;
    }

    // Handle remaining content after CID processing OR entire content if no CIDs
    if (cidCount > 0) {
      // If we found CIDs, add any remaining HTML content after the last CID
      if (lastIndex < cleanedHtmlContent.length) {
        const remainingContent = cleanedHtmlContent.substring(lastIndex);
        if (remainingContent.trim()) {
          parts.push({
            type: 'html',
            content: remainingContent
          });
        }
      }
    } else {
      // If no CIDs found, add the entire cleaned content as a single HTML part
      if (cleanedHtmlContent.trim()) {
        parts.push({
          type: 'html',
          content: cleanedHtmlContent
        });
      }
    }

    return { parts, cidCount };
  }, [parsedEmail, htmlContent, plainContent]);

  // Helper function to escape HTML
  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  if (isParsing) {
    return (
      <div className={`email-content-with-attachments ${className}`}>
        <p>Loading email...</p>
      </div>
    );
  }

  // Render the component
  return (
    <div className={`email-content-with-attachments ${className}`}>
      {/* Render processed content parts with CSS isolation */}
      <div 
        className="email-content-isolated"
        style={{
          contain: 'layout style',
          isolation: 'isolate',
          position: 'relative'
        }}
      >
        {processedContent.parts.map((part, index) => {
          if (part.type === 'html') {
            const sanitizedHtml = sanitizeHtml(part.content);
            return (
              <div
                key={index}
                className="email-html-part"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            );
          }
          if (part.type === 'cid-image' && emailId && part.cid) {
            return (
              <LazyAttachmentImage
                key={index}
                emailId={emailId}
                cid={part.cid}
                alt={part.alt}
                maxWidth={maxImageWidth}
                maxHeight={maxImageHeight}
              />
            );
          }
          return null;
        })}
      </div>

      {/* Render quoted content if it exists */}
      {parsedEmail && parsedEmail.hasQuotedContent && (
         <EnterpriseCollapsibleQuotedContent
            quotedContent={parsedEmail.quotedContent}
            headers={parsedEmail.quotedHeaders}
            emailId={emailId}
            maxImageWidth={maxImageWidth}
            maxHeight={maxImageHeight}
          />
      )}
    </div>
  );
};

// Enhanced HTML sanitization that prevents CSS bleeding and maintains security
// 
// ⚠️  CRITICAL THREADING SYSTEM PROTECTION ⚠️
// This function MUST preserve RFC2822 threading headers to maintain email threading.
// These headers are embedded as HTML comments and are ESSENTIAL for the threading system:
// <!--[RFC2822-THREADING-HEADERS-START]-->
// Message-ID: xxx
// In-Reply-To: xxx  
// References: xxx
// Thread-Topic: xxx
// Thread-Index: xxx
// <!--[RFC2822-THREADING-HEADERS-END]-->
//
// The get_or_create_thread_id_universal function depends on these headers to group emails
// into proper conversation threads. If these headers are lost during sanitization,
// emails will appear as separate threads instead of being grouped together.
//
// DO NOT MODIFY this function without ensuring threading headers remain preserved!
const sanitizeHtml = (html: string): string => {
  // Create a temporary div to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // CRITICAL: Preserve RFC2822 threading headers - these are essential for thread system
  // These headers MUST be extracted BEFORE any HTML processing to prevent loss
  // Pattern matches the exact format used by the backend threading system
  const threadingHeadersRegex = /<!--\[RFC2822-THREADING-HEADERS-START\]-->.*?<!--\[RFC2822-THREADING-HEADERS-END\]-->/gs;
  const threadingHeaders = html.match(threadingHeadersRegex) || [];
  
  // Log if threading headers are found for debugging purposes
  if (threadingHeaders.length > 0) {
    console.log('🧵 Threading headers found and preserved during sanitization:', threadingHeaders.length);
  }

  // Remove dangerous elements but preserve formatting elements
  const dangerousElements = tempDiv.querySelectorAll('script, object, embed, iframe, form, input, button, link, meta');
  dangerousElements.forEach(element => element.remove());

  // Remove all <style> elements to prevent CSS bleeding
  const styleElements = tempDiv.querySelectorAll('style');
  styleElements.forEach(element => element.remove());

  // Remove dangerous event handlers and problematic style attributes
  const allElements = tempDiv.querySelectorAll('*');
  allElements.forEach(element => {
    Array.from(element.attributes).forEach(attr => {
      // Remove event handlers
      if (attr.name.startsWith('on')) {
        element.removeAttribute(attr.name);
      }
      
      // Remove dangerous href protocols but allow mailto and http/https
      if (attr.name === 'href' && attr.value) {
        const value = attr.value.toLowerCase();
        if (value.startsWith('javascript:') || value.startsWith('data:') || value.startsWith('vbscript:')) {
          element.removeAttribute(attr.name);
        }
      }
      
      // Remove dangerous src protocols for non-image elements
      if (attr.name === 'src' && attr.value && !element.tagName.toLowerCase().includes('img')) {
        const value = attr.value.toLowerCase();
        if (value.startsWith('javascript:') || value.startsWith('data:') || value.startsWith('vbscript:')) {
          element.removeAttribute(attr.name);
        }
      }

      // Sanitize style attributes to prevent CSS injection
      if (attr.name === 'style') {
        const styleValue = attr.value;
        // Remove potentially dangerous CSS properties
        const dangerousCSS = [
          'position:\\s*(fixed|absolute)',
          'z-index:\\s*\\d+',
          'transform:\\s*.*',
          '!important',
          'expression\\s*\\(',
          'javascript:',
          'behavior:',
          'binding:',
          '-moz-binding:',
          'font-family:\\s*[^;]*[<>]', // Prevent XSS via font-family
        ];
        
        let cleanStyle = styleValue;
        dangerousCSS.forEach(pattern => {
          cleanStyle = cleanStyle.replace(new RegExp(pattern, 'gi'), '');
        });
        
        // Only keep the style if it's significantly different (i.e., we removed something dangerous)
        if (cleanStyle.trim()) {
          element.setAttribute('style', cleanStyle);
        } else {
          element.removeAttribute('style');
        }
      }

      // Remove class attributes that might reference global CSS
      if (attr.name === 'class') {
        // Keep only basic styling classes, remove potential framework classes
        const classValue = attr.value;
        const safeClasses = classValue
          .split(' ')
          .filter(cls => {
            // Allow basic styling classes but block framework/global classes
            return !cls.match(/^(btn|nav|header|footer|container|row|col|pull-|push-|hidden|visible|sr-only)/i);
          })
          .join(' ');
        
        if (safeClasses.trim()) {
          element.setAttribute('class', safeClasses);
        } else {
          element.removeAttribute('class');
        }
      }
    });
  });

  let sanitizedHtml = tempDiv.innerHTML;

  // CRITICAL: Restore threading headers after sanitization
  // These headers are essential for proper email threading and must be preserved
  // They MUST be placed at the beginning of the content to ensure they're not lost
  // and remain accessible to the get_or_create_thread_id_universal function
  if (threadingHeaders.length > 0) {
    // Add threading headers at the beginning to ensure they're not lost
    sanitizedHtml = threadingHeaders.join('\n') + '\n' + sanitizedHtml;
    console.log('✅ Threading headers successfully restored after sanitization');
  }

  return sanitizedHtml;
};

export default EmailContentWithAttachments; 