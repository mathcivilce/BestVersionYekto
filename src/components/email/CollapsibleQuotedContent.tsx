import React, { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { EmailContentWithAttachments } from '../EmailContentWithAttachments';
import { getQuotedHeadersSummary, ParsedEmailContent } from '../../utils/emailContentParser';

interface CollapsibleQuotedContentProps {
  quotedContent: string;
  quotedHeaders?: ParsedEmailContent['quotedHeaders'];
  className?: string;
}

const CollapsibleQuotedContent: React.FC<CollapsibleQuotedContentProps> = ({
  quotedContent,
  quotedHeaders,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!quotedContent) return null;

  const headersSummary = getQuotedHeadersSummary(quotedHeaders);

  return (
    <div className={`mt-4 border-t border-gray-200 pt-4 ${className}`}>
      {!isExpanded ? (
        // Collapsed state - Gmail style
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center space-x-2 text-gray-500 hover:text-gray-700 text-sm group"
            title="Show quoted text"
          >
            <MoreHorizontal 
              size={16} 
              className="text-gray-400 group-hover:text-gray-600 transition-colors" 
            />
            <span className="text-gray-400 group-hover:text-gray-600 transition-colors">
              {headersSummary || 'Show quoted text'}
            </span>
          </button>
        </div>
      ) : (
        // Expanded state
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {headersSummary && (
                <div className="mb-2 p-2 bg-gray-50 rounded text-xs text-gray-500 border-l-4 border-gray-300">
                  {headersSummary}
                </div>
              )}
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              title="Hide quoted text"
            >
              Hide quoted text
            </button>
          </div>
          
          {/* Quoted content with visual distinction */}
          <div className="border-l-4 border-gray-300 pl-4 bg-gray-50 rounded-r">
            <div className="py-2">
              <EmailContentWithAttachments 
                htmlContent={quotedContent}
                className="text-gray-600 text-sm opacity-90"
                maxImageWidth={400}
                maxImageHeight={300}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollapsibleQuotedContent; 