import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useAuth } from '../../contexts/AuthContext';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const AuthDebug: React.FC = () => {
  const { user } = useAuth();
  const [debugInfo, setDebugInfo] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check environment variables
        const envCheck = {
          hasSupabaseUrl: !!import.meta.env.VITE_SUPABASE_URL,
          hasSupabaseKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          keyLength: import.meta.env.VITE_SUPABASE_ANON_KEY?.length
        };

        // Check Supabase session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        // Try to fetch user profile
        let profileData = null;
        let profileError = null;
        
        if (session?.user) {
          try {
            const { data, error } = await supabase
              .from('user_profiles')
              .select('*')
              .eq('user_id', session.user.id)
              .single();
            
            profileData = data;
            profileError = error;
          } catch (err) {
            profileError = err;
          }
        }

        setDebugInfo({
          envCheck,
          contextUser: user,
          supabaseSession: session,
          sessionError,
          profileData,
          profileError,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        setDebugInfo({
          error: error?.message || String(error),
          timestamp: new Date().toISOString()
        });
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [user]);

  if (loading) {
    return <div className="p-4">Loading debug info...</div>;
  }

  return (
    <div className="p-4 bg-gray-100 rounded-lg m-4">
      <h3 className="text-lg font-bold mb-4">Authentication Debug Info</h3>
      <pre className="text-xs bg-white p-4 rounded overflow-auto max-h-96">
        {JSON.stringify(debugInfo, null, 2)}
      </pre>
    </div>
  );
};

export default AuthDebug; 