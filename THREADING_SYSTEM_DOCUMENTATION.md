# Email Threading System Documentation

## ⚠️ CRITICAL SYSTEM COMPONENT ⚠️

This document explains the email threading system and the **CRITICAL** mechanisms in place to preserve threading integrity during email parsing.

## Overview

The email threading system groups related emails into conversation threads using RFC2822 headers embedded as HTML comments within email content. **These headers are ESSENTIAL** for proper email threading and must NEVER be lost, moved, or modified during email processing.

## Threading Header Format

Threading headers are embedded in email HTML as comments in this exact format:

```html
<!--[RFC2822-THREADING-HEADERS-START]-->
Message-ID: <unique-message-id@domain.com>
In-Reply-To: <parent-message-id@domain.com>
References: <thread-root-id@domain.com> <parent-message-id@domain.com>
Thread-Topic: Subject of the conversation
Thread-Index: Base64-encoded threading information
<!--[RFC2822-THREADING-HEADERS-END]-->
```

## Critical Functions and Dependencies

### Backend Function: `get_or_create_thread_id_universal`

This function is responsible for:
- Reading threading headers from email content
- Identifying thread relationships using Message-ID, In-Reply-To, and References
- Grouping emails into conversation threads
- Creating new threads when necessary

**If threading headers are lost, this function CANNOT identify thread relationships!**

### Frontend Parsing Pipeline

The frontend email parsing must preserve these headers through multiple stages:

1. **HTML Sanitization** (`EmailContentWithAttachments.tsx`)
2. **Enterprise Email Parsing** (`enterpriseEmailParserBrowser.ts`)
3. **Quoted Content Detection and Splitting**

## Critical Rules for Threading Header Preservation

### Rule 1: ALWAYS Extract First
```typescript
// CORRECT: Extract headers before any processing
const { threadingHeaders, htmlWithoutHeaders } = extractAndPreserveThreadingHeaders(html);

// WRONG: Process content first, then try to extract headers
const processedContent = processContent(html);
const headers = extractHeaders(processedContent); // Headers may be lost!
```

### Rule 2: NEVER Include in Quoted Content Detection
```typescript
// CORRECT: Analyze content without headers
const segments = analyzeContentStructure(htmlWithoutHeaders);

// WRONG: Analyze content with headers included
const segments = analyzeContentStructure(html); // Headers may be detected as quoted content!
```

### Rule 3: ALWAYS Restore to Original Content
```typescript
// CORRECT: Threading headers go with original content
const finalOriginalContent = threadingHeaders 
  ? `${threadingHeaders}\n${originalContent}`
  : originalContent;

// WRONG: Threading headers in quoted content
const quotedContent = `${threadingHeaders}\n${detectedQuotedContent}`; // BREAKS THREADING!
```

### Rule 4: NEVER Move or Modify
```typescript
// CORRECT: Preserve headers exactly as extracted
return { originalContent: `${threadingHeaders}\n${content}` };

// WRONG: Modify or clean headers
const cleanedHeaders = threadingHeaders.replace(/Message-ID:/g, 'ID:'); // BREAKS THREADING!
```

### Rule 5: Preserve in Error Cases
```typescript
// CORRECT: Even errors preserve headers
catch (error) {
  const { threadingHeaders, htmlWithoutHeaders } = extractAndPreserveThreadingHeaders(content);
  return { originalContent: `${threadingHeaders}\n${htmlWithoutHeaders}` };
}

// WRONG: Error handling that loses headers
catch (error) {
  return { originalContent: content }; // Headers may be lost!
}
```

## Protected Functions

### 1. `sanitizeHtml()` in EmailContentWithAttachments.tsx

**Purpose**: Remove dangerous HTML while preserving threading headers

**Protection Mechanism**:
- Extracts threading headers before sanitization
- Performs HTML sanitization on content without headers
- Restores headers to the beginning of sanitized content

**Critical Code**:
```typescript
const threadingHeadersRegex = /<!--\[RFC2822-THREADING-HEADERS-START\]-->.*?<!--\[RFC2822-THREADING-HEADERS-END\]-->/gs;
const threadingHeaders = html.match(threadingHeadersRegex) || [];
// ... sanitization process ...
if (threadingHeaders.length > 0) {
  sanitizedHtml = threadingHeaders.join('\n') + '\n' + sanitizedHtml;
}
```

### 2. `extractAndPreserveThreadingHeaders()` in enterpriseEmailParserBrowser.ts

**Purpose**: Extract threading headers before any email parsing

**Protection Mechanism**:
- Uses exact regex pattern matching backend format
- Returns both headers and content without headers
- Enables separate processing without header interference

**Critical Code**:
```typescript
const threadingHeadersRegex = /<!--\[RFC2822-THREADING-HEADERS-START\]-->.*?<!--\[RFC2822-THREADING-HEADERS-END\]-->/gs;
const threadingHeaders = html.match(threadingHeadersRegex) || [];
const htmlWithoutHeaders = html.replace(threadingHeadersRegex, '');
```

### 3. `parseHtmlEmailContent()` in enterpriseEmailParserBrowser.ts

**Purpose**: Parse email content while maintaining threading integrity

**Protection Mechanism**:
- Extracts headers first (Step 1)
- Analyzes content without headers (Step 2)
- Splits content without headers (Steps 3-4)
- Restores headers to original content (Step 5)
- Preserves headers in validation and error cases

### 4. `parseEmailContentEnterprise()` in enterpriseEmailParserBrowser.ts

**Purpose**: Simplified interface for EmailContentWithAttachments component

**Protection Mechanism**:
- Uses full enterprise parser with all protections
- Verifies header preservation in logs
- Handles errors with header preservation

## Testing Requirements

After ANY changes to email parsing code, you MUST verify:

### 1. Thread Grouping Still Works
- Check existing email threads remain properly grouped
- Verify "Email thread 909" and other known threads display correctly
- Ensure new emails are threaded with their parents

### 2. Threading Headers Are Present
- Inspect parsed originalContent for threading header comments
- Verify headers are NOT in quotedContent sections
- Check console logs for "Threading headers preserved: YES"

### 3. Rich Text Formatting Preserved
- Verify bold, italic, colors are maintained
- Check inline styles and basic HTML formatting
- Ensure images and links still work

### 4. No Regression in Quoted Content Detection
- Verify quoted content is still properly detected and separated
- Check that confidence scores remain reasonable (85-92%)
- Ensure UI shows quoted content toggle when appropriate

## Warning Signs of Threading Breakage

### Symptoms:
- Emails appearing as separate threads instead of grouped conversations
- "Thread 909" showing as multiple individual emails
- Missing In-Reply-To relationships
- Broken conversation flows

### Debugging:
1. Check console logs for "Threading headers preserved: NO"
2. Inspect parsed originalContent for missing header comments
3. Verify regex pattern matches backend format exactly
4. Test with known threading header examples

## Recovery Procedure

If threading is broken:

1. **Immediately revert** any recent changes to email parsing
2. **Deploy the revert** to restore threading functionality
3. **Debug the issue** in a development environment
4. **Re-implement changes** with proper header preservation
5. **Test thoroughly** before re-deploying

## Code Modification Guidelines

### Before Making Changes:
1. Read this entire document
2. Understand the threading header format
3. Identify all functions that process email content
4. Plan how to preserve headers through your changes

### During Implementation:
1. Always extract headers first
2. Work with content that has headers removed
3. Restore headers to original content at the end
4. Handle error cases with header preservation
5. Add logging to verify header preservation

### After Implementation:
1. Test thread grouping extensively
2. Verify header preservation in logs
3. Check for any regression in functionality
4. Document any new threading-related code

## Contact

If you have questions about the threading system or need to make changes that might affect it, consult the team lead before proceeding. Threading breakage affects the core functionality of the email system and must be avoided at all costs.

---

**Remember: Email threading is a CRITICAL system component. When in doubt, preserve the headers!** 