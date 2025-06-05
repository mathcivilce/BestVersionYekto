import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function getCacheEntry<T>(
  userId: string,
  key: string
): Promise<T | null> {
  try {
    const { data, error } = await supabase
      .from('cache_entries')
      .select('value')
      .eq('user_id', userId)
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return data.value as T;
  } catch (err) {
    console.error('Cache get failed:', err);
    return null;
  }
}

export async function setCacheEntry<T>(
  userId: string,
  key: string,
  value: T,
  ttlMinutes: number = 60
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000);

    const { error } = await supabase
      .from('cache_entries')
      .upsert({
        user_id: userId,
        key,
        value,
        expires_at: expiresAt.toISOString()
      });

    if (error) throw error;
  } catch (err) {
    console.error('Cache set failed:', err);
  }
}