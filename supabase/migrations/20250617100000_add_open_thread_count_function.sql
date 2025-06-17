CREATE OR REPLACE FUNCTION count_open_threads_by_store(p_store_id UUID)
RETURNS INTEGER AS $$
DECLARE
    thread_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT thread_id)
    INTO thread_count
    FROM emails
    WHERE store_id = p_store_id
    AND status = 'open';

    RETURN thread_count;
END;
$$ LANGUAGE plpgsql; 