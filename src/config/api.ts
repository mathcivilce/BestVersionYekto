// API Configuration for Storage Dashboard System
export const API_CONFIG = {
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  },
  functions: {
    sendEmail: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
    cleanupAttachments: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cleanup-attachments`,
    healthCheck: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health-check`,
  },
  storage: {
    bucketName: import.meta.env.VITE_STORAGE_BUCKET_NAME || 'email-attachments',
    maxFileSize: parseInt(import.meta.env.VITE_MAX_FILE_SIZE || '104857600'), // 100MB
    maxTotalSize: parseInt(import.meta.env.VITE_MAX_TOTAL_SIZE || '26214400'), // 25MB
  },
  dashboard: {
    storageQuotaGB: parseInt(import.meta.env.VITE_STORAGE_QUOTA_GB || '1'),
    enableCleanupOps: import.meta.env.VITE_ENABLE_CLEANUP_OPERATIONS === 'true',
    enableStorageAnalytics: import.meta.env.VITE_ENABLE_STORAGE_ANALYTICS === 'true',
    refreshIntervalMs: parseInt(import.meta.env.VITE_DASHBOARD_REFRESH_INTERVAL || '30000'), // 30 seconds
  },
  features: {
    enableDragDrop: import.meta.env.VITE_ENABLE_DRAG_DROP !== 'false',
    enableInlineImages: import.meta.env.VITE_ENABLE_INLINE_IMAGES !== 'false',
    enableAutoCleanup: import.meta.env.VITE_ENABLE_AUTO_CLEANUP !== 'false',
    debugLogging: import.meta.env.VITE_ENABLE_DEBUG_LOGGING === 'true',
  }
};

// Validate required environment variables
export const validateConfig = () => {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY'
  ];

  const missing = required.filter(key => !import.meta.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return true;
};

// Get storage quota in bytes
export const getStorageQuotaBytes = () => {
  return API_CONFIG.dashboard.storageQuotaGB * 1024 * 1024 * 1024;
};

// Feature flag helpers
export const isFeatureEnabled = (feature: keyof typeof API_CONFIG.features) => {
  return API_CONFIG.features[feature];
};

export default API_CONFIG; 