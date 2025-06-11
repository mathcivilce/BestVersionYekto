import { createClient } from '@supabase/supabase-js';
import { API_CONFIG, validateConfig } from './api';

// Validate configuration on module load
try {
  validateConfig();
} catch (error) {
  console.error('Supabase configuration error:', error);
}

// Create a single shared Supabase client instance
const createSupabaseClient = () => {
  const url = API_CONFIG.supabase.url;
  const key = API_CONFIG.supabase.anonKey;
  
  if (!url || !key) {
    console.error('Supabase environment variables are not configured');
    throw new Error('Supabase configuration is missing');
  }
  
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        storageKey: 'supabase-auth-token',
        storage: window.localStorage
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });
  } catch (error) {
    console.error('Failed to create Supabase client:', error);
    throw error;
  }
};

// Export a single instance
export const supabase = createSupabaseClient();

export default supabase; 