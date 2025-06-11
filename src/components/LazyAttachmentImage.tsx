/**
 * Lazy Attachment Image Component - Phase 2: Lazy Loading
 * 
 * Intelligent image component that handles:
 * - CID (Content-ID) resolution for inline images
 * - Progressive loading with beautiful placeholders
 * - Automatic fallback mechanisms
 * - Cache-aware loading strategies
 * - Seamless user experience
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
  progress?: number;
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

  // Effect to start loading when component mounts or props change
  useEffect(() => {
    if (!cid && !attachmentId) {
      setLoadingState({ status: 'error', errorMessage: 'Missing attachment identifier' });
      return;
    }

    loadAttachmentImage();

    // Cleanup function to cancel ongoing requests
    return () => {
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, [cid, attachmentId]);

  const loadAttachmentImage = async () => {
    try {
      setLoadingState({ status: 'loading', progress: 0 });

      // Cancel any existing request
      if (abortController.current) {
        abortController.current.abort();
      }
      abortController.current = new AbortController();

      // Get current user session
      const { data: { session } } = await supabase.auth.getSession();
      console.log('🔍 Session debug:', {
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        accessTokenLength: session?.access_token?.length,
        user: session?.user?.email,
        expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
      });
      
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

      // Set progress to 25% when starting fetch
      setLoadingState({ status: 'loading', progress: 25 });

      // Prepare headers for debugging
      const headers = {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };
      
      console.log('🌐 Fetch request debug:', {
        url,
        hasAuthHeader: !!headers.Authorization,
        authHeaderPrefix: headers.Authorization?.substring(0, 20) + '...',
        contentType: headers['Content-Type']
      });

      // Fetch attachment with authentication
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortController.current.signal
      });

      // Set progress to 50% when response received
      setLoadingState({ status: 'loading', progress: 50 });

      if (!response.ok) {
        if (response.status === 404) {
          setLoadingState({ status: 'not-found' });
          return;
        }
        
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Get cache level from headers
      const cacheLevel = response.headers.get('X-Cache') as 'L1-HIT' | 'L2-HIT' | 'MISS' | null;
      const cacheLevelSimple = cacheLevel?.includes('L1') ? 'L1' : 
                              cacheLevel?.includes('L2') ? 'L2' : 'MISS';

      // Set progress to 75% when starting to process blob
      setLoadingState({ 
        status: 'loading', 
        progress: 75,
        cacheLevel: cacheLevelSimple 
      });

      // Convert response to blob and create object URL
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      // Set progress to 90% when blob is ready
      setLoadingState({ 
        status: 'loading', 
        progress: 90,
        cacheLevel: cacheLevelSimple 
      });

      // Preload the image to ensure it's fully loaded before displaying
      const img = new Image();
      img.onload = () => {
        setImageSrc(objectUrl);
        setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
        setLoadingState({ 
          status: 'loaded', 
          progress: 100,
          cacheLevel: cacheLevelSimple 
        });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setLoadingState({ 
          status: 'error', 
          errorMessage: 'Failed to load image data' 
        });
      };
      
      img.src = objectUrl;

    } catch (error: any) {
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
    if (!imageSize) return { width: 'auto', height: 'auto' };
    
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
          className={`relative flex items-center justify-center bg-gray-100 border border-gray-200 rounded-lg ${className}`}
          style={{ 
            width: displaySize.width, 
            height: displaySize.height, 
            minWidth: '120px', 
            minHeight: '80px',
            ...style 
          }}
        >
          <div className="flex flex-col items-center space-y-2 p-4">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            <div className="text-sm text-gray-600 text-center">
              Loading image...
              {loadingState.progress && (
                <div className="text-xs text-gray-500 mt-1">
                  {loadingState.progress}%
                  {loadingState.cacheLevel && (
                    <span className="ml-1 text-blue-500">
                      ({loadingState.cacheLevel} Cache)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Progress bar */}
          {loadingState.progress && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200 rounded-b-lg overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${loadingState.progress}%` }}
              />
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
            <ImageIcon className="w-6 h-6 text-yellow-600" />
            <div className="text-sm text-yellow-700">
              Image not found
            </div>
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
            <AlertCircle className="w-6 h-6 text-red-600" />
            <div className="text-sm text-red-700">
              Failed to load image
            </div>
            {loadingState.errorMessage && (
              <div className="text-xs text-red-600">
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