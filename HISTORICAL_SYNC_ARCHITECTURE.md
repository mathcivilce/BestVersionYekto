# Historical Email Sync Architecture

This document outlines the complete, end-to-end process for performing a historical email sync for a newly connected account. This system is designed to be robust, scalable, and transparent, leveraging a chunk-based processing model to handle large mailboxes without running into serverless function timeouts.

## Core Components

The following files and database objects are the key players in this workflow:

-   **Frontend Initiator**: `src/contexts/InboxContext.tsx`
    -   Responsible for initiating the sync process after a successful OAuth connection.
-   **Database Compatibility Bridge**: `supabase/migrations/20250131000350_chunked_sync_compatibility_bridge.sql`
    -   Provides the `create_chunked_sync_job()` function, which acts as the main entry point for the frontend. This bridge ensures the frontend can call a simple function without needing to know about the complex chunking logic on the backend.
-   **Database Chunking Logic**: `supabase/migrations/20250618000000_fix_create_sync_chunks_function.sql`
    -   Contains the core `create_sync_chunks()` function that takes a parent job and divides it into manageable pieces.
-   **Background Worker**: `supabase/functions/background-sync-processor/index.ts`
    -   An edge function responsible for claiming and processing individual sync chunks. It operates in the background and is the engine of the historical sync.
-   **Core Sync Engine**: `supabase/functions/sync-emails/index.ts`
    -   The function that contains the logic to connect to the email provider's API (e.g., Gmail, Outlook) and fetch email data.
-   **Database Tables**:
    -   `sync_queue`: Holds the main, or "parent," sync jobs.
    -   `sync_chunks`: Holds the individual, smaller chunk jobs that are processed by workers.
    -   `chunk_config`: A configuration table that defines parameters like the size of each chunk.
-   **Real-time Updates**: Supabase Realtime
    -   The frontend subscribes to changes in the `sync_queue` and `sync_chunks` tables to display live progress to the user.

## Step-by-Step Flow

Here is the precise sequence of events for a historical sync:

### 1. User Connects Email Account

The process begins on the frontend. After the user successfully completes the OAuth flow to connect their email account, the application has the necessary tokens to proceed.

### 2. Frontend Creates the Sync Job

The frontend does **not** call the `sync-emails` function directly for a historical sync. Instead, it calls a database function to create a job in the queue.

-   **File**: `src/contexts/InboxContext.tsx`
-   **Action**: The client calls the `create_chunked_sync_job` function.
-   **Function Signature**:
    ```sql
    FUNCTION create_chunked_sync_job(
        p_store_id UUID,
        p_sync_type TEXT,
        p_estimated_email_count INTEGER,
        p_metadata JSONB
    ) RETURNS JSONB
    ```
-   **Database Operations**:
    1.  A new parent job is inserted into the `sync_queue` table with a `status` of `'pending'`.
    2.  This function immediately calls the internal `create_sync_chunks` function.

### 3. Database Creates Sync Chunks

This is the core of the chunking logic, ensuring the large task is broken down.

-   **File**: `supabase/migrations/20250618000000_fix_create_sync_chunks_function.sql`
-   **Function Signature**:
    ```sql
    FUNCTION create_sync_chunks(
        p_sync_job_id UUID,
        p_estimated_emails INTEGER
    ) RETURNS TABLE(success BOOLEAN, total_chunks INTEGER, base_chunk_size INTEGER, message TEXT)
    ```
-   **Database Operations**:
    1.  It queries the `chunk_config` table to get the `base_chunk_size`.
    2.  It calculates the `total_chunks` needed based on the estimated email count and chunk size.
    3.  It inserts N rows into the `sync_chunks` table, one for each chunk. Each of these chunks is created with a `status` of `'pending'`.
    4.  It returns the `total_chunks` and `base_chunk_size` to the calling `create_chunked_sync_job` function.

### 4. Processor Invocation

The `create_chunked_sync_job` function returns a success message to the frontend, which then immediately triggers the background processor.

-   **File**: `src/contexts/InboxContext.tsx`
-   **Action**: Upon receiving a successful response from the database, the client invokes the `background-sync-processor` edge function. It might pass the `parent_job_id` to the processor to target the sync, or it might trigger a general invocation.

### 5. Processor Claims a Job Chunk

The background worker starts and immediately tries to claim an available piece of work. This is a critical, race-condition-safe step.

-   **File**: `supabase/functions/background-sync-processor/index.ts`
-   **Action**: The processor calls the `claim_next_chunk_job()` database function.
-   **Database Operations**:
    1.  The `claim_next_chunk_job` function scans the `sync_chunks` table for any chunk with a `status` of `'pending'`.
    2.  Using `FOR UPDATE SKIP LOCKED`, it atomically selects the oldest pending chunk and updates its `status` to `'processing'`. This prevents any other workers from claiming the same chunk.
    3.  It returns the details of the claimed chunk to the `background-sync-processor`. If no pending jobs are found, it reports that back.

### 6. Email Synchronization

With a claimed chunk, the processor gets to work.

-   **File**: `supabase/functions/sync-emails/index.ts`
-   **Action**: The `background-sync-processor` uses the details from the claimed chunk (like start and end offsets) and calls the core `sync-emails` logic. This function communicates with the external email provider's API to fetch the actual email data for that specific chunk.

### 7. Real-time Status Updates and Completion

As the processor works, the UI is kept in sync with the progress.

-   **File**: `supabase/functions/background-sync-processor/index.ts`
-   **Action**:
    1.  After processing a chunk, the worker calls the `complete_chunk_job()` database function.
    2.  This function updates the chunk's status in `sync_chunks` to `'completed'` or `'failed'`.
    3.  It also updates the parent job's progress in the `sync_queue` table, incrementing the count of completed chunks.
-   **Real-time UI**:
    -   The frontend, using Supabase Realtime, is subscribed to changes on the `sync_queue` table.
    -   When the parent job's progress metadata is updated, the new data is automatically pushed to the client, and the UI (e.g., a progress bar) updates live.
    -   When all chunks are completed, the parent job status is set to `'completed'`, the user is notified, and their inbox is refreshed with the newly synced historical emails. 