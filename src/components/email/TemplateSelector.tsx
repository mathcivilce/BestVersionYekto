import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

interface Template {
  id: string;
  name: string;
  content: string;
}

interface TemplateSelectorProps {
  onSelect: (content: string) => void;
  onClose: () => void;
  existingContent?: string;
}

const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  onSelect,
  onClose,
  existingContent = ''
}) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const { data, error } = await supabase
          .from('reply_templates')
          .select('*')
          .order('name');

        if (error) throw error;
        setTemplates(data || []);
      } catch (error) {
        console.error('Error fetching templates:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  const handleSelect = (template: Template) => {
    const newContent = existingContent
      ? `${existingContent}\n\n${template.content}`
      : template.content;
    onSelect(newContent);
    onClose();
  };

  // Filter templates based on search query
  const filteredTemplates = templates.filter(template => {
    if (!searchQuery.trim()) return true;
    
    const searchLower = searchQuery.toLowerCase();
    const nameMatch = template.name.toLowerCase().includes(searchLower);
    const contentMatch = template.content.replace(/<[^>]+>/g, '').toLowerCase().includes(searchLower);
    
    return nameMatch || contentMatch;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[280px] bg-white">
      {/* Search Bar */}
      <div className="flex-shrink-0 p-3 border-b border-gray-200">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
            placeholder="Search templates by name or content..."
          />
        </div>
      </div>

      <div className="flex divide-x divide-gray-200 flex-1 min-h-0">
        {/* Template List */}
        <div className="w-1/2 flex flex-col">
          <div className="flex-shrink-0 p-3 pb-2">
            <h3 className="text-sm font-medium text-gray-900">Reply Templates</h3>
          </div>
          <div className="flex-1 px-3 pb-3 overflow-y-auto max-h-[200px]">
            <div className="space-y-1">
              {filteredTemplates.length === 0 ? (
                <div className="text-center py-4">
                  <Search className="mx-auto h-6 w-6 text-gray-400 mb-2" />
                  <p className="text-xs text-gray-500">
                    {searchQuery.trim() ? 'No templates match your search' : 'No templates available'}
                  </p>
                  {searchQuery.trim() && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="text-blue-600 hover:text-blue-500 text-xs font-medium mt-1"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                filteredTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleSelect(template)}
                    onMouseEnter={() => setSelectedTemplate(template)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                      selectedTemplate?.id === template.id ? 'bg-gray-100' : ''
                    }`}
                  >
                    {template.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="w-1/2 bg-gray-50 flex flex-col">
          <div className="flex-shrink-0 p-3 pb-2">
            <h3 className="text-sm font-medium text-gray-900">Preview</h3>
          </div>
                     <div className="flex-1 px-3 pb-3 overflow-y-auto max-h-[200px]">
            <div className="prose prose-sm max-w-none text-gray-600">
              {selectedTemplate ? (
                <div 
                  className="rich-template-preview text-xs leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: selectedTemplate.content }}
                />
              ) : (
                <p className="text-gray-400 italic text-xs">
                  Hover over a template to preview its content
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateSelector;