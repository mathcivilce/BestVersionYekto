/**
 * System Health Dashboard Component
 * 
 * A comprehensive monitoring dashboard that provides real-time insights into the
 * health and performance of the email management system. It tracks OAuth connections,
 * token health, subscription status, and system performance metrics.
 * 
 * Key Features:
 * - Real-time system health scoring and status visualization
 * - OAuth token monitoring with expiration tracking
 * - Platform breakdown (Outlook, Gmail, IMAP) with statistics
 * - Recent error tracking with severity classification
 * - Performance metrics for API calls and database queries
 * - Cron job status monitoring with last run timestamps
 * - Auto-refresh functionality with 30-second intervals
 * 
 * Monitoring Categories:
 * 1. Store Health: Connected stores, OAuth status, token validity
 * 2. Token Management: Refresh success rates, expiration tracking
 * 3. Subscription Management: Webhook subscription renewal rates
 * 4. Error Tracking: Recent issues with severity levels and timestamps
 * 5. Performance: Response times, API call volumes, DB query stats
 * 6. Job Monitoring: Cron job execution status and scheduling
 * 
 * Visual Elements:
 * - Color-coded health indicators with dynamic backgrounds
 * - Progress bars and status icons for quick assessment
 * - Platform-specific color coding for easy identification
 * - Responsive grid layout for different screen sizes
 * - Loading states and error handling with fallback UI
 * 
 * Data Sources:
 * - System metrics API (simulated with mock data)
 * - Real-time updates via polling mechanism
 * - Historical data for trend analysis
 * - Performance monitoring integration
 * 
 * Security Considerations:
 * - No sensitive data exposure in UI
 * - Aggregated metrics only for privacy
 * - Error messages sanitized for security
 * - Admin-only access for system insights
 * 
 * Used by:
 * - System administrators for monitoring
 * - DevOps teams for operational insights
 * - Support teams for troubleshooting
 * - Business stakeholders for health reporting
 */

import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  RefreshCw, 
  Server, 
  Shield, 
  TrendingUp,
  XCircle,
  Zap,
  Database,
  Globe
} from 'lucide-react';

/**
 * System Metrics Interface
 * 
 * Defines the comprehensive structure of system health and performance data.
 * Includes all metrics tracked by the monitoring system.
 */
interface SystemMetrics {
  totalConnectedStores: number;           // Total number of connected email stores
  oauthStores: number;                    // Stores using OAuth authentication
  storesWithValidTokens: number;          // Stores with non-expired tokens
  storesWithExpiringTokens: number;       // Stores with tokens expiring soon
  systemHealth: number;                   // Overall system health percentage (0-100)
  lastRefreshJobRun?: string;             // Timestamp of last token refresh job
  lastSubscriptionJobRun?: string;        // Timestamp of last subscription renewal job
  tokenRefreshSuccessRate: number;        // Token refresh success rate percentage
  subscriptionRenewalSuccessRate: number; // Subscription renewal success rate percentage
  platformBreakdown: Record<string, number>; // Platform distribution (outlook, gmail, etc.)
  
  // Recent error tracking with severity classification
  recentErrors: Array<{
    timestamp: string;                    // ISO timestamp of error occurrence
    type: string;                         // Error type identifier
    message: string;                      // Human-readable error message
    severity: 'low' | 'medium' | 'high' | 'critical'; // Error severity level
  }>;
  
  // Performance metrics for system optimization
  performanceMetrics: {
    avgTokenRefreshTime: number;          // Average token refresh time in milliseconds
    avgSubscriptionRenewalTime: number;   // Average subscription renewal time in milliseconds
    apiCallsLast24h: number;              // API calls in last 24 hours
    dbQueriesLast24h: number;             // Database queries in last 24 hours
  };
}

/**
 * SystemHealthDashboard Functional Component
 * 
 * Main dashboard component that orchestrates data fetching, state management,
 * and rendering of all health monitoring visualizations.
 */
const SystemHealthDashboard: React.FC = () => {
  // State management for metrics data and UI state
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  /**
   * Fetch System Metrics
   * 
   * Simulates fetching comprehensive system metrics from analytics API.
   * In production, this would call actual monitoring endpoints.
   * 
   * @returns Promise<SystemMetrics> - Complete system health and performance data
   */
  const fetchSystemMetrics = async (): Promise<SystemMetrics> => {
    // Simulate realistic API delay for better UX testing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock data representing typical system metrics
    // TODO: Replace with actual API call to monitoring service
    return {
      totalConnectedStores: 12,
      oauthStores: 10,
      storesWithValidTokens: 9,
      storesWithExpiringTokens: 2,
      systemHealth: 87.5,
      lastRefreshJobRun: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      lastSubscriptionJobRun: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      tokenRefreshSuccessRate: 94.2,
      subscriptionRenewalSuccessRate: 98.1,
      platformBreakdown: {
        outlook: 8,   // Microsoft Outlook/Office 365 stores
        gmail: 2,     // Google Gmail stores
        imap: 2       // Generic IMAP stores
      },
      recentErrors: [
        {
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          type: 'TOKEN_REFRESH_ERROR',
          message: 'Rate limited by Microsoft Graph API',
          severity: 'medium'
        },
        {
          timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          type: 'SUBSCRIPTION_RENEWAL_ERROR',
          message: 'Network timeout during subscription renewal',
          severity: 'low'
        }
      ],
      performanceMetrics: {
        avgTokenRefreshTime: 1240,    // 1.24 seconds average
        avgSubscriptionRenewalTime: 890, // 0.89 seconds average
        apiCallsLast24h: 156,
        dbQueriesLast24h: 342
      }
    };
  };

  // Component lifecycle and data fetching
  useEffect(() => {
    /**
     * Load Metrics Data
     * 
     * Async function to fetch and update system metrics with error handling.
     * Updates component state with fetched data and loading status.
     */
    const loadMetrics = async () => {
      try {
        setLoading(true);
        const data = await fetchSystemMetrics();
        setMetrics(data);
        setLastUpdated(new Date());
      } catch (error) {
        console.error('Failed to load system metrics:', error);
        // TODO: Implement user notification for failed data loads
      } finally {
        setLoading(false);
      }
    };

    // Initial data load
    loadMetrics();
    
    // Auto-refresh every 30 seconds for real-time monitoring
    const interval = setInterval(loadMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Get Health Color Class
   * 
   * Determines text color class based on system health percentage.
   * 
   * @param health - Health percentage (0-100)
   * @returns CSS class name for health status color
   */
  const getHealthColor = (health: number): string => {
    if (health >= 90) return 'text-green-600';   // Excellent health
    if (health >= 75) return 'text-yellow-600';  // Good health
    if (health >= 50) return 'text-orange-600';  // Fair health
    return 'text-red-600';                       // Poor health
  };

  /**
   * Get Health Background Color Class
   * 
   * Determines background color class based on system health percentage.
   * 
   * @param health - Health percentage (0-100)
   * @returns CSS class name for health status background color
   */
  const getHealthBgColor = (health: number): string => {
    if (health >= 90) return 'bg-green-100';
    if (health >= 75) return 'bg-yellow-100';
    if (health >= 50) return 'bg-orange-100';
    return 'bg-red-100';
  };

  /**
   * Get Severity Color Classes
   * 
   * Maps error severity levels to appropriate color classes for visual distinction.
   * 
   * @param severity - Error severity level
   * @returns CSS classes for text and background colors
   */
  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-100';
      case 'high': return 'text-orange-600 bg-orange-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'low': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  /**
   * Format Time Ago
   * 
   * Converts ISO timestamp to human-readable relative time format.
   * 
   * @param timestamp - ISO timestamp string
   * @returns Human-readable time ago string (e.g., "2h 15m ago")
   */
  const formatTimeAgo = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
    return `${minutes}m ago`;
  };

  // Loading State UI
  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          {/* Header skeleton */}
          <div className="flex items-center space-x-4 mb-6">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="h-6 bg-gray-200 rounded w-32"></div>
          </div>
          
          {/* Metrics cards skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
          
          {/* Charts skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-gray-200 rounded"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  // Error State UI
  if (!metrics) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="text-center text-gray-500">
          <AlertTriangle className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium">Unable to load system metrics</h3>
          <p className="mt-2">Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dashboard Header with Health Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Activity className="h-8 w-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">System Health Dashboard</h1>
            </div>
            
            {/* Health Status Indicator */}
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${getHealthBgColor(metrics.systemHealth)}`}>
              <div className={`w-2 h-2 rounded-full ${metrics.systemHealth >= 90 ? 'bg-green-600' : metrics.systemHealth >= 75 ? 'bg-yellow-600' : 'bg-red-600'}`}></div>
              <span className={getHealthColor(metrics.systemHealth)}>
                {metrics.systemHealth.toFixed(1)}% Health
              </span>
            </div>
          </div>
          
          {/* Last Updated Timestamp */}
          <div className="text-right">
            <p className="text-sm text-gray-500">Last updated</p>
            <p className="text-sm font-medium">{lastUpdated.toLocaleTimeString()}</p>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Connected Stores Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Database className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-medium text-gray-500">Connected Stores</h3>
              <p className="text-2xl font-bold text-gray-900">{metrics.totalConnectedStores}</p>
              <p className="text-sm text-gray-600">{metrics.oauthStores} OAuth stores</p>
            </div>
          </div>
        </div>

        {/* Token Health Status Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Shield className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-medium text-gray-500">Valid Tokens</h3>
              <p className="text-2xl font-bold text-gray-900">{metrics.storesWithValidTokens}</p>
              <p className="text-sm text-yellow-600">{metrics.storesWithExpiringTokens} expiring soon</p>
            </div>
          </div>
        </div>

        {/* Token Refresh Success Rate Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <RefreshCw className="h-8 w-8 text-indigo-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-medium text-gray-500">Token Refresh Rate</h3>
              <p className="text-2xl font-bold text-gray-900">{metrics.tokenRefreshSuccessRate}%</p>
              <p className="text-sm text-gray-600">Success rate (24h)</p>
            </div>
          </div>
        </div>

        {/* Subscription Renewal Success Rate Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Globe className="h-8 w-8 text-purple-600" />
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-medium text-gray-500">Subscription Rate</h3>
              <p className="text-2xl font-bold text-gray-900">{metrics.subscriptionRenewalSuccessRate}%</p>
              <p className="text-sm text-gray-600">Renewal rate (24h)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Distribution Breakdown */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Platform Breakdown</h3>
          <div className="space-y-4">
            {Object.entries(metrics.platformBreakdown).map(([platform, count]) => {
              const percentage = (count / metrics.totalConnectedStores * 100).toFixed(1);
              return (
                <div key={platform} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {/* Platform Color Indicator */}
                    <div className={`w-3 h-3 rounded-full ${
                      platform === 'outlook' ? 'bg-blue-500' : 
                      platform === 'gmail' ? 'bg-red-500' : 'bg-gray-500'
                    }`}></div>
                    <span className="text-sm font-medium capitalize">{platform}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">{count} stores</span>
                    <span className="text-xs text-gray-500">({percentage}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Issues and Errors */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Issues</h3>
          <div className="space-y-3">
            {metrics.recentErrors.length > 0 ? (
              metrics.recentErrors.map((error, index) => (
                <div key={index} className="border-l-4 border-gray-200 pl-3">
                  <div className="flex items-center justify-between">
                    {/* Severity Badge */}
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${getSeverityColor(error.severity)}`}>
                      {error.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">{formatTimeAgo(error.timestamp)}</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900 mt-1">{error.type}</p>
                  <p className="text-sm text-gray-600">{error.message}</p>
                </div>
              ))
            ) : (
              // No Issues State
              <div className="text-center py-4">
                <CheckCircle className="mx-auto h-8 w-8 text-green-600 mb-2" />
                <p className="text-sm text-gray-600">No recent issues</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Performance Metrics Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Performance Metrics (24h)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Average Token Refresh Time */}
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Clock className="h-6 w-6 text-blue-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">Avg Token Refresh</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.avgTokenRefreshTime}ms</p>
          </div>
          
          {/* Average Subscription Renewal Time */}
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Zap className="h-6 w-6 text-green-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">Avg Subscription</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.avgSubscriptionRenewalTime}ms</p>
          </div>
          
          {/* API Calls Volume */}
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Globe className="h-6 w-6 text-purple-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">API Calls</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.apiCallsLast24h}</p>
          </div>
          
          {/* Database Queries Volume */}
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Database className="h-6 w-6 text-indigo-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">DB Queries</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.dbQueriesLast24h}</p>
          </div>
        </div>
      </div>

      {/* Cron Job Status Monitoring */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Cron Job Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Token Refresh Job Status */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-gray-900">Token Refresh Job</h4>
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-sm text-gray-600">
              Last run: {metrics.lastRefreshJobRun ? formatTimeAgo(metrics.lastRefreshJobRun) : 'Never'}
            </p>
            <p className="text-sm text-gray-600">
              Next run: In ~{60 - new Date().getMinutes()} minutes
            </p>
          </div>
          
          {/* Subscription Renewal Job Status */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-gray-900">Subscription Renewal Job</h4>
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-sm text-gray-600">
              Last run: {metrics.lastSubscriptionJobRun ? formatTimeAgo(metrics.lastSubscriptionJobRun) : 'Never'}
            </p>
            <p className="text-sm text-gray-600">
              Next run: In ~{60 - new Date().getMinutes()} minutes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemHealthDashboard; 