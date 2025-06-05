import React, { createContext, useContext, useState, useEffect } from 'react';
import { PublicClientApplication, InteractionRequiredAuthError, Configuration, AccountInfo } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { Message } from '@microsoft/microsoft-graph-types';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { TokenManager } from '../utils/tokenManager';

interface Email {
  id: string;
  graph_id?: string;
  subject: string;
  snippet: string;
  content?: string;
  from: string;
  date: string;
  read: boolean;
  priority: number;
  status: string;
  storeName: string;
  storeColor: string;
  store_id: string;
  thread_id?: string;
  assigned_to?: string | null;
}

interface Store {
  id: string;
  name: string;
  platform: 'outlook' | 'gmail';
  email: string;
  connected: boolean;
  status: 'active' | 'issue' | 'pending' | 'syncing';
  color: string;
  lastSynced?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  token_last_refreshed?: string;
}

interface InboxContextType {
  emails: Email[];
  stores: Store[];
  getEmailById: (id: string) => Email | undefined;
  markAsRead: (id: string) => Promise<void>;
  deleteEmail: (id: string) => Promise<void>;
  statuses: string[];
  connectStore: (storeData: any) => Promise<void>;
  disconnectStore: (id: string) => void;
  syncEmails: (storeId: string, syncFrom?: string, syncTo?: string) => Promise<void>;
  refreshEmails: () => Promise<void>;
  loading: boolean;
  error: string | null;
  pendingStore: any | null;
}

const InboxContext = createContext<InboxContextType | undefined>(undefined);

export const useInbox = () => {
  const context = useContext(InboxContext);
  if (context === undefined) {
    throw new Error('useInbox must be used within an InboxProvider');
  }
  return context;
};

const requiredScopes = [
  'User.Read',
  'Mail.Read',
  'Mail.ReadBasic',
  'offline_access'
];

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || '',
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: true
  },
  system: {
    allowNativeBroker: false,
    windowHashTimeout: 60000,
    iframeHashTimeout: 6000,
    loadFrameTimeout: 0,
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case 0: console.error(message); break;
          case 1: console.warn(message); break;
          case 2: console.info(message); break;
          case 3: console.debug(message); break;
        }
      },
      piiLoggingEnabled: false
    }
  }
};

let msalInstance: PublicClientApplication | null = null;

const initializeMsal = async () => {
  if (!msalInstance) {
    if (!import.meta.env.VITE_AZURE_CLIENT_ID) {
      throw new Error('Azure Client ID is not configured');
    }
    msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();
  }
  return msalInstance;
};

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const InboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [emails, setEmails] = useState<Email[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<AccountInfo | null>(null);
  const [pendingStore, setPendingStore] = useState<any>(null);
  const [realtimeSubscription, setRealtimeSubscription] = useState<any>(null);
  const [tokenManager, setTokenManager] = useState<TokenManager | null>(null);
  const [periodicRefreshCleanup, setPeriodicRefreshCleanup] = useState<(() => void) | null>(null);
  
  const statuses = ['open', 'pending', 'resolved'];

  const getEmailById = (id: string) => {
    return emails.find(email => email.id === id);
  };

  const markAsRead = async (id: string) => {
    try {
      const { error: updateError } = await supabase
        .from('emails')
        .update({ read: true })
        .eq('id', id);

      if (updateError) throw updateError;

      setEmails(prev => prev.map(email => 
        email.id === id ? { ...email, read: true } : email
      ));
    } catch (error) {
      console.error('Error marking email as read:', error);
      setError('Failed to mark email as read');
    }
  };

  const deleteEmail = async (id: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('emails')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setEmails(prev => prev.filter(email => email.id !== id));
    } catch (error) {
      console.error('Error deleting email:', error);
      setError('Failed to delete email');
    }
  };

  const connectStore = async (storeData: any) => {
    try {
      setLoading(true);
      setPendingStore(storeData);

      const msalInstance = await initializeMsal();
      const loginRequest = {
        scopes: [...requiredScopes, 'Mail.Send', 'Mail.ReadWrite'],
        prompt: 'select_account'
      };

      const msalResponse = await msalInstance.loginPopup(loginRequest);
      setCurrentAccount(msalResponse.account);

      const tokenResponse = await msalInstance.acquireTokenSilent({
        scopes: [...requiredScopes, 'Mail.Send', 'Mail.ReadWrite'],
        account: msalResponse.account
      });

      // Calculate token expiration
      const expiresAt = new Date();
      if (tokenResponse.expiresOn) {
        expiresAt.setTime(tokenResponse.expiresOn.getTime());
      } else {
        // Default to 1 hour if no expiration provided
        expiresAt.setHours(expiresAt.getHours() + 1);
      }

      // Get user's business_id
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user?.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        throw new Error('Business information not found. Please contact support.');
      }

      // Store with refresh token capability
      const storeInsertData: any = {
        name: storeData.name,
        platform: 'outlook',
        email: msalResponse.account.username,
        color: storeData.color || '#2563eb',
        connected: true,
        status: 'active',
        user_id: user?.id,
        business_id: userProfile.business_id,
        access_token: tokenResponse.accessToken,
        token_expires_at: expiresAt.toISOString(),
        token_last_refreshed: new Date().toISOString()
      };

      // Try to get refresh token from MSAL cache
      // Note: MSAL manages refresh tokens internally, but we'll store what we can
      try {
        const account = msalInstance.getAccountByUsername(msalResponse.account.username);
        if (account) {
          // MSAL doesn't expose refresh tokens directly for security reasons
          // But we can use the account information for future silent token requests
          console.log('MSAL account stored for future token refresh');
        }
      } catch (refreshTokenError) {
        console.warn('Could not access refresh token information:', refreshTokenError);
      }

      const { data: store, error: storeError } = await supabase
        .from('stores')
        .insert(storeInsertData)
        .select()
        .single();

      if (storeError) throw storeError;

      // Create webhook subscription
      const graphClient = Client.init({
        authProvider: (done) => {
          done(null, tokenResponse.accessToken);
        }
      });

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 3);

      const clientState = crypto.randomUUID();

      const subscription = await graphClient
        .api('/subscriptions')
        .post({
          changeType: 'created',
          notificationUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-webhook`,
          resource: '/me/mailFolders(\'Inbox\')/messages',
          expirationDateTime: expirationDate.toISOString(),
          clientState
        });

      // Store subscription details
      await supabase
        .from('graph_subscriptions')
        .insert({
          store_id: store.id,
          subscription_id: subscription.id,
          resource: '/me/mailFolders(\'Inbox\')/messages',
          client_state: clientState,
          expiration_date: expirationDate.toISOString()
        });

      // Update local state
      setStores(prev => [...prev, {
        ...store,
        lastSynced: store.last_synced
      }]);

      setPendingStore(null);

      console.log('=== STARTING AUTOMATIC SYNC SETUP ===');
      console.log('Store created with ID:', store.id);
      console.log('Current timestamp:', new Date().toISOString());

      // Trigger initial email sync with improved error handling
      console.log('Starting automatic email sync for new store:', store.id);
      
      // Explicitly capture the store ID and date range to avoid closure issues
      const storeId = store.id;
      const { syncFrom, syncTo } = storeData; // Extract date range from modal
      console.log('Captured storeId for sync:', storeId);
      console.log('Captured date range:', { syncFrom, syncTo });
      
      // Perform initial sync and wait for it to complete before finishing
      try {
        console.log('Performing initial email sync...');
        await syncEmails(storeId, syncFrom, syncTo);
        console.log('Initial sync completed successfully');
        toast.success('Store connected and emails synced successfully');
      } catch (syncError) {
        console.error('Initial sync failed:', syncError);
        
        // More specific error messages
        const errorMessage = (syncError as any)?.message || 'Unknown error';
        if (errorMessage.includes('Store ID is required')) {
          toast.error('Configuration error. Please try disconnecting and reconnecting the store.');
        } else if (errorMessage.includes('session')) {
          toast.error('Session issue. Please refresh the page and try again.');
        } else if (errorMessage.includes('token')) {
          toast.error('Authentication issue. You may need to reconnect this store.');
        } else {
          toast.error(`Initial sync failed: ${errorMessage}. You can manually sync using the sync button.`);
        }
        
        // Don't throw the error - the store was created successfully, just sync failed
        console.warn('Store connected but initial sync failed. User can retry manually.');
      }
      
      console.log('=== AUTOMATIC SYNC SETUP COMPLETE ===');
      
    } catch (error: any) {
      console.error('Error connecting store:', error);
      setPendingStore(null);
      if (error.errorCode === 'user_cancelled') {
        toast.error('Connection cancelled');
      } else {
        toast.error('Failed to connect store: ' + error.message);
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const disconnectStore = async (id: string) => {
    try {
      const store = stores.find(s => s.id === id);
      if (!store) return;

      let accessToken = store.access_token;

      // Try to get a fresh token using token manager if available
      if (tokenManager && store.email) {
        try {
          const account = tokenManager.getAccountForStore(store.email);
          if (account) {
            accessToken = await tokenManager.getValidToken(id, account, requiredScopes);
          }
        } catch (tokenError) {
          console.warn('Could not refresh token for disconnection:', tokenError);
          // Continue with stored token
        }
      }

      // Get webhook subscription
      const { data: subscription } = await supabase
        .from('graph_subscriptions')
        .select('subscription_id')
        .eq('store_id', id)
        .single();

      if (subscription && accessToken) {
        try {
          // Try to delete the webhook subscription
          const graphClient = Client.init({
            authProvider: (done) => {
              done(null, accessToken);
            }
          });

          await graphClient
            .api(`/subscriptions/${subscription.subscription_id}`)
            .delete();

        } catch (webhookError) {
          console.warn('Could not clean up webhook subscription:', webhookError);
          // Continue with store deletion anyway
        }
      }

      // Delete subscription record
      await supabase
        .from('graph_subscriptions')
        .delete()
        .eq('store_id', id);

      // Delete store and related data
      const { error: deleteError } = await supabase
        .from('stores')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      // Update local state
      setStores(prev => prev.filter(store => store.id !== id));
      setEmails(prev => prev.filter(email => email.store_id !== id));

      toast.success('Store disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting store:', error);
      toast.error('Failed to disconnect store');
      throw error;
    }
  };

  const syncEmails = async (storeId: string, syncFrom?: string, syncTo?: string) => {
    try {
      console.log(`Starting email sync for store: ${storeId}`);
      
      // Validate storeId parameter
      if (!storeId || storeId.trim() === '') {
        const error = 'Invalid storeId parameter: ' + JSON.stringify(storeId);
        console.error(error);
        throw new Error('Store ID is required and must be a valid string');
      }
      
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Session check:', { hasSession: !!session, hasAccessToken: !!session?.access_token });
      
      if (!session?.access_token) {
        throw new Error('No user session found. Please log in again.');
      }

      console.log('Calling sync-emails function with payload:', { storeId: storeId, syncFrom, syncTo });
      
      // Try using fetch directly as an alternative to supabase.functions.invoke
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const functionUrl = `${supabaseUrl}/functions/v1/sync-emails`;
      
      console.log('Making direct fetch call to:', functionUrl);
      
      // Create the request payload - include date range if provided
      const requestPayload: any = { storeId: storeId };
      
      // Convert date ranges to Perth timezone with full day coverage
      if (syncFrom) {
        // Create start of day in Perth timezone (UTC+8)
        const fromDate = new Date(syncFrom + 'T00:00:00+08:00');
        requestPayload.syncFrom = fromDate.toISOString();
        console.log('Converted syncFrom:', syncFrom, '->', fromDate.toISOString());
      }
      
      if (syncTo) {
        // Create end of day in Perth timezone (UTC+8)
        const toDate = new Date(syncTo + 'T23:59:59+08:00');
        requestPayload.syncTo = toDate.toISOString();
        console.log('Converted syncTo:', syncTo, '->', toDate.toISOString());
      }
      
      const requestBody = JSON.stringify(requestPayload);
      
      console.log('=== DETAILED REQUEST LOGGING ===');
      console.log('storeId variable:', storeId);
      console.log('storeId type:', typeof storeId);
      console.log('storeId length:', storeId?.length);
      console.log('Original syncFrom:', syncFrom);
      console.log('Original syncTo:', syncTo);
      console.log('Converted syncFrom ISO:', requestPayload.syncFrom);
      console.log('Converted syncTo ISO:', requestPayload.syncTo);
      console.log('Request payload object:', requestPayload);
      console.log('Request body string:', requestBody);
      console.log('Request body length:', requestBody.length);
      console.log('Stringified payload verification:', JSON.parse(requestBody));
      console.log('=== END DETAILED REQUEST LOGGING ===');
      
      const fetchResponse = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: requestBody
      });
      
      console.log('Direct fetch response status:', fetchResponse.status);
      console.log('Direct fetch response statusText:', fetchResponse.statusText);
      console.log('Direct fetch response headers:', Object.fromEntries(fetchResponse.headers.entries()));
      
      // Get response text before trying to parse as JSON
      const responseText = await fetchResponse.text();
      console.log('Direct fetch response text:', responseText);
      
      if (!fetchResponse.ok) {
        console.error('Direct fetch error - Status:', fetchResponse.status);
        console.error('Direct fetch error - Response:', responseText);
        throw new Error(`HTTP ${fetchResponse.status}: ${responseText}`);
      }
      
      // Try to parse as JSON
      let response;
      try {
        response = JSON.parse(responseText);
        console.log('Direct fetch response data (parsed):', response);
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', parseError);
        console.error('Raw response text:', responseText);
        throw new Error('Invalid JSON response from server');
      }

      if (response?.error) {
        console.error('Edge function returned error:', response.error);
        throw new Error(response.error);
      }

      console.log('Email sync completed:', response);
      toast.success('Email sync completed successfully');
      
      // Refresh the emails after sync
      if (user) {
        console.log('Refreshing emails after sync...');
        const { data: emailsData, error: emailsError } = await supabase
          .from('emails')
          .select('*')
          .eq('user_id', user.id)
          .eq('store_id', storeId)
          .order('date', { ascending: false });

        if (emailsError) {
          console.error('Error fetching emails after sync:', emailsError);
        } else if (emailsData) {
          console.log(`Found ${emailsData.length} emails for store ${storeId}`);
          const store = stores.find(s => s.id === storeId);
          const emailsWithStore = emailsData.map(email => ({
            ...email,
            storeName: store?.name || '',
            storeColor: store?.color || '#2563eb'
          }));
          
          // Update emails state by merging new emails
          setEmails(prev => {
            const filtered = prev.filter(e => e.store_id !== storeId);
            return [...emailsWithStore, ...filtered].sort((a, b) => 
              new Date(b.date).getTime() - new Date(a.date).getTime()
            );
          });
          
          console.log('Emails state updated successfully');
        }
      }
    } catch (error) {
      console.error('Error syncing emails:', error);
      const errorMessage = (error as any)?.message || 'Unknown error occurred';
      toast.error(`Failed to sync emails: ${errorMessage}`);
      throw error;
    }
  };

  const refreshEmails = async () => {
    if (!user) return;
    
    try {
      console.log('InboxContext: Manual email refresh triggered');
      setLoading(true);
      
      const { data: emailsData, error: emailsError } = await supabase
        .from('emails')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (emailsError) {
        console.error('InboxContext: Error refreshing emails:', emailsError);
        throw emailsError;
      }

      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', user.id);

      if (storesError) {
        console.error('InboxContext: Error refreshing stores:', storesError);
        throw storesError;
      }

      const emailsWithStore = (emailsData || []).map(email => {
        const store = storesData?.find(s => s.id === email.store_id);
        return {
          ...email,
          storeName: store?.name || '',
          storeColor: store?.color || '#2563eb'
        };
      });

      setEmails(emailsWithStore);
      console.log('InboxContext: Manual refresh completed -', emailsWithStore.length, 'emails loaded');
      toast.success('Emails refreshed successfully');
    } catch (error) {
      console.error('InboxContext: Manual refresh failed:', error);
      toast.error('Failed to refresh emails');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      if (!import.meta.env.VITE_AZURE_CLIENT_ID) {
        setError('Microsoft authentication is not configured');
        setLoading(false);
        return;
      }

      try {
        const msalInstance = await initializeMsal();
        setInitialized(true);

        // Initialize token manager
        const manager = new TokenManager(msalInstance);
        setTokenManager(manager);

        // Start periodic token refresh
        const cleanup = manager.startPeriodicRefresh();
        setPeriodicRefreshCleanup(() => cleanup);

      } catch (err) {
        console.error('Failed to initialize MSAL:', err);
        setError('Failed to initialize Microsoft authentication');
      } finally {
        setLoading(false);
      }
    };
    init();

    // Cleanup on unmount
    return () => {
      if (periodicRefreshCleanup) {
        periodicRefreshCleanup();
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        console.log('InboxContext: Starting data load for user:', user.id);
        
        // Query all stores - RLS policies will filter by business membership
        const { data: storesData, error: storesError } = await supabase
          .from('stores')
          .select('*');

        console.log('InboxContext: Stores query result:', { storesData, storesError });
        
        if (storesError) {
          console.error('InboxContext: Stores error:', storesError);
          throw storesError;
        }

        // Query all emails - RLS policies will filter by business membership
        const { data: emailsData, error: emailsError } = await supabase
          .from('emails')
          .select('*')
          .order('date', { ascending: false });

        console.log('InboxContext: Emails query result:', { emailsData: emailsData?.length, emailsError });

        if (emailsError) {
          console.error('InboxContext: Emails error:', emailsError);
          throw emailsError;
        }

        console.log('InboxContext: Setting stores and emails data');
        const stores = storesData || [];
        setStores(stores);
        
        const emailsWithStore = (emailsData || []).map(email => {
          const store = stores.find(s => s.id === email.store_id);
          return {
            ...email,
            storeName: store?.name || '',
            storeColor: store?.color || '#2563eb'
          };
        });
        
        setEmails(emailsWithStore);
        
        console.log('InboxContext: Data loaded successfully');
        console.log('InboxContext: Loaded', stores.length, 'stores and', emailsWithStore.length, 'emails');
      } catch (err) {
        console.error('InboxContext: Error loading data:', err);
        setError('Failed to load data: ' + (err as any)?.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    // Set up realtime subscription with better error handling
    console.log('InboxContext: Setting up real-time subscription');
    const subscription = supabase
      .channel('inbox-emails')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emails',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('InboxContext: Received real-time email update:', payload);
          const newEmail = payload.new;

          // Get the current stores to find the correct store info
          const { data: currentStores } = await supabase
            .from('stores')
            .select('*');

          const store = currentStores?.find(s => s.id === newEmail.store_id);
          
          const emailWithStore = {
            ...newEmail,
            storeName: store?.name || '',
            storeColor: store?.color || '#2563eb'
          };

          // Check if email already exists to avoid duplicates
          setEmails(prev => {
            const exists = prev.some(e => e.graph_id === newEmail.graph_id);
            if (!exists) {
              console.log('InboxContext: Adding new email to state');
              const updated = [emailWithStore, ...prev].sort((a, b) => 
                new Date(b.date).getTime() - new Date(a.date).getTime()
              );
              toast.success(`New email from ${newEmail.from}`);
              return updated;
            }
            console.log('InboxContext: Email already exists, skipping');
            return prev;
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'emails'
        },
        async (payload) => {
          console.log('InboxContext: Received email update:', payload);
          const updatedEmail = payload.new;
          
          // Get the current stores to find the correct store info
          const { data: currentStores } = await supabase
            .from('stores')
            .select('*');

          const store = currentStores?.find(s => s.id === updatedEmail.store_id);
          
          const emailWithStore = {
            ...updatedEmail,
            storeName: store?.name || '',
            storeColor: store?.color || '#2563eb'
          };

          setEmails(prev => prev.map(email => 
            email.id === updatedEmail.id ? emailWithStore : email
          ));
        }
      )
      .subscribe((status) => {
        console.log('InboxContext: Subscription status:', status);
      });

    setRealtimeSubscription(subscription);

    return () => {
      console.log('InboxContext: Cleaning up subscriptions');
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [user]);

  const value = {
    emails,
    stores,
    getEmailById,
    markAsRead,
    deleteEmail,
    statuses,
    connectStore,
    disconnectStore,
    syncEmails,
    refreshEmails,
    loading,
    error,
    pendingStore
  };

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
};