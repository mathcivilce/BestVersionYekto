export const FILE_STORAGE_CONFIG = {
  // Small files: Direct base64 (no storage needed, no cleanup required)
  DIRECT_BASE64_MAX_SIZE: 2 * 1024 * 1024, // 2MB
  
  // Medium files: Temporary storage with automatic cleanup
  TEMP_STORAGE_MAX_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Large files: Not supported (reject to prevent abuse)
  MAX_TOTAL_SIZE: 25 * 1024 * 1024, // 25MB Microsoft Graph limit
  
  // Retention periods for automatic cleanup
  RETENTION_PERIODS: {
    TEMP_FILES: 7, // days - Files in temporary storage
    RESOLVED_EMAIL_FILES: 30, // days - Files from resolved emails
    OPEN_EMAIL_FILES: 90, // days - Files from active emails
    INACTIVE_USER_FILES: 180, // days - Files from inactive users
    CLEANUP_LOGS: 365 // days - Keep cleanup logs for audit
  },
  
  // File type restrictions
  ALLOWED_TYPES: {
    images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    documents: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv'
    ],
    videos: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv']
  },
  
  // Size limits by type
  MAX_FILE_SIZES: {
    image: 10 * 1024 * 1024, // 10MB
    document: 25 * 1024 * 1024, // 25MB
    video: 100 * 1024 * 1024 // 100MB (would require special handling)
  }
};

export const determineStorageStrategy = (fileSize: number, fileType: string): 'base64' | 'temp_storage' | 'reject' => {
  if (fileSize <= FILE_STORAGE_CONFIG.DIRECT_BASE64_MAX_SIZE) {
    return 'base64'; // Send directly, no storage needed
  } else if (fileSize <= FILE_STORAGE_CONFIG.TEMP_STORAGE_MAX_SIZE) {
    return 'temp_storage'; // Store temporarily for sending, auto-cleanup
  } else {
    return 'reject'; // Too large, prevent storage bloat
  }
};

export const validateFile = (file: File): { valid: boolean; error?: string; strategy?: string } => {
  const fileType = file.type;
  const fileSize = file.size;

  // Check if file type is allowed
  const allAllowedTypes = [
    ...FILE_STORAGE_CONFIG.ALLOWED_TYPES.images,
    ...FILE_STORAGE_CONFIG.ALLOWED_TYPES.documents,
    ...FILE_STORAGE_CONFIG.ALLOWED_TYPES.videos
  ];

  if (!allAllowedTypes.includes(fileType)) {
    return { valid: false, error: 'File type not allowed' };
  }

  // Check file size based on type
  if (fileType.startsWith('image/') && fileSize > FILE_STORAGE_CONFIG.MAX_FILE_SIZES.image) {
    return { valid: false, error: 'Image file too large (max 10MB)' };
  }

  if (fileType.startsWith('video/') && fileSize > FILE_STORAGE_CONFIG.MAX_FILE_SIZES.video) {
    return { valid: false, error: 'Video file too large (max 100MB)' };
  }

  if (!fileType.startsWith('image/') && !fileType.startsWith('video/') && fileSize > FILE_STORAGE_CONFIG.MAX_FILE_SIZES.document) {
    return { valid: false, error: 'Document file too large (max 25MB)' };
  }

  const strategy = determineStorageStrategy(fileSize, fileType);
  return { valid: strategy !== 'reject', strategy, error: strategy === 'reject' ? 'File too large for email sending' : undefined };
};

export const sanitizeFileName = (fileName: string): string => {
  // Remove potentially dangerous characters and limit length
  return fileName.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 100);
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}; 