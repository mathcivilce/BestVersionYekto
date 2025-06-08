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

interface SystemMetrics {
  totalConnectedStores: number;
  oauthStores: number;
  storesWithValidTokens: number;
  storesWithExpiringTokens: number;
  systemHealth: number;
  lastRefreshJobRun?: string;
  lastSubscriptionJobRun?: string;
  tokenRefreshSuccessRate: number;
  subscriptionRenewalSuccessRate: number;
  platformBreakdown: Record<string, number>;
  recentErrors: Array<{
    timestamp: string;
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  performanceMetrics: {
    avgTokenRefreshTime: number;
    avgSubscriptionRenewalTime: number;
    apiCallsLast24h: number;
    dbQueriesLast24h: number;
  };
}

const SystemHealthDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Simulated data fetch - in real implementation, this would call your analytics API
  const fetchSystemMetrics = async (): Promise<SystemMetrics> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock data - replace with actual API call
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
        outlook: 8,
        gmail: 2,
        imap: 2
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
        avgTokenRefreshTime: 1240,
        avgSubscriptionRenewalTime: 890,
        apiCallsLast24h: 156,
        dbQueriesLast24h: 342
      }
    };
  };

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        setLoading(true);
        const data = await fetchSystemMetrics();
        setMetrics(data);
        setLastUpdated(new Date());
      } catch (error) {
        console.error('Failed to load system metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMetrics();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const getHealthColor = (health: number): string => {
    if (health >= 90) return 'text-green-600';
    if (health >= 75) return 'text-yellow-600';
    if (health >= 50) return 'text-orange-600';
    return 'text-red-600';
  };

  const getHealthBgColor = (health: number): string => {
    if (health >= 90) return 'bg-green-100';
    if (health >= 75) return 'bg-yellow-100';
    if (health >= 50) return 'bg-orange-100';
    return 'bg-red-100';
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-100';
      case 'high': return 'text-orange-600 bg-orange-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'low': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const formatTimeAgo = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
    return `${minutes}m ago`;
  };

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          <div className="flex items-center space-x-4 mb-6">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="h-6 bg-gray-200 rounded w-32"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-gray-200 rounded"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

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
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Activity className="h-8 w-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">System Health Dashboard</h1>
            </div>
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium ${getHealthBgColor(metrics.systemHealth)}`}>
              <div className={`w-2 h-2 rounded-full ${metrics.systemHealth >= 90 ? 'bg-green-600' : metrics.systemHealth >= 75 ? 'bg-yellow-600' : 'bg-red-600'}`}></div>
              <span className={getHealthColor(metrics.systemHealth)}>
                {metrics.systemHealth.toFixed(1)}% Health
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500">Last updated</p>
            <p className="text-sm font-medium">{lastUpdated.toLocaleTimeString()}</p>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Stores */}
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

        {/* Token Health */}
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

        {/* Token Refresh Success Rate */}
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

        {/* Subscription Success Rate */}
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
        {/* Platform Breakdown */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Platform Breakdown</h3>
          <div className="space-y-4">
            {Object.entries(metrics.platformBreakdown).map(([platform, count]) => {
              const percentage = (count / metrics.totalConnectedStores * 100).toFixed(1);
              return (
                <div key={platform} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
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

        {/* Recent Errors */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Issues</h3>
          <div className="space-y-3">
            {metrics.recentErrors.length > 0 ? (
              metrics.recentErrors.map((error, index) => (
                <div key={index} className="border-l-4 border-gray-200 pl-3">
                  <div className="flex items-center justify-between">
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
              <div className="text-center py-4">
                <CheckCircle className="mx-auto h-8 w-8 text-green-600 mb-2" />
                <p className="text-sm text-gray-600">No recent issues</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">Performance Metrics (24h)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Clock className="h-6 w-6 text-blue-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">Avg Token Refresh</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.avgTokenRefreshTime}ms</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Zap className="h-6 w-6 text-green-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">Avg Subscription</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.avgSubscriptionRenewalTime}ms</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Globe className="h-6 w-6 text-purple-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">API Calls</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.apiCallsLast24h}</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Database className="h-6 w-6 text-indigo-600 mr-2" />
              <span className="text-sm font-medium text-gray-600">DB Queries</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.performanceMetrics.dbQueriesLast24h}</p>
          </div>
        </div>
      </div>

      {/* Job Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Cron Job Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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