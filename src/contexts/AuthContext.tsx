/**
 * Authentication Context Provider
 * 
 * This context manages user authentication throughout the application using Supabase Auth.
 * It provides functionality for:
 * - User login/logout
 * - User registration  
 * - Invitation-based signup with team integration
 * - Session management with automatic refresh
 * - Environment validation for Supabase configuration
 * 
 * The auth system supports both regular user registration and invitation-based
 * signup where users can join existing businesses through invitation tokens.
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';

// Get Supabase configuration from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Validate if a string is a properly formatted URL
 * @param urlString - URL string to validate
 * @returns boolean indicating if URL is valid
 */
const isValidUrl = (urlString: string) => {
  try {
    new URL(urlString);
    return true;
  } catch (e) {
    return false;
  }
};

// Validate Supabase configuration on startup
if (!supabaseUrl || !isValidUrl(supabaseUrl)) {
  throw new Error('Invalid or missing VITE_SUPABASE_URL. Please check your .env file and ensure the URL is in the correct format (e.g., https://your-project.supabase.co)');
}

if (!supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_ANON_KEY. Please check your .env file');
}

/**
 * Initialize Supabase client with authentication configuration
 * 
 * Auth configuration:
 * - autoRefreshToken: Automatically refresh expired tokens
 * - persistSession: Keep user logged in across browser sessions
 * - detectSessionInUrl: Handle auth redirects from email links
 * - flowType: Use PKCE flow for enhanced security
 */
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    site: window.location.origin
  }
});

// User data structure
interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

// Authentication context interface
interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signUp: (email: string, password: string, metadata?: any) => Promise<{ error: any }>;
  logout: () => Promise<void>;
  loading: boolean;
}

// Create authentication context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Custom hook to access authentication context
 * Throws error if used outside of AuthProvider
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Authentication Provider Component
 * 
 * Provides authentication state and methods to all child components.
 * Handles session persistence and automatic auth state changes.
 * 
 * PERFORMANCE FIX: Uses useMemo to stabilize user object and prevent 
 * infinite re-render loops in components that depend on this context.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Stabilize user object to prevent infinite re-renders in child components
  const memoizedUser = useMemo(() => {
    return user;
  }, [user?.id, user?.email]); // Only recreate when actual user data changes

  // Helper function to create user object only when data actually changes
  const createUserFromSession = useCallback((sessionUser: any): User => {
    return {
      id: sessionUser.id,
      email: sessionUser.email!,
    };
  }, []);

  // Helper function to compare user objects for equality
  const usersAreEqual = useCallback((user1: User | null, user2: User | null): boolean => {
    if (!user1 && !user2) return true;
    if (!user1 || !user2) return false;
    return user1.id === user2.id && user1.email === user2.email;
  }, []);

  useEffect(() => {
    // Check for existing session on app startup
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const newUser = createUserFromSession(session.user);
        setUser(prevUser => {
          // Only update if user data actually changed
          if (!usersAreEqual(prevUser, newUser)) {
            return newUser;
          }
          return prevUser;
        });
      }
      setLoading(false);
    });

    // Listen for authentication state changes
    // This handles login, logout, token refresh, etc.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const newUser = createUserFromSession(session.user);
        setUser(prevUser => {
          // Only update if user data actually changed - prevents unnecessary re-renders
          if (!usersAreEqual(prevUser, newUser)) {
            return newUser;
          }
          return prevUser;
        });
      } else {
        setUser(prevUser => {
          // Only set to null if not already null
          return prevUser !== null ? null : prevUser;
        });
      }
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => subscription.unsubscribe();
  }, [createUserFromSession, usersAreEqual]);

  /**
   * Log in user with email and password
   * 
   * @param email - User's email address
   * @param password - User's password
   * @throws Error if login fails
   */
  const login = useCallback(async (email: string, password: string) => {
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
  }, []);

  /**
   * Register new user with email confirmation
   * 
   * @param email - User's email address
   * @param password - User's password
   * @param firstName - User's first name
   * @param lastName - User's last name
   * @throws Error if registration fails
   */
  const register = useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
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
          // Redirect to login page after email confirmation
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
  }, []);

  /**
   * Sign up user (supports both regular and invitation-based registration)
   * 
   * @param email - User's email address
   * @param password - User's password
   * @param metadata - Additional user data (including invitation token)
   * @returns Object with error if signup fails
   * 
   * For invitation-based signup:
   * - Skips email confirmation (auto-confirmed by trigger)
   * - Processes invitation token to join existing business
   * - Handles session establishment for immediate login
   */
  const signUp = useCallback(async (email: string, password: string, metadata?: any) => {
    try {
      setLoading(true);
      
      // For invited users, skip email confirmation by not setting emailRedirectTo
      // The trigger function will auto-confirm their email
      const signUpOptions: any = {
        data: metadata || {},
      };
      
      // Only set emailRedirectTo for non-invitation signups (this triggers confirmation email)
      if (!metadata?.invitation_token) {
        signUpOptions.emailRedirectTo = `${window.location.origin}/dashboard`;
      }
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: signUpOptions,
      });

      if (error) {
        return { error };
      }

      // If this is an invitation-based signup, call the accept-invitation function
      if (metadata?.invitation_token && data.user) {
        try {
          console.log('AuthContext: Processing invitation acceptance for user:', data.user.id);
          
          // Poll for session availability with retries
          // Sometimes there's a delay between user creation and session availability
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
            
            // Call invitation acceptance endpoint with user session
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
          
          // Handle business conflict scenario
          if (inviteError.message && inviteError.message.includes('already associated with')) {
            throw new Error(inviteError.message);
          }
          
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
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (error) {
      toast.error('Failed to log out');
      throw error;
    }
  }, []);

  // Memoize context value to prevent unnecessary re-renders in child components
  // Only recreate when actual dependencies change
  const value = useMemo(() => ({
    user: memoizedUser,
    login,
    register,
    signUp,
    logout,
    loading
  }), [memoizedUser, login, register, signUp, logout, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};