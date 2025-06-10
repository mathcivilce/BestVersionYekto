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
import { createClient } from '@supabase/supabase-js';
import { toast } from 'react-hot-toast';
import { formatFileSize } from '../../utils/fileStorageStrategy';
import AttachmentsTab from './AttachmentsTab';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

interface StorageStats {
  totalAttachments: number;
  totalStorageBytes: number;
  tempStorageBytes: number;
  currentMonthUploads: number;
  currentMonthBytes: number;
  lastCalculatedAt: string;
}

interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  fileSize: number;
  isInline: boolean;
  storageStrategy: 'base64' | 'temp_storage';
  autoDeleteAt: string | null;
  createdAt: string;
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
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cleanupLogs, setCleanupLogs] = useState<CleanupLog[]>([]);
  const [retentionPolicies, setRetentionPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'attachments' | 'cleanup' | 'settings'>('overview');
  const [refreshing, setRefreshing] = useState(false);

  // Load dashboard data
  const loadDashboardData = async () => {
    try {
      const [statsResponse, attachmentsResponse, logsResponse, policiesResponse] = await Promise.all([
        supabase.from('storage_usage').select('*').single(),
        supabase.from('email_attachments').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('cleanup_logs').select('*').order('executed_at', { ascending: false }).limit(20),
        supabase.from('retention_policies').select('*').order('policy_name')
      ]);

      if (statsResponse.data) setStorageStats(statsResponse.data);
      if (attachmentsResponse.data) setAttachments(attachmentsResponse.data);
      if (logsResponse.data) setCleanupLogs(logsResponse.data);
      if (policiesResponse.data) setRetentionPolicies(policiesResponse.data);

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      toast.error('Failed to load storage data');
    } finally {
      setLoading(false);
    }
  };

  // Refresh storage stats
  const refreshStorageStats = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc('update_storage_usage', {
        p_user_id: (await supabase.auth.getUser()).data.user?.id
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

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Storage usage calculations
  const storageMetrics = useMemo(() => {
    if (!storageStats) return null;

    const maxStorage = 1024 * 1024 * 1024; // 1GB default quota
    const usagePercentage = (storageStats.totalStorageBytes / maxStorage) * 100;
    const tempPercentage = (storageStats.tempStorageBytes / storageStats.totalStorageBytes) * 100;

    return {
      totalUsage: formatFileSize(storageStats.totalStorageBytes),
      maxStorage: formatFileSize(maxStorage),
      usagePercentage: Math.min(usagePercentage, 100),
      tempPercentage: isNaN(tempPercentage) ? 0 : tempPercentage,
      isNearLimit: usagePercentage > 80,
      monthlyUploads: storageStats.currentMonthUploads,
      monthlySize: formatFileSize(storageStats.currentMonthBytes)
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
      const type = attachment.contentType;
      let category: keyof typeof stats = 'others';

      if (type.startsWith('image/')) category = 'images';
      else if (type.startsWith('video/')) category = 'videos';
      else if (type.includes('pdf') || type.includes('document') || type.includes('text')) category = 'documents';

      stats[category].count++;
      stats[category].size += attachment.fileSize;
    });

    return stats;
  }, [attachments]);

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
          <h1 className="text-2xl font-bold text-gray-900">Storage Usage Dashboard</h1>
          <p className="text-gray-600">Monitor and manage your email attachment storage</p>
        </div>
        <button
          onClick={refreshStorageStats}
          disabled={refreshing}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
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
                    {formatFileSize(storageStats?.tempStorageBytes || 0)}
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
                    {storageStats?.totalAttachments || 0}
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