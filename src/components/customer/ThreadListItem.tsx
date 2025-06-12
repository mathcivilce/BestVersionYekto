import React from 'react';
import { MessageSquare, Clock, User } from 'lucide-react';
import { format } from 'date-fns';
import StatusBadge from '../ui/StatusBadge';

interface CustomerThread {
  thread_id: string;
  latest_subject: string;
  latest_status: string;
  latest_snippet: string;
  assigned_to: string | null;
  assigned_user_name: string | null;
  message_count: number;
  last_activity: string;
  thread_preview: string;
}

interface ThreadListItemProps {
  thread: CustomerThread;
  customerEmail: string;
  onClick: (thread: CustomerThread) => void;
}

const ThreadListItem: React.FC<ThreadListItemProps> = ({ thread, customerEmail, onClick }) => {
  const handleClick = () => {
    onClick(thread);
  };

  // Clean up the thread preview by removing HTML tags
  const cleanPreview = (preview: string) => {
    if (!preview) return 'No preview available';
    
    // Remove HTML tags and decode HTML entities
    const cleanText = preview
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
      .replace(/&amp;/g, '&') // Replace &amp; with &
      .replace(/&lt;/g, '<') // Replace &lt; with <
      .replace(/&gt;/g, '>') // Replace &gt; with >
      .replace(/&quot;/g, '"') // Replace &quot; with "
      .replace(/&apos;/g, "'") // Replace &apos; with '
      .replace(/&hellip;/g, '...') // Replace &hellip; with ...
      .replace(/\r\n/g, ' ') // Replace Windows line breaks with space
      .replace(/\n/g, ' ') // Replace Unix line breaks with space
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // Limit length to 150 characters
    return cleanText.length > 150 ? cleanText.substring(0, 147) + '...' : cleanText;
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffInHours = Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60);
      
      if (diffInHours < 24) {
        return format(date, 'h:mm a');
      } else if (diffInHours < 24 * 7) {
        return format(date, 'EEE h:mm a');
      } else {
        return format(date, 'MMM d, yyyy');
      }
    } catch (error) {
      return 'Invalid date';
    }
  };

  return (
    <div
      className="p-3 sm:p-4 hover:bg-gray-50 cursor-pointer transition-colors border-l-4 border-transparent hover:border-blue-400"
      onClick={handleClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 truncate pr-2">
            {thread.latest_subject || 'No Subject'}
          </h3>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center space-y-1 sm:space-y-0 sm:space-x-2 ml-2">
          <StatusBadge status={thread.latest_status as 'open' | 'resolved' | 'pending'} />
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {formatDate(thread.last_activity)}
          </span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 space-y-1 sm:space-y-0">
        <div className="flex items-center space-x-3 sm:space-x-4 text-xs text-gray-500">
          <div className="flex items-center">
            <MessageSquare className="w-3 h-3 mr-1" />
            <span>{thread.message_count} message{thread.message_count !== 1 ? 's' : ''}</span>
          </div>
          
          {thread.assigned_user_name && thread.assigned_user_name !== 'Unassigned' && (
            <div className="flex items-center">
              <User className="w-3 h-3 mr-1" />
              <span className="truncate max-w-20 sm:max-w-24" title={thread.assigned_user_name}>
                {thread.assigned_user_name}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-600 overflow-hidden">
        <div className="line-clamp-2" style={{ 
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}>
          {cleanPreview(thread.thread_preview)}
        </div>
      </div>
    </div>
  );
};

export default ThreadListItem; 