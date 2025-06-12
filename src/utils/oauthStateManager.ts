/**
 * OAuth State Manager
 * 
 * Manages OAuth flow state, duplicate detection, and provides utilities for
 * tracking and managing OAuth connection attempts across the application.
 * 
 * Key Features:
 * - Track active OAuth attempts to prevent concurrent flows
 * - Advanced duplicate detection with fuzzy matching
 * - OAuth flow state persistence and cleanup
 * - Integration with health validation system
 * - Comprehensive logging for debugging
 * 
 * Design Principles:
 * - Prevent multiple OAuth flows for same email simultaneously
 * - Provide clear feedback about connection attempts
 * - Integrate seamlessly with existing validation system
 * - Maintain user experience consistency
 */

import { createClient } from '@supabase/supabase-js';
import { Store } from './connectionHealthValidator';

export interface OAuthAttempt {
  id: string;
  email?: string;
  platform: 'outlook' | 'gmail';
  storeName: string;
  userId: string;
  businessId: string;
  startTime: Date;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  stateParam?: string;
}

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  existingStore?: Store;
  isActiveOAuth?: boolean;
  shouldProceed: boolean;
  recommendedAction: 'proceed' | 'wait' | 'use_existing' | 'cancel_and_retry';
  message?: string;
}

export class OAuthStateManager {
  private supabase: any;
  private activeAttempts: Map<string, OAuthAttempt> = new Map();

  constructor() {
    this.supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL || '',
      import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    );
    
    // Clear stale attempts on initialization (important for page reloads)
    this.initializeAndCleanup();
  }

  /**
   * Initialize the OAuth state manager and clean up any stale attempts
   */
  private async initializeAndCleanup(): Promise<void> {
    try {
      console.log('🔧 Initializing OAuth State Manager...');
      
      // Clean up any expired attempts from memory
      this.cleanupExpiredAttempts();
      
      // Start the cleanup interval
      this.startCleanupInterval();
      
      console.log('✅ OAuth State Manager initialized');
    } catch (error) {
      console.error('Failed to initialize OAuth State Manager:', error);
    }
  }

  /**
   * Register a new OAuth attempt
   */
  registerOAuthAttempt(attempt: Omit<OAuthAttempt, 'id' | 'startTime' | 'status'>): string {
    // First, clean up any stale attempts
    this.cleanupExpiredAttempts();
    
    const attemptId = `oauth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const oauthAttempt: OAuthAttempt = {
      ...attempt,
      id: attemptId,
      startTime: new Date(),
      status: 'pending'
    };

    this.activeAttempts.set(attemptId, oauthAttempt);
    
    console.log('=== OAUTH ATTEMPT REGISTERED ===');
    console.log(`Attempt ID: ${attemptId}`);
    console.log(`Platform: ${attempt.platform}`);
    console.log(`User: ${attempt.userId}`);
    console.log(`Store Name: ${attempt.storeName}`);
    console.log(`Active Attempts: ${this.activeAttempts.size}`);

    return attemptId;
  }

  /**
   * Update OAuth attempt status
   */
  updateOAuthAttempt(attemptId: string, status: OAuthAttempt['status'], email?: string): void {
    const attempt = this.activeAttempts.get(attemptId);
    if (attempt) {
      attempt.status = status;
      if (email) {
        attempt.email = email;
      }
      
      console.log(`OAuth attempt ${attemptId} status updated to: ${status}`);
      
      // Clean up completed/failed attempts immediately to prevent false positives
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        // Small delay to allow any logging, then clean up
        setTimeout(() => {
          this.activeAttempts.delete(attemptId);
          console.log(`Cleaned up OAuth attempt: ${attemptId}`);
        }, 1000); // 1 second delay instead of 5 minutes
      }
    }
  }

  /**
   * Check for concurrent OAuth attempts for the same user/platform
   * Enhanced with better stale attempt detection
   */
  checkConcurrentAttempts(userId: string, platform: string, excludeAttemptId?: string): OAuthAttempt[] {
    // Clean up expired attempts first
    this.cleanupExpiredAttempts();
    
    const concurrent = Array.from(this.activeAttempts.values()).filter(attempt => 
      attempt.userId === userId && 
      attempt.platform === platform && 
      attempt.status === 'pending' &&
      (!excludeAttemptId || attempt.id !== excludeAttemptId) // Exclude current attempt
    );

    if (concurrent.length > 0) {
      console.log(`Found ${concurrent.length} concurrent OAuth attempts for user ${userId} on ${platform}`);
      
      // Log details for debugging
      concurrent.forEach(attempt => {
        const age = Date.now() - attempt.startTime.getTime();
        console.log(`  - Attempt ${attempt.id}: ${age}ms old`);
      });
    }

    return concurrent;
  }

  /**
   * Advanced duplicate detection with multiple strategies
   */
  async performAdvancedDuplicateCheck(
    email: string | undefined, 
    platform: string, 
    userId: string,
    storeName: string,
    currentAttemptId?: string
  ): Promise<DuplicateCheckResult> {
    console.log('=== ADVANCED DUPLICATE CHECK START ===');
    console.log(`Email: ${email || 'unknown'}`);
    console.log(`Platform: ${platform}`);
    console.log(`User: ${userId}`);
    console.log(`Store Name: ${storeName}`);

    try {
      // Strategy 1: Exact email match (most reliable)
      if (email) {
        const exactMatch = await this.findExactEmailMatch(email, userId);
        if (exactMatch) {
          console.log('✅ Found exact email match');
          return {
            hasDuplicate: true,
            existingStore: exactMatch,
            shouldProceed: false, // Health validation will determine if OAuth needed
            recommendedAction: 'use_existing',
            message: `Email account ${email} is already connected`
          };
        }
      }

      // Strategy 2: Check for active OAuth attempts
      const concurrentAttempts = this.checkConcurrentAttempts(userId, platform, currentAttemptId);
      if (concurrentAttempts.length > 0) {
        const recentAttempt = concurrentAttempts[0];
        const timeElapsed = Date.now() - recentAttempt.startTime.getTime();
        
        // Only block if attempt is very recent (less than 30 seconds)
        // This prevents false positives from page reloads while still catching genuine concurrent attempts
        if (timeElapsed < 30 * 1000) { // Less than 30 seconds (much more lenient)
          console.log('⚠️ Found very recent concurrent OAuth attempt');
          return {
            hasDuplicate: false,
            isActiveOAuth: true,
            shouldProceed: false,
            recommendedAction: 'wait',
            message: 'Another OAuth connection is in progress. Please wait a moment.'
          };
        } else {
          // If attempt is older than 30 seconds, clean it up and proceed
          console.log('🧹 Found stale OAuth attempt, cleaning up and proceeding');
          this.activeAttempts.delete(recentAttempt.id);
        }
      }

      // Strategy 3: Fuzzy name matching (detect user typos/variations)
      const nameMatches = await this.findSimilarStoreNames(storeName, platform, userId);
      if (nameMatches.length > 0) {
        console.log(`Found ${nameMatches.length} stores with similar names`);
        // This is just a warning, not a blocker
      }

      // Strategy 4: Platform connection count check
      const platformCount = await this.countPlatformConnections(platform, userId);
      if (platformCount >= 3) { // Reasonable limit
        console.log(`⚠️ User has ${platformCount} ${platform} connections (approaching limit)`);
      }

      console.log('✅ No blocking duplicates found, OAuth can proceed');
      return {
        hasDuplicate: false,
        shouldProceed: true,
        recommendedAction: 'proceed',
        message: email ? `Ready to connect ${email}` : 'Ready to connect email account'
      };

    } catch (error: any) {
      console.error('Advanced duplicate check error:', error);
      
      // Fail safely - allow OAuth to proceed
      return {
        hasDuplicate: false,
        shouldProceed: true,
        recommendedAction: 'proceed',
        message: 'Duplicate check failed, proceeding with connection'
      };
    } finally {
      console.log('=== ADVANCED DUPLICATE CHECK COMPLETE ===');
    }
  }

  /**
   * Find exact email match in existing stores
   */
  private async findExactEmailMatch(email: string, userId: string): Promise<Store | null> {
    try {
      const { data: store, error } = await this.supabase
        .from('stores')
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') { // Not "no rows found"
        throw error;
      }

      return store || null;
    } catch (error) {
      console.error('Error finding exact email match:', error);
      return null;
    }
  }

  /**
   * Find stores with similar names (fuzzy matching)
   */
  private async findSimilarStoreNames(storeName: string, platform: string, userId: string): Promise<Store[]> {
    try {
      const { data: stores, error } = await this.supabase
        .from('stores')
        .select('*')
        .eq('platform', platform)
        .eq('user_id', userId);

      if (error) {
        throw error;
      }

      // Simple fuzzy matching - can be enhanced with more sophisticated algorithms
      const similar = stores?.filter(store => {
        const similarity = this.calculateNameSimilarity(storeName.toLowerCase(), store.name.toLowerCase());
        return similarity > 0.8; // 80% similarity threshold
      }) || [];

      return similar;
    } catch (error) {
      console.error('Error finding similar store names:', error);
      return [];
    }
  }

  /**
   * Count existing connections for a platform
   */
  private async countPlatformConnections(platform: string, userId: string): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('stores')
        .select('*', { count: 'exact', head: true })
        .eq('platform', platform)
        .eq('user_id', userId)
        .eq('connected', true);

      if (error) {
        throw error;
      }

      return count || 0;
    } catch (error) {
      console.error('Error counting platform connections:', error);
      return 0;
    }
  }

  /**
   * Simple string similarity calculation (Levenshtein-inspired)
   */
  private calculateNameSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    // Simple similarity based on common characters and length
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const matches = shorter.split('').filter(char => longer.includes(char)).length;
    return matches / longer.length;
  }

  /**
   * Get active OAuth attempts summary for debugging
   */
  getActiveAttemptsSummary(): { total: number; byPlatform: Record<string, number>; byStatus: Record<string, number> } {
    const attempts = Array.from(this.activeAttempts.values());
    
    const byPlatform: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    
    attempts.forEach(attempt => {
      byPlatform[attempt.platform] = (byPlatform[attempt.platform] || 0) + 1;
      byStatus[attempt.status] = (byStatus[attempt.status] || 0) + 1;
    });

    return {
      total: attempts.length,
      byPlatform,
      byStatus
    };
  }

  /**
   * Clean up expired OAuth attempts
   * Enhanced to be more aggressive with cleanup
   */
  cleanupExpiredAttempts(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    this.activeAttempts.forEach((attempt, id) => {
      const age = now - attempt.startTime.getTime();
      const maxAge = 5 * 60 * 1000; // 5 minutes (reduced from 10)

      // More aggressive cleanup: also clean up attempts older than 5 minutes regardless of status
      if (age > maxAge) {
        expiredIds.push(id);
      }
    });

    expiredIds.forEach(id => {
      this.activeAttempts.delete(id);
      console.log(`Cleaned up expired OAuth attempt: ${id}`);
    });

    if (expiredIds.length > 0) {
      console.log(`Cleaned up ${expiredIds.length} expired OAuth attempts`);
    }
  }

  /**
   * Initialize cleanup interval
   */
  startCleanupInterval(): () => void {
    const interval = setInterval(() => {
      this.cleanupExpiredAttempts();
    }, 2 * 60 * 1000); // Every 2 minutes (more frequent)

    return () => clearInterval(interval);
  }

  /**
   * Force clear all attempts (for debugging/testing)
   */
  clearAllAttempts(): void {
    const count = this.activeAttempts.size;
    this.activeAttempts.clear();
    console.log(`🧹 Force cleared ${count} OAuth attempts`);
  }
} 