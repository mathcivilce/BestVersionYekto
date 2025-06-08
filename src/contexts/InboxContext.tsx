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
  status: 'active' | 'issue' | 'pending' | 'syncing' | 'connecting';
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
  connectStoreServerOAuth: (storeData: any) => Promise<void>;
  disconnectStore: (id: string) => Promise<void>;
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

      if (storeError) {
        if (storeError.code === '23505' && storeError.message.includes('stores_email_business_unique')) {
          throw new Error(`This email account (${msalResponse.account.username}) is already connected to your business. Please disconnect it first or use a different email account.`);
        }
        throw storeError;
      }

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

  const connectStoreServerOAuth = async (storeData: any) => {
    let tempStoreId: string | null = null;
    let connectingStartTime: number;
    
    try {
      setLoading(true);
      setPendingStore(storeData);
      connectingStartTime = Date.now(); // Track when connecting starts

      // Create a temporary store with connecting status to show in UI
      const tempStore: Store = {
        id: `temp-${Date.now()}`,
        name: storeData.name,
        platform: storeData.platform,
        email: 'Connecting...',
        connected: false,
        status: 'connecting',
        color: storeData.color,
        lastSynced: undefined
      };
      
      tempStoreId = tempStore.id;
      console.log('=== ADDING TEMPORARY CONNECTING STORE ===');
      console.log('Temp store:', tempStore);
      
      setStores(prev => {
        const newStores = [...prev, tempStore];
        console.log('Stores after adding temp store:', newStores);
        return newStores;
      });

      // Get user's business_id first
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user?.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        throw new Error('Business information not found. Please contact support.');
      }

      console.log('=== STARTING SERVER OAUTH FLOW WITH POLLING ===');
      console.log('Store data:', storeData);
      console.log('User ID:', user?.id);
      console.log('Business ID:', userProfile.business_id);

      // Call oauth-initiate Edge Function
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No user session found. Please log in again.');
      }

      const initiateResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oauth-initiate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          storeData,
          userId: user?.id,
          businessId: userProfile.business_id
        })
      });

      if (!initiateResponse.ok) {
        const errorText = await initiateResponse.text();
        console.error('OAuth initiate failed:', errorText);
        throw new Error(`Failed to initiate OAuth: ${errorText}`);
      }

      const initiateData = await initiateResponse.json();
      console.log('OAuth initiate response:', initiateData);
      
      const { authUrl, state } = initiateData;
      console.log('OAuth URL generated with state:', state);
      
      if (!state) {
        throw new Error('OAuth initiate did not return a state parameter');
      }

      // Open OAuth popup
      const popup = window.open(
        authUrl,
        'oauth-popup',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups for this site.');
      }

      // POLLING APPROACH - Status shown in table, not toasts
      const pollForOAuthResult = () => {
        return new Promise<any>((resolve, reject) => {
          let pollCount = 0;
          const maxPolls = 300; // 5 minutes at 1 second intervals
          
          const pollInterval = setInterval(async () => {
            try {
              pollCount++;
              
              // Check if popup was closed by user
              if (popup.closed) {
                clearInterval(pollInterval);
                reject(new Error('OAuth cancelled by user'));
                return;
              }
              
              // Debug first few attempts
              if (pollCount <= 3) {
                console.log(`Polling attempt ${pollCount} - state is:`, state, typeof state);
              }

              // Check for timeout
              if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                popup.close();
                reject(new Error('OAuth timeout after 5 minutes'));
                return;
              }

              // Poll the database for results
              const { data, error } = await supabase
                .from('oauth_pending')
                .select('result, completed_at')
                .eq('state', state)
                .single();

              if (error && error.code !== 'PGRST116') {
                console.error('Polling error:', error);
                return;
              }

              // Check if OAuth completed
              if (data?.result) {
                console.log('=== OAUTH RESULT FOUND IN DATABASE ===');
                console.log('Result:', data.result);
                
                clearInterval(pollInterval);
                popup.close();
                
                // Clean up the pending request
                await supabase
                  .from('oauth_pending')
                  .delete()
                  .eq('state', state);

                if (data.result.success) {
                  resolve(data.result);
                } else {
                  reject(new Error(data.result.description || 'OAuth failed'));
                }
              }
            } catch (pollError) {
              console.error('Poll error:', pollError);
            }
          }, 1000); // Poll every second
        });
      };

      // Wait for OAuth result via polling
      const result = await pollForOAuthResult();
      const newStore = result.store;

      console.log('=== OAUTH POLLING SUCCESS ===');
      console.log('Store data from polling:', newStore);

      // Update the temp store with real email but keep "connecting" status during sync
      console.log('=== UPDATING TEMP STORE WITH REAL EMAIL (STILL CONNECTING) ===');
      setStores(prev => {
        return prev.map(store => {
          if (store.id === tempStoreId) {
            return {
              ...store,
              email: newStore.email, // Update with real email
              // Keep status as 'connecting' during email sync
            };
          }
          return store;
        });
      });

      console.log('=== STARTING AUTOMATIC SYNC SETUP (POLLING APPROACH) ===');
      console.log('Store created with ID:', newStore.id);

      // Trigger initial email sync and webhook creation
      const performInitialSync = async () => {
        try {
          console.log('Performing initial email sync...');
          await syncEmails(newStore.id, storeData.syncFrom, storeData.syncTo);
          console.log('Initial sync completed successfully');
          
          // Create webhook subscription after successful sync
          console.log('Creating webhook subscription for server OAuth flow...');
          console.log('Store ID for webhook:', newStore.id);
          try {
            const { data: { session } } = await supabase.auth.getSession();
            console.log('Session for webhook:', { hasSession: !!session, hasAccessToken: !!session?.access_token });
            
            const webhookResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-webhook-subscription`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session?.access_token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                storeId: newStore.id
              })
            });

            console.log('Webhook response status:', webhookResponse.status);
            if (webhookResponse.ok) {
              const webhookData = await webhookResponse.json();
              console.log('✅ Webhook subscription created (server OAuth):', webhookData);
            } else {
              const webhookError = await webhookResponse.text();
              console.error('❌ Webhook creation failed (server OAuth):', webhookError);
              console.error('Response status:', webhookResponse.status);
              // Don't fail the entire process if webhook creation fails
            }
          } catch (webhookError) {
            console.error('❌ Webhook creation error (server OAuth):', webhookError);
            // Don't fail the entire process if webhook creation fails
          }
          
          // NOW update to final connected store after sync completes
          const storeWithLastSynced = {
            ...newStore,
            connected: true,
            lastSynced: newStore.last_synced
          };
          
          console.log('=== EMAIL SYNC COMPLETE - UPDATING TO CONNECTED STATUS ===');
          console.log('Final connected store:', storeWithLastSynced);
          
          setStores(prev => {
            // Remove temp store and add final connected store
            const filtered = prev.filter(store => store.id !== tempStoreId);
            const newStores = [...filtered, storeWithLastSynced];
            console.log('Final stores array after sync:', newStores);
            return newStores;
          });
          
          toast.success('Email account connected and synced successfully!');
        } catch (syncError) {
          console.error('Initial sync failed:', syncError);
          const errorMessage = (syncError as any)?.message || 'Unknown error';
          
          // On sync error, still update to connected but show error
          const storeWithError = {
            ...newStore,
            connected: true,
            lastSynced: newStore.last_synced
          };
          
          setStores(prev => {
            const filtered = prev.filter(store => store.id !== tempStoreId);
            return [...filtered, storeWithError];
          });
          
          toast.error(`Email account connected but initial sync failed: ${errorMessage}. You can manually sync using the sync button.`);
        }
      };

      setPendingStore(null);
      performInitialSync();
    } catch (error: any) {
      console.error('Error in server OAuth:', error);
      
      // Remove the temporary connecting store on error
      if (tempStoreId) {
        setStores(prev => prev.filter(store => store.id !== tempStoreId));
      }
      
      setPendingStore(null);
      toast.error('Failed to connect email account: ' + error.message);
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

      // Delete emails associated with this store first (to avoid foreign key constraint)
      const { error: emailsDeleteError } = await supabase
        .from('emails')
        .delete()
        .eq('store_id', id);

      if (emailsDeleteError) {
        console.warn('Could not delete emails for store:', emailsDeleteError);
        // Continue anyway - the emails will be orphaned but that's better than failing
      }

      // Delete other related data
      await supabase.from('analytics').delete().eq('store_id', id);
      await supabase.from('email_replies').delete().eq('store_id', id);
      await supabase.from('oauth_code_usage').delete().eq('store_id', id);

      // Finally delete the store
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
      
      console.log('=== DETAILED REQUEST LOGGING ===');
      console.log('storeId variable:', storeId);
      console.log('storeId type:', typeof storeId);
      console.log('storeId length:', storeId?.length);
      console.log('Original syncFrom:', syncFrom);
      console.log('Original syncTo:', syncTo);
      console.log('Converted syncFrom ISO:', requestPayload.syncFrom);
      console.log('Converted syncTo ISO:', requestPayload.syncTo);
      console.log('Request payload object:', requestPayload);
      console.log('Session access token (first 20 chars):', session.access_token.substring(0, 20) + '...');
      console.log('=== END DETAILED REQUEST LOGGING ===');
      
      // Use direct fetch with proper JWT token
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const functionUrl = `${supabaseUrl}/functions/v1/sync-emails`;
      
      console.log('Making direct fetch call to sync-emails...');
      const fetchResponse = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });
      
      console.log('Sync-emails response status:', fetchResponse.status);
      console.log('Sync-emails response statusText:', fetchResponse.statusText);
      
      // Get response text before trying to parse as JSON
      const responseText = await fetchResponse.text();
      console.log('Sync-emails response text:', responseText);
      
      if (!fetchResponse.ok) {
        console.error('Sync-emails error - Status:', fetchResponse.status);
        console.error('Sync-emails error - Response:', responseText);
        throw new Error(`HTTP ${fetchResponse.status}: ${responseText}`);
      }
      
      // Try to parse as JSON
      let response;
      try {
        response = JSON.parse(responseText);
        console.log('Sync-emails response data (parsed):', response);
      } catch (parseError) {
        console.error('Failed to parse sync-emails response as JSON:', parseError);
        console.error('Raw response text:', responseText);
        throw new Error('Invalid JSON response from sync-emails function');
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
      
      // SECURITY FIX: Get user's business_id first
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        console.error('InboxContext: Failed to get user business_id during refresh:', profileError);
        throw new Error('Unable to load business information. Please contact support.');
      }

      // SECURITY: Get stores filtered by business_id
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('*')
        .eq('business_id', userProfile.business_id);

      if (storesError) {
        console.error('InboxContext: Error refreshing stores:', storesError);
        throw storesError;
      }

      // SECURITY: Only get emails for user's business stores
      const storeIds = (storesData || []).map(store => store.id);
      
      let emailsData = [];
      if (storeIds.length > 0) {
        const { data: emails, error: emailsError } = await supabase
          .from('emails')
          .select('*')
          .in('store_id', storeIds)
          .order('date', { ascending: false });

        if (emailsError) {
          console.error('InboxContext: Error refreshing emails:', emailsError);
          throw emailsError;
        }
        
        emailsData = emails || [];
      }

      const emailsWithStore = emailsData.map(email => {
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
        
        // SECURITY FIX: Get user's business_id first to ensure proper filtering
        const { data: userProfile, error: profileError } = await supabase
          .from('user_profiles')
          .select('business_id')
          .eq('user_id', user.id)
          .single();

        if (profileError || !userProfile?.business_id) {
          console.error('InboxContext: Failed to get user business_id:', profileError);
          throw new Error('Unable to load business information. Please contact support.');
        }

        console.log('InboxContext: User business_id:', userProfile.business_id);

        // SECURITY: Explicitly filter stores by business_id (not relying only on RLS)
        const { data: storesData, error: storesError } = await supabase
          .from('stores')
          .select('*')
          .eq('business_id', userProfile.business_id);

        console.log('InboxContext: Stores query result:', { storesData, storesError, business_id: userProfile.business_id });
        
        if (storesError) {
          console.error('InboxContext: Stores error:', storesError);
          throw storesError;
        }

        // SECURITY: Only get emails for stores that belong to user's business
        const storeIds = (storesData || []).map(store => store.id);
        
        let emailsData = [];
        if (storeIds.length > 0) {
          const { data: emails, error: emailsError } = await supabase
            .from('emails')
            .select('*')
            .in('store_id', storeIds)
            .order('date', { ascending: false });

          if (emailsError) {
            console.error('InboxContext: Emails error:', emailsError);
            throw emailsError;
          }
          
          emailsData = emails || [];
        }

        console.log('InboxContext: Emails query result:', { emailsData: emailsData?.length, storeIds });

        // SECURITY VALIDATION: Double-check that all stores belong to user's business
        const invalidStores = (storesData || []).filter(store => store.business_id !== userProfile.business_id);
        if (invalidStores.length > 0) {
          console.error('InboxContext: SECURITY VIOLATION - Found stores from different business:', invalidStores);
          throw new Error('Security violation detected. Please contact support.');
        }

        console.log('InboxContext: Setting stores and emails data');
        const stores = storesData || [];
        setStores(stores);
        
        const emailsWithStore: Email[] = (emailsData || []).map(email => {
          const store = stores.find(s => s.id === email.store_id);
          return {
            ...email,
            storeName: store?.name || '',
            storeColor: store?.color || '#2563eb'
          } as Email;
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

    const loadDataAndSetupRealtime = async () => {
      await loadData();

      // Get user's business_id for business-based real-time filtering
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (!userProfile?.business_id) {
        console.error('InboxContext: No business_id found for user, cannot set up real-time subscription');
        setLoading(false);
        return;
      }

      // Set up realtime subscription with business-based filtering
      console.log('InboxContext: Setting up real-time subscription for business:', userProfile.business_id);
      const subscription = supabase
      .channel('inbox-emails')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emails',
          filter: `business_id=eq.${userProfile.business_id}`
        },
        async (payload) => {
          try {
            console.log('🔥 InboxContext: Received real-time email INSERT:', payload);
            const newEmail = payload.new as any;
            
            console.log('New email details:', {
              id: newEmail.id,
              graph_id: newEmail.graph_id,
              subject: newEmail.subject,
              from: newEmail.from,
              store_id: newEmail.store_id,
              user_id: newEmail.user_id
            });

            // Use current stores from state instead of fetching again
            const currentStores = stores;
            const store = currentStores.find(s => s.id === newEmail.store_id);
            
            if (!store) {
              console.warn('InboxContext: Store not found in current stores for real-time email:', newEmail.store_id);
              console.log('Available stores:', currentStores.map(s => ({ id: s.id, name: s.name })));
              return;
            }
            
            console.log('Found store for email:', { storeId: store.id, storeName: store.name });
            
            const emailWithStore: Email = {
              ...newEmail,
              storeName: store.name,
              storeColor: store.color
            } as Email;

            // Check if email already exists to avoid duplicates
            setEmails(prev => {
              const exists = prev.some(e => e.graph_id === newEmail.graph_id || e.id === newEmail.id);
              if (!exists) {
                console.log('✅ InboxContext: Adding new email to state:', newEmail.subject);
                const updated = [emailWithStore, ...prev].sort((a, b) => 
                  new Date(b.date).getTime() - new Date(a.date).getTime()
                );
                
                // Show toast notification
                try {
                  toast.success(`📧 New email from ${newEmail.from}`);
                } catch (toastError) {
                  console.warn('Toast notification failed:', toastError);
                }
                
                return updated;
              } else {
                console.log('⚠️ InboxContext: Email already exists, skipping:', newEmail.graph_id || newEmail.id);
                return prev;
              }
            });
          } catch (error) {
            console.error('❌ InboxContext: Error processing real-time email:', error);
          }
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
          
          // SECURITY: Get stores for user's business only
          const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('business_id')
            .eq('user_id', user.id)
            .single();

          if (!userProfile?.business_id) {
            console.error('InboxContext: No business_id found for realtime update');
            return;
          }

          const { data: currentStores } = await supabase
            .from('stores')
            .select('*')
            .eq('business_id', userProfile.business_id);

          const store = currentStores?.find(s => s.id === updatedEmail.store_id);
          
          // SECURITY: Only process emails for stores in user's business
          if (!store) {
            console.warn('InboxContext: Received email update for store not in user business:', updatedEmail.store_id);
            return;
          }
          
          const emailWithStore: Email = {
            ...updatedEmail,
            storeName: store?.name || '',
            storeColor: store?.color || '#2563eb'
          } as Email;

          setEmails(prev => prev.map(email => 
            email.id === updatedEmail.id ? emailWithStore : email
          ));
        }
      )
      .subscribe((status) => {
        console.log('🔄 InboxContext: Real-time subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('✅ Real-time subscription is active and ready');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Real-time subscription error');
        } else if (status === 'TIMED_OUT') {
          console.warn('⏰ Real-time subscription timed out');
        } else if (status === 'CLOSED') {
          console.log('🔒 Real-time subscription closed');
        }
      });

      setRealtimeSubscription(subscription);
    };

    loadDataAndSetupRealtime();

    return () => {
      console.log('InboxContext: Cleaning up subscriptions');
      if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
      }
    };
  }, [user, stores]);

  const value = {
    emails,
    stores,
    getEmailById,
    markAsRead,
    deleteEmail,
    statuses,
    connectStore,
    connectStoreServerOAuth,
    disconnectStore,
    syncEmails,
    refreshEmails,
    loading,
    error,
    pendingStore
  };

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
};