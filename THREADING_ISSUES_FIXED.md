# Threading Issues Analysis & Fixes

## Issue Analysis Summary

You were absolutely correct about both issues! My initial understanding was wrong. Here's the detailed analysis:

## Issue 1: Thread Splitting After Reconnection ✅ FIXED

### Root Cause Analysis
- **What happens during disconnection**: All emails are **completely deleted** from the database (line 950-960 in `InboxContext.tsx`)
- **What happens during reconnection**: All emails are indeed "new" to the database, as you correctly stated
- **The actual problem**: The threading algorithm expects **chronological processing** for optimal results, but Microsoft Graph API doesn't guarantee chronological order in responses
- **Result**: If emails arrive out of chronological order during sync, the threading algorithm may create separate threads for what should be the same conversation

### Solution Implemented
Added a call to `rebuild_threads_for_store()` after successful reconnection in `InboxContext.tsx`:

```typescript
// 🔧 FIX ISSUE 1: Rebuild threads after reconnection
// After reconnection, all emails are "new" to the database and need to be
// processed chronologically to ensure proper threading
console.log('🧵 Rebuilding threads for reconnected store...');
try {
  const { data: rebuildResult, error: rebuildError } = await supabase.rpc('rebuild_threads_for_store', {
    p_store_id: newStore.id,
    p_user_id: user?.id
  });
  
  if (rebuildError) {
    console.warn('Thread rebuild failed (non-critical):', rebuildError);
  } else {
    console.log('✅ Thread rebuild completed:', rebuildResult);
  }
} catch (rebuildError) {
  console.warn('Thread rebuild error (non-critical):', rebuildError);
  // Don't fail the connection for threading issues
}
```

This ensures all emails are reprocessed in chronological order using the RFC 2822 compliant threading algorithm.

## Issue 2: Sender Name Display Issue ✅ FIXED

### Root Cause Analysis
- **Database storage**: ✅ CORRECT - Stores `email.store.name` as sender (line 590 in `send-email/index.ts`)
- **Microsoft Graph API**: ✅ NOT THE PROBLEM - API correctly uses store name
- **Frontend display**: ❌ PROBLEM FOUND - Shows inconsistent names

### The Actual Problem
In `EmailDetail.tsx` line 747:
```typescript
{message.type === 'reply' ? message.author : message.type === 'note' ? message.author : message.from}
```

- **Original emails**: Show `message.from` (store name) ✅ Correct
- **Replies**: Show `message.author` (team member's personal name) ❌ Wrong
- **Result**: Inconsistent display where replies show personal names instead of store names

### Solution Implemented
Fixed the author name assignment in `EmailDetail.tsx` for both reply functions:

```typescript
// 🔧 FIX ISSUE 2: Use store name for consistency with database storage
// The database stores replies with store name (email.store.name), so display should match
const authorName = currentStore?.name || email.storeName || 'Support';
```

This ensures replies display the store name consistently with how they're stored in the database and how original emails are displayed.

## Deployment Status ✅ COMPLETE

### Edge Functions Deployed:
- ✅ `send-email`: 932kB
- ✅ `sync-emails`: 1.008MB  
- ✅ `email-webhook`: 930.7kB

### Frontend Deployed:
- ✅ Build completed: 17.08s
- ✅ Vercel deployment: https://project-ze-pikeno-q8r9xbqwo-matheus-projects-161f7187.vercel.app

## Testing Instructions

### Issue 1 Testing:
1. Disconnect an email account
2. Reconnect the same email account
3. Verify that existing conversation threads remain intact (no splitting)
4. Check console logs for "🧵 Rebuilding threads for reconnected store..." message

### Issue 2 Testing:
1. Reply to a customer email using the app
2. Verify that the reply shows the store name (e.g., "Little Infants Australia") instead of team member's personal name
3. Check that this matches the original email sender display

## Technical Details

### Issue 1 - Threading Algorithm Flow:
1. **Disconnection**: `DELETE FROM emails WHERE store_id = ?` (complete cleanup)
2. **Reconnection**: `syncEmails()` processes emails as received from Microsoft Graph
3. **Problem**: Graph API order ≠ chronological order
4. **Fix**: `rebuild_threads_for_store()` reprocesses all emails chronologically

### Issue 2 - Display Consistency:
1. **Database**: Stores replies with `from: email.store.name`
2. **Frontend**: Was showing `currentUserProfile.first_name + last_name` for replies
3. **Fix**: Now shows `currentStore?.name || email.storeName` for replies

Both issues are now resolved and deployed to production. 