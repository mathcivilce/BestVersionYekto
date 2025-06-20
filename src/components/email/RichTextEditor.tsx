import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import ReactQuill, { Quill } from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useDropzone } from 'react-dropzone';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { 
  Bold, Italic, Underline, List, ListOrdered, 
  Image, Paperclip, Smile, Video, X, Upload,
  Clock, HardDrive, AlertTriangle
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { createClient } from '@supabase/supabase-js';
import { 
  FILE_STORAGE_CONFIG, 
  determineStorageStrategy, 
  validateFile, 
  sanitizeFileName, 
  formatFileSize 
} from '../../utils/fileStorageStrategy';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Register custom Quill modules for better image handling
const BlockEmbed = Quill.import('blots/block/embed');

class ImageBlot extends BlockEmbed {
  static create(value: any) {
    const node = super.create();
    node.setAttribute('src', value.src);
    node.setAttribute('alt', value.alt || '');
    node.setAttribute('style', 'max-width: 100%; height: auto;');
    if (value.contentId) {
      node.setAttribute('data-content-id', value.contentId);
    }
    return node;
  }

  static value(node: any) {
    return {
      src: node.getAttribute('src'),
      alt: node.getAttribute('alt'),
      contentId: node.getAttribute('data-content-id')
    };
  }
}

ImageBlot.blotName = 'customImage';
ImageBlot.tagName = 'img';
Quill.register(ImageBlot);

interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  base64Content?: string;
  isInline?: boolean;
  contentId?: string;
  preview?: string;
  storagePath?: string;
  storageStrategy: 'base64' | 'temp_storage';
  autoDeleteAt?: Date;
}

interface RichTextEditorProps {
  value: string;
  onChange: (content: string, attachments: Attachment[]) => void;
  placeholder?: string;
  disabled?: boolean;
  showStorageInfo?: boolean;
}

/**
 * 🔧 INLINE IMAGE FIXES IMPLEMENTED:
 * 
 * Fix 1: Prevent inline images from disappearing from editor
 * - Problem: Race condition between Quill editor content and React state
 * - Solution: Get fresh content from Quill editor after image insertion
 * - Location: Line ~235 in handleFileUpload function
 * 
 * Fix 2: Hide inline images from attachments list  
 * - Problem: Inline images appeared in both editor AND attachments list
 * - Solution: Filter attachments display to exclude isInline=true items
 * - Location: Line ~515 in attachments list rendering
 * 
 * Result: Inline images now stay in editor only, regular attachments work normally
 */
const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = "Write your reply...",
  disabled = false,
  showStorageInfo = true
}) => {
  const [content, setContent] = useState(value);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const quillRef = useRef<ReactQuill>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync content state with value prop when it changes externally
  useEffect(() => {
    setContent(value);
  }, [value]);

  // Calculate total size of attachments
  // 📝 NOTE: This includes BOTH inline images AND regular attachments
  // because both count toward email size limits, even though inline images
  // are hidden from the attachments list display
  const totalAttachmentSize = useMemo(() => {
    return attachments.reduce((total, att) => total + att.size, 0);
  }, [attachments]);

  // Generate unique content ID for inline images
  const generateContentId = (): string => {
    return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  // Enhanced file upload with hybrid storage strategy
  const handleFileUpload = useCallback(async (files: File[], isInline = false) => {
    setIsUploading(true);
    let newAttachments: Attachment[] = [];
    
    try {
      // Get current user once at the beginning
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Authentication required for file upload');
        return;
      }

      for (const file of files) {
        // Validate file
        const validation = validateFile(file);
        if (!validation.valid) {
          toast.error(`${file.name}: ${validation.error}`);
          continue;
        }

        // Check total size limit
        if (totalAttachmentSize + file.size > FILE_STORAGE_CONFIG.MAX_TOTAL_SIZE) {
          toast.error(`Adding ${file.name} would exceed the ${formatFileSize(FILE_STORAGE_CONFIG.MAX_TOTAL_SIZE)} email size limit`);
          continue;
        }

        const strategy = validation.strategy as 'base64' | 'temp_storage';
        let base64Content: string;
        let storagePath: string | undefined;
        let autoDeleteAt: Date | undefined;

        if (strategy === 'base64') {
          // Direct base64 encoding - no storage, no cleanup needed
          base64Content = await fileToBase64(file);
          autoDeleteAt = new Date(Date.now() + FILE_STORAGE_CONFIG.RETENTION_PERIODS.RESOLVED_EMAIL_FILES * 24 * 60 * 60 * 1000);
        } else if (strategy === 'temp_storage') {
          // Upload to temporary storage with automatic cleanup
          const fileId = generateContentId();
          const fileName = `${user.id}/temp_${Date.now()}_${sanitizeFileName(file.name)}`;
          
          const { data, error } = await supabase.storage
            .from('email-attachments')
            .upload(fileName, file);

          if (error) {
            toast.error(`Failed to upload ${file.name}: ${error.message}`);
            continue;
          }

          storagePath = data.path;
          base64Content = await fileToBase64(file); // Still need base64 for email sending
          autoDeleteAt = new Date(Date.now() + FILE_STORAGE_CONFIG.RETENTION_PERIODS.TEMP_FILES * 24 * 60 * 60 * 1000);
        }

        const contentId = generateContentId();
        const attachment: Attachment = {
          id: contentId,
          name: file.name,
          size: file.size,
          type: file.type,
          file,
          base64Content,
          isInline,
          contentId: isInline ? contentId : undefined,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
          storagePath,
          storageStrategy: strategy,
          autoDeleteAt
        };

        newAttachments.push(attachment);

        // For inline images, insert into editor with data URL for preview
        if (isInline && file.type.startsWith('image/')) {
          const quill = quillRef.current?.getEditor();
          if (quill) {
            const range = quill.getSelection();
            // Use data URL for preview in editor, but will convert to CID for email sending
            const dataUrl = `data:${file.type};base64,${base64Content}`;
            quill.insertEmbed(range?.index || 0, 'customImage', {
              src: dataUrl, // Use data URL for browser preview
              alt: file.name,
              contentId
            });
          }
        }

        // Track attachment in database for cleanup purposes (if tables exist)
        try {
          await supabase
            .from('email_attachments')
            .insert({
              user_id: user.id, // Use the user fetched at the beginning
              filename: file.name,
              content_type: file.type,
              file_size: file.size,
              content_id: attachment.contentId,
              is_inline: isInline,
              storage_path: storagePath,
              storage_strategy: strategy,
              auto_delete_at: autoDeleteAt?.toISOString()
            });
        } catch (dbError) {
          console.warn('Failed to track attachment in database:', dbError);
          // Don't fail the upload, just log the warning
        }
      }

      const allAttachments = [...attachments, ...newAttachments];
      setAttachments(allAttachments);
      
      // 🔧 FIX 1: INLINE IMAGE DISAPPEARING ISSUE
      // Problem: Using stale 'content' state instead of current Quill editor content
      // Solution: Get fresh content from Quill editor after image insertion
      // This prevents the race condition where onChange() is called with old content
      // causing the parent component to reset the editor and remove the inline image
      const currentContent = quillRef.current?.getEditor()?.root.innerHTML || content;
      onChange(currentContent, allAttachments);

      if (newAttachments.length > 0) {
        toast.success(`${newAttachments.length} file(s) uploaded successfully`);
      }

    } catch (error) {
      console.error('File upload error:', error);
      // Only show error toast if no files were uploaded successfully
      if (newAttachments.length === 0) {
        toast.error('Failed to upload files');
      }
    } finally {
      setIsUploading(false);
    }
  }, [content, attachments, totalAttachmentSize, onChange, showStorageInfo]);

  // Dropzone configuration
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => handleFileUpload(acceptedFiles, false),
    noClick: true,
    noKeyboard: true
  });

  // Custom toolbar modules
  const modules = useMemo(() => ({
    toolbar: {
      container: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'align': [] }],
        ['link'],
        ['clean']
      ]
    }
  }), []);

  // Handle content change from Quill editor
  // This function is called when user types or makes changes in the editor
  // It's separate from the file upload content sync fix above
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    onChange(newContent, attachments);
  }, [attachments, onChange]);

  // Handle emoji selection
  const handleEmojiSelect = useCallback((emoji: any) => {
    const quill = quillRef.current?.getEditor();
    if (quill) {
      const range = quill.getSelection();
      quill.insertText(range?.index || 0, emoji.native);
    }
    setShowEmojiPicker(false);
  }, []);

  // Handle image upload
  const handleImageUpload = useCallback(() => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.setAttribute('multiple', 'true');
    input.click();

    input.onchange = () => {
      const files = Array.from(input.files || []);
      handleFileUpload(files, true);
    };
  }, [handleFileUpload]);

  // Handle regular attachment upload
  const handleAttachmentUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle video upload
  const handleVideoUpload = useCallback(() => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'video/*');
    input.click();

    input.onchange = () => {
      const files = Array.from(input.files || []);
      handleFileUpload(files, false);
    };
  }, [handleFileUpload]);

  // Remove attachment with cleanup
  const removeAttachment = useCallback(async (attachmentId: string) => {
    const attachment = attachments.find(att => att.id === attachmentId);
    
    if (attachment) {
      // Remove from storage if it's a temp file
      if (attachment.storagePath && attachment.storageStrategy === 'temp_storage') {
        try {
          await supabase.storage
            .from('email-attachments')
            .remove([attachment.storagePath]);
        } catch (error) {
          console.warn('Failed to remove file from storage:', error);
        }
      }

      // Remove from database tracking
      try {
        await supabase
          .from('email_attachments')
          .delete()
          .eq('content_id', attachmentId);
      } catch (error) {
        console.warn('Failed to remove attachment tracking:', error);
      }
    }

    const updatedAttachments = attachments.filter(att => att.id !== attachmentId);
    setAttachments(updatedAttachments);
    onChange(content, updatedAttachments);
    
    // Remove from content if it's an inline image
    if (attachment?.isInline) {
      const quill = quillRef.current?.getEditor();
      if (quill) {
        const delta = quill.getContents();
        const ops = delta.ops?.filter(op => 
          !(op.insert?.customImage?.contentId === attachmentId)
        );
        quill.setContents({ ops });
      }
    }

    // Clean up preview URL
    if (attachment?.preview) {
      URL.revokeObjectURL(attachment.preview);
    }
  }, [attachments, content, onChange]);

  // Storage usage indicator component
  const StorageIndicator = () => {
    const usagePercentage = (totalAttachmentSize / FILE_STORAGE_CONFIG.MAX_TOTAL_SIZE) * 100;
    const isNearLimit = usagePercentage > 80;
    
    return (
      <div className="flex items-center space-x-2 text-sm">
        <HardDrive size={14} className={isNearLimit ? 'text-red-500' : 'text-gray-500'} />
        <span className={isNearLimit ? 'text-red-600' : 'text-gray-600'}>
          {formatFileSize(totalAttachmentSize)} / {formatFileSize(FILE_STORAGE_CONFIG.MAX_TOTAL_SIZE)}
        </span>
        {isNearLimit && <AlertTriangle size={14} className="text-red-500" />}
      </div>
    );
  };

  return (
    <div className="rich-text-editor relative">
      {/* Drag and Drop Overlay */}
      <div {...getRootProps()} className="relative">
        <input {...getInputProps()} />
        
        {isDragActive && (
          <div className="absolute inset-0 bg-blue-100 border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center z-10">
            <div className="text-center">
              <Upload className="mx-auto h-12 w-12 text-blue-500 mb-2" />
              <p className="text-blue-600 font-medium">Drop files here to attach</p>
              <p className="text-blue-500 text-sm">Files will be automatically managed and cleaned up</p>
            </div>
          </div>
        )}

        {/* Main Editor */}
        <div className="border border-gray-300 rounded-lg overflow-hidden">
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={content}
            onChange={handleContentChange}
            modules={modules}
            placeholder={placeholder}
            readOnly={disabled || isUploading}
            className="min-h-[200px]"
          />
          
          {/* Enhanced Custom Toolbar */}
          <div className="bg-gray-50 px-3 py-2 border-t border-gray-300">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2">
                {/* Emoji Picker Button */}
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  disabled={disabled}
                  title="Add emoji"
                >
                  <Smile size={16} />
                </button>

                {/* Image Upload Button */}
                <button
                  type="button"
                  onClick={handleImageUpload}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  disabled={disabled}
                  title="Add inline image"
                >
                  <Image size={16} />
                </button>

                {/* File Attachment Button */}
                <button
                  type="button"
                  onClick={handleAttachmentUpload}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  disabled={disabled}
                  title="Attach file"
                >
                  <Paperclip size={16} />
                </button>

                {/* Video Upload Button */}
                <button
                  type="button"
                  onClick={handleVideoUpload}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors"
                  disabled={disabled}
                  title="Attach video"
                >
                  <Video size={16} />
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    handleFileUpload(files, false);
                  }}
                />
              </div>

              {/* Status and Storage Info */}
              <div className="flex items-center space-x-4">
                {isUploading && (
                  <div className="text-sm text-blue-600 flex items-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                    Uploading...
                  </div>
                )}
                
                {showStorageInfo && <StorageIndicator />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Emoji Picker */}
      {showEmojiPicker && (
        <div className="absolute bottom-full mb-2 z-20 shadow-lg">
          <Picker
            data={data}
            onEmojiSelect={handleEmojiSelect}
            theme="light"
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>
      )}

      {/* Enhanced Attachments List */}
      {/* 🔧 FIX 2: HIDE INLINE IMAGES FROM ATTACHMENTS LIST
          Problem: Inline images were appearing both in editor AND attachments list
          Solution: Filter out inline images (isInline=true) from attachments display
          This ensures inline images only appear in the rich text editor where they belong */}
      {attachments.filter(att => !att.isInline).length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">
              {/* Only count non-inline attachments for display */}
              Attachments ({attachments.filter(att => !att.isInline).length})
            </h4>
            <div className="text-xs text-gray-500">
              {/* Calculate total size of non-inline attachments only */}
              Total: {formatFileSize(attachments.filter(att => !att.isInline).reduce((total, att) => total + att.size, 0))}
            </div>
          </div>
          
          {/* Only render non-inline attachments in the list */}
          {attachments.filter(att => !att.isInline).map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between bg-gray-50 p-3 rounded border"
            >
              <div className="flex items-center space-x-3">
                {attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={attachment.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-300 rounded flex items-center justify-center">
                    {attachment.type.startsWith('video/') ? (
                      <Video size={20} />
                    ) : (
                      <Paperclip size={20} />
                    )}
                  </div>
                )}
                
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {attachment.name}
                  </div>
                  <div className="text-xs text-gray-500 space-x-2">
                    <span>{formatFileSize(attachment.size)}</span>
                    {attachment.isInline && <span>• Inline</span>}
                    <span>• {attachment.storageStrategy === 'base64' ? 'Direct' : 'Temporary storage'}</span>
                    {attachment.autoDeleteAt && (
                      <span className="flex items-center">
                        <Clock size={12} className="mr-1" />
                        Auto-cleanup: {attachment.autoDeleteAt.toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="p-1 text-red-600 hover:text-red-800 hover:bg-red-100 rounded transition-colors"
                disabled={disabled}
                title="Remove attachment"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RichTextEditor; 

/* Author: Matheus Rodrigues Oliveira */