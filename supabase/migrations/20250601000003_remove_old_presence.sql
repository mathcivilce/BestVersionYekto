-- Remove Old Email Presence System
DROP TABLE IF EXISTS email_presence CASCADE;
DROP FUNCTION IF EXISTS cleanup_stale_presence() CASCADE;
DROP FUNCTION IF EXISTS get_email_viewers(uuid) CASCADE;
DROP FUNCTION IF EXISTS upsert_email_presence(uuid, uuid) CASCADE;