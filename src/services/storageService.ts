import { createClient } from '@supabase/supabase-js';
import { API_CONFIG, validateConfig } from '../config/api';

// Validate configuration on import
validateConfig();

const supabase = createClient(
  API_CONFIG.supabase.url,
  API_CONFIG.supabase.anonKey
);

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  tempFiles: number;
  tempSize: number;
  monthFiles: number;
  monthSize: number;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  file_size: number;
  is_inline: boolean;
  storage_strategy: 'base64' | 'temp_storage';
  auto_delete_at: string | null;
  created_at: string;
  processed: boolean;
  storage_path?: string;
}

export interface CleanupLog {
  id: string;
  cleanup_type: string;
  files_deleted: number;
  storage_freed_bytes: number;
  execution_time_ms: number;
  success: boolean;
  executed_at: string;
  error_message?: string;
}

export interface SystemHealth {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: { status: string; error?: string };
    storage: { status: string; error?: string };
    cleanup: { status: string; lastRun?: string; error?: string };
  };
  version: string;
}

export class StorageService {
  /**
   * Get user storage statistics
   */
  static async getStorageStats(userId?: string): Promise<StorageStats> {
    try {
      const { data, error } = await supabase
        .rpc('get_user_storage_stats', { 
          user_id: userId || (await supabase.auth.getUser()).data.user?.id 
        });
      
      if (error) throw error;
      
      return {
        totalFiles: data?.total_files || 0,
        totalSize: data?.total_size || 0,
        tempFiles: data?.temp_files || 0,
        tempSize: data?.temp_size || 0,
        monthFiles: data?.month_files || 0,
        monthSize: data?.month_size || 0,
      };
    } catch (error) {
      console.error('Failed to get storage stats:', error);
      throw new Error(`Failed to retrieve storage statistics: ${error.message}`);
    }
  }

  /**
   * Trigger cleanup operation
   */
  static async triggerCleanup(
    cleanupType: string, 
    dryRun = false,
    batchSize = 100
  ): Promise<any> {
    try {
      const user = await supabase.auth.getUser();
      if (!user.data.user) {
        throw new Error('User not authenticated');
      }

      const response = await fetch(API_CONFIG.functions.cleanupAttachments, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_CONFIG.supabase.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          cleanupType, 
          dryRun,
          batchSize,
          userId: user.data.user.id
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Cleanup failed: ${response.statusText} - ${errorData}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Cleanup operation failed:', error);
      throw new Error(`Cleanup operation failed: ${error.message}`);
    }
  }

  /**
   * Get user attachments with pagination and filtering
   */
  static async getAttachments(
    limit = 50, 
    offset = 0,
    filters?: {
      search?: string;
      type?: 'all' | 'images' | 'documents' | 'videos';
      status?: 'all' | 'active' | 'pending' | 'expired';
    }
  ): Promise<Attachment[]> {
    try {
      let query = supabase
        .from('email_attachments')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Apply filters
      if (filters?.search) {
        query = query.ilike('filename', `%${filters.search}%`);
      }

      if (filters?.type && filters.type !== 'all') {
        if (filters.type === 'images') {
          query = query.like('content_type', 'image/%');
        } else if (filters.type === 'videos') {
          query = query.like('content_type', 'video/%');
        } else if (filters.type === 'documents') {
          query = query.or('content_type.like.application/%,content_type.like.text/%');
        }
      }

      if (filters?.status && filters.status !== 'all') {
        if (filters.status === 'pending') {
          query = query.eq('processed', false);
        } else if (filters.status === 'expired') {
          query = query.lt('auto_delete_at', new Date().toISOString());
        } else if (filters.status === 'active') {
          query = query.eq('processed', true)
                      .or('auto_delete_at.is.null,auto_delete_at.gt.' + new Date().toISOString());
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get attachments:', error);
      throw new Error(`Failed to retrieve attachments: ${error.message}`);
    }
  }

  /**
   * Delete attachment
   */
  static async deleteAttachment(attachmentId: string): Promise<void> {
    try {
      // First get attachment details to remove from storage if needed
      const { data: attachment, error: fetchError } = await supabase
        .from('email_attachments')
        .select('storage_path, storage_strategy')
        .eq('id', attachmentId)
        .single();

      if (fetchError) throw fetchError;

      // Remove from storage if it's a temp file
      if (attachment?.storage_path && attachment.storage_strategy === 'temp_storage') {
        const { error: storageError } = await supabase.storage
          .from(API_CONFIG.storage.bucketName)
          .remove([attachment.storage_path]);

        if (storageError) {
          console.warn('Failed to remove file from storage:', storageError);
          // Don't fail the operation, just log the warning
        }
      }

      // Remove from database
      const { error } = await supabase
        .from('email_attachments')
        .delete()
        .eq('id', attachmentId);

      if (error) throw error;
    } catch (error) {
      console.error('Failed to delete attachment:', error);
      throw new Error(`Failed to delete attachment: ${error.message}`);
    }
  }

  /**
   * Get cleanup history
   */
  static async getCleanupHistory(limit = 20): Promise<CleanupLog[]> {
    try {
      const { data, error } = await supabase
        .from('cleanup_logs')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get cleanup history:', error);
      throw new Error(`Failed to retrieve cleanup history: ${error.message}`);
    }
  }

  /**
   * Get system health status
   */
  static async getSystemHealth(): Promise<SystemHealth> {
    try {
      const response = await fetch(API_CONFIG.functions.healthCheck, {
        headers: {
          'Authorization': `Bearer ${API_CONFIG.supabase.anonKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Health check failed:', error);
      // Return unhealthy status if health check fails
      return {
        timestamp: new Date().toISOString(),
        status: 'unhealthy',
        services: {
          database: { status: 'unknown', error: error.message },
          storage: { status: 'unknown', error: error.message },
          cleanup: { status: 'unknown', error: error.message },
        },
        version: '1.0.0',
      };
    }
  }

  /**
   * Update storage usage for current user
   */
  static async updateStorageUsage(): Promise<void> {
    try {
      const user = await supabase.auth.getUser();
      if (!user.data.user) {
        throw new Error('User not authenticated');
      }

      const { error } = await supabase.rpc('update_storage_usage', {
        p_user_id: user.data.user.id
      });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to update storage usage:', error);
      throw new Error(`Failed to update storage usage: ${error.message}`);
    }
  }

  /**
   * Get retention policies
   */
  static async getRetentionPolicies() {
    try {
      const { data, error } = await supabase
        .from('retention_policies')
        .select('*')
        .order('policy_name');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get retention policies:', error);
      throw new Error(`Failed to retrieve retention policies: ${error.message}`);
    }
  }

  /**
   * Validate file before upload
   */
  static validateFile(file: File): { valid: boolean; error?: string } {
    // Check file size
    if (file.size > API_CONFIG.storage.maxFileSize) {
      return {
        valid: false,
        error: `File size exceeds maximum limit of ${Math.round(API_CONFIG.storage.maxFileSize / 1024 / 1024)}MB`
      };
    }

    // Check file type (basic validation - server will do comprehensive check)
    const allowedTypes = [
      'image/', 'video/', 'application/pdf', 'application/msword',
      'application/vnd.openxmlformats', 'text/', 'application/zip'
    ];

    const isAllowed = allowedTypes.some(type => file.type.startsWith(type));
    if (!isAllowed) {
      return {
        valid: false,
        error: 'File type not allowed'
      };
    }

    return { valid: true };
  }
}

export default StorageService; 