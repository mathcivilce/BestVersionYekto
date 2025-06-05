import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js';

export async function checkRateLimit(
  supabase: SupabaseClient,
  service: string,
  endpoint: string,
  limit: number = 100,
  windowMinutes: number = 60
): Promise<boolean> {
  try {
    const now = new Date();
    console.log(`Checking rate limit for ${service}/${endpoint}`);
    
    // Get current rate limit
    const { data: rateLimit, error } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('service', service)
      .eq('endpoint', endpoint)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found error
      throw error;
    }

    // If no rate limit exists or it has expired, create a new one
    if (!rateLimit || new Date(rateLimit.reset_at) < now) {
      console.log('Creating new rate limit entry');
      const resetAt = new Date(now.getTime() + windowMinutes * 60000);
      
      const { error: insertError } = await supabase
        .from('rate_limits')
        .upsert({
          service,
          endpoint,
          remaining_calls: limit - 1,
          reset_at: resetAt.toISOString()
        });

      if (insertError) throw insertError;
      return true;
    }

    // Check if we have remaining calls
    if (rateLimit.remaining_calls <= 0) {
      console.log('Rate limit exceeded');
      return false;
    }

    // Decrement remaining calls
    console.log(`Remaining calls: ${rateLimit.remaining_calls - 1}`);
    const { error: updateError } = await supabase
      .from('rate_limits')
      .update({ remaining_calls: rateLimit.remaining_calls - 1 })
      .eq('id', rateLimit.id);

    if (updateError) throw updateError;
    return true;
  } catch (err) {
    console.error('Rate limit check failed:', err);
    return false;
  }
}

export async function getCacheEntry<T>(
  supabase: SupabaseClient,
  key: string
): Promise<T | null> {
  try {
    console.log(`Fetching cache entry for key: ${key}`);
    const { data, error } = await supabase
      .from('cache_entries')
      .select('value')
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    console.log('Cache hit');
    return data.value as T;
  } catch (err) {
    console.error('Cache get failed:', err);
    return null;
  }
}

export async function setCacheEntry<T>(
  supabase: SupabaseClient,
  key: string,
  value: T,
  ttlMinutes: number = 60
): Promise<void> {
  try {
    console.log(`Setting cache entry for key: ${key}`);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000);

    const { error } = await supabase
      .from('cache_entries')
      .upsert({
        key,
        value,
        expires_at: expiresAt.toISOString()
      });

    if (error) throw error;
    console.log('Cache entry set successfully');
  } catch (err) {
    console.error('Cache set failed:', err);
  }
}