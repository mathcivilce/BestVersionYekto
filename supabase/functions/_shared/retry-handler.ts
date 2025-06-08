// =============================================
// ADVANCED RETRY & ERROR HANDLING SYSTEM
// =============================================
// Implements exponential backoff, circuit breaker patterns,
// and intelligent retry strategies for robust error handling

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
  jitterMs: number;
  retryableErrorCodes: string[];
  circuitBreakerThreshold: number;
  circuitBreakerTimeoutMs: number;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attemptsUsed: number;
  totalTimeMs: number;
  circuitBreakerTriggered: boolean;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

// Default retry configurations for different operation types
export const RETRY_CONFIGS: Record<string, RetryConfig> = {
  oauth_token_refresh: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    exponentialBase: 2,
    jitterMs: 500,
    retryableErrorCodes: ['NETWORK_ERROR', 'RATE_LIMITED', 'TEMPORARY_UNAVAILABLE', 'TIMEOUT'],
    circuitBreakerThreshold: 5,
    circuitBreakerTimeoutMs: 300000 // 5 minutes
  },
  
  subscription_renewal: {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    exponentialBase: 2,
    jitterMs: 1000,
    retryableErrorCodes: ['NETWORK_ERROR', 'RATE_LIMITED', 'TEMPORARY_UNAVAILABLE'],
    circuitBreakerThreshold: 3,
    circuitBreakerTimeoutMs: 600000 // 10 minutes
  },
  
  database_operation: {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    exponentialBase: 2,
    jitterMs: 200,
    retryableErrorCodes: ['CONNECTION_ERROR', 'TIMEOUT', 'TEMPORARY_ERROR'],
    circuitBreakerThreshold: 10,
    circuitBreakerTimeoutMs: 60000 // 1 minute
  },
  
  api_call: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    exponentialBase: 2,
    jitterMs: 300,
    retryableErrorCodes: ['NETWORK_ERROR', 'RATE_LIMITED', 'TIMEOUT'],
    circuitBreakerThreshold: 5,
    circuitBreakerTimeoutMs: 180000 // 3 minutes
  }
};

export class AdvancedRetryHandler {
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private config: RetryConfig;
  private operationType: string;

  constructor(operationType: string, customConfig?: Partial<RetryConfig>) {
    this.operationType = operationType;
    this.config = {
      ...RETRY_CONFIGS[operationType] || RETRY_CONFIGS.api_call,
      ...customConfig
    };
  }

  // Main retry method with comprehensive error handling
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string = ''
  ): Promise<RetryResult<T>> {
    const startTime = performance.now();
    let lastError: Error | null = null;
    let attemptsUsed = 0;

    // Check circuit breaker state
    const circuitBreakerId = `${this.operationType}_${context}`;
    if (this.isCircuitBreakerOpen(circuitBreakerId)) {
      return {
        success: false,
        error: new Error(`Circuit breaker is OPEN for ${this.operationType}. Failing fast.`),
        attemptsUsed: 0,
        totalTimeMs: performance.now() - startTime,
        circuitBreakerTriggered: true
      };
    }

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      attemptsUsed = attempt + 1;

      try {
        console.log(`🔄 [${this.operationType}] Attempt ${attemptsUsed}/${this.config.maxRetries + 1}: ${context}`);
        
        const result = await this.executeWithTimeout(operation);
        
        // Success - reset circuit breaker
        this.resetCircuitBreaker(circuitBreakerId);
        
        console.log(`✅ [${this.operationType}] Success on attempt ${attemptsUsed}: ${context}`);
        return {
          success: true,
          result,
          attemptsUsed,
          totalTimeMs: performance.now() - startTime,
          circuitBreakerTriggered: false
        };

      } catch (error) {
        lastError = error;
        attemptsUsed = attempt + 1;
        
        console.warn(`⚠️  [${this.operationType}] Attempt ${attemptsUsed} failed: ${error.message}`);
        
        // Check if error is retryable
        const errorCode = this.categorizeError(error);
        const isRetryable = this.isErrorRetryable(errorCode);
        const shouldCircuitBreak = this.shouldTriggerCircuitBreaker(error);
        
        if (shouldCircuitBreak) {
          this.triggerCircuitBreaker(circuitBreakerId);
        }
        
        // If this was the last attempt or error is not retryable, stop trying
        if (attempt === this.config.maxRetries || !isRetryable) {
          console.error(`❌ [${this.operationType}] Final failure after ${attemptsUsed} attempts: ${error.message}`);
          break;
        }
        
        // Wait before retry with exponential backoff + jitter
        const delay = this.calculateRetryDelay(attempt);
        console.log(`⏳ [${this.operationType}] Waiting ${delay}ms before retry...`);
        await this.delay(delay);
      }
    }

    return {
      success: false,
      error: lastError || new Error('Unknown error'),
      attemptsUsed,
      totalTimeMs: performance.now() - startTime,
      circuitBreakerTriggered: false
    };
  }

  // Execute operation with timeout
  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    const timeoutMs = this.config.maxDelayMs; // Use maxDelay as timeout
    
    return Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
      })
    ]);
  }

  // Categorize errors for better handling
  private categorizeError(error: any): string {
    const message = error.message?.toLowerCase() || '';
    
    if (message.includes('network') || message.includes('fetch')) {
      return 'NETWORK_ERROR';
    }
    if (message.includes('timeout') || message.includes('TIMEOUT')) {
      return 'TIMEOUT';
    }
    if (message.includes('rate limit') || error.status === 429) {
      return 'RATE_LIMITED';
    }
    if (error.status >= 500 && error.status < 600) {
      return 'SERVER_ERROR';
    }
    if (error.status >= 400 && error.status < 500) {
      return 'CLIENT_ERROR';
    }
    if (message.includes('invalid_grant')) {
      return 'INVALID_GRANT';
    }
    if (message.includes('connection')) {
      return 'CONNECTION_ERROR';
    }
    
    return 'UNKNOWN_ERROR';
  }

  // Check if error type is retryable
  private isErrorRetryable(errorCode: string): boolean {
    return this.config.retryableErrorCodes.includes(errorCode);
  }

  // Calculate retry delay with exponential backoff and jitter
  private calculateRetryDelay(attemptIndex: number): number {
    const exponentialDelay = this.config.baseDelayMs * 
      Math.pow(this.config.exponentialBase, attemptIndex);
    
    const jitter = Math.random() * this.config.jitterMs;
    const totalDelay = Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
    
    return Math.floor(totalDelay);
  }

  // Simple delay utility
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Circuit breaker logic
  private isCircuitBreakerOpen(breakerId: string): boolean {
    const state = this.circuitBreakers.get(breakerId);
    if (!state) return false;

    const now = Date.now();
    
    if (state.state === 'open') {
      // Check if timeout has elapsed
      if (now - state.lastFailureTime > this.config.circuitBreakerTimeoutMs) {
        // Move to half-open state
        state.state = 'half-open';
        console.log(`🔄 Circuit breaker moving to HALF-OPEN: ${breakerId}`);
        return false;
      }
      return true;
    }
    
    return false;
  }

  private shouldTriggerCircuitBreaker(error: any): boolean {
    // Trigger circuit breaker for severe errors
    const errorCode = this.categorizeError(error);
    return ['SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT'].includes(errorCode);
  }

  private triggerCircuitBreaker(breakerId: string): void {
    const state = this.circuitBreakers.get(breakerId) || {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed' as const
    };

    state.failures++;
    state.lastFailureTime = Date.now();

    if (state.failures >= this.config.circuitBreakerThreshold) {
      state.state = 'open';
      console.error(`🚨 Circuit breaker OPENED: ${breakerId} (${state.failures} failures)`);
    }

    this.circuitBreakers.set(breakerId, state);
  }

  private resetCircuitBreaker(breakerId: string): void {
    const state = this.circuitBreakers.get(breakerId);
    if (state && state.state !== 'closed') {
      console.log(`✅ Circuit breaker CLOSED: ${breakerId}`);
      this.circuitBreakers.set(breakerId, {
        failures: 0,
        lastFailureTime: 0,
        state: 'closed'
      });
    }
  }

  // Get circuit breaker status for monitoring
  getCircuitBreakerStatus(): Map<string, CircuitBreakerState> {
    return new Map(this.circuitBreakers);
  }

  // Fallback strategy factory
  static createFallbackStrategy<T>(
    primaryOperation: () => Promise<T>,
    fallbackOperation: () => Promise<T>,
    fallbackCondition: (error: any) => boolean = () => true
  ): () => Promise<T> {
    return async () => {
      try {
        return await primaryOperation();
      } catch (error) {
        if (fallbackCondition(error)) {
          console.warn(`🔄 Primary operation failed, using fallback: ${error.message}`);
          return await fallbackOperation();
        }
        throw error;
      }
    };
  }
}

// Specialized retry handlers for common scenarios
export class OAuthRetryHandler extends AdvancedRetryHandler {
  constructor() {
    super('oauth_token_refresh');
  }

  // OAuth-specific retry logic with token validation
  async refreshTokenWithRetry(
    refreshOperation: () => Promise<any>,
    storeInfo: { id: string; name: string; platform: string }
  ): Promise<RetryResult<any>> {
    const context = `${storeInfo.platform} token refresh for ${storeInfo.name}`;
    
    return this.executeWithRetry(async () => {
      const result = await refreshOperation();
      
      // Validate token response
      if (!result.access_token) {
        throw new Error('Invalid token response: missing access_token');
      }
      
      if (!result.expires_in || result.expires_in <= 0) {
        throw new Error('Invalid token response: invalid expires_in value');
      }
      
      return result;
    }, context);
  }
}

export class SubscriptionRetryHandler extends AdvancedRetryHandler {
  constructor() {
    super('subscription_renewal');
  }

  // Subscription-specific retry with validation
  async renewSubscriptionWithRetry(
    renewOperation: () => Promise<any>,
    subscriptionInfo: { storeId: string; storeName: string }
  ): Promise<RetryResult<any>> {
    const context = `Subscription renewal for ${subscriptionInfo.storeName}`;
    
    return this.executeWithRetry(async () => {
      const result = await renewOperation();
      
      // Validate subscription response
      if (!result.id) {
        throw new Error('Invalid subscription response: missing subscription id');
      }
      
      return result;
    }, context);
  }
}

// Error recovery strategies
export class ErrorRecoveryStrategies {
  // Strategy for handling OAuth token errors
  static async handleOAuthError(
    error: any,
    store: any,
    supabase: any
  ): Promise<{ action: string; shouldRetry: boolean; disconnectStore: boolean }> {
    const errorCode = error.message?.toLowerCase() || '';
    
    if (errorCode.includes('invalid_grant')) {
      // Refresh token is invalid - user needs to reconnect
      return {
        action: 'disconnect_store_invalid_token',
        shouldRetry: false,
        disconnectStore: true
      };
    }
    
    if (errorCode.includes('unauthorized') || errorCode.includes('403')) {
      // Permissions revoked - disconnect store
      return {
        action: 'disconnect_store_permissions_revoked',
        shouldRetry: false,
        disconnectStore: true
      };
    }
    
    if (errorCode.includes('rate limit') || errorCode.includes('429')) {
      // Rate limited - retry with exponential backoff
      return {
        action: 'rate_limited_retry_later',
        shouldRetry: true,
        disconnectStore: false
      };
    }
    
    if (errorCode.includes('network') || errorCode.includes('timeout')) {
      // Network issue - retry
      return {
        action: 'network_error_retry',
        shouldRetry: true,
        disconnectStore: false
      };
    }
    
    // Unknown error - mark as issue but don't disconnect
    return {
      action: 'unknown_error_mark_issue',
      shouldRetry: true,
      disconnectStore: false
    };
  }

  // Strategy for handling subscription errors
  static async handleSubscriptionError(
    error: any,
    store: any
  ): Promise<{ action: string; shouldRetry: boolean; skipStore: boolean }> {
    const errorCode = error.message?.toLowerCase() || '';
    
    if (errorCode.includes('not found') || errorCode.includes('404')) {
      // Subscription doesn't exist - skip this store
      return {
        action: 'subscription_not_found_skip',
        shouldRetry: false,
        skipStore: true
      };
    }
    
    if (errorCode.includes('unauthorized')) {
      // Token expired - should be handled by token refresh first
      return {
        action: 'unauthorized_refresh_token_first',
        shouldRetry: true,
        skipStore: false
      };
    }
    
    if (errorCode.includes('quota') || errorCode.includes('limit')) {
      // API quota exceeded - retry later
      return {
        action: 'quota_exceeded_retry_later',
        shouldRetry: true,
        skipStore: false
      };
    }
    
    // Generic error - retry
    return {
      action: 'generic_error_retry',
      shouldRetry: true,
      skipStore: false
    };
  }
} 