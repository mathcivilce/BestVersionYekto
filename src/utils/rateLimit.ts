import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function checkRateLimit(
  userId: string,
  service: string,
  endpoint: string,
  limit: number = 100,
  windowMinutes: number = 60
): Promise<boolean> {
  try {
    const now = new Date();
    
    // Get current rate limit
    const { data: rateLimit, error } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('user_id', userId)
      .eq('service', service)
      .eq('endpoint', endpoint)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found error
      throw error;
    }

    // If no rate limit exists or it has expired, create a new one
    if (!rateLimit || new Date(rateLimit.reset_at) < now) {
      const resetAt = new Date(now.getTime() + windowMinutes * 60000);
      
      const { error: insertError } = await supabase
        .from('rate_limits')
        .upsert({
          user_id: userId,
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
      return false;
    }

    // Decrement remaining calls
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