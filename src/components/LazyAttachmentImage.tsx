/**
 * Lazy Attachment Image Component - Phase 2: Optimized Loading
 * 
 * Intelligent image component that handles:
 * - CID (Content-ID) resolution for inline images
 * - Optimized loading for multiple images in emails
 * - Gray placeholder for layout preservation
 * - Shared session management for performance
 * - Cache-aware loading strategies
 * - Seamless user experience optimized for modern SaaS standards
 * 
 * Usage:
 * <LazyAttachmentImage 
 *   cid="ii_1975cbd90f84ad4cdce1" 
 *   alt="Customer image"
 *   className="max-w-sm" 
 * />
 */

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Loader2, ImageIcon, AlertCircle, Download } from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Shared session cache to avoid multiple auth calls
let sharedSession: any = null;
let sessionPromise: Promise<any> | null = null;
let sessionExpiry: number = 0;

const getSharedSession = async () => {
  // Check if we have a valid cached session
  if (sharedSession && Date.now() < sessionExpiry) {
    return sharedSession;
  }

  // If there's already a session request in progress, wait for it
  if (sessionPromise) {
    return await sessionPromise;
  }

  // Create new session request
  sessionPromise = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        sharedSession = session;
        // Cache for 5 minutes or until token expiry, whichever is sooner
        const expiryTime = session.expires_at ? session.expires_at * 1000 : Date.now() + 300000;
        sessionExpiry = Math.min(expiryTime - 60000, Date.now() + 300000); // 1 minute buffer
      }
      return session;
    } finally {
      sessionPromise = null;
    }
  })();

  return await sessionPromise;
};

interface LazyAttachmentImageProps {
  cid?: string;              // Content-ID for inline images (cid:xxxxx)
  attachmentId?: string;     // Direct attachment reference ID
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  showDownloadButton?: boolean;
  maxWidth?: number;
  maxHeight?: number;
}

interface LoadingState {
  status: 'idle' | 'loading' | 'loaded' | 'error' | 'not-found';
  showSpinner?: boolean;     // Only show spinner after delay
  errorMessage?: string;
  cacheLevel?: 'L1' | 'L2' | 'MISS';
}

export const LazyAttachmentImage: React.FC<LazyAttachmentImageProps> = ({
  cid,
  attachmentId,
  alt = 'Email attachment',
  className = '',
  style,
  onClick,
  showDownloadButton = false,
  maxWidth = 600,
  maxHeight = 400
}) => {
  const [loadingState, setLoadingState] = useState<LoadingState>({ status: 'idle' });
  const [imageSrc, setImageSrc] = useState<string>('');
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const abortController = useRef<AbortController | null>(null);
  const spinnerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Effect to start loading when component mounts or props change
  useEffect(() => {
    if (!cid && !attachmentId) {
      setLoadingState({ status: 'error', errorMessage: 'Missing attachment identifier' });
      return;
    }

    loadAttachmentImage();

    // Cleanup function to cancel ongoing requests and timeouts
    return () => {
      if (abortController.current) {
        abortController.current.abort();
      }
      if (spinnerTimeoutRef.current) {
        clearTimeout(spinnerTimeoutRef.current);
      }
    };
  }, [cid, attachmentId]);

  const loadAttachmentImage = async () => {
    try {
      setLoadingState({ status: 'loading', showSpinner: false });

      // Cancel any existing request and timeout
      if (abortController.current) {
        abortController.current.abort();
      }
      if (spinnerTimeoutRef.current) {
        clearTimeout(spinnerTimeoutRef.current);
      }
      
      abortController.current = new AbortController();

      // Set up delayed spinner with shorter delay for better UX
      spinnerTimeoutRef.current = setTimeout(() => {
        setLoadingState(prev => ({ ...prev, showSpinner: true }));
      }, 200); // Reduced from 300ms to 200ms

      // Use shared session to avoid multiple auth calls
      const session = await getSharedSession();
      
      if (!session) {
        throw new Error('User not authenticated');
      }

      if (!session.access_token) {
        throw new Error('Access token not available');
      }

      // Build API URL
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-attachment`;
      const params = new URLSearchParams();
      
      if (cid) {
        params.append('cid', cid);
      } else if (attachmentId) {
        params.append('id', attachmentId);
      }

      const url = `${baseUrl}?${params.toString()}`;

      // Prepare headers
      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };

      // Fetch attachment with authentication
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortController.current.signal
      });

      if (!response.ok) {
        if (response.status === 404) {
          setLoadingState({ status: 'not-found' });
          return;
        }
        
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Get cache level from headers (for debugging/optimization)
      const cacheLevel = response.headers.get('X-Cache') as 'L1-HIT' | 'L2-HIT' | 'MISS' | null;
      const cacheLevelSimple = cacheLevel?.includes('L1') ? 'L1' : 
                              cacheLevel?.includes('L2') ? 'L2' : 'MISS';

      // Convert response to blob and create object URL
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      // Preload the image to ensure it's fully loaded before displaying
      const img = new Image();
      img.onload = () => {
        // Clear the spinner timeout since we're done loading
        if (spinnerTimeoutRef.current) {
          clearTimeout(spinnerTimeoutRef.current);
        }
        
        setImageSrc(objectUrl);
        setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
        setLoadingState({ 
          status: 'loaded', 
          cacheLevel: cacheLevelSimple 
        });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        if (spinnerTimeoutRef.current) {
          clearTimeout(spinnerTimeoutRef.current);
        }
        setLoadingState({ 
          status: 'error', 
          errorMessage: 'Failed to load image data' 
        });
      };
      
      img.src = objectUrl;

    } catch (error: any) {
      // Clear the spinner timeout on error
      if (spinnerTimeoutRef.current) {
        clearTimeout(spinnerTimeoutRef.current);
      }
      
      if (error.name === 'AbortError') {
        // Request was cancelled, don't update state
        return;
      }
      
      console.error('Error loading attachment image:', error);
      setLoadingState({ 
        status: 'error', 
        errorMessage: error.message || 'Failed to load image' 
      });
    }
  };

  const calculateDisplaySize = () => {
    if (!imageSize) {
      // Default placeholder size when we don't know image dimensions yet
      return { width: '200px', height: '150px' };
    }
    
    const { width: naturalWidth, height: naturalHeight } = imageSize;
    
    // Calculate aspect ratio
    const aspectRatio = naturalWidth / naturalHeight;
    
    // Determine display dimensions
    let displayWidth = naturalWidth;
    let displayHeight = naturalHeight;
    
    // Constrain by max width
    if (displayWidth > maxWidth) {
      displayWidth = maxWidth;
      displayHeight = displayWidth / aspectRatio;
    }
    
    // Constrain by max height
    if (displayHeight > maxHeight) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * aspectRatio;
    }
    
    return {
      width: `${Math.round(displayWidth)}px`,
      height: `${Math.round(displayHeight)}px`
    };
  };

  const handleDownload = async () => {
    if (!imageSrc) return;
    
    try {
      const response = await fetch(imageSrc);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = alt || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const displaySize = calculateDisplaySize();

  // Render based on loading state
  switch (loadingState.status) {
    case 'idle':
    case 'loading':
      return (
        <div 
          className={`relative flex items-center justify-center bg-gray-100 border border-gray-200 rounded-lg overflow-hidden ${className}`}
          style={{ 
            width: displaySize.width, 
            height: displaySize.height, 
            minWidth: '120px', 
            minHeight: '80px',
            ...style 
          }}
        >
          {/* Gray placeholder for layout preservation */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-gray-100" />
          
          {/* Only show spinner after delay - now smaller and more subtle */}
          {loadingState.showSpinner && (
            <div className="relative z-10 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              {/* Removed text and cache info for cleaner look */}
            </div>
          )}
        </div>
      );

    case 'loaded':
      return (
        <div className={`relative ${className}`} style={style}>
          <img
            ref={imgRef}
            src={imageSrc}
            alt={alt}
            style={{
              ...displaySize,
              objectFit: 'contain'
            }}
            className="rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-shadow"
            onClick={onClick}
          />
          
          {/* Download button */}
          {showDownloadButton && (
            <button
              onClick={handleDownload}
              className="absolute bottom-2 right-2 p-2 bg-black/70 text-white rounded-full hover:bg-black/80 transition-colors"
              title="Download attachment"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          
          {/* Cache level indicator (subtle, dev-friendly) */}
          {loadingState.cacheLevel && process.env.NODE_ENV === 'development' && (
            <div className="absolute top-1 left-1 px-1 py-0.5 bg-black/50 text-white text-xs rounded">
              {loadingState.cacheLevel}
            </div>
          )}
        </div>
      );

    case 'not-found':
      return (
        <div 
          className={`flex items-center justify-center bg-yellow-50 border border-yellow-200 rounded-lg ${className}`}
          style={{ 
            width: displaySize.width, 
            height: displaySize.height, 
            minWidth: '120px', 
            minHeight: '80px',
            ...style 
          }}
        >
          <div className="flex flex-col items-center space-y-2 p-4 text-center">
            <ImageIcon className="w-5 h-5 text-yellow-600" />
            <div className="text-sm text-yellow-700">Image not found</div>
            <div className="text-xs text-yellow-600">
              {cid ? `CID: ${cid}` : `ID: ${attachmentId}`}
            </div>
          </div>
        </div>
      );

    case 'error':
      return (
        <div 
          className={`flex items-center justify-center bg-red-50 border border-red-200 rounded-lg ${className}`}
          style={{ 
            width: displaySize.width, 
            height: displaySize.height, 
            minWidth: '120px', 
            minHeight: '80px',
            ...style 
          }}
        >
          <div className="flex flex-col items-center space-y-2 p-4 text-center">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <div className="text-sm text-red-700">Failed to load</div>
            {loadingState.errorMessage && (
              <div className="text-xs text-red-600 max-w-32 truncate">
                {loadingState.errorMessage}
              </div>
            )}
            <button
              onClick={loadAttachmentImage}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Retry
            </button>
          </div>
        </div>
      );
  }
};

export default LazyAttachmentImage; 