import React, { useState, useEffect, useMemo } from 'react';
import { 
  HardDrive, 
  Trash2, 
  Download, 
  Clock, 
  AlertTriangle, 
  CheckCircle,
  FileText,
  Image,
  Video,
  Archive,
  Paperclip,
  Calendar,
  TrendingUp,
  Settings,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatFileSize } from '../../utils/fileStorageStrategy';
import AttachmentsTab from './AttachmentsTab';
import { supabase } from '../../config/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface StorageStats {
  total_attachments: number;
  total_storage_bytes: number;
  temp_storage_bytes: number;
  current_month_uploads: number;
  current_month_bytes: number;
  last_calculated_at: string;
}

interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  file_size: number;
  is_inline: boolean;
  storage_strategy: 'base64' | 'temp_storage';
  auto_delete_at: string | null;
  created_at: string;
  processed: boolean;
}

interface CleanupLog {
  id: string;
  cleanupType: string;
  filesDeleted: number;
  storageFreedBytes: number;
  executionTimeMs: number;
  success: boolean;
  executedAt: string;
}

interface RetentionPolicy {
  id: string;
  policyName: string;
  policyType: string;
  retentionDays: number;
  enabled: boolean;
}

const StorageUsageDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'attachments' | 'cleanup' | 'settings'>('overview');
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cleanupLogs, setCleanupLogs] = useState<CleanupLog[]>([]);
  const [retentionPolicies, setRetentionPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load dashboard data
  const loadDashboardData = async () => {
    console.log('StorageUsageDashboard: loadDashboardData called, user:', user);
    
    if (!user) {
      console.log('No authenticated user, skipping data load');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      console.log('StorageUsageDashboard: Starting data load for user:', user.id);

      // Check and refresh session if needed
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!session && !sessionError) {
        console.log('No valid session found, attempting to refresh...');
        const { data: refreshData } = await supabase.auth.refreshSession();
        if (refreshData?.session) {
          console.log('Session refreshed successfully');
        } else {
          console.warn('Could not refresh session, but continuing with user context');
        }
      }

      // First, ensure storage usage is calculated for this user
      const { error: updateError } = await supabase.rpc('update_storage_usage', { 
        p_user_id: user.id 
      });

      if (updateError) {
        console.warn('Failed to update storage usage:', updateError);
      }

      console.log('StorageUsageDashboard: Fetching data from database...');

      // Fetch data using RPC function for attachments to bypass RLS issues
      const [statsResponse, attachmentsResponse] = await Promise.all([
        // Get storage_usage for current month
        supabase
          .from('storage_usage')
          .select('*')
          .eq('user_id', user.id)
          .eq('month_year', new Date().toISOString().substring(0, 7))
          .maybeSingle(),
        
        // Get all attachments using RPC function (bypasses RLS)
        supabase.rpc('get_user_attachments', { 
          p_user_id: user.id,
          p_limit: 100 
        })
      ]);

      console.log('StorageUsageDashboard: Database responses received');
      console.log('Storage stats response:', statsResponse);
      console.log('Attachments response:', attachmentsResponse);

      // Handle storage stats - create default if none exists
      if (statsResponse.data) {
        console.log('StorageUsageDashboard: Found storage stats:', statsResponse.data);
        setStorageStats(statsResponse.data);
      } else {
        console.log('StorageUsageDashboard: No storage stats found, creating default');
        // No storage usage record exists, create a default one
        const defaultStats: StorageStats = {
          total_attachments: 0,
          total_storage_bytes: 0,
          temp_storage_bytes: 0,
          current_month_uploads: 0,
          current_month_bytes: 0,
          last_calculated_at: new Date().toISOString()
        };
        setStorageStats(defaultStats);
      }

      // Process attachments from RPC response
      let allAttachments: Attachment[] = [];

      if (attachmentsResponse.data && attachmentsResponse.data.length > 0) {
        // Normalize the RPC response to match our Attachment interface
        allAttachments = attachmentsResponse.data.map(att => ({
          id: att.id,
          filename: att.filename,
          content_type: att.content_type,
          file_size: att.file_size,
          is_inline: att.is_inline || false,
          storage_strategy: att.storage_strategy as 'base64' | 'temp_storage',
          auto_delete_at: att.auto_delete_at,
          created_at: att.created_at,
          processed: att.processed || true
        }));
        
        console.log('StorageUsageDashboard: Loaded', allAttachments.length, 'total attachments via RPC');
      } else {
        console.log('StorageUsageDashboard: No attachments found via RPC');
        if (attachmentsResponse.error) {
          console.error('Attachments RPC error:', attachmentsResponse.error);
        }
      }

      console.log('StorageUsageDashboard: Total attachments loaded:', allAttachments.length);
      setAttachments(allAttachments);

      // Try to load admin-only data but don't fail if not accessible
      try {
        const [logsResponse, policiesResponse] = await Promise.all([
          supabase
            .from('cleanup_logs')
            .select('*')
            .order('executed_at', { ascending: false })
            .limit(20),
          
          supabase
            .from('retention_policies')
            .select('*')
            .order('policy_name')
        ]);

        if (logsResponse.data) {
          setCleanupLogs(logsResponse.data);
        } else {
          setCleanupLogs([]);
        }

        if (policiesResponse.data) {
          setRetentionPolicies(policiesResponse.data);
        } else {
          setRetentionPolicies([]);
        }
      } catch (adminError) {
        console.log('Admin-only data not accessible:', adminError);
        setCleanupLogs([]);
        setRetentionPolicies([]);
      }

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      
      // Don't show error toast for authentication issues, just log them
      if (error?.code !== 'PGRST301') {
        toast.error('Failed to load dashboard data');
      }
      
      // Set default empty data on error
      setStorageStats({
        total_attachments: 0,
        total_storage_bytes: 0,
        temp_storage_bytes: 0,
        current_month_uploads: 0,
        current_month_bytes: 0,
        last_calculated_at: new Date().toISOString()
      });
      setAttachments([]);
      setCleanupLogs([]);
      setRetentionPolicies([]);
    } finally {
      setLoading(false);
    }
  };

  // Refresh storage stats
  const refreshStorageStats = async () => {
    if (!user) {
      toast.error('User not authenticated');
      return;
    }

    setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc('update_storage_usage', {
        p_user_id: user.id
      });

      if (error) throw error;
      
      await loadDashboardData();
      toast.success('Storage stats refreshed');
    } catch (error) {
      console.error('Failed to refresh storage stats:', error);
      toast.error('Failed to refresh storage stats');
    } finally {
      setRefreshing(false);
    }
  };

  // Manual cleanup trigger
  const triggerCleanup = async (cleanupType: string) => {
    try {
      const response = await fetch('/api/supabase/functions/cleanup-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleanupType, dryRun: false })
      });

      if (!response.ok) throw new Error('Cleanup failed');

      const result = await response.json();
      toast.success(`Cleanup completed: ${result.deletedCount} files cleaned`);
      await loadDashboardData();
    } catch (error) {
      console.error('Cleanup failed:', error);
      toast.error('Cleanup operation failed');
    }
  };

  // Remove attachment
  const removeAttachment = async (attachmentId: string) => {
    if (!user) {
      toast.error('User not authenticated');
      return;
    }

    try {
      const { error } = await supabase
        .from('email_attachments')
        .delete()
        .eq('id', attachmentId);

      if (error) throw error;

      toast.success('Attachment removed successfully');
      await loadDashboardData();
    } catch (error) {
      console.error('Failed to remove attachment:', error);
      toast.error('Failed to remove attachment');
    }
  };

  // Load data when component mounts or user changes
  useEffect(() => {
    loadDashboardData();
  }, [user]); // Only depend on user changes

  // Storage usage calculations
  const storageMetrics = useMemo(() => {
    if (!storageStats) return null;

    const maxStorage = 1024 * 1024 * 1024; // 1GB default quota
    const usagePercentage = (storageStats.total_storage_bytes / maxStorage) * 100;
    const tempPercentage = (storageStats.temp_storage_bytes / storageStats.total_storage_bytes) * 100;

    return {
      totalUsage: formatFileSize(storageStats.total_storage_bytes),
      maxStorage: formatFileSize(maxStorage),
      usagePercentage: Math.min(usagePercentage, 100),
      tempPercentage: isNaN(tempPercentage) ? 0 : tempPercentage,
      isNearLimit: usagePercentage > 80,
      monthlyUploads: storageStats.current_month_uploads,
      monthlySize: formatFileSize(storageStats.current_month_bytes)
    };
  }, [storageStats]);

  // File type breakdown
  const fileTypeStats = useMemo(() => {
    const stats = {
      images: { count: 0, size: 0 },
      documents: { count: 0, size: 0 },
      videos: { count: 0, size: 0 },
      others: { count: 0, size: 0 }
    };

    attachments.forEach(attachment => {
      const type = attachment.content_type || '';
      let category: keyof typeof stats = 'others';

      if (type.startsWith('image/')) category = 'images';
      else if (type.startsWith('video/')) category = 'videos';
      else if (type.includes('pdf') || type.includes('document') || type.includes('text')) category = 'documents';

      stats[category].count++;
      stats[category].size += attachment.file_size || 0;
    });

    return stats;
  }, [attachments]);

  // Debug function to check database connectivity
  const debugDatabaseConnection = async () => {
    if (!user) {
      console.log('Debug: No user authenticated');
      toast.error('No user authenticated for debug');
      return;
    }

    try {
      console.log('Debug: Testing database connection for user:', user.id);
      
      // Check authentication session and attempt refresh
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('Debug: Current session:', { 
        hasSession: !!session, 
        userId: session?.user?.id, 
        error: sessionError,
        expiresAt: session?.expires_at
      });

      // Try to refresh session if needed
      if (!session) {
        console.log('Debug: Attempting session refresh...');
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        console.log('Debug: Session refresh result:', { 
          hasNewSession: !!refreshData?.session,
          error: refreshError 
        });
      }
      
      // Test basic connection with storage_usage
      const { data: testData, error: testError } = await supabase
        .from('storage_usage')
        .select('*')
        .eq('user_id', user.id);
      
      console.log('Debug: Storage usage query result:', { 
        count: testData?.length || 0, 
        data: testData,
        error: testError 
      });
      
      // Test RPC function for storage calculation
      const { data: rpcData, error: rpcError } = await supabase.rpc('update_storage_usage', { 
        p_user_id: user.id 
      });
      
      console.log('Debug: RPC storage function result:', { rpcData, rpcError });
      
      // Test new RPC function for getting attachments
      const { data: attachmentsData, error: attachmentsError } = await supabase.rpc('get_user_attachments', { 
        p_user_id: user.id,
        p_limit: 10 
      });
      
      console.log('Debug: RPC attachments function result:', { 
        count: attachmentsData?.length || 0,
        data: attachmentsData?.slice(0, 3) || [], // Show first 3 only
        error: attachmentsError,
        errorCode: attachmentsError?.code
      });
      
      // Still test direct table access for comparison
      const { data: outgoingAttachments, error: outgoingError } = await supabase
        .from('email_attachments')
        .select('id, filename, content_type, file_size, created_at')
        .eq('user_id', user.id)
        .limit(5);
      
      console.log('Debug: Direct email_attachments query:', { 
        count: outgoingAttachments?.length || 0, 
        data: outgoingAttachments?.slice(0, 2) || [],
        error: outgoingError,
        errorCode: outgoingError?.code
      });
      
      const { data: incomingAttachments, error: incomingError } = await supabase
        .from('attachment_references')
        .select('id, filename, content_type, file_size, created_at')
        .eq('user_id', user.id)
        .limit(5);
      
      console.log('Debug: Direct attachment_references query:', { 
        count: incomingAttachments?.length || 0, 
        data: incomingAttachments?.slice(0, 2) || [],
        error: incomingError,
        errorCode: incomingError?.code
      });

      // Test file type categorization with RPC data
      const fileTypes = attachmentsData?.reduce((acc, att) => {
        const type = att.content_type || '';
        let category = 'others';
        if (type.startsWith('image/')) category = 'images';
        else if (type.startsWith('video/')) category = 'videos';
        else if (type.includes('pdf') || type.includes('document') || type.includes('text')) category = 'documents';
        
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};
      
      console.log('Debug: File type breakdown from RPC:', fileTypes);
      
      // Summary
      const rpcAttachmentCount = attachmentsData?.length || 0;
      const directAttachmentCount = (outgoingAttachments?.length || 0) + (incomingAttachments?.length || 0);
      const hasAuthErrors = !!(outgoingError?.code === 'PGRST301' || incomingError?.code === 'PGRST301');
      const hasRpcError = !!attachmentsError;
      
      console.log('Debug: Summary:', {
        rpcAttachmentCount,
        directAttachmentCount,
        hasAuthErrors,
        hasRpcError,
        sessionValid: !!session,
        storageRecords: testData?.length || 0
      });
      
      if (hasRpcError) {
        toast.error(`RPC function failed - check console for details`);
      } else if (hasAuthErrors && rpcAttachmentCount > 0) {
        toast.success(`RPC bypass working! Found ${rpcAttachmentCount} attachments via RPC (direct queries blocked)`);
      } else if (rpcAttachmentCount > 0) {
        toast.success(`Debug complete - Found ${rpcAttachmentCount} attachments`);
      } else {
        toast.warning('No attachments found via any method');
      }
      
    } catch (error) {
      console.error('Debug: Database connection test failed:', error);
      toast.error('Database connection test failed - check console');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading storage dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Storage Usage Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor and manage your email attachment storage</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={debugDatabaseConnection}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Debug DB
          </button>
          <button
            onClick={refreshStorageStats}
            disabled={refreshing}
            className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {[
            { key: 'overview', label: 'Overview', icon: TrendingUp },
            { key: 'attachments', label: 'Attachments', icon: Paperclip },
            { key: 'cleanup', label: 'Cleanup History', icon: Trash2 },
            { key: 'settings', label: 'Settings', icon: Settings }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4 mr-2" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Storage Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <HardDrive className="h-8 w-8 text-blue-500" />
                </div>
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">Total Storage</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {storageMetrics?.totalUsage || '0 B'}
                  </div>
                  <div className="text-sm text-gray-500">
                    of {storageMetrics?.maxStorage || '1 GB'}
                  </div>
                </div>
              </div>
              {storageMetrics && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Usage</span>
                    <span className={storageMetrics.isNearLimit ? 'text-red-600' : 'text-gray-900'}>
                      {storageMetrics.usagePercentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        storageMetrics.isNearLimit ? 'bg-red-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(storageMetrics.usagePercentage, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Clock className="h-8 w-8 text-orange-500" />
                </div>
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">Temp Storage</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {formatFileSize(storageStats?.temp_storage_bytes || 0)}
                  </div>
                  <div className="text-sm text-gray-500">
                    {storageMetrics?.tempPercentage.toFixed(1)}% of total
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Calendar className="h-8 w-8 text-green-500" />
                </div>
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">This Month</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {storageMetrics?.monthlyUploads || 0}
                  </div>
                  <div className="text-sm text-gray-500">
                    {storageMetrics?.monthlySize || '0 B'} uploaded
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Paperclip className="h-8 w-8 text-purple-500" />
                </div>
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">Total Files</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {storageStats?.total_attachments || 0}
                  </div>
                  <div className="text-sm text-gray-500">attachments</div>
                </div>
              </div>
            </div>
          </div>

          {/* File Type Breakdown */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">File Type Breakdown</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { key: 'images', label: 'Images', icon: Image, color: 'text-blue-500' },
                  { key: 'documents', label: 'Documents', icon: FileText, color: 'text-green-500' },
                  { key: 'videos', label: 'Videos', icon: Video, color: 'text-red-500' },
                  { key: 'others', label: 'Others', icon: Archive, color: 'text-gray-500' }
                ].map(type => (
                  <div key={type.key} className="text-center">
                    <type.icon className={`h-8 w-8 mx-auto mb-2 ${type.color}`} />
                    <div className="text-lg font-semibold text-gray-900">
                      {fileTypeStats[type.key as keyof typeof fileTypeStats].count}
                    </div>
                    <div className="text-sm text-gray-500">{type.label}</div>
                    <div className="text-xs text-gray-400">
                      {formatFileSize(fileTypeStats[type.key as keyof typeof fileTypeStats].size)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Quick Actions</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => triggerCleanup('temp_files')}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Trash2 className="h-6 w-6 text-red-500 mb-2" />
                  <div className="font-medium text-gray-900">Clean Temp Files</div>
                  <div className="text-sm text-gray-500">Remove temporary files</div>
                </button>

                <button
                  onClick={() => triggerCleanup('expired')}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Clock className="h-6 w-6 text-yellow-500 mb-2" />
                  <div className="font-medium text-gray-900">Clean Expired</div>
                  <div className="text-sm text-gray-500">Remove expired attachments</div>
                </button>

                <button
                  onClick={refreshStorageStats}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className="h-6 w-6 text-blue-500 mb-2" />
                  <div className="font-medium text-gray-900">Refresh Stats</div>
                  <div className="text-sm text-gray-500">Update storage usage</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attachments Tab */}
      {activeTab === 'attachments' && (
        <AttachmentsTab
          attachments={attachments}
          onRefresh={loadDashboardData}
          onRemoveAttachment={removeAttachment}
        />
      )}

      {/* Other tabs */}
      {activeTab !== 'overview' && activeTab !== 'attachments' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-gray-500">
            <div className="text-lg font-medium mb-2">
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Tab
            </div>
            <p>This section is under development...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default StorageUsageDashboard; 