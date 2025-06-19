# 📧 BACKGROUND SYNC SYSTEM - COMPREHENSIVE DOCUMENTATION

## 🎯 SYSTEM OVERVIEW

The Background Sync System is a sophisticated email synchronization architecture that processes email syncing in chunks for scalability and reliability. This document provides complete documentation of all components, data flows, and critical implementation details.

### 🏗️ ARCHITECTURE COMPONENTS

```
Frontend OAuth → InboxContext.createSyncJob → create_sync_chunks Function → chunked_sync_jobs Table 
→ background-sync-processor Function → claim_next_chunk_job Function → sync-emails Function 
→ complete_chunk_job Function → Email Processing Complete
```

---

## 📋 DATABASE SCHEMA

### 1. `sync_queue` Table (Parent Jobs)
```sql
-- Stores the main sync job metadata
CREATE TABLE sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES user_profiles(business_id),
    store_id UUID NOT NULL REFERENCES stores(id),
    sync_type TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 1,
    sync_from TIMESTAMPTZ,
    sync_to TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. `chunked_sync_jobs` Table (Child Chunks)
```sql
-- Stores individual chunk jobs that make up a larger sync
CREATE TABLE chunked_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_sync_job_id UUID NOT NULL REFERENCES sync_queue(id) ON DELETE CASCADE,
    business_id UUID NOT NULL,
    store_id UUID NOT NULL,
    chunk_index INTEGER NOT NULL,           -- 1, 2, 3, 4, 5...
    total_chunks INTEGER NOT NULL,          -- Total number of chunks
    start_offset INTEGER NOT NULL,          -- Email start position (0, 100, 200...)
    end_offset INTEGER NOT NULL,            -- Email end position (99, 199, 299...)
    estimated_emails INTEGER NOT NULL,      -- Expected emails in this chunk
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    attempts INTEGER DEFAULT 0,             -- Current retry attempts
    max_attempts INTEGER DEFAULT 3,         -- Maximum allowed retries
    worker_id TEXT,                         -- Background processor worker ID
    started_at TIMESTAMPTZ,                 -- When chunk processing started
    completed_at TIMESTAMPTZ,               -- When chunk processing completed
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 🔄 FLOW DIAGRAM: Complete Sync Process

### Phase 1: Job Creation (Frontend)
```
1. User connects email account (OAuth)
2. InboxContext.connectStoreServerOAuth() calls performInitialSync()
3. performInitialSync() calls createSyncJob()
4. createSyncJob() gets accurate email count from Microsoft Graph
5. createSyncJob() creates parent job in sync_queue
6. createSyncJob() calls create_sync_chunks() function
7. create_sync_chunks() creates 5 child chunks in chunked_sync_jobs
```

### Phase 2: Background Processing
```
8. Frontend triggers background-sync-processor Edge Function
9. background-sync-processor enters continuous loop:
   a. Calls claim_next_chunk_job() to get next pending chunk
   b. Updates chunk status to 'processing'
   c. Calls sync-emails with chunk parameters
   d. sync-emails processes emails within chunk boundaries
   e. Calls complete_chunk_job() to mark chunk as 'completed'
   f. Loop continues until no more pending chunks
```

---

## 🧩 DETAILED COMPONENT ANALYSIS

### 1. Frontend: `src/contexts/InboxContext.tsx`

#### Key Functions:

**`createSyncJob()`** - Lines 1124-1420
```typescript
// Gets accurate email count from Microsoft Graph API
let actualEmailCount = 100; // Default fallback
const countResponse = await fetch(graphUrl, {
  headers: {
    'Authorization': `Bearer ${storeData.access_token}`,
    'ConsistencyLevel': 'eventual'
  }
});
actualEmailCount = parseInt(countData['@odata.count']) || 100;

// Creates parent job in sync_queue
const { data: parentJob, error: parentError } = await supabase
  .from('sync_queue')
  .insert({
    business_id: userProfile.business_id,
    store_id: storeId,
    sync_type: syncType,
    status: 'pending',
    priority: 1,
    sync_from: syncFrom,
    sync_to: syncTo,
    metadata: metadata
  })
  .select()
  .single();

// Creates chunks using compatibility function
const { data: chunkResult, error: chunkError } = await supabase.rpc('create_sync_chunks', {
  p_parent_sync_job_id: parentJob.id,
  p_sync_type: syncType,
  p_estimated_email_count: actualEmailCount,
  p_sync_from: syncFrom,
  p_sync_to: syncTo
});
```

**`performInitialSync()`** - Lines 775-847 (OAuth Connection)
```typescript
// FIXED: Now simply calls createSyncJob instead of duplicating logic
const result = await createSyncJob(newStore.id, 'manual', storeData.syncFrom, storeData.syncTo);
```

**⚠️ CRITICAL BUG HISTORY:**
- **Original Issue**: `performInitialSync` was duplicating `createSyncJob` logic
- **Bug**: Used `actualEmailCount` variable that wasn't in scope → `ReferenceError`
- **Fix**: Made `performInitialSync` call `createSyncJob` directly

---

### 2. Database Functions

#### `create_sync_chunks()` - Compatibility Bridge
**Location**: `supabase/migrations/20250131000350_chunked_sync_compatibility_bridge.sql`

```sql
CREATE OR REPLACE FUNCTION create_sync_chunks(
    p_parent_sync_job_id UUID,
    p_sync_type TEXT DEFAULT 'manual',
    p_estimated_email_count INTEGER DEFAULT NULL,
    p_sync_from TEXT DEFAULT NULL,
    p_sync_to TEXT DEFAULT NULL
) RETURNS JSONB
```

**Purpose**: Bridges frontend calls to backend chunking system

**Process**:
1. Validates parent sync job exists
2. Estimates email count based on sync type
3. Updates parent job with sync range metadata
4. Creates chunks directly in `chunked_sync_jobs` table
5. Returns JSONB response for frontend compatibility

**⚠️ CRITICAL BUG HISTORY:**
- **Original Issue**: Function was calling non-existent `create_sync_chunks(uuid, integer)`
- **Error**: `function create_sync_chunks(uuid, integer) does not exist`
- **Fix**: Rewrote to create chunks directly instead of calling missing function

#### `claim_next_chunk_job()` - Sequential Processing
**Purpose**: Claims next available chunk in sequential order

```sql
-- CRITICAL: Orders by chunk_index ASC for sequential processing (1,2,3,4,5)
UPDATE chunked_sync_jobs 
SET status = 'processing', started_at = NOW(), attempts = attempts + 1, worker_id = p_worker_id
WHERE id = (
    SELECT id FROM chunked_sync_jobs
    WHERE status = 'pending' AND attempts < max_attempts
    ORDER BY chunk_index ASC, created_at ASC  -- Sequential processing!
    LIMIT 1 FOR UPDATE SKIP LOCKED
);
```

**⚠️ SEQUENTIAL ORDERING**: Without `ORDER BY chunk_index ASC`, chunks could be processed out of order!

#### `complete_chunk_job()` - Completion Tracking
**Purpose**: Marks chunk as completed and records processing stats

```sql
UPDATE chunked_sync_jobs 
SET status = p_status, completed_at = NOW(), processing_time_ms = p_processing_time_ms
WHERE id = p_chunk_job_id;
```

---

### 3. Background Processor: `supabase/functions/background-sync-processor/index.ts`

#### Core Loop Logic
```typescript
while (true) {
  // 1. Claim next chunk
  const { data: claimResult } = await supabaseAdmin.rpc('claim_next_chunk_job', {
    p_worker_id: workerId
  });

  if (!claimResult?.success) {
    break; // No more chunks to process
  }

  // 2. Process chunk via sync-emails
  const { data: syncResult } = await supabaseAdmin.functions.invoke('sync-emails', {
    body: {
      storeId: chunkJob.store_id,
      chunkId: chunkJob.chunk_id,
      chunkIndex: chunkJob.chunk_index,
      totalChunks: chunkJob.total_chunks,
      startOffset: chunkJob.start_offset,
      endOffset: chunkJob.end_offset,
      chunked: true
    }
  });

  // 3. Mark chunk as completed
  await supabaseAdmin.rpc('complete_chunk_job', {
    p_chunk_job_id: chunkJob.chunk_id,
    p_status: 'completed'
  });
}
```

**🔄 CONTINUOUS PROCESSING**: The `while(true)` loop ensures all chunks are processed in one session

---

### 4. Email Sync: `supabase/functions/sync-emails/index.ts`

#### Chunk Processing Logic (Lines 570-591)
```typescript
// CHUNKED PROCESSING LIMITS
if (chunked && typeof startOffset === 'number' && typeof endOffset === 'number') {
  console.log(`🧩 CHUNK PROCESSING: Evaluating chunk range ${startOffset} to ${endOffset}`);
  
  if (syncFrom || syncTo) {
    // DATE RANGE + CHUNK MODE: Process chunk of date-filtered emails
    console.log(`📅 DATE RANGE + CHUNK MODE: Processing chunk ${chunkIndex}/${totalChunks} of date-filtered emails`);
    emailsToProcess = emailsToProcess.slice(startOffset, endOffset + 1);
  } else {
    // Original chunking logic for non-date-filtered syncs
    emailsToProcess = allEmails.slice(startOffset, endOffset + 1);
    console.log(`🧩 Chunk ${chunkIndex}/${totalChunks}: Processing ${emailsToProcess.length} emails (range ${startOffset}-${endOffset})`);
  }
}
```

**📅 DATE RANGE HANDLING**: When sync has date filters, chunks process subsets of the date-filtered emails

---

## 🚨 CURRENT ISSUE ANALYSIS

### Problem: Only 4/5 Chunks Processed

**Database State**:
```sql
chunk_index | status     | attempts
1          | completed  | 1
2          | completed  | 1  
3          | processing | 1  ← STUCK HERE
4          | pending    | 0
5          | pending    | 0
```

**Root Cause**: Chunk 3 is stuck in "processing" status, preventing chunks 4 and 5 from being claimed.

**Possible Causes**:
1. **Timeout in sync-emails function** while processing chunk 3
2. **Edge Function execution limit exceeded** (max 30 seconds)
3. **Error in chunk 3 processing** that wasn't properly caught
4. **Network timeout** during Microsoft Graph API calls
5. **Database transaction timeout** during email saving

---

## 🔧 TROUBLESHOOTING GUIDE

### 1. Check Stuck Chunks
```sql
SELECT chunk_index, status, attempts, started_at, worker_id
FROM chunked_sync_jobs 
WHERE status = 'processing' 
  AND started_at < NOW() - INTERVAL '5 minutes';
```

### 2. Reset Stuck Chunks
```sql
UPDATE chunked_sync_jobs 
SET status = 'pending', worker_id = NULL, started_at = NULL
WHERE status = 'processing' 
  AND started_at < NOW() - INTERVAL '5 minutes';
```

### 3. Check Background Processor Logs
- Go to Supabase Dashboard > Edge Functions > background-sync-processor
- Check logs for error messages around chunk 3 processing
- Look for timeout errors or API failures

### 4. Manual Retry Processing
```sql
-- Trigger background processor manually
SELECT net.http_post(
  'https://[project-ref].supabase.co/functions/v1/background-sync-processor',
  '{}',
  'application/json'
);
```

---

## 📝 MAINTENANCE PROCEDURES

### 1. Cleanup Old Jobs
```sql
-- Clean up completed jobs older than 7 days
DELETE FROM sync_queue 
WHERE status = 'completed' 
  AND created_at < NOW() - INTERVAL '7 days';
```

### 2. Monitor Chunk Success Rate
```sql
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM chunked_sync_jobs 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;
```

### 3. Identify Problem Stores
```sql
SELECT 
  s.name,
  s.email,
  COUNT(CASE WHEN csj.status = 'failed' THEN 1 END) as failed_chunks,
  COUNT(*) as total_chunks
FROM stores s
JOIN chunked_sync_jobs csj ON s.id = csj.store_id
WHERE csj.created_at > NOW() - INTERVAL '24 hours'
GROUP BY s.id, s.name, s.email
HAVING COUNT(CASE WHEN csj.status = 'failed' THEN 1 END) > 0
ORDER BY failed_chunks DESC;
```

---

## ⚠️ CRITICAL IMPLEMENTATION NOTES

### 1. Sequential Processing Requirement
- Chunks MUST be processed in order (1,2,3,4,5)
- `claim_next_chunk_job` uses `ORDER BY chunk_index ASC`
- Out-of-order processing could cause data inconsistencies

### 2. Timeout Handling
- Edge Functions have 30-second execution limit
- Large chunks may timeout during processing
- Consider reducing chunk size for stores with many emails

### 3. Error Recovery
- Failed chunks can be retried up to `max_attempts` (default: 3)
- After max attempts, chunk is marked as permanently failed
- One failed chunk doesn't stop other chunks from processing

### 4. Date Range Synchronization
- When date range is specified, chunks process subsets of filtered emails
- Total email count is based on date-filtered results
- Chunk boundaries respect the date filter

---

## 🐛 KNOWN BUGS AND FIXES

### Bug 1: actualEmailCount Scope Error ✅ FIXED
**Error**: `ReferenceError: actualEmailCount is not defined`
**Cause**: `performInitialSync` tried to use variable from different function scope
**Fix**: Made `performInitialSync` call `createSyncJob` directly

### Bug 2: Function Overloading Conflict ✅ FIXED  
**Error**: `Could not choose the best candidate function between create_sync_chunks(...)`
**Cause**: Multiple functions with similar but conflicting signatures
**Fix**: Dropped conflicting TIMESTAMPTZ version, kept TEXT version

### Bug 3: Missing Function Dependency ✅ FIXED
**Error**: `function create_sync_chunks(uuid, integer) does not exist`
**Cause**: Compatibility bridge called non-existent 2-parameter function
**Fix**: Rewrote bridge to create chunks directly

### Bug 4: Chunk 3 Stuck in Processing ❌ CURRENT ISSUE
**Symptom**: Only 4/5 chunks processed, chunk 3 stuck in "processing"
**Likely Cause**: Timeout or error in sync-emails function for chunk 3
**Investigation Needed**: Check Edge Function logs and reset stuck chunk

---

## 📚 RELATED DOCUMENTATION

- **OAuth Implementation**: `PHASE4_OAUTH_IMPLEMENTATION_PLAN.md`
- **Team Management**: `TEAM_MANAGEMENT_IMPLEMENTATION.md` 
- **Sync Architecture**: `UNIFIED_CHUNKED_SYNC_ARCHITECTURE.md`
- **Email Threading**: `UNIVERSAL_RFC2822_THREADING.md`
- **Security**: `RLS_Security_Fix_Summary.md`

---

## 🚀 FUTURE IMPROVEMENTS

1. **Chunk Size Auto-Adjustment**: Dynamically adjust chunk size based on store email volume
2. **Parallel Processing**: Process multiple chunks simultaneously (with careful ordering)
3. **Progress Tracking**: Real-time progress updates for users during sync
4. **Health Monitoring**: Automated detection and recovery of stuck chunks
5. **Performance Metrics**: Track sync speeds and optimize accordingly

---

*Last Updated: June 18, 2025*
*System Status: Operational (1 known issue with chunk 3 timeout)* 