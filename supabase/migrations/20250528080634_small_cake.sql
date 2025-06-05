/*
  # Add email source tracking

  1. Changes
    - Add source column to emails table to track origin
    - Valid values: 'webhook', 'backfill', null
    - Helps distinguish between initial sync and real-time updates

  2. Notes
    - Maintains existing data by defaulting to null
    - Allows filtering notifications by source
*/

ALTER TABLE emails ADD COLUMN IF NOT EXISTS source text;