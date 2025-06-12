/**
 * Error Recovery Manager
 * 
 * Implements intelligent recovery strategies for different types of OAuth connection errors.
 * Works with the ConnectionHealthValidator to provide automatic error recovery.
 * 
 * Recovery Strategies:
 * - INVALID_REFRESH_TOKEN: Mark store as disconnected, require full re-auth
 * - EXPIRED_ACCESS_TOKEN: Attempt token refresh via Edge Function
 * - MICROSOFT_API_DOWN: Start OAuth flow (prefer OAuth over uncertainty)
 * - PERMISSION_REVOKED: Mark store as disconnected, require full re-auth
 * - NETWORK_ERROR: Start OAuth flow for reliability
 * 
 * Design Principles:
 * - Comprehensive console logging for debugging
 * - Graceful degradation - never throw errors that break user flow
 * - Prefer OAuth flow over leaving users in broken state
 * - Automatic recovery without user intervention when possible
 */

import { createClient } from '@supabase/supabase-js';
import { ConnectionError, Store, ValidationResult } from './connectionHealthValidator';

export enum RecoveryStrategy {
  START_OAUTH = 'start_oauth',
  ATTEMPT_TOKEN_REFRESH = 'attempt_token_refresh', 
  MARK_DISCONNECTED = 'mark_disconnected',
  NO_ACTION = 'no_action'
}

export interface RecoveryResult {
  strategy: RecoveryStrategy;
  success: boolean;
  shouldStartOAuth: boolean;
  error?: string;
  details?: any;
}

export interface ToastMessage {
  type: 'success' | 'error' | 'info';
  message: string;
}

export class ErrorRecoveryManager {
  private supabase: any;

  constructor() {
    this.supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL || '',
      import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    );
  }

  /**
   * Main recovery entry point - determines and executes recovery strategy
   */
  async executeRecovery(validationResult: ValidationResult, store: Store): Promise<RecoveryResult> {
    console.log(`=== ERROR RECOVERY START ===`);
    console.log(`Error: ${validationResult.error}`);
    console.log(`Store: ${store.id} (${store.email})`);
    console.log(`Level: ${validationResult.level}`);

    if (!validationResult.error) {
      console.log('No error to recover from');
      return {
        strategy: RecoveryStrategy.NO_ACTION,
        success: true,
        shouldStartOAuth: false
      };
    }

    try {
      const strategy = this.determineRecoveryStrategy(validationResult.error);
      console.log(`Recovery strategy: ${strategy}`);

      switch (strategy) {
        case RecoveryStrategy.START_OAUTH:
          return await this.startOAuthFlow(store, validationResult);

        case RecoveryStrategy.ATTEMPT_TOKEN_REFRESH:
          return await this.attemptTokenRefresh(store, validationResult);

        case RecoveryStrategy.MARK_DISCONNECTED:
          return await this.markStoreAsDisconnected(store, validationResult);

        case RecoveryStrategy.NO_ACTION:
        default:
          return {
            strategy,
            success: true,
            shouldStartOAuth: false
          };
      }

    } catch (error: any) {
      console.error('Recovery execution error:', error);
      
      // Fallback to OAuth flow on any recovery error
      return {
        strategy: RecoveryStrategy.START_OAUTH,
        success: false,
        shouldStartOAuth: true,
        error: `Recovery failed: ${error.message}`,
        details: { originalError: validationResult.error }
      };
    } finally {
      console.log(`=== ERROR RECOVERY COMPLETE ===`);
    }
  }

  /**
   * Determine the appropriate recovery strategy based on error type
   */
  private determineRecoveryStrategy(error: ConnectionError): RecoveryStrategy {
    switch (error) {
      case ConnectionError.INVALID_REFRESH_TOKEN:
        // Refresh token is permanently invalid - need full re-auth
        return RecoveryStrategy.MARK_DISCONNECTED;

      case ConnectionError.EXPIRED_ACCESS_TOKEN:
        // Access token expired but refresh token might work
        return RecoveryStrategy.ATTEMPT_TOKEN_REFRESH;

      case ConnectionError.MICROSOFT_API_DOWN:
        // API is down or unreachable - start OAuth to avoid false positives
        return RecoveryStrategy.START_OAUTH;

      case ConnectionError.PERMISSION_REVOKED:
        // User revoked permissions - need full re-auth
        return RecoveryStrategy.MARK_DISCONNECTED;

      case ConnectionError.NETWORK_ERROR:
        // Network issues - start OAuth for reliability
        return RecoveryStrategy.START_OAUTH;

      case ConnectionError.VALIDATION_TIMEOUT:
        // Validation timed out - start OAuth for reliability
        return RecoveryStrategy.START_OAUTH;

      case ConnectionError.MISSING_REQUIRED_FIELDS:
        // Database issues - start OAuth to rebuild store
        return RecoveryStrategy.START_OAUTH;

      default:
        // Unknown error - start OAuth for safety
        return RecoveryStrategy.START_OAUTH;
    }
  }

  /**
   * Recovery Strategy 1: Start OAuth Flow
   * Used when we need to start fresh OAuth for reliability
   */
  private async startOAuthFlow(store: Store, validationResult: ValidationResult): Promise<RecoveryResult> {
    console.log('🔄 Recovery: Starting OAuth flow');

    // Don't modify the store - just signal to start OAuth
    // The OAuth flow will handle updating/creating the store
    return {
      strategy: RecoveryStrategy.START_OAUTH,
      success: true,
      shouldStartOAuth: true,
      details: {
        reason: validationResult.errorMessage,
        originalError: validationResult.error,
        storeId: store.id
      }
    };
  }

  /**
   * Recovery Strategy 2: Attempt Token Refresh
   * Used when access token is expired but refresh token might work
   */
  private async attemptTokenRefresh(store: Store, validationResult: ValidationResult): Promise<RecoveryResult> {
    console.log('🔄 Recovery: Attempting token refresh');

    try {
      // Call the refresh-tokens Edge Function
      const { data: response, error } = await this.supabase.functions.invoke('refresh-tokens', {
        body: { storeId: store.id }
      });

      if (error) {
        console.error('Token refresh Edge Function error:', error);
        return {
          strategy: RecoveryStrategy.ATTEMPT_TOKEN_REFRESH,
          success: false,
          shouldStartOAuth: true, // Fallback to OAuth
          error: 'Token refresh function failed',
          details: { functionError: error }
        };
      }

      if (!response.success) {
        console.error('Token refresh failed:', response.error);
        
        // Check if it's an invalid refresh token error
        if (response.error?.includes('invalid_grant') || response.error?.includes('refresh_token')) {
          console.log('Refresh token is invalid, marking store as disconnected');
          return await this.markStoreAsDisconnected(store, validationResult);
        }

        // Other refresh errors - fallback to OAuth
        return {
          strategy: RecoveryStrategy.ATTEMPT_TOKEN_REFRESH,
          success: false,
          shouldStartOAuth: true,
          error: response.error,
          details: { refreshResponse: response }
        };
      }

      console.log('✅ Token refresh successful');
      return {
        strategy: RecoveryStrategy.ATTEMPT_TOKEN_REFRESH,
        success: true,
        shouldStartOAuth: false,
        details: { refreshedTokens: true }
      };

    } catch (error: any) {
      console.error('Token refresh attempt error:', error);
      
      return {
        strategy: RecoveryStrategy.ATTEMPT_TOKEN_REFRESH,
        success: false,
        shouldStartOAuth: true, // Fallback to OAuth
        error: `Token refresh failed: ${error.message}`,
        details: { originalError: error.message }
      };
    }
  }

  /**
   * Recovery Strategy 3: Mark Store as Disconnected
   * Used when refresh token is invalid or permissions revoked
   */
  private async markStoreAsDisconnected(store: Store, validationResult: ValidationResult): Promise<RecoveryResult> {
    console.log('🔄 Recovery: Marking store as disconnected');

    try {
      const { error } = await this.supabase
        .from('stores')
        .update({
          connected: false,
          status: 'issue',
          token_last_refreshed: new Date().toISOString()
        })
        .eq('id', store.id);

      if (error) {
        console.error('Failed to mark store as disconnected:', error);
        return {
          strategy: RecoveryStrategy.MARK_DISCONNECTED,
          success: false,
          shouldStartOAuth: true, // Fallback to OAuth
          error: `Failed to update store: ${error.message}`,
          details: { updateError: error }
        };
      }

      console.log('✅ Store marked as disconnected');
      return {
        strategy: RecoveryStrategy.MARK_DISCONNECTED,
        success: true,
        shouldStartOAuth: true, // Need fresh OAuth to reconnect
        details: {
          reason: 'Store marked as disconnected due to invalid credentials',
          originalError: validationResult.error
        }
      };

    } catch (error: any) {
      console.error('Mark disconnected error:', error);
      
      return {
        strategy: RecoveryStrategy.MARK_DISCONNECTED,
        success: false,
        shouldStartOAuth: true,
        error: `Failed to mark store as disconnected: ${error.message}`,
        details: { originalError: error.message }
      };
    }
  }

  /**
   * Generate user-friendly toast messages based on recovery results
   */
  static getToastMessage(recoveryResult: RecoveryResult, validationResult: ValidationResult): ToastMessage {
    if (recoveryResult.success) {
      switch (recoveryResult.strategy) {
        case RecoveryStrategy.ATTEMPT_TOKEN_REFRESH:
          return {
            type: 'success',
            message: 'Email connection refreshed successfully'
          };

        case RecoveryStrategy.START_OAUTH:
          return {
            type: 'info',
            message: 'Reconnecting your email account for better reliability'
          };

        case RecoveryStrategy.MARK_DISCONNECTED:
          return {
            type: 'info',
            message: 'Email account needs to be reconnected'
          };

        default:
          return {
            type: 'success',
            message: 'Email account is already connected and working'
          };
      }
    } else {
      // Recovery failed
      return {
        type: 'info',
        message: 'Reconnecting your email account...'
      };
    }
  }

  /**
   * Log recovery statistics for monitoring and debugging
   */
  static logRecoveryStats(recoveryResult: RecoveryResult, validationResult: ValidationResult, store: Store): void {
    console.log(`=== RECOVERY STATISTICS ===`);
    console.log(`Store: ${store.id} (${store.email})`);
    console.log(`Platform: ${store.platform}`);
    console.log(`Original Error: ${validationResult.error}`);
    console.log(`Validation Level: ${validationResult.level}`);
    console.log(`Recovery Strategy: ${recoveryResult.strategy}`);
    console.log(`Recovery Success: ${recoveryResult.success}`);
    console.log(`Should Start OAuth: ${recoveryResult.shouldStartOAuth}`);
    console.log(`Validation Duration: ${validationResult.duration}ms`);
    console.log(`=== END RECOVERY STATISTICS ===`);
  }
} 