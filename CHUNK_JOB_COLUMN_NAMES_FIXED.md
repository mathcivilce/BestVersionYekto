# Chunk Job Column Names Fix - RESOLVED ✅

## Issue Summary
The background-sync-processor was failing with the error:
```
record "v_chunk" has no field "chunk_number"
```

## Root Cause
The `claim_next_chunk_job_safe` functions were referencing `chunk_number` column, but the actual `chunked_sync_jobs` table uses `chunk_index` as the column name.

## Table Schema Validation
Confirmed `chunked_sync_jobs` table structure:
- ✅ `chunk_index` (integer) - correct column name
- ❌ `chunk_number` - does not exist

## Functions Fixed

### 1. `claim_next_chunk_job_safe(p_worker_id text)`
**Used by:** background-sync-processor function
**Issues Fixed:**
- Changed `v_chunk.chunk_number` → `v_chunk.chunk_index`
- Updated calculation to use direct columns: `v_chunk.start_offset`, `v_chunk.end_offset`
- Fixed return JSON structure

### 2. `claim_next_chunk_job_safe(p_parent_sync_job_id uuid)`
**Used by:** Legacy/alternative chunk claiming
**Issues Fixed:**
- Changed `ORDER BY chunk_number` → `ORDER BY chunk_index`
- Changed `j.chunk_number` → `j.chunk_index` in SELECT
- Fixed table references (`sync_jobs` → `sync_queue`)
- Updated return JSON to use correct column names

## Migration Applied
- **Migration 1:** `fix_claim_chunk_function_column_name`
- **Migration 2:** `fix_uuid_claim_chunk_function`

## Testing Results
Both functions now work correctly:

### Worker ID Version:
```json
{
  "success": true,
  "chunk_job": {
    "chunk_index": 3,
    "total_chunks": 5,
    "start_offset": 200,
    "end_offset": 299,
    "estimated_emails": 100
  }
}
```

### UUID Version:
```json
{
  "chunk_index": 2,
  "total_chunks": 5,
  "start_offset": 100,
  "end_offset": 199
}
```

## Status: RESOLVED ✅
The background-sync-processor should now work without the "chunk_number" field errors.

## Next Steps
Monitor the edge function logs to confirm the error is resolved and chunks are being processed successfully. 