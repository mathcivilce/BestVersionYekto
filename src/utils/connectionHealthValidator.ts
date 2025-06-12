/**
 * Connection Health Validator
 * 
 * Implements progressive validation system to ensure OAuth connections are working properly.
 * Prevents false positives by validating at multiple levels with comprehensive error handling.
 * 
 * Validation Levels:
 * 1. BASIC_DATABASE - Check database record existence and basic fields
 * 2. TOKEN_EXPIRY - Check token expiration locally without API calls
 * 3. LIVE_API - Test actual Microsoft Graph API call with timeout
 * 
 * Design Principles:
 * - Prefer OAuth flow over uncertainty (avoid false positives)
 * - 5-second timeout for Microsoft API calls
 * - Comprehensive console logging for debugging
 * - No caching - validate on every connection attempt
 * - Silent operation - no UI changes during validation
 */

import { createClient } from '@supabase/supabase-js';

export enum ValidationLevel {
  BASIC_DATABASE = 'basic_database',
  TOKEN_EXPIRY = 'token_expiry', 
  LIVE_API = 'live_api'
}

export enum ConnectionError {
  INVALID_REFRESH_TOKEN = 'invalid_refresh_token',
  EXPIRED_ACCESS_TOKEN = 'expired_access_token',
  MICROSOFT_API_DOWN = 'microsoft_api_down',
  NETWORK_ERROR = 'network_error',
  PERMISSION_REVOKED = 'permission_revoked',
  MISSING_REQUIRED_FIELDS = 'missing_required_fields',
  VALIDATION_TIMEOUT = 'validation_timeout'
}

export interface ValidationResult {
  isValid: boolean;
  level: ValidationLevel;
  error?: ConnectionError;
  errorMessage?: string;
  needsReauth?: boolean;
  details?: any;
  duration?: number;
}

export interface Store {
  id: string;
  name: string;
  platform: 'outlook' | 'gmail';
  email: string;
  connected: boolean;
  status: 'active' | 'issue' | 'pending' | 'syncing' | 'connecting';
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  token_last_refreshed?: string;
  oauth_method?: string;
}

export class ConnectionHealthValidator {
  private static readonly API_TIMEOUT = 5000; // 5 seconds
  private static readonly DATABASE_TIMEOUT = 2000; // 2 seconds
  private static readonly TOKEN_TIMEOUT = 3000; // 3 seconds
  private static readonly TOTAL_TIMEOUT = 10000; // 10 seconds maximum

  private supabase: any;

  constructor() {
    this.supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL || '',
      import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    );
  }

  /**
   * Main validation entry point - progressive validation with three levels
   */
  async validateConnection(store: Store): Promise<ValidationResult> {
    const startTime = Date.now();
    console.log(`=== CONNECTION HEALTH VALIDATION START ===`);
    console.log(`Store: ${store.id} (${store.email})`);
    console.log(`Platform: ${store.platform}`);
    console.log(`OAuth Method: ${store.oauth_method}`);

    try {
      // Level 1: Basic Database Validation
      console.log('🔍 Level 1: Basic Database Validation');
      const basicResult = await this.validateBasicDatabase(store);
      console.log(`Database validation: ${basicResult.isValid ? 'PASS' : 'FAIL'}`);
      
      if (!basicResult.isValid) {
        const duration = Date.now() - startTime;
        console.log(`=== VALIDATION FAILED AT LEVEL 1 (${duration}ms) ===`);
        return { ...basicResult, duration };
      }

      // Level 2: Token Expiry Validation  
      console.log('🔍 Level 2: Token Expiry Validation');
      const tokenResult = await this.validateTokenExpiry(store);
      console.log(`Token expiry validation: ${tokenResult.isValid ? 'PASS' : 'FAIL'}`);
      
      if (!tokenResult.isValid) {
        const duration = Date.now() - startTime;
        console.log(`=== VALIDATION FAILED AT LEVEL 2 (${duration}ms) ===`);
        return { ...tokenResult, duration };
      }

      // Level 3: Live API Validation
      console.log('🔍 Level 3: Live Microsoft API Validation');
      const apiResult = await this.validateLiveAPI(store);
      console.log(`API validation: ${apiResult.isValid ? 'PASS' : 'FAIL'}`);
      
      const duration = Date.now() - startTime;
      console.log(`=== VALIDATION COMPLETE: ${apiResult.isValid ? 'HEALTHY' : 'BROKEN'} (${duration}ms) ===`);
      
      return { ...apiResult, duration };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error('Validation error:', error);
      console.log(`=== VALIDATION ERROR (${duration}ms) ===`);
      
      return {
        isValid: false,
        level: ValidationLevel.BASIC_DATABASE,
        error: ConnectionError.VALIDATION_TIMEOUT,
        errorMessage: error.message || 'Validation failed with unknown error',
        needsReauth: true,
        duration
      };
    }
  }

  /**
   * Level 1: Basic Database Validation
   * Checks if store has required fields for OAuth connection
   */
  private async validateBasicDatabase(store: Store): Promise<ValidationResult> {
    try {
      // Check required fields for server-side OAuth
      const requiredFields = ['id', 'email', 'platform', 'access_token'];
      const missingFields = requiredFields.filter(field => !store[field as keyof Store]);
      
      if (missingFields.length > 0) {
        return {
          isValid: false,
          level: ValidationLevel.BASIC_DATABASE,
          error: ConnectionError.MISSING_REQUIRED_FIELDS,
          errorMessage: `Missing required fields: ${missingFields.join(', ')}`,
          needsReauth: true,
          details: { missingFields }
        };
      }

      // Check if store is marked as connected
      if (!store.connected) {
        return {
          isValid: false,
          level: ValidationLevel.BASIC_DATABASE,
          error: ConnectionError.INVALID_REFRESH_TOKEN,
          errorMessage: 'Store is marked as disconnected',
          needsReauth: true
        };
      }

      // Check if platform is supported
      if (!['outlook', 'gmail'].includes(store.platform)) {
        return {
          isValid: false,
          level: ValidationLevel.BASIC_DATABASE,
          error: ConnectionError.MISSING_REQUIRED_FIELDS,
          errorMessage: `Unsupported platform: ${store.platform}`,
          needsReauth: true
        };
      }

      console.log('✅ Database validation passed');
      return {
        isValid: true,
        level: ValidationLevel.BASIC_DATABASE
      };

    } catch (error: any) {
      return {
        isValid: false,
        level: ValidationLevel.BASIC_DATABASE,
        error: ConnectionError.NETWORK_ERROR,
        errorMessage: `Database validation failed: ${error.message}`,
        needsReauth: true
      };
    }
  }

  /**
   * Level 2: Token Expiry Validation
   * Checks if access token is expired based on stored expiration time
   */
  private async validateTokenExpiry(store: Store): Promise<ValidationResult> {
    try {
      // Check if we have token expiration data
      if (!store.token_expires_at) {
        console.log('⚠️ No token expiration data available');
        return {
          isValid: false,
          level: ValidationLevel.TOKEN_EXPIRY,
          error: ConnectionError.EXPIRED_ACCESS_TOKEN,
          errorMessage: 'No token expiration data available',
          needsReauth: false // Might be refreshable
        };
      }

      // Parse expiration time
      const expiresAt = new Date(store.token_expires_at);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));

      console.log(`Token expires in ${minutesUntilExpiry} minutes`);

      // Consider token expired if it expires within 5 minutes (buffer for API calls)
      if (timeUntilExpiry <= 5 * 60 * 1000) {
        return {
          isValid: false,
          level: ValidationLevel.TOKEN_EXPIRY,
          error: ConnectionError.EXPIRED_ACCESS_TOKEN,
          errorMessage: `Token expires in ${minutesUntilExpiry} minutes`,
          needsReauth: false, // Can be refreshed
          details: { minutesUntilExpiry, expiresAt: expiresAt.toISOString() }
        };
      }

      console.log('✅ Token expiry validation passed');
      return {
        isValid: true,
        level: ValidationLevel.TOKEN_EXPIRY,
        details: { minutesUntilExpiry, expiresAt: expiresAt.toISOString() }
      };

    } catch (error: any) {
      return {
        isValid: false,
        level: ValidationLevel.TOKEN_EXPIRY,
        error: ConnectionError.EXPIRED_ACCESS_TOKEN,
        errorMessage: `Token expiry validation failed: ${error.message}`,
        needsReauth: false
      };
    }
  }

  /**
   * Level 3: Live API Validation  
   * Makes actual Microsoft Graph API call to test token validity
   */
  private async validateLiveAPI(store: Store): Promise<ValidationResult> {
    try {
      console.log('🌐 Testing Microsoft Graph API with 5-second timeout...');

      if (!store.access_token) {
        return {
          isValid: false,
          level: ValidationLevel.LIVE_API,
          error: ConnectionError.EXPIRED_ACCESS_TOKEN,
          errorMessage: 'No access token available',
          needsReauth: true
        };
      }

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('API validation timeout after 5 seconds'));
        }, ConnectionHealthValidator.API_TIMEOUT);
      });

      // Create API call promise
      const apiPromise = fetch('https://graph.microsoft.com/v1.0/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${store.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      // Race between API call and timeout
      const response = await Promise.race([apiPromise, timeoutPromise]);

      if (response.ok) {
        const userData = await response.json();
        console.log('✅ Microsoft API validation passed');
        console.log(`Authenticated as: ${userData.mail || userData.userPrincipalName}`);
        
        return {
          isValid: true,
          level: ValidationLevel.LIVE_API,
          details: { 
            authenticatedEmail: userData.mail || userData.userPrincipalName,
            responseStatus: response.status 
          }
        };
      }

      // Handle specific HTTP status codes
      if (response.status === 401) {
        return {
          isValid: false,
          level: ValidationLevel.LIVE_API,
          error: ConnectionError.EXPIRED_ACCESS_TOKEN,
          errorMessage: 'Access token is invalid or expired',
          needsReauth: false, // Try refresh first
          details: { responseStatus: response.status }
        };
      }

      if (response.status === 403) {
        return {
          isValid: false,
          level: ValidationLevel.LIVE_API,
          error: ConnectionError.PERMISSION_REVOKED,
          errorMessage: 'Access token permissions have been revoked',
          needsReauth: true,
          details: { responseStatus: response.status }
        };
      }

      // Other 4xx/5xx errors
      return {
        isValid: false,
        level: ValidationLevel.LIVE_API,
        error: response.status >= 500 ? ConnectionError.MICROSOFT_API_DOWN : ConnectionError.EXPIRED_ACCESS_TOKEN,
        errorMessage: `Microsoft API returned ${response.status}`,
        needsReauth: response.status >= 500 ? true : false, // Server errors -> start OAuth, client errors -> try refresh
        details: { responseStatus: response.status }
      };

    } catch (error: any) {
      console.error('Microsoft API validation error:', error);

      // Check if it's a timeout
      if (error.message.includes('timeout')) {
        console.log('⚠️ Microsoft API timeout - assuming API is down, will start OAuth');
        return {
          isValid: false,
          level: ValidationLevel.LIVE_API,
          error: ConnectionError.MICROSOFT_API_DOWN,
          errorMessage: 'Microsoft API is down or unreachable',
          needsReauth: true, // Prefer OAuth flow over uncertainty
          details: { timeoutMs: ConnectionHealthValidator.API_TIMEOUT }
        };
      }

      // Network or other errors
      return {
        isValid: false,
        level: ValidationLevel.LIVE_API,
        error: ConnectionError.NETWORK_ERROR,
        errorMessage: `Network error: ${error.message}`,
        needsReauth: true,
        details: { originalError: error.message }
      };
    }
  }

  /**
   * Find existing store by email for duplicate detection
   */
  async findExistingStoreByEmail(email: string, userId: string): Promise<Store | null> {
    try {
      console.log(`🔍 Searching for existing store with email: ${email}`);
      
      const { data: store, error } = await this.supabase
        .from('stores')
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('user_id', userId) 
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows found
          console.log('No existing store found with this email');
          return null;
        }
        throw error;
      }

      console.log(`Found existing store: ${store.id} (${store.name})`);
      return store;

    } catch (error: any) {
      console.error('Error searching for existing store:', error);
      return null; // Fail gracefully
    }
  }

  /**
   * Get classification of connection error for recovery strategies
   */
  static classifyConnectionError(error: any): ConnectionError {
    if (!error) return ConnectionError.NETWORK_ERROR;

    const message = error.message?.toLowerCase() || '';
    const status = error.status || error.statusCode;

    if (message.includes('timeout')) return ConnectionError.VALIDATION_TIMEOUT;
    if (message.includes('invalid_grant') || status === 400) return ConnectionError.INVALID_REFRESH_TOKEN;
    if (status === 401) return ConnectionError.EXPIRED_ACCESS_TOKEN;
    if (status === 403) return ConnectionError.PERMISSION_REVOKED;
    if (status >= 500) return ConnectionError.MICROSOFT_API_DOWN;
    if (message.includes('network') || message.includes('fetch')) return ConnectionError.NETWORK_ERROR;

    return ConnectionError.NETWORK_ERROR;
  }
} 