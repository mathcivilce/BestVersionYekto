import React, { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { EmailContentWithAttachments } from '../EmailContentWithAttachments';
import { EnterpriseEmailContent } from '../../utils/enterpriseEmailParserBrowser';

interface EnterpriseCollapsibleQuotedContentProps {
  quotedContent: string;
  quotedHeaders?: EnterpriseEmailContent['quotedHeaders'];
  metadata?: EnterpriseEmailContent['metadata'];
  className?: string;
}

const EnterpriseCollapsibleQuotedContent: React.FC<EnterpriseCollapsibleQuotedContentProps> = ({
  quotedContent,
  quotedHeaders,
  metadata,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!quotedContent) return null;

  // Create a professional header summary
  const createHeaderSummary = () => {
    const parts: string[] = [];
    
    if (quotedHeaders?.from) {
      // Extract just the name or email (cleaner display)
      const fromDisplay = quotedHeaders.from.includes('<') 
        ? quotedHeaders.from.split('<')[0].trim().replace(/"/g, '') || quotedHeaders.from
        : quotedHeaders.from;
      parts.push(fromDisplay);
    }
    
    if (quotedHeaders?.date) {
      // Format date nicely
      try {
        const date = new Date(quotedHeaders.date);
        const formattedDate = date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
        });
        parts.push(formattedDate);
      } catch {
        parts.push(quotedHeaders.date);
      }
    }
    
    if (quotedHeaders?.subject) {
      const subject = quotedHeaders.subject.length > 50 
        ? quotedHeaders.subject.substring(0, 50) + '...'
        : quotedHeaders.subject;
      parts.push(`"${subject}"`);
    }
    
    return parts.length > 0 ? parts.join(' • ') : 'Previous message';
  };

  const headerSummary = createHeaderSummary();

  return (
    <div className={className}>
      {!isExpanded ? (
        // Collapsed state - Just three dots without preview text
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center text-gray-500 hover:text-gray-700 text-sm group transition-all duration-200 hover:bg-gray-50 rounded-lg p-2"
            title="Show quoted message"
          >
            <MoreHorizontal 
              size={16} 
              className="text-gray-400 group-hover:text-gray-600 transition-colors" 
            />
          </button>
          
          {/* Metadata indicators - only show attachments */}
          {metadata?.hasAttachments && (
            <div className="flex items-center space-x-2 text-xs text-gray-400">
              <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                📎 Attachments
              </span>
            </div>
          )}
        </div>
      ) : (
        // Expanded state - Simplified layout without headers
        <div className="space-y-3">
          {/* Quoted content with enhanced styling */}
          <div className="border-l-4 border-blue-300 pl-4 bg-gradient-to-r from-gray-50 to-transparent rounded-r-lg">
            <div className="py-3">
              <EmailContentWithAttachments 
                htmlContent={quotedContent}
                className="text-gray-700 text-sm leading-relaxed"
                maxImageWidth={400}
                maxImageHeight={300}
                enableQuotedContentCollapsing={false} // Prevent nested collapsing
              />
            </div>
          </div>
          
          {/* Hide button replacing RFC compliance indicator */}
          <div className="flex justify-start">
            <button
              onClick={() => setIsExpanded(false)}
              className="flex items-center space-x-2 text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded hover:bg-gray-100"
              title="Hide quoted message"
            >
              <MoreHorizontal size={12} className="text-gray-400" />
              <span>Hide quoted message</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnterpriseCollapsibleQuotedContent; 