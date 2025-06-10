# 🧵 Email Threading Logic - How Emails Are Grouped

## 🎯 **Overview**

The enhanced threading system uses **4 progressive strategies** to determine if emails belong to the same conversation thread. It checks each strategy in order until it finds a match or creates a new thread.

## 🔢 **Strategy Priority Order**

### **Strategy 1: Microsoft Conversation ID (Primary)**
**What it checks**: Microsoft Graph API's `conversationId`

**Logic**:
```sql
-- Look for existing emails with same Microsoft conversationId
SELECT thread_id FROM emails 
WHERE microsoft_conversation_id = [incoming_email_conversation_id]
  AND user_id = [current_user]
  AND store_id = [current_store]
```

**When it works**: When Microsoft assigns consistent IDs (ideal case)
**When it fails**: Microsoft assigns different IDs to replies (common issue)

---

### **Strategy 2: Subject + Participant Matching (Enhanced)**
**What it checks**: Normalized subject + email participants

**Subject Normalization**:
```sql
-- Removes ALL email prefixes iteratively
"Re: Re: Fwd: Test Subject" → "Test Subject"
"Fwd: Re: Order #123" → "Order #123"  
"Re: Re: Re: Support Request" → "Support Request"
```

**Participant Matching Logic**:
```sql
WHERE normalize_email_subject(subject) = [normalized_incoming_subject]
  AND (
      -- Exact sender match
      emails.from = [incoming_from] OR
      -- Sender is our support email (for our replies)
      emails.from = [our_support_email] OR  
      -- Same organization domain (excluding public emails)
      (split_part(emails.from, '@', 2) = split_part([incoming_from], '@', 2) 
       AND domain NOT IN ('gmail.com', 'hotmail.com', 'yahoo.com')) OR
      -- Same username across domains
      split_part(emails.from, '@', 1) = split_part([incoming_from], '@', 1)
  )
  AND date >= CURRENT_DATE - INTERVAL '30 days'  -- Performance optimization
```

**Examples that would match**:
- `"Test Subject"` ↔ `"Re: Test Subject"`
- `"Order #123"` ↔ `"Fwd: Re: Order #123"`
- `john@company.com` ↔ `john@company.com` (exact match)
- `support@yourbusiness.com` ↔ `customer@gmail.com` (our reply to customer)

---

### **Strategy 3: Recent Email Fallback (NEW - Edge Cases)**
**What it checks**: Recent emails from same sender with fuzzy subject matching

**Logic**:
```sql
WHERE emails.from = [incoming_from]
  AND emails.date >= NOW() - INTERVAL '1 hour'  -- Very recent
  AND (
      -- Exact normalized subject match
      normalize_email_subject(emails.subject) = [normalized_subject] OR
      -- Fuzzy matching for edge cases
      LOWER(normalize_email_subject(emails.subject)) LIKE LOWER('%' || [normalized_subject] || '%') OR
      LOWER([normalized_subject]) LIKE LOWER('%' || normalize_email_subject(emails.subject) || '%')
  )
```

**When it helps**: 
- Image-only emails with empty content
- Emails with corrupted/missing subjects
- Attachment-only emails
- Auto-generated replies

**Example**: If someone sends "Support Request" and then replies with just an image 20 minutes later, this catches it.

---

### **Strategy 4: Create New Thread (Fallback)**
**What it does**: Creates a new thread when no matches found

**Logic**:
```sql
-- Use Microsoft ID if available
IF microsoft_conversation_id IS NOT NULL THEN
    new_thread_id := microsoft_conversation_id
ELSE
    -- Generate unique thread ID
    new_thread_id := 'thread_' || SHA256(subject + user_id + store_id + timestamp)
```

## 🎯 **What Emails Need to Have in Common**

### **For Strategy 1 (Microsoft ID)**:
- ✅ **Same `conversationId`** from Microsoft Graph
- ✅ **Same user/store** (multi-tenant isolation)

### **For Strategy 2 (Subject + Participant)**:
- ✅ **Same normalized subject** (after removing Re:, Fwd:, etc.)
- ✅ **Matching participants** (sender/recipient relationship)
- ✅ **Within 30 days** (performance optimization)
- ✅ **Same user/store** (security isolation)

### **For Strategy 3 (Recent Fuzzy)**:
- ✅ **Same sender email address**
- ✅ **Within 1 hour** (very recent)
- ✅ **Fuzzy subject similarity** (contains/contained in)
- ✅ **Same user/store**

## 📊 **Real-World Examples**

### **Example 1: Normal Email Thread**
```
Original: "Order #12345 Support Request"
Reply 1:  "Re: Order #12345 Support Request" 
Reply 2:  "Re: Re: Order #12345 Support Request"
```
**✅ Grouped by**: Strategy 2 (same normalized subject "Order #12345 Support Request")

### **Example 2: Microsoft ID Inconsistency** 
```
Original: conversationId = "ABC123"
Reply:    conversationId = "XYZ789" (different!)
```
**✅ Grouped by**: Strategy 2 (subject matching saves the day)

### **Example 3: Image-Only Reply**
```
Original: "Test 3:01pm" with text content
Reply:    "Re: Re: Test 3:01pm" with only image, empty content
```
**✅ Grouped by**: Strategy 2 or 3 (subject normalization + recent fallback)

### **Example 4: Complex Organization Thread**
```
Customer: john@company.com → "Project Discussion"
Us:       support@yourbusiness.com → "Re: Project Discussion"  
Customer: john@company.com → "Fwd: Re: Project Discussion"
```
**✅ Grouped by**: Strategy 2 (participant relationship + normalized subject)

## 🔒 **Security & Isolation**

**Every strategy includes**:
- ✅ **User isolation**: Only sees their own emails
- ✅ **Store isolation**: Multi-tenant security
- ✅ **Time boundaries**: Performance and relevance limits

## 🚀 **Performance Optimizations**

- ✅ **30-day lookback**: Prevents searching entire email history
- ✅ **1-hour recent window**: Fuzzy matching only for very recent emails
- ✅ **Indexed searches**: Database indexes on `thread_id`, `subject`, `from`
- ✅ **Early termination**: Stops at first successful strategy

## 🎯 **Why This Works Better Than Microsoft Alone**

**Microsoft's Problem**: 
- Assigns different `conversationId` to replies
- No consistency across email clients
- Platform-dependent behavior

**Our Solution**:
- ✅ **Multiple fallbacks** ensure threading always works
- ✅ **Cross-platform consistency** 
- ✅ **Handles edge cases** (images, attachments, empty content)
- ✅ **User-friendly subject matching** 
- ✅ **Performance optimized**

**The result**: Robust threading that works regardless of Microsoft Graph API quirks! 🎉** 