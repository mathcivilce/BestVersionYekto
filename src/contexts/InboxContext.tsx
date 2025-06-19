/**
 * Inbox Context Provider
 * * This is the central context for managing email data and store connections throughout the application.
 * It provides a comprehensive email management system with support for multiple email platforms.
 * * Key Features:
 * - Multi-platform email integration (Outlook, Gmail)
 * - Real-time email synchronization
 * - Store connection management (MSAL popup and server-side OAuth)
 * - Email CRUD operations (read, delete, status updates)
 * - Token management and automatic refresh
 * - Real-time updates via Supabase subscriptions
 * - Error handling and recovery
 * * Supported Authentication Methods:
 * 1. MSAL Popup (Microsoft): Client-side token management
 * 2. Server-side OAuth: Backend token management with refresh capability
 * * Data Flow:
 * 1. User connects email store (via MSAL or server OAuth)
 * 2. Store credentials saved to database
 * 3. Emails synced from email provider APIs
 * 4. Real-time updates via Supabase subscriptions
 * 5. Automatic token refresh for expired credentials
 * * Context State:
 * - emails: Array of email objects from all connected stores
 * - stores: Array of connected email store configurations
 * - loading: Global loading state for async operations
 * - error: Error messages for user feedback
 * - pendingStore: Temporary store data during connection process
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { PublicClientApplication, InteractionRequiredAuthError, Configuration, AccountInfo } from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { Message } from '@microsoft/microsoft-graph-types';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { TokenManager } from '../utils/tokenManager';
import { createClient } from '@supabase/supabase-js';
import { ConnectionHealthValidator, ValidationResult } from '../utils/connectionHealthValidator';
import { ErrorRecoveryManager, RecoveryResult } from '../utils/errorRecoveryManager';
import { OAuthStateManager, DuplicateCheckResult } from '../utils/oauthStateManager';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

/**
 * Email data structure
 * * Represents a single email message with metadata for display and management.
 * Includes both original email data and application-specific fields.
 */
interface Email {
  id: string;                    // Unique identifier in our database
  graph_id?: string;             // Microsoft Graph API identifier
  subject: string;               // Email subject line
  snippet: string;               // Email preview text
  content?: string;              // Full email body content
  from: string;                  // Sender email address
  date: string;                  // Email received date (ISO string)
  read: boolean;                 // Read status
  priority: number;              // Priority level (1-5)
  status: string;                // Processing status (open, pending, resolved)
  storeName: string;             // Display name of the email store
  storeColor: string;            // Color for UI identification
  store_id: string;              // Reference to the store this email belongs to
  thread_id?: string;            // Thread/conversation identifier
  assigned_to?: string | null;   // User assigned to handle this email
  // 🆕 NEW FIELDS: Direction and recipient for proper customer identification
  direction?: 'inbound' | 'outbound'; // Email direction (inbound = received, outbound = sent)
  recipient?: string;            // Actual recipient email address
}

/**
 * Email store configuration
 * * Represents a connected email account (Outlook, Gmail, etc.)
 * with authentication and synchronization settings.
 */
interface Store {
  id: string;                    // Unique store identifier
  name: string;                  // User-defined store name
  platform: 'outlook' | 'gmail'; // Email platform type
  email: string;                 // Email address of the account
  connected: boolean;            // Connection status
  status: 'active' | 'issue' | 'pending' | 'syncing' | 'connecting'; // Current status
  color: string;                 // UI color for identification
  lastSynced?: string;           // Last synchronization timestamp
  access_token?: string;         // OAuth access token
  refresh_token?: string;        // OAuth refresh token (server-side only)
  token_expires_at?: string;     // Token expiration timestamp
  token_last_refreshed?: string; // Last token refresh timestamp
}

/**
 * Inbox Context Interface
 * * Defines all methods and state available to components using this context.
 * Provides a comprehensive API for email and store management.
 */
interface InboxContextType {
  // State
  emails: Email[];               // All emails from connected stores
  stores: Store[];               // All connected email stores
  loading: boolean;              // Global loading state
  error: string | null;          // Current error message
  pendingStore: any | null;      // Store being connected
  statuses: string[];            // Available email statuses
  
  // Email operations
  getEmailById: (id: string) => Email | undefined;
  markAsRead: (id: string) => Promise<void>;
  deleteEmail: (id: string) => Promise<void>;
  refreshEmails: () => Promise<void>;
  
  // Store operations
  connectStore: (storeData: any) => Promise<void>;           // MSAL popup connection
  connectStoreServerOAuth: (storeData: any) => Promise<void>; // Server-side OAuth connection
  disconnectStore: (id: string) => Promise<void>;
  syncEmails: (storeId: string, syncFrom?: string, syncTo?: string) => Promise<any>;
  
  // Error recovery operations
  refreshStoreStatus: (storeId: string) => Promise<void>;    // Manual store status refresh
  retryFailedSync: (storeId: string) => Promise<void>;       // Retry failed sync
  
  // 🧪 TESTING: Real-time subscription test
  testRealtimeSubscription: () => Promise<void>;             // Test real-time subscription functionality
}

// Create the inbox context
const InboxContext = createContext<InboxContextType | undefined>(undefined);

/**
 * Custom hook to access inbox context
 * Throws error if used outside of InboxProvider
 */
export const useInbox = () => {
  const context = useContext(InboxContext);
  if (context === undefined) {
    throw new Error('useInbox must be used within an InboxProvider');
  }
  return context;
};

/**
 * Microsoft Graph API Scopes
 * * Required permissions for accessing Outlook email data.
 * These scopes are requested during the OAuth flow.
 */
const requiredScopes = [
  'User.Read',        // Read user profile information
  'Mail.Read',        // Read user's email
  'Mail.ReadBasic',   // Read basic email properties
  'offline_access'    // Maintain access when user is offline
];

/**
 * MSAL Configuration
 * * Configuration for Microsoft Authentication Library (MSAL)
 * used for Outlook integration via popup authentication.
 */
const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || '',
    authority: 'https://login.microsoftonline.com/common', // Multi-tenant endpoint
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true
  },
  cache: {
    cacheLocation: 'localStorage',    // Store tokens in localStorage
    storeAuthStateInCookie: true      // Store auth state in cookies for IE support
  },
  system: {
    allowNativeBroker: false,         // Disable native broker for web apps
    windowHashTimeout: 60000,         // Popup window timeout
    iframeHashTimeout: 6000,          // iframe timeout for silent requests
    loadFrameTimeout: 0,              // Frame load timeout
    loggerOptions: {
      // Configure MSAL logging
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return; // Skip PII logging
        switch (level) {
          case 0: console.error(message); break;   // Error
          case 1: console.warn(message); break;    // Warning
          case 2: console.info(message); break;    // Info
          case 3: console.debug(message); break;   // Debug
        }
      },
      piiLoggingEnabled: false // Disable PII logging for security
    }
  }
};

// Global MSAL instance (singleton pattern)
let msalInstance: PublicClientApplication | null = null;

/**
 * Initialize MSAL instance
 * * Creates and initializes the MSAL instance for Microsoft authentication.
 * Uses singleton pattern to ensure only one instance exists.
 * * @returns Promise<PublicClientApplication> - Initialized MSAL instance
 */
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

// Using shared Supabase client from config

/**
 * Inbox Provider Component
 * * Provides inbox context to all child components and manages:
 * - Email data loading and synchronization
 * - Store connection and management
 * - Real-time updates via Supabase subscriptions
 * - Token management and refresh
 * - Error handling and user feedback
 */
export const InboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  
  // Core state management
  const [emails, setEmails] = useState<Email[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Initialization and connection state
  const [initialized, setInitialized] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<AccountInfo | null>(null);
  const [pendingStore, setPendingStore] = useState<any>(null);
  
  // Real-time and token management
  const [realtimeSubscription, setRealtimeSubscription] = useState<any>(null);
  const [tokenManager, setTokenManager] = useState<TokenManager | null>(null);
  const [periodicRefreshCleanup, setPeriodicRefreshCleanup] = useState<(() => void) | null>(null);
  
  // OAuth Health Validation System
  const [healthValidator] = useState(() => new ConnectionHealthValidator());
  const [recoveryManager] = useState(() => new ErrorRecoveryManager());
  const [oauthStateManager] = useState(() => new OAuthStateManager());
  
  // Available email statuses for filtering and management
  const statuses = ['open', 'pending', 'resolved'];

  /**
   * Get email by ID
   * * @param id - Email identifier
   * @returns Email object or undefined if not found
   */
  const getEmailById = (id: string) => {
    return emails.find(email => email.id === id);
  };

  /**
   * Mark email as read
   * * Updates the email's read status in the database and local state.
   * * @param id - Email identifier
   */
  const markAsRead = async (id: string) => {
    try {
      // Update in database
      const { error: updateError } = await supabase
        .from('emails')
        .update({ read: true })
        .eq('id', id);

      if (updateError) throw updateError;

      // Update local state
      setEmails(prev => prev.map(email => 
        email.id === id ? { ...email, read: true } : email
      ));
    } catch (error) {
      console.error('Error marking email as read:', error);
      setError('Failed to mark email as read');
    }
  };

  /**
   * Delete email
   * * Removes the email from the database and local state.
   * * @param id - Email identifier
   */
  const deleteEmail = async (id: string) => {
    try {
      // Delete from database
      const { error: deleteError } = await supabase
        .from('emails')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      // Remove from local state
      setEmails(prev => prev.filter(email => email.id !== id));
    } catch (error) {
      console.error('Error deleting email:', error);
      setError('Failed to delete email');
    }
  };

  /**
   * Connect Store via MSAL Popup
   * * Connects an Outlook email account using Microsoft's MSAL library
   * with popup-based authentication. This method stores tokens client-side
   * and is suitable for personal use or development.
   * * @param storeData - Store configuration data
   */
  const connectStore = async (storeData: any) => {
    try {
      setLoading(true);
      setPendingStore(storeData);

      // Initialize MSAL and perform popup login
      const msalInstance = await initializeMsal();
      const loginRequest = {
        scopes: [...requiredScopes, 'Mail.Send', 'Mail.ReadWrite'],
        prompt: 'select_account' // Allow user to select account
      };

      const msalResponse = await msalInstance.loginPopup(loginRequest);
      setCurrentAccount(msalResponse.account);

      // Acquire access token silently
      const tokenResponse = await msalInstance.acquireTokenSilent({
        scopes: [...requiredScopes, 'Mail.Send', 'Mail.ReadWrite'],
        account: msalResponse.account
      });

      // Calculate token expiration time
      const expiresAt = new Date();
      if (tokenResponse.expiresOn) {
        expiresAt.setTime(tokenResponse.expiresOn.getTime());
      } else {
        // Default to 1 hour if no expiration provided
        expiresAt.setHours(expiresAt.getHours() + 1);
      }

      // Get user's business_id for multi-tenant support
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user?.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        throw new Error('Business information not found. Please contact support.');
      }

      // Prepare store data for database insertion
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

      // Handle refresh token (MSAL manages these internally)
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

      // Insert store into database
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
    let attemptId: string = '';
    
    try {
      setLoading(true);
      setPendingStore(storeData);
      connectingStartTime = Date.now(); // Track when connecting starts

      console.log('=== OAUTH CONNECTION HEALTH CHECK START ===');
      
      // Step 1: Register OAuth attempt and check for concurrent attempts
      attemptId = oauthStateManager.registerOAuthAttempt({
        email: storeData.email,
        platform: storeData.platform,
        storeName: storeData.name,
        userId: user?.id || '',
        businessId: 'temp' // Will be updated after business_id fetch
      });

      // Step 2: Advanced duplicate detection
      const duplicateCheck = await oauthStateManager.performAdvancedDuplicateCheck(
        storeData.email,
        storeData.platform,
        user?.id || '',
        storeData.name,
        attemptId // Pass current attempt ID to exclude it from concurrent check
      );

      if (!duplicateCheck.shouldProceed) {
        oauthStateManager.updateOAuthAttempt(attemptId, 'cancelled');
        
        if (duplicateCheck.recommendedAction === 'wait') {
          toast.error(duplicateCheck.message || 'Please wait for the current connection to complete');
        } else if (duplicateCheck.recommendedAction === 'use_existing' && duplicateCheck.existingStore) {
          console.log('Found existing store, performing health validation...');
          
          // Step 3: Validate existing connection health
          const validationResult = await healthValidator.validateConnection(duplicateCheck.existingStore);
          
          if (validationResult.isValid) {
            console.log('✅ Existing connection is healthy, no OAuth needed');
            toast.success('Email account is already connected and working');
            setPendingStore(null);
            setLoading(false);
            return;
          } else {
            console.log('❌ Existing connection is broken, attempting recovery...');
            
            // Step 4: Attempt automatic recovery
            const recoveryResult = await recoveryManager.executeRecovery(validationResult, duplicateCheck.existingStore);
            
            // Log recovery statistics for debugging
            ErrorRecoveryManager.logRecoveryStats(recoveryResult, validationResult, duplicateCheck.existingStore);
            
            if (recoveryResult.success && !recoveryResult.shouldStartOAuth) {
              console.log('✅ Automatic recovery successful');
              const toastMessage = ErrorRecoveryManager.getToastMessage(recoveryResult, validationResult);
              if (toastMessage.type === 'success') {
                toast.success(toastMessage.message);
              } else if (toastMessage.type === 'info') {
                toast(toastMessage.message);
              }
              setPendingStore(null);
              setLoading(false);
              return;
            } else {
              console.log('🔄 Recovery requires OAuth flow, continuing...');
              const toastMessage = ErrorRecoveryManager.getToastMessage(recoveryResult, validationResult);
              if (toastMessage.type === 'info') {
                toast(toastMessage.message);
              }
              // Continue with OAuth flow to fix the connection
              oauthStateManager.updateOAuthAttempt(attemptId, 'pending'); // Reactivate attempt
            }
          }
        }
        
        if (duplicateCheck.recommendedAction !== 'use_existing') {
          setPendingStore(null);
          setLoading(false);
          return;
        }
      }

      console.log('✅ Duplicate check passed, proceeding with OAuth flow');

      console.log('=== STARTING OAUTH FLOW ===');

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
      const isUpdatingExisting = result.isUpdatingExisting;

      console.log('=== OAUTH POLLING SUCCESS ===');
      console.log('Store data from polling:', newStore);
      console.log('Operation type:', isUpdatingExisting ? 'UPDATED EXISTING' : 'CREATED NEW');

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

      // Trigger initial email sync using event-driven queue system
      const performInitialSync = async () => {
        try {
          console.log('=== EVENT-DRIVEN SYNC: Creating sync job ===');
          console.log('Store ID:', newStore.id);
          console.log('Sync range:', { from: storeData.syncFrom, to: storeData.syncTo });
          
          // Call the existing createSyncJob function instead of duplicating logic
          const result = await createSyncJob(newStore.id, 'manual', storeData.syncFrom, storeData.syncTo);
          
          console.log('✅ [SYNC] Initial sync job created:', result);
          
          // =========================================================================
          // == START: FIXED WEBHOOK CREATION LOGIC                                 ==
          // =========================================================================
          // This block is now identical to the old, working code.
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
          // =========================================================================
          // == END: FIXED WEBHOOK CREATION LOGIC                                   ==
          // =========================================================================
          
          return result;
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
            if (isUpdatingExisting) {
              // Update existing store in place
              return prev.map(store => {
                if (store.id === newStore.id) {
                  return storeWithError;
                } else if (store.id === tempStoreId) {
                  // Remove temp store
                  return null;
                }
                return store;
              }).filter(Boolean) as Store[];
            } else {
              // Remove temp store and add final store
              const filtered = prev.filter(store => store.id !== tempStoreId);
              return [...filtered, storeWithError];
            }
          });
          
          const errorToastMessage = isUpdatingExisting 
            ? `Email account reconnected but initial sync failed: ${errorMessage}. You can manually sync using the sync button.`
            : `Email account connected but initial sync failed: ${errorMessage}. You can manually sync using the sync button.`;
          toast.error(errorToastMessage);
          
          // Update OAuth attempt status - still successful connection, just sync failed
          oauthStateManager.updateOAuthAttempt(attemptId, 'completed', newStore.email);
        }
      };

      setPendingStore(null);
      performInitialSync();
    } catch (error: any) {
      console.error('Error in server OAuth:', error);
      
      // Update OAuth attempt status
      oauthStateManager.updateOAuthAttempt(attemptId, 'failed');
      
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

      // FIX: Handle disconnection of temporary/connecting stores that haven't been saved to DB
      if (id.startsWith('temp-')) {
        console.log(`🔌 Disconnecting a temporary store: ${store.name}. Removing from UI state only.`);
        console.log(`🔌 Store ID: ${id} - This is a temporary store, skipping all database operations.`);
        setStores(prev => prev.filter(s => s.id !== id));
        toast.success('Connection cancelled.');
        return; // Explicitly return early to prevent any database operations
      }

      console.log(`🔌 Starting enhanced disconnection for store: ${store.name} (${store.email})`);

      // 🔧 ENHANCED DISCONNECTION LOGIC
      let accessToken = store.access_token;
      let webhookCleanupSuccess = false;
      const cleanupAttempts: string[] = [];

      // Step 1: Try to get a fresh token using multiple methods
      console.log('🔑 Attempting token refresh for clean disconnection...');
      
      // Method 1: Token manager refresh
      if (tokenManager && store.email) {
        try {
          const account = tokenManager.getAccountForStore(store.email);
          if (account) {
            accessToken = await tokenManager.getValidToken(id, account, requiredScopes);
            cleanupAttempts.push('token_manager_refresh_success');
            console.log('✅ Token refreshed via token manager');
          }
        } catch (tokenError) {
          console.warn('Token manager refresh failed:', tokenError);
          cleanupAttempts.push('token_manager_refresh_failed');
        }
      }

      // Method 2: Direct refresh token call if token manager failed
      if (!accessToken && store.refresh_token) {
        try {
          console.log('🔄 Attempting direct token refresh...');
          const refreshResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-tokens`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ storeId: id })
          });

          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json();
            if (refreshData.results?.[0]?.success) {
              // Get the updated store data
              const { data: updatedStore } = await supabase
                .from('stores')
                .select('access_token')
                .eq('id', id)
                .single();
              
              if (updatedStore?.access_token) {
                accessToken = updatedStore.access_token;
                cleanupAttempts.push('direct_refresh_success');
                console.log('✅ Token refreshed via direct refresh');
              }
            }
          }
        } catch (refreshError) {
          console.warn('Direct token refresh failed:', refreshError);
          cleanupAttempts.push('direct_refresh_failed');
        }
      }

      // Step 2: Get webhook subscription details
      const { data: subscription } = await supabase
        .from('graph_subscriptions')
        .select('subscription_id, client_state, resource')
        .eq('store_id', id)
        .single();

      // Step 3: Enhanced webhook cleanup with multiple strategies
      if (subscription) {
        console.log(`🧹 Attempting webhook cleanup for subscription: ${subscription.subscription_id}`);

        // Strategy 1: Use current/refreshed token
        if (accessToken) {
          try {
            const graphClient = Client.init({
              authProvider: (done) => {
                done(null, accessToken);
              }
            });

            await graphClient
              .api(`/subscriptions/${subscription.subscription_id}`)
              .delete();

            webhookCleanupSuccess = true;
            cleanupAttempts.push('primary_cleanup_success');
            console.log('✅ Webhook subscription deleted successfully');

          } catch (webhookError) {
            console.warn('Primary webhook cleanup failed:', webhookError);
            cleanupAttempts.push(`primary_cleanup_failed: ${webhookError instanceof Error ? webhookError.message : String(webhookError)}`);
          }
        }

        // Strategy 2: Try using other connected stores' tokens (if primary failed)
        if (!webhookCleanupSuccess) {
          console.log('🔄 Attempting webhook cleanup using other connected stores...');
          
          const { data: otherStores } = await supabase
            .from('stores')
            .select('id, name, access_token')
            .eq('platform', 'outlook')
            .eq('connected', true)
            .not('access_token', 'is', null)
            .neq('id', id)
            .limit(3);

          if (otherStores && otherStores.length > 0) {
            for (const otherStore of otherStores) {
              try {
                console.log(`🔧 Trying cleanup with store: ${otherStore.name}`);
                
                const graphClient = Client.init({
                  authProvider: (done) => {
                    done(null, otherStore.access_token);
                  }
                });

                await graphClient
                  .api(`/subscriptions/${subscription.subscription_id}`)
                  .delete();

                webhookCleanupSuccess = true;
                cleanupAttempts.push(`alternate_cleanup_success: ${otherStore.name}`);
                console.log(`✅ Webhook cleanup successful using store: ${otherStore.name}`);
                break;

              } catch (altError) {
                console.warn(`Alternate cleanup failed with ${otherStore.name}:`, altError);
                cleanupAttempts.push(`alternate_cleanup_failed: ${otherStore.name} - ${altError instanceof Error ? altError.message : String(altError)}`);
              }
            }
          } else {
            cleanupAttempts.push('no_alternate_stores_available');
          }
        }

        // Strategy 3: Schedule cleanup for later if all immediate attempts failed
        if (!webhookCleanupSuccess) {
          console.log('⏰ Scheduling webhook cleanup for later...');
          
          try {
            // Log the orphaned subscription for later cleanup
            await supabase
              .from('webhook_cleanup_log')
              .insert({
                store_id: id,
                subscription_id: subscription.subscription_id,
                action: 'cleanup_scheduled_on_disconnect',
                details: {
                  storeName: store.name,
                  storeEmail: store.email,
                  resource: subscription.resource,
                  clientState: subscription.client_state,
                  cleanupAttempts: cleanupAttempts,
                  scheduledAt: new Date().toISOString(),
                  reason: 'immediate_cleanup_failed_during_disconnect'
                },
                timestamp: new Date().toISOString()
              });

            cleanupAttempts.push('cleanup_scheduled_for_later');
            console.log('📝 Webhook cleanup scheduled for later processing');

          } catch (scheduleError) {
            console.error('Failed to schedule cleanup:', scheduleError);
            cleanupAttempts.push(`schedule_failed: ${scheduleError instanceof Error ? scheduleError.message : String(scheduleError)}`);
          }
        }

        // Log comprehensive cleanup results
        await supabase
          .from('webhook_cleanup_log')
          .insert({
            store_id: id,
            subscription_id: subscription.subscription_id,
            action: webhookCleanupSuccess ? 'disconnect_cleanup_success' : 'disconnect_cleanup_partial',
            details: {
              storeName: store.name,
              storeEmail: store.email,
              cleanupSuccess: webhookCleanupSuccess,
              cleanupAttempts: cleanupAttempts,
              timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
          });
      }

      // Step 4: Always delete database records (even if webhook cleanup failed)
      console.log('🗑️ Cleaning up database records...');
      
      // Clean up chunk processing queue entries first (to avoid foreign key constraints)
      console.log('🧹 Cleaning up chunk processing queue entries...');
      
      // First, get chunk IDs for this store
      const { data: chunkIds } = await supabase
        .from('chunked_sync_jobs')
        .select('id')
        .eq('store_id', id);

      if (chunkIds && chunkIds.length > 0) {
        const { error: queueCleanupError } = await supabase
          .from('chunk_processing_queue')
          .delete()
          .in('chunk_id', chunkIds.map(chunk => chunk.id));

        if (queueCleanupError) {
          console.warn('Could not delete chunk processing queue entries:', queueCleanupError);
          // Continue anyway - we'll try the safer approach
        }
      }

      // Clean up chunked sync jobs
      console.log('🧹 Cleaning up chunked sync jobs...');
      const { error: chunkedJobsError } = await supabase
        .from('chunked_sync_jobs')
        .delete()
        .eq('store_id', id);

      if (chunkedJobsError) {
        console.warn('Could not delete chunked sync jobs:', chunkedJobsError);
        // Continue anyway
      }

      // Clean up sync queue entries
      console.log('🧹 Cleaning up sync queue entries...');
      const { error: syncQueueError } = await supabase
        .from('sync_queue')
        .delete()
        .eq('store_id', id);

      if (syncQueueError) {
        console.warn('Could not delete sync queue entries:', syncQueueError);
        // Continue anyway
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

      // 🧹 SOLUTION 1: Automatic post-disconnection cleanup (asynchronous)
      try {
        console.log('🧹 Running automatic cleanup after disconnection...');
        
        // Run cleanup asynchronously (non-blocking for user experience)
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cleanup-orphaned-subscriptions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          }
        }).then(async response => {
          if (response.ok) {
            const result = await response.json();
            console.log('✅ Post-disconnection cleanup completed:', result);
          } else {
            console.warn('⚠️ Post-disconnection cleanup failed (non-critical):', response.status);
          }
        }).catch(error => {
          console.warn('⚠️ Post-disconnection cleanup error (non-critical):', error);
        });
        
      } catch (error) {
        console.warn('⚠️ Could not initiate post-disconnection cleanup:', error);
      }

      toast.success('Store disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting store:', error);
      toast.error('Failed to disconnect store');
      throw error;
    }
  };

  // ============================================================================================================
  // EVENT-DRIVEN SYNC QUEUE FUNCTIONS
  // ============================================================================================================
  
  /**
   * Create a sync job in the queue system (triggers immediate webhook processing)
   * @param storeId - Store to sync
   * @param syncType - Type of sync ('initial', 'manual', 'incremental')
   * @param syncFrom - Optional start date
   * @param syncTo - Optional end date
   */
  const createSyncJob = async (storeId: string, syncType: string = 'manual', syncFrom?: string, syncTo?: string) => {
    try {
      console.log(`📋 [QUEUE] Creating ${syncType} sync job for store: ${storeId}`);
      
      // Validate storeId parameter
      if (!storeId || storeId.trim() === '') {
        throw new Error('Store ID is required and must be a valid string');
      }
      
      // Get user session and business context
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !user) {
        throw new Error('No user session found. Please log in again.');
      }

      // Get user's business_id for security
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        throw new Error('Unable to load business information. Please contact support.');
      }

      // ================================================================================================
      // PHASE 6: ENTERPRISE WEBHOOK SYNC PROCESSING
      // ================================================================================================
      
      // For all sync types, use the proper webhook approach
      console.log(`🔗 [WEBHOOK] Creating ${syncType} sync job via enterprise webhook...`);
      
      // Get ACCURATE email count instead of estimation
      console.log(`📊 [COUNT] Getting accurate email count for sync range...`);
      let actualEmailCount = 100; // Default fallback
      
      try {
        // Get actual email count from Microsoft Graph for accurate chunking
        const { data: storeData } = await supabase
          .from('stores')
          .select('access_token, email, platform')
          .eq('id', storeId)
          .single();

        if (storeData?.access_token) {
          let graphUrl = '';
          
          if (syncFrom && syncTo) {
            // Build OData filter for date range
            const fromIso = new Date(syncFrom).toISOString();
            const toIso = new Date(syncTo).toISOString();
            graphUrl = `https://graph.microsoft.com/v1.0/me/messages?$count=true&$filter=receivedDateTime ge ${fromIso} and receivedDateTime le ${toIso}&$top=1`;
          } else {
            // Get total message count
            graphUrl = 'https://graph.microsoft.com/v1.0/me/messages?$count=true&$top=1';
          }

          const countResponse = await fetch(graphUrl, {
            headers: {
              'Authorization': `Bearer ${storeData.access_token}`,
              'ConsistencyLevel': 'eventual'
            }
          });

          if (countResponse.ok) {
            const countData = await countResponse.json();
            actualEmailCount = parseInt(countData['@odata.count']) || 100;
            console.log(`📊 [COUNT] Accurate count: ${actualEmailCount} emails`);
          } else {
            console.warn('📊 [COUNT] Could not get accurate count, using default');
          }
        }
      } catch (countError) {
        console.warn('📊 [COUNT] Error getting email count:', countError);
      }
      
      const metadata = {
        created_from: 'frontend',
        client_timestamp: new Date().toISOString(),
        sync_type: syncType,
        user_agent: navigator.userAgent,
        sync_from: syncFrom,
        sync_to: syncTo,
        actual_email_count: actualEmailCount
      };

      // STEP 1: Create parent sync job in sync_queue first
      console.log(`📋 [PARENT] Creating parent sync job...`);
      const { data: parentJob, error: parentError } = await supabase
        .from('sync_queue')
        .insert({
          business_id: userProfile.business_id,
          store_id: storeId,
          sync_type: syncType,
          status: 'pending',
          priority: 1,
          sync_from: syncFrom,
          sync_to: syncTo,
          metadata: metadata
        })
        .select()
        .single();

      if (parentError || !parentJob) {
        console.error('❌ [PARENT] Failed to create parent sync job:', parentError);
        throw new Error(`Failed to create parent sync job: ${parentError?.message}`);
      }

      console.log(`✅ [PARENT] Parent sync job created with ID: ${parentJob.id}`);

      // STEP 2: Create sync chunks with correct parent job ID
      const { data: chunkResult, error: chunkError } = await supabase.rpc('create_sync_chunks', {
        p_parent_sync_job_id: parentJob.id,
        p_sync_type: syncType,
        p_estimated_email_count: actualEmailCount,
        p_sync_from: syncFrom,
        p_sync_to: syncTo
      });

      if (chunkError) {
        console.error('❌ [CHUNKS] Failed to create sync chunks:', chunkError);
        throw new Error(`Failed to create sync job: ${chunkError.message}`);
      }

      if (!chunkResult?.success) {
        throw new Error(chunkResult?.message || 'Sync chunk creation failed');
      }

      console.log('✅ [CHUNKS] Sync chunks created successfully:', chunkResult);
      console.log(`🧩 [CHUNKS] Created ${chunkResult.total_chunks} chunks for processing`);
      console.log(`📋 [QUEUE] Sync job ID: ${chunkResult.parent_job_id}`);
      
      // Immediately trigger the UNIFIED background processor for event-driven processing
      console.log('🚀 [EVENT-DRIVEN] Triggering background processor immediately...');
      try {
        const { data: processorResult, error: processorError } = await supabase.functions.invoke('unified-background-sync', {
          body: {
            trigger_source: 'frontend_immediate',
            job_id: parentJob.id,
            parent_sync_job_id: parentJob.id,
            store_id: storeId,
            business_id: userProfile.business_id,
            sync_type: syncType,
            immediate_processing: true
          },
          headers: {
            Authorization: `Bearer ${session?.access_token}`
          }
        });

        if (processorError) {
          console.warn('⚠️ [PROCESSOR] Background processor trigger failed (will retry):', processorError);
          // Don't throw error - the job is still created and can be processed later
        } else {
          console.log('✅ [PROCESSOR] Background processor triggered successfully:', processorResult);
        }
      } catch (triggerError) {
        console.warn('⚠️ [PROCESSOR] Failed to trigger background processor:', triggerError);
        // Don't throw error - the sync job is created and will be processed eventually
      }
      
      // Update store status to indicate sync in progress
      const store = stores.find(s => s.id === storeId);
      if (store) {
        setStores(prev => prev.map(s => 
          s.id === storeId 
            ? { ...s, status: 'syncing' as const }
            : s
        ));
        console.log('📊 [UI] Store status updated to "syncing"');
      }

      // Show enhanced user feedback for chunked processing
      const chunkText = chunkResult.total_chunks > 1 ? ` with ${chunkResult.total_chunks} chunks` : '';
      toast.success(
        `Sync started${chunkText} - will be processed in the background!`,
        { duration: 5000 }
      );

      // 🔄 FALLBACK POLLING: Start polling as backup for real-time subscription
      console.log('🔍 [POLLING] Starting fallback polling mechanism...');
      pollSyncStatus(parentJob.id, storeId);

      // ⏰ TIMEOUT DETECTION: Start timeout monitoring
      console.log('⏰ [TIMEOUT] Starting sync timeout monitoring...');
      startSyncTimeoutMonitoring(parentJob.id, storeId);
      
      return {
        id: parentJob.id,
        sync_type: syncType,
        status: 'pending',
        total_chunks: chunkResult.total_chunks,
        chunked: chunkResult.total_chunks > 1,
        actual_emails: actualEmailCount,
        architecture: 'chunked_processing',
        processor_triggered: true // Background processor will pick up the chunks
      };

      // All sync types now use the unified webhook approach above
      // This code path should not be reached anymore
    } catch (error) {
      console.error('❌ [QUEUE] Error creating sync job:', error);
      const errorMessage = (error as any)?.message || 'Unknown error occurred';
      toast.error(`Failed to start sync: ${errorMessage}`);
      throw error;
    }
  };

  /**
   * Monitor sync job status for real-time updates
   * @param storeId - Store to monitor
   */
  const monitorSyncStatus = async (storeId: string) => {
    try {
      // Subscribe to sync_queue changes for this store
      const subscription = supabase
        .channel(`sync_status_${storeId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'sync_queue',
          filter: `store_id=eq.${storeId}`
        }, (payload) => {
          console.log('🔄 [REALTIME] Sync status update:', payload);
          
          const { new: newJob, old: oldJob } = payload;
          
          if (newJob && typeof newJob === 'object' && 'status' in newJob) {
            switch (newJob.status) {
              case 'processing':
                console.log('📊 [STATUS] Sync job started processing');
                setStores(prev => prev.map(s => 
                  s.id === storeId 
                    ? { ...s, status: 'syncing' as const }
                    : s
                ));
                break;
                
              case 'completed':
                console.log('✅ [STATUS] Sync job completed successfully');
                handleSyncCompletion(storeId, newJob);
                break;
                
              case 'failed':
                console.log('❌ [STATUS] Sync job failed');
                handleSyncFailure(storeId, newJob);
                break;
            }
          }
        })
        .subscribe();

      return subscription;
    } catch (error) {
      console.error('Error setting up sync monitoring:', error);
    }
  };

  /**
   * Handle successful sync completion
   */
  const handleSyncCompletion = async (storeId: string, job: any) => {
    try {
      console.log('🎉 [COMPLETION] Processing sync completion for store:', storeId);
      console.log('🎉 [COMPLETION] Job details:', {
        id: job.id,
        status: job.status,
        storeId: job.store_id,
        businessId: job.business_id,
        metadata: job.metadata
      });
      console.log('🔍 [POLLING] Sync completion detected - polling will be cancelled by timeout');
      
      // 🔍 [DEBUG] Check current store status before update (with fallback for OAuth scenarios)
      let currentStore = stores.find(s => s.id === storeId);
      
      // If store not found in React state, try to fetch from database (OAuth scenario)
      if (!currentStore && user) {
        console.log('🏪 [STORE-FETCH] Store not in React state, fetching from database...');
        try {
          const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('business_id')
            .eq('user_id', user.id)
            .single();

          if (userProfile?.business_id) {
            const { data: dbStore } = await supabase
              .from('stores')
              .select('*')
              .eq('id', storeId)
              .eq('business_id', userProfile.business_id)
              .single();

            if (dbStore) {
              currentStore = {
                id: dbStore.id,
                name: dbStore.name,
                platform: dbStore.platform,
                email: dbStore.email,
                connected: dbStore.connected,
                status: dbStore.status,
                color: dbStore.color,
                lastSynced: dbStore.last_synced
              };
              console.log('🏪 [STORE-FETCH] Successfully fetched store from database');
            }
          }
        } catch (fetchError) {
          console.warn('🏪 [STORE-FETCH] Failed to fetch store from database:', fetchError);
        }
      }
      
      console.log('🏪 [STORE-BEFORE] Current store status:', {
        id: currentStore?.id || 'NOT_FOUND',
        name: currentStore?.name || 'NOT_FOUND',
        status: currentStore?.status || 'NOT_FOUND',
        connected: currentStore?.connected || 'NOT_FOUND'
      });
      
      // Update store status to connected and refresh last_synced
      console.log('🔄 [STORE-UPDATE] Updating store status to "active" and connected: true...');
      setStores(prev => {
        // First, check if this is an OAuth completion scenario where we need to remove temp stores
        const tempStores = prev.filter(s => s.id.startsWith('temp-') && s.status === 'connecting');
        const realStore = prev.find(s => s.id === storeId);
        
        console.log('🏪 [CLEANUP] Store cleanup analysis:', {
          tempStoreCount: tempStores.length,
          tempStoreIds: tempStores.map(s => s.id),
          realStoreExists: !!realStore,
          targetStoreId: storeId
        });
        
        let updated = prev;
        
        // If we have temp stores and this is a real store completion, remove all temp stores
        if (tempStores.length > 0 && (realStore || currentStore)) {
          console.log('🗑️ [CLEANUP] Removing temporary connecting stores...');
          updated = prev.filter(s => !s.id.startsWith('temp-'));
        }
        
        // Update the real store or add it if it doesn't exist
        updated = updated.map(s => 
          s.id === storeId 
            ? { 
                ...s, 
                status: 'active' as const,
                connected: true,
                lastSynced: new Date().toISOString()
              }
            : s
        );
        
        // If store wasn't in the state, add it (OAuth completion scenario)
        const storeExists = updated.find(s => s.id === storeId);
        if (!storeExists && currentStore) {
          console.log('🏪 [STORE-ADD] Adding store to React state (OAuth completion)');
          updated.push({
            ...currentStore,
            status: 'active' as const,
            connected: true,
            lastSynced: new Date().toISOString()
          });
        }
        
        const updatedStore = updated.find(s => s.id === storeId);
        console.log('🏪 [STORE-AFTER] Updated store status:', {
          id: updatedStore?.id || 'STILL_NOT_FOUND',
          name: updatedStore?.name || 'STILL_NOT_FOUND',
          status: updatedStore?.status || 'STILL_NOT_FOUND',
          connected: updatedStore?.connected || 'STILL_NOT_FOUND',
          lastSynced: updatedStore?.lastSynced || 'STILL_NOT_FOUND',
          tempStoresRemoved: tempStores.length
        });
        
        return updated;
      });
      
      // Refresh emails for this store
      if (user) {
        console.log('🔄 [REFRESH] Loading emails after sync completion...');
        const { data: emailsData, error: emailsError } = await supabase
          .from('emails')
          .select('*')
          .eq('store_id', storeId)
          .order('date', { ascending: false });

        if (!emailsError && emailsData) {
          // Use currentStore or fallback to find the store again
          let storeForEmails = currentStore || stores.find(s => s.id === storeId);
          const emailsWithStore = emailsData.map(email => ({
            ...email,
            storeName: storeForEmails?.name || 'Unknown Store',
            storeColor: storeForEmails?.color || '#2563eb'
          }));
          
          // Update emails state by merging new emails
          setEmails(prev => {
            const filtered = prev.filter(e => e.store_id !== storeId);
            return [...emailsWithStore, ...filtered].sort((a, b) => 
              new Date(b.date).getTime() - new Date(a.date).getTime()
            );
          });
          
          console.log(`📧 [EMAILS] Loaded ${emailsData.length} emails for store ${storeId}`);
        } else {
          console.error('❌ [EMAILS] Error loading emails:', emailsError);
        }
      }
      
      // Show comprehensive success notification with detailed sync stats
      const metadata = job.metadata || {};
      const emailCount = metadata.emails_processed || 0;
      const attachmentCount = metadata.emails_with_attachments || 0;
      const threadingSuccessRate = metadata.universal_threading_success_rate || 'N/A';
      const phase = metadata.phase || 'Unknown';
      const performance = metadata.performance || 'N/A';
      const duration = metadata.total_duration_ms || 0;
      
      // Log comprehensive sync completion stats (similar to old sync-emails function)
      console.log('=== 🎉 SYNC COMPLETED SUCCESSFULLY (ALL CHUNKS) ===');
      console.log(`📧 Total emails processed: ${emailCount}`);
      console.log(`📎 Emails with attachments: ${attachmentCount}`);
      console.log(`🧵 Universal threading success rate: ${threadingSuccessRate}`);
      console.log(`🚀 Sync strategy: ${phase}`);
      console.log(`⚡ Performance improvement: ${performance}`);
      console.log(`🧩 Chunk processing: All chunks completed successfully`);
      console.log(`🔄 Store status: Updated to "Connected"`);
      console.log(`⏱️  Total sync duration: ${duration}ms`);
      console.log('=== END SYNC COMPLETION STATISTICS ===');
      
      // 🔗 WEBHOOK VERIFICATION: Ensure webhook subscription exists after successful sync
      console.log('🔗 [WEBHOOK-VERIFY] Verifying webhook subscription after sync completion...');
      try {
        const webhookResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fix-missing-webhooks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json'
          }
        });

        if (webhookResponse.ok) {
          const webhookResult = await webhookResponse.json();
          const storeWebhooks = webhookResult.results?.filter((r: any) => r.storeId === storeId);
          if (storeWebhooks && storeWebhooks.length > 0) {
            console.log(`✅ [WEBHOOK-VERIFY] Created missing webhook subscription for store: ${storeId}`);
          } else {
            console.log('ℹ️ [WEBHOOK-VERIFY] Webhook subscription already exists (no action needed)');
          }
        } else {
          console.warn('⚠️ [WEBHOOK-VERIFY] Webhook verification failed (non-critical):', webhookResponse.status);
        }
      } catch (webhookError) {
        console.warn('⚠️ [WEBHOOK-VERIFY] Webhook verification error (non-critical):', webhookError);
      }

      // 🍞 SIMPLIFIED SUCCESS TOAST: Show only at the very end, once per sync
      const storeForToast = currentStore || stores.find(s => s.id === storeId);
      const storeName = storeForToast?.name || 'Email store';
      
      console.log('🍞 [TOAST] Showing simple success notification...');
      toast.success(
        `📧 ${storeName} connected successfully!`,
        { duration: 4000 }
      );
      
      console.log('✅ [COMPLETION] handleSyncCompletion finished successfully');
      
    } catch (error) {
      console.error('❌ [COMPLETION] Error handling sync completion:', error);
    }
  };

  /**
   * Fallback polling mechanism for sync status
   * Used as backup when real-time subscriptions fail
   */
  const pollSyncStatus = async (jobId: string, storeId: string) => {
    const maxPolls = 60; // 5 minutes max (60 polls * 5 seconds)
    let polls = 0;
    let pollingActive = true;
    
    console.log(`🔍 [POLLING] Starting fallback polling for job ${jobId}, store ${storeId}`);
    
    const poll = async () => {
      if (!pollingActive) {
        console.log('🔍 [POLLING] Polling cancelled - real-time update received');
        return;
      }
      
      polls++;
      console.log(`🔍 [POLLING] Checking sync status (${polls}/${maxPolls}) for job ${jobId}`);
      
      try {
        const { data: job, error } = await supabase
          .from('sync_queue')
          .select('status, metadata, error_message')
          .eq('id', jobId)
          .single();
        
        if (error) {
          console.error('🔍 [POLLING] Error fetching job status:', error);
          return;
        }
        
        if (job?.status === 'completed') {
          console.log('✅ [POLLING] Sync completed via polling - triggering completion handler');
          pollingActive = false;
          handleSyncCompletion(storeId, job);
          return;
        } else if (job?.status === 'failed') {
          console.log('❌ [POLLING] Sync failed via polling - triggering failure handler');
          pollingActive = false;
          handleSyncFailure(storeId, job);
          return;
        } else if (job?.status === 'processing') {
          console.log('🔄 [POLLING] Sync still processing...');
        } else {
          console.log(`🔍 [POLLING] Current status: ${job?.status}`);
        }
        
        // Continue polling if not completed and under limit
        if (polls < maxPolls) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        } else {
          console.warn('⏰ [POLLING] Polling timeout reached - sync may still be running in background');
          pollingActive = false;
        }
        
      } catch (pollError) {
        console.error('🔍 [POLLING] Error during polling:', pollError);
        pollingActive = false;
      }
    };
    
    // Start polling after 10 seconds (give real-time subscription a chance first)
    setTimeout(() => {
      if (pollingActive) {
        poll();
      }
    }, 10000);
    
    // Store polling cancellation function for cleanup
    return () => {
      pollingActive = false;
    };
  };

  /**
   * Handle sync failure
   */
  const handleSyncFailure = async (storeId: string, job: any) => {
    try {
      console.log('💥 [FAILURE] Processing sync failure for store:', storeId);
      
      // Update store status  
      setStores(prev => prev.map(s => 
        s.id === storeId 
          ? { ...s, status: 'issue' as const }
          : s
      ));
      
      // Show error notification
      const errorMessage = job.error_message || 'Unknown error occurred';
      const willRetry = job.attempts < (job.max_attempts || 3);
      
      if (willRetry) {
        toast.error(`Sync failed but will retry automatically: ${errorMessage}`);
      } else {
        toast.error(`Sync failed permanently: ${errorMessage}. Please try again manually.`);
      }
      
    } catch (error) {
      console.error('Error handling sync failure:', error);
    }
  };

  /**
   * Legacy syncEmails function - now uses queue system
   */
  const syncEmails = async (storeId: string, syncFrom?: string, syncTo?: string) => {
    console.log('📋 [LEGACY] syncEmails called - redirecting to queue system');
    return createSyncJob(storeId, 'manual', syncFrom, syncTo);
  };

  /**
   * Manual store status refresh
   * Checks database for actual store status and sync job status
   */
  const refreshStoreStatus = async (storeId: string) => {
    try {
      console.log(`🔄 [MANUAL-REFRESH] Refreshing status for store: ${storeId}`);
      
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Get user's business_id
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        throw new Error('Unable to load business information');
      }

      // Get current store status from database
      const { data: storeData, error: storeError } = await supabase
        .from('stores')
        .select('id, name, status, connected, last_synced')
        .eq('id', storeId)
        .eq('business_id', userProfile.business_id)
        .single();

      if (storeError) {
        throw new Error(`Store not found: ${storeError.message}`);
      }

      // Check for any pending or running sync jobs
      const { data: activeSyncJobs, error: syncError } = await supabase
        .from('sync_queue')
        .select('id, status, created_at, metadata')
        .eq('store_id', storeId)
        .eq('business_id', userProfile.business_id)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (syncError) {
        console.warn('Error checking sync jobs:', syncError);
      }

      // Determine actual status
      let actualStatus: Store['status'] = 'active';
      
      if (activeSyncJobs && activeSyncJobs.length > 0) {
        const activeJob = activeSyncJobs[0];
        const jobAge = Date.now() - new Date(activeJob.created_at).getTime();
        const maxJobAge = 10 * 60 * 1000; // 10 minutes
        
        if (jobAge > maxJobAge) {
          console.warn(`🔄 [MANUAL-REFRESH] Sync job ${activeJob.id} appears stuck (${Math.round(jobAge / 60000)} minutes old)`);
          actualStatus = 'issue';
        } else {
          actualStatus = activeJob.status === 'processing' ? 'syncing' : 'connecting';
        }
      } else if (!storeData.connected) {
        actualStatus = 'pending';
      }

      // Update frontend state
      setStores(prev => prev.map(s => 
        s.id === storeId 
          ? { 
              ...s, 
              status: actualStatus,
              connected: storeData.connected,
              lastSynced: storeData.last_synced
            }
          : s
      ));

      console.log(`✅ [MANUAL-REFRESH] Store ${storeId} status refreshed: ${actualStatus}`);
      toast.success(`Store status refreshed: ${actualStatus}`);

    } catch (error) {
      console.error('Error refreshing store status:', error);
      toast.error(`Failed to refresh store status: ${(error as any)?.message}`);
    }
  };

  /**
   * Sync timeout monitoring
   * Automatically detects and handles stuck sync jobs
   */
  const startSyncTimeoutMonitoring = (jobId: string, storeId: string) => {
    const maxSyncTime = 15 * 60 * 1000; // 15 minutes maximum
    const checkInterval = 2 * 60 * 1000; // Check every 2 minutes
    let monitoringActive = true;
    let checksPerformed = 0;
    const maxChecks = Math.ceil(maxSyncTime / checkInterval);
    
    console.log(`⏰ [TIMEOUT] Starting timeout monitoring for job ${jobId} (max ${maxSyncTime / 60000} minutes)`);
    
    const checkTimeout = async () => {
      if (!monitoringActive) {
        console.log('⏰ [TIMEOUT] Monitoring cancelled - sync completed');
        return;
      }
      
      checksPerformed++;
      console.log(`⏰ [TIMEOUT] Timeout check ${checksPerformed}/${maxChecks} for job ${jobId}`);
      
      try {
        const { data: job, error } = await supabase
          .from('sync_queue')
          .select('status, created_at, metadata')
          .eq('id', jobId)
          .single();
        
        if (error) {
          console.error('⏰ [TIMEOUT] Error checking job status:', error);
          monitoringActive = false;
          return;
        }
        
        // If job is completed or failed, stop monitoring
        if (job?.status === 'completed' || job?.status === 'failed') {
          console.log(`⏰ [TIMEOUT] Job ${jobId} finished with status: ${job.status}`);
          monitoringActive = false;
          return;
        }
        
        // Check if job has exceeded maximum time
        const jobAge = Date.now() - new Date(job.created_at).getTime();
        if (jobAge > maxSyncTime) {
          console.warn(`⏰ [TIMEOUT] Sync job ${jobId} exceeded maximum time (${Math.round(jobAge / 60000)} minutes)`);
          
          // Update store status to issue
          setStores(prev => prev.map(s => 
            s.id === storeId 
              ? { ...s, status: 'issue' as const }
              : s
          ));
          
          // Show timeout notification
          toast.error(
            `Sync appears to be stuck (${Math.round(jobAge / 60000)} minutes). Try refreshing store status or retry sync.`,
            { 
              duration: 10000
            }
          );
          
          monitoringActive = false;
          return;
        }
        
        // Continue monitoring if under time limit and checks remaining
        if (checksPerformed < maxChecks) {
          setTimeout(checkTimeout, checkInterval);
        } else {
          console.log(`⏰ [TIMEOUT] Maximum checks reached for job ${jobId}`);
          monitoringActive = false;
        }
        
      } catch (timeoutError) {
        console.error('⏰ [TIMEOUT] Error during timeout monitoring:', timeoutError);
        monitoringActive = false;
      }
    };
    
    // Start first check after initial delay
    setTimeout(checkTimeout, checkInterval);
    
    // Return cancellation function
    return () => {
      monitoringActive = false;
    };
  };

  /**
   * Retry failed sync
   * Creates a new sync job for stores with failed status
   */
  const retryFailedSync = async (storeId: string) => {
    try {
      await syncEmails(storeId);
    } catch (error) {
      console.error('Retry failed sync error:', error);
      toast.error('Failed to retry sync. Please try again.');
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
        
        // Start OAuth state manager cleanup
        const oauthCleanup = oauthStateManager.startCleanupInterval();
        
        // Combine cleanup functions
        setPeriodicRefreshCleanup(() => () => {
          cleanup();
          oauthCleanup();
        });

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

    // Prevent multiple subscriptions with a flag
    let isSubscriptionActive = true;
    let currentSubscription: any = null;

    // Clean up any existing subscription first to prevent duplicate subscriptions
    if (realtimeSubscription) {
      console.log('InboxContext: Cleaning up existing subscription before reload');
      supabase.removeChannel(realtimeSubscription);
      setRealtimeSubscription(null);
    }

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

      // Check if subscription is still active (component not unmounted)
      if (!isSubscriptionActive) {
        console.log('InboxContext: Subscription cancelled, component unmounted');
        return;
      }

      // Get user's business_id for business-based real-time filtering
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user!.id)
        .single();

      if (!userProfile?.business_id) {
        console.error('InboxContext: No business_id found for user, cannot set up real-time subscription');
        setLoading(false);
        return;
      }

      // Check again if subscription is still active after async operation
      if (!isSubscriptionActive) {
        console.log('InboxContext: Subscription cancelled during setup');
        return;
      }

      // Set up realtime subscription with business-based filtering
      // Use unique channel name per business to prevent conflicts
      console.log('InboxContext: Setting up real-time subscription for business:', userProfile.business_id);
      
      // 📋 [NEW] Add handleSyncQueueUpdate function for real-time sync status
      const handleSyncQueueUpdate = (payload: any) => {
        console.log('🔄 [SYNC-QUEUE-UPDATE] Raw payload received:', JSON.stringify(payload, null, 2));
        
        const { new: newJob, old: oldJob, eventType } = payload;
        
        console.log('🔄 [SYNC-QUEUE-UPDATE] Parsed data:', {
          eventType,
          newStatus: newJob && typeof newJob === 'object' && 'status' in newJob ? newJob.status : 'unknown',
          oldStatus: oldJob && typeof oldJob === 'object' && 'status' in oldJob ? oldJob.status : 'unknown',
          jobId: newJob && typeof newJob === 'object' && 'id' in newJob ? newJob.id : 'unknown',
          storeId: newJob && typeof newJob === 'object' && 'store_id' in newJob ? newJob.store_id : 'unknown',
          businessId: newJob && typeof newJob === 'object' && 'business_id' in newJob ? newJob.business_id : 'unknown',
          filterBusinessId: userProfile.business_id
        });

        // 🔍 [DEBUG] Check if business_id matches our filter
        const newJobBusinessId = newJob && typeof newJob === 'object' && 'business_id' in newJob ? newJob.business_id : null;
        if (newJobBusinessId !== userProfile.business_id) {
          console.warn('⚠️ [FILTER-MISMATCH] Received sync_queue update for different business_id:', {
            received: newJobBusinessId,
            expected: userProfile.business_id,
            willIgnore: true
          });
          return;
        }
        
        const newJobStoreId = newJob && typeof newJob === 'object' && 'store_id' in newJob ? newJob.store_id : null;
        const newJobId = newJob && typeof newJob === 'object' && 'id' in newJob ? newJob.id : null;
        const newJobStatus = newJob && typeof newJob === 'object' && 'status' in newJob ? newJob.status : null;
        
        if (newJob && newJobStoreId) {
          console.log(`🔄 [SYNC-STATUS] ${eventType}: Job ${newJobId} for store ${newJobStoreId} - ${newJobStatus}`);
          
          switch (newJobStatus) {
            case 'processing':
              console.log('📋 [STATUS-UPDATE] Setting store to syncing');
              setStores(prev => prev.map(s => 
                s.id === newJobStoreId 
                  ? { ...s, status: 'syncing' as const }
                  : s
              ));
              break;
              
            case 'completed':
              console.log('🎉 [STATUS-UPDATE] Triggering completion handler for store:', newJobStoreId);
              console.log('🎉 [COMPLETION-TRIGGER] About to call handleSyncCompletion...');
              handleSyncCompletion(newJobStoreId, newJob);
              break;
              
            case 'failed':
              console.log('❌ [STATUS-UPDATE] Triggering failure handler for store:', newJobStoreId);
              handleSyncFailure(newJobStoreId, newJob);
              break;
              
            default:
              console.log(`ℹ️ [STATUS-UPDATE] Unhandled status: ${newJobStatus}`);
          }
        } else {
          console.warn('⚠️ [SYNC-QUEUE-UPDATE] Missing newJob or store_id:', { 
            hasNewJob: !!newJob, 
            storeId: newJobStoreId,
            fullPayload: payload 
          });
        }
      };
      
      const subscription = supabase
      .channel(`inbox-emails-${userProfile.business_id}`)
      
      // NOTE: Store updates are handled by handleSyncCompletion via sync_queue subscription
      
      // 📋 [ENHANCED] Subscribe to sync_queue changes with enhanced debugging
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_queue',
          filter: `business_id=eq.${userProfile.business_id}`
        },
        (payload) => {
          console.log(`🔄 [SUBSCRIPTION] sync_queue event received for business ${userProfile.business_id}:`, payload.eventType);
          console.log(`🔄 [SUBSCRIPTION] Full event details:`, {
            table: payload.table,
            schema: payload.schema,
            eventType: payload.eventType,
            timestamp: new Date().toISOString(),
            hasNew: !!payload.new,
            hasOld: !!payload.old,
            newJobId: payload.new?.id,
            newStatus: payload.new?.status,
            newStoreId: payload.new?.store_id,
            newBusinessId: payload.new?.business_id
          });
          handleSyncQueueUpdate(payload);
        }
      )
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

            // Get fresh stores data to ensure we have current state
            const { data: currentStoresData } = await supabase
              .from('stores')
              .select('*')
              .eq('business_id', userProfile.business_id);
            
            const store = currentStoresData?.find(s => s.id === newEmail.store_id);
            
            if (!store) {
              console.warn('InboxContext: Store not found for real-time email:', newEmail.store_id);
              console.log('Available stores:', currentStoresData?.map(s => ({ id: s.id, name: s.name })));
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
                
                // 🔔 SMART NOTIFICATION: Only show toast for webhook emails, not sync emails
                // Check if this email came from a webhook (real-time) vs sync operation
                const isFromWebhook = newEmail.source === 'webhook' || 
                                     (!newEmail.source && newEmail.graph_id); // Webhook emails have graph_id
                const isRecentEmail = new Date(newEmail.date).getTime() > (Date.now() - 5 * 60 * 1000); // Last 5 minutes
                
                if (isFromWebhook && isRecentEmail) {
                  try {
                    console.log('🔔 Showing webhook email notification for:', newEmail.from);
                    toast.success(`📧 New email from ${newEmail.from}`);
                  } catch (toastError) {
                    console.warn('Toast notification failed:', toastError);
                  }
                } else {
                  console.log('🔇 Skipping notification for sync email:', {
                    isFromWebhook,
                    isRecentEmail,
                    source: newEmail.source,
                    hasGraphId: !!newEmail.graph_id,
                    emailDate: newEmail.date
                  });
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
      // =========================================================================
      // == START: ADDED REAL-TIME UPDATE LISTENER                              ==
      // =========================================================================
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'emails',
          filter: `business_id=eq.${userProfile.business_id}`
        },
        async (payload) => {
          console.log('InboxContext: Received email update:', payload);
          const updatedEmail = payload.new;
          
          // SECURITY: Re-fetch stores for user's business only to ensure context is current
          const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('business_id')
            .eq('user_id', user!.id)
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
      // =========================================================================
      // == END: ADDED REAL-TIME UPDATE LISTENER                                ==
      // =========================================================================
      .subscribe((status, err) => {
        console.log('🔌 [SUBSCRIPTION-STATUS] Real-time subscription status changed:', {
          status,
          error: err,
          channel: `inbox-emails-${userProfile.business_id}`,
          timestamp: new Date().toISOString()
        });
        
        if (status === 'SUBSCRIBED') {
          console.log('✅ [SUBSCRIPTION-READY] Real-time subscription active and ready for sync_queue updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ [SUBSCRIPTION-ERROR] Real-time subscription failed:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('⏰ [SUBSCRIPTION-TIMEOUT] Real-time subscription timed out');
        } else if (status === 'CLOSED') {
          console.log('🔒 [SUBSCRIPTION-CLOSED] Real-time subscription closed');
        }
      });

      // Store subscription reference for cleanup
      currentSubscription = subscription;
      
      // Only set state if subscription is still active
      if (isSubscriptionActive) {
        setRealtimeSubscription(subscription);
      } else {
        // Clean up immediately if cancelled
        supabase.removeChannel(subscription);
      }
    };

    loadDataAndSetupRealtime();

    return () => {
      console.log('InboxContext: Cleaning up subscriptions');
      
      // Mark subscription as inactive to prevent new ones
      isSubscriptionActive = false;
      
      // Clean up current subscription
      if (currentSubscription) {
        supabase.removeChannel(currentSubscription);
      }
      
      // Clean up state subscription if it exists
      if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
        setRealtimeSubscription(null);
      }
    };
  }, [user?.id]); // Only depend on user.id to prevent unnecessary re-subscriptions

  /**
   * 🧪 TEST: Real-time subscription functionality
   */
  const testRealtimeSubscription = async () => {
    if (!user) {
      toast.error('Please log in to test real-time subscription');
      return;
    }

    try {
      console.log('🧪 [TEST] Starting real-time subscription test...');

      // Get user's business_id for the test
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (profileError || !userProfile?.business_id) {
        throw new Error('Business information not found for testing');
      }

      console.log('🧪 [TEST] User business_id for test:', userProfile.business_id);

      // Test 1: Create a test sync_queue record with correct business_id
      console.log('🧪 [TEST-1] Creating test sync_queue record WITH business_id filter match...');
      
      // Generate proper UUID for test
      const testUuid1 = crypto.randomUUID();
      
      const testRecord1 = {
        id: testUuid1,
        store_id: 'test-store-1',
        business_id: userProfile.business_id, // Matches filter
        sync_type: 'manual', // Valid sync_type (instead of 'test')
        status: 'pending',
        created_at: new Date().toISOString(),
        metadata: { test: 'realtime-subscription-test-1' }
      };

      const { error: insertError1 } = await supabase
        .from('sync_queue')
        .insert(testRecord1);

      if (insertError1) {
        console.error('🧪 [TEST-1] Failed to insert test record:', insertError1);
        console.error('🧪 [TEST-1] Full error details:', {
          message: insertError1.message,
          details: insertError1.details,
          hint: insertError1.hint,
          code: insertError1.code
        });
        
        console.log('🧪 [TEST-1] This suggests RLS policies or permissions are blocking direct sync_queue access');
        console.log('🧪 [TEST-1] Let me try an alternative approach...');
        
        // Alternative Test: Check if subscription is connected by testing with existing sync
        console.log('🧪 [ALT-TEST] Testing subscription connection status...');
        
        // Get current subscription status
        const subscriptionStatus = supabase.getChannels();
        console.log('🧪 [ALT-TEST] Current Supabase channels:', subscriptionStatus);
        
        // Test if we can read from sync_queue at least
        console.log('🧪 [ALT-TEST] Testing sync_queue read access...');
        const { data: existingJobs, error: readError } = await supabase
          .from('sync_queue')
          .select('id, status, business_id')
          .eq('business_id', userProfile.business_id)
          .limit(5);
          
        if (readError) {
          console.error('🧪 [ALT-TEST] Cannot read sync_queue either:', readError);
          throw new Error(`sync_queue access blocked: ${readError.message}`);
        } else {
          console.log('🧪 [ALT-TEST] sync_queue READ access works:', existingJobs);
          console.log('🧪 [ALT-TEST] Found', existingJobs?.length || 0, 'existing jobs for this business');
        }
        
        throw new Error(`Cannot insert test records into sync_queue. RLS Policy issue: ${insertError1.message}`);
      }

      console.log('🧪 [TEST-1] Test record inserted successfully:', testRecord1.id);

      // Wait 2 seconds for real-time event
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test 2: Update the test record to 'completed' status
      console.log('🧪 [TEST-2] Updating test record to completed status...');
      
      const { error: updateError1 } = await supabase
        .from('sync_queue')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
          metadata: { test: 'realtime-subscription-test-completed' }
        })
        .eq('id', testRecord1.id);

      if (updateError1) {
        console.error('🧪 [TEST-2] Failed to update test record:', updateError1);
        throw updateError1;
      }

      console.log('🧪 [TEST-2] Test record updated to completed');

      // Wait 2 seconds for real-time event
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test 3: Create a test record with DIFFERENT business_id (should NOT trigger subscription)
      console.log('🧪 [TEST-3] Creating test record with DIFFERENT business_id (should NOT trigger)...');
      
      // Generate proper UUID for test 2
      const testUuid2 = crypto.randomUUID();
      
      const testRecord2 = {
        id: testUuid2,
        store_id: 'test-store-2',
        business_id: 'different-business-id', // Does NOT match filter
        sync_type: 'manual', // Valid sync_type
        status: 'completed',
        created_at: new Date().toISOString(),
        metadata: { test: 'realtime-subscription-test-no-match' }
      };

      const { error: insertError2 } = await supabase
        .from('sync_queue')
        .insert(testRecord2);

      if (insertError2) {
        console.error('🧪 [TEST-3] Failed to insert test record 2:', insertError2);
        throw insertError2;
      }

      console.log('🧪 [TEST-3] Test record 2 inserted (should NOT trigger subscription)');

      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Cleanup: Remove test records
      console.log('🧪 [CLEANUP] Removing test records...');
      
      await supabase
        .from('sync_queue')
        .delete()
        .in('id', [testUuid1, testUuid2]);

      console.log('🧪 [CLEANUP] Test records removed');

      console.log('🧪 [TEST] Real-time subscription test completed!');
      console.log('🧪 [TEST] Check the logs above for subscription events:');
      console.log('🧪 [TEST] - Look for "🔄 [SUBSCRIPTION]" logs');
      console.log('🧪 [TEST] - Look for "🔄 [SYNC-QUEUE-UPDATE]" logs');
      console.log('🧪 [TEST] - Test 1 & 2 should trigger events');
      console.log('🧪 [TEST] - Test 3 should NOT trigger events');

      toast.success('Real-time subscription test completed! Check console for results.', { 
        duration: 5000 
      });

    } catch (error) {
      console.error('🧪 [TEST] Real-time subscription test failed:', error);
      
      // If direct sync_queue access fails, try alternative test with real sync
      console.log('🧪 [ALT-TEST-2] Direct sync_queue access failed, trying real sync test...');
      
      try {
        // Check if we have any connected stores to test with
        if (stores.length === 0) {
          console.log('🧪 [ALT-TEST-2] No connected stores available for real sync test');
          toast.error('Real-time test failed: sync_queue access blocked and no stores to test with');
          return;
        }
        
        const testStore = stores[0];
        console.log('🧪 [ALT-TEST-2] Testing with real store:', testStore.id, testStore.name);
        console.log('🧪 [ALT-TEST-2] This will create a real sync job and test if subscription triggers');
        console.log('🧪 [ALT-TEST-2] Watch for real-time subscription events...');
        
        // Trigger a real sync to test if subscription works
        await createSyncJob(testStore.id, 'manual'); // Use 'manual' instead of 'test'
        
        console.log('🧪 [ALT-TEST-2] Real sync triggered - watch for subscription events above');
        toast.success('Real sync test triggered! Watch console for real-time subscription events.', { 
          duration: 5000 
        });
        
      } catch (altError) {
        console.error('🧪 [ALT-TEST-2] Alternative test also failed:', altError);
        toast.error(`Test failed: ${(error as any)?.message || 'Unknown error'}`);
      }
    }
  };

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
    refreshStoreStatus,
    retryFailedSync,
    loading,
    error,
    pendingStore,
          testRealtimeSubscription: () => testRealtimeSubscription()
  };

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
};
