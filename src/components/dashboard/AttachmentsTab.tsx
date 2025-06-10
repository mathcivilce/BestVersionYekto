import React, { useState } from 'react';
import { 
  Paperclip, 
  Image, 
  Video, 
  FileText, 
  Download, 
  Trash2, 
  Eye, 
  Calendar,
  Filter,
  Search,
  Clock
} from 'lucide-react';
import { formatFileSize } from '../../utils/fileStorageStrategy';

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

interface AttachmentsTabProps {
  attachments: Attachment[];
  onRefresh: () => void;
  onRemoveAttachment: (id: string) => void;
}

const AttachmentsTab: React.FC<AttachmentsTabProps> = ({ 
  attachments, 
  onRefresh, 
  onRemoveAttachment 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'images' | 'documents' | 'videos'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'size' | 'name'>('date');

  // Filter and sort attachments
  const filteredAttachments = attachments
    .filter(attachment => {
      const matchesSearch = attachment.filename.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (filterType === 'all') return matchesSearch;
      
      const type = attachment.contentType;
      if (filterType === 'images') return matchesSearch && type.startsWith('image/');
      if (filterType === 'videos') return matchesSearch && type.startsWith('video/');
      if (filterType === 'documents') return matchesSearch && (
        type.includes('pdf') || 
        type.includes('document') || 
        type.includes('text') ||
        type.includes('application/')
      );
      
      return matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'date') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === 'size') return b.fileSize - a.fileSize;
      if (sortBy === 'name') return a.filename.localeCompare(b.filename);
      return 0;
    });

  const getFileIcon = (contentType: string, isInline: boolean) => {
    if (contentType.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />;
    if (contentType.startsWith('video/')) return <Video className="h-4 w-4 text-red-500" />;
    if (contentType.includes('pdf') || contentType.includes('document')) return <FileText className="h-4 w-4 text-green-500" />;
    return <Paperclip className="h-4 w-4 text-gray-500" />;
  };

  const getStatusBadge = (attachment: Attachment) => {
    if (!attachment.processed) {
      return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">Pending</span>;
    }
    if (attachment.autoDeleteAt && new Date(attachment.autoDeleteAt) < new Date()) {
      return <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">Expired</span>;
    }
    return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">Active</span>;
  };

  return (
    <div className="space-y-6">
      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search attachments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Type Filter */}
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Types</option>
              <option value="images">Images</option>
              <option value="documents">Documents</option>
              <option value="videos">Videos</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-500">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="date">Date</option>
              <option value="size">Size</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>
      </div>

      {/* Attachments List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            Attachments ({filteredAttachments.length})
          </h3>
        </div>

        <div className="divide-y divide-gray-200">
          {filteredAttachments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Paperclip className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No attachments found matching your criteria</p>
            </div>
          ) : (
            filteredAttachments.map((attachment) => (
              <div key={attachment.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1 min-w-0">
                    {/* File Icon */}
                    <div className="flex-shrink-0">
                      {getFileIcon(attachment.contentType, attachment.isInline)}
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-900 truncate">
                          {attachment.filename}
                        </h4>
                        {attachment.isInline && (
                          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                            Inline
                          </span>
                        )}
                        {getStatusBadge(attachment)}
                      </div>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>{formatFileSize(attachment.fileSize)}</span>
                        <span>•</span>
                        <span className="capitalize">{attachment.storageStrategy.replace('_', ' ')}</span>
                        <span>•</span>
                        <span className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {new Date(attachment.createdAt).toLocaleDateString()}
                        </span>
                        {attachment.autoDeleteAt && (
                          <>
                            <span>•</span>
                            <span className="flex items-center text-orange-600">
                              <Clock className="h-3 w-3 mr-1" />
                              Expires {new Date(attachment.autoDeleteAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2">
                    <button
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="View details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    
                    <button
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    
                    <button
                      onClick={() => onRemoveAttachment(attachment.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm text-gray-500">Total Size</div>
          <div className="text-xl font-semibold text-gray-900">
            {formatFileSize(filteredAttachments.reduce((sum, att) => sum + att.fileSize, 0))}
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm text-gray-500">Pending Processing</div>
          <div className="text-xl font-semibold text-gray-900">
            {filteredAttachments.filter(att => !att.processed).length}
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <div className="text-sm text-gray-500">Expiring Soon</div>
          <div className="text-xl font-semibold text-gray-900">
            {filteredAttachments.filter(att => 
              att.autoDeleteAt && 
              new Date(att.autoDeleteAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
            ).length}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttachmentsTab; 