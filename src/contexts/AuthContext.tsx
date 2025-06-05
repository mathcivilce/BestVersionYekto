import React, { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate Supabase URL format
const isValidUrl = (urlString: string) => {
  try {
    new URL(urlString);
    return true;
  } catch (e) {
    return false;
  }
};

if (!supabaseUrl || !isValidUrl(supabaseUrl)) {
  throw new Error('Invalid or missing VITE_SUPABASE_URL. Please check your .env file and ensure the URL is in the correct format (e.g., https://your-project.supabase.co)');
}

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY. Please check your .env file');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    site: window.location.origin
  }
});

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signUp: (email: string, password: string, metadata?: any) => Promise<{ error: any }>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email!,
        });
      }
      setLoading(false);
    });

    // Listen for changes on auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email!,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
    } catch (error) {
      toast.error('Failed to log in');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string, firstName: string, lastName: string) => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            firstName,
            lastName,
          },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (error) throw error;
      toast.success('Registration successful! Please check your email to verify your account.');
    } catch (error) {
      toast.error('Failed to create account');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, metadata?: any) => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata || {},
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        return { error };
      }

      // If this is an invitation-based signup, call the accept-invitation function
      if (metadata?.invitation_token && data.user) {
        try {
          console.log('AuthContext: Processing invitation acceptance for user:', data.user.id);
          
          // Poll for session availability with retries
          let session = null;
          let attempts = 0;
          const maxAttempts = 10; // 10 attempts = 5 seconds max
          
          while (!session && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between attempts
            const { data: sessionData } = await supabase.auth.getSession();
            
            if (sessionData.session?.access_token) {
              session = sessionData.session;
              break;
            }
            
            attempts++;
            console.log(`AuthContext: Waiting for session... attempt ${attempts}/${maxAttempts}`);
          }
          
          if (!session?.access_token) {
            console.warn('AuthContext: Session not available, using alternative approach');
            // Use the service role approach via Edge Function without user session
            const acceptResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accept-invitation`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({ 
                token: metadata.invitation_token,
                user_id: data.user.id,
                direct_call: true // Flag to indicate this is a direct call without user session
              }),
            });
            
            if (!acceptResponse.ok) {
              const errorData = await acceptResponse.json();
              console.error('AuthContext: Accept invitation failed (direct):', errorData);
              throw new Error(errorData.error || 'Failed to process invitation');
            }

            const result = await acceptResponse.json();
            console.log('AuthContext: Invitation processed successfully (direct):', result);
          } else {
            console.log('AuthContext: Session established, using authenticated approach');
            
            const acceptResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accept-invitation`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ 
                token: metadata.invitation_token,
                user_id: data.user.id 
              }),
            });
            
            if (!acceptResponse.ok) {
              const errorData = await acceptResponse.json();
              console.error('AuthContext: Accept invitation failed (authenticated):', errorData);
              throw new Error(errorData.error || 'Failed to process invitation');
            }

            const result = await acceptResponse.json();
            console.log('AuthContext: Invitation processed successfully (authenticated):', result);
          }
          
        } catch (inviteError) {
          console.error('AuthContext: Error processing invitation:', inviteError);
          // This is critical - if invitation processing fails, the user won't have a profile
          throw new Error(`Account created but invitation processing failed: ${inviteError.message}`);
        }
      }

      return { error: null };
    } catch (error) {
      console.error('AuthContext: SignUp error:', error);
      return { error };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (error) {
      toast.error('Failed to log out');
      throw error;
    }
  };

  const value = {
    user,
    login,
    register,
    signUp,
    logout,
    loading
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};