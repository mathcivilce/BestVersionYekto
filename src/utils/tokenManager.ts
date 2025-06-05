import { PublicClientApplication, AccountInfo } from '@azure/msal-browser';
import { createClient } from '@supabase/supabase-js';

interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  account: AccountInfo;
}

export class TokenManager {
  private msalInstance: PublicClientApplication;
  private supabase: any;
  private refreshInProgress = new Map<string, Promise<TokenInfo>>();

  constructor(msalInstance: PublicClientApplication) {
    this.msalInstance = msalInstance;
    this.supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL || '',
      import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    );
  }

  /**
   * Get a valid access token, automatically refreshing if needed
   */
  async getValidToken(storeId: string, account: AccountInfo, requiredScopes: string[]): Promise<string> {
    try {
      // First try to get token silently (from cache or refresh token)
      const tokenResponse = await this.msalInstance.acquireTokenSilent({
        scopes: requiredScopes,
        account
      });

      // Update database with new token info if successful
      if (tokenResponse.accessToken) {
        await this.updateTokenInDatabase(storeId, tokenResponse);
      }

      return tokenResponse.accessToken;
    } catch (error: any) {
      console.warn('Silent token acquisition failed, trying server-side refresh:', error);
      
      // If silent acquisition fails, try server-side refresh
      return await this.refreshTokenServerSide(storeId);
    }
  }

  /**
   * Refresh token using server-side Edge Function
   */
  private async refreshTokenServerSide(storeId: string): Promise<string> {
    // Check if refresh is already in progress for this store
    if (this.refreshInProgress.has(storeId)) {
      const result = await this.refreshInProgress.get(storeId)!;
      return result.accessToken;
    }

    // Start refresh process
    const refreshPromise = this.performTokenRefresh(storeId);
    this.refreshInProgress.set(storeId, refreshPromise);

    try {
      const result = await refreshPromise;
      return result.accessToken;
    } finally {
      this.refreshInProgress.delete(storeId);
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async performTokenRefresh(storeId: string): Promise<TokenInfo> {
    const { data: response, error } = await this.supabase.functions.invoke('refresh-tokens', {
      body: { storeId }
    });

    if (error) throw error;
    if (!response.success) throw new Error(response.error || 'Token refresh failed');

    const result = response.results.find((r: any) => r.storeId === storeId);
    if (!result || !result.success) {
      throw new Error(result?.error || 'Token refresh failed');
    }

    // Get updated store data
    const { data: store, error: storeError } = await this.supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    if (storeError) throw storeError;
    if (!store.access_token) throw new Error('No access token after refresh');

    return {
      accessToken: store.access_token,
      refreshToken: store.refresh_token,
      expiresAt: new Date(store.token_expires_at),
      account: null as any // Will be set by caller
    };
  }

  /**
   * Update token information in database
   */
  private async updateTokenInDatabase(storeId: string, tokenResponse: any): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenResponse.expiresOn ? 
      Math.floor((tokenResponse.expiresOn.getTime() - Date.now()) / 1000) : 3600));

    const updateData: any = {
      access_token: tokenResponse.accessToken,
      token_expires_at: expiresAt.toISOString(),
      token_last_refreshed: new Date().toISOString()
    };

    // MSAL doesn't always provide refresh tokens in the response
    // They're managed internally by MSAL
    if (tokenResponse.refreshToken) {
      updateData.refresh_token = tokenResponse.refreshToken;
    }

    await this.supabase
      .from('stores')
      .update(updateData)
      .eq('id', storeId);
  }

  /**
   * Check if a token is close to expiring (within 10 minutes)
   */
  isTokenExpiringSoon(expiresAt: string | Date): boolean {
    const expiration = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
    const tenMinutesFromNow = new Date();
    tenMinutesFromNow.setMinutes(tenMinutesFromNow.getMinutes() + 10);
    
    return expiration <= tenMinutesFromNow;
  }

  /**
   * Proactively refresh tokens that are expiring soon
   */
  async refreshExpiringSoon(): Promise<void> {
    try {
      const { data: response } = await this.supabase.functions.invoke('refresh-tokens', {
        body: { refreshAllExpiring: true }
      });

      if (response && response.refreshed > 0) {
        console.log(`Proactively refreshed ${response.refreshed} tokens`);
      }
    } catch (error) {
      console.warn('Failed to proactively refresh tokens:', error);
    }
  }

  /**
   * Start periodic token refresh (every 30 minutes)
   */
  startPeriodicRefresh(): () => void {
    const interval = setInterval(() => {
      this.refreshExpiringSoon();
    }, 30 * 60 * 1000); // 30 minutes

    // Return cleanup function
    return () => clearInterval(interval);
  }

  /**
   * Validate token by making a test API call
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get account info for a store email
   */
  getAccountForStore(storeEmail: string): AccountInfo | null {
    const accounts = this.msalInstance.getAllAccounts();
    return accounts.find(account => 
      account.username.toLowerCase() === storeEmail.toLowerCase()
    ) || null;
  }
} 