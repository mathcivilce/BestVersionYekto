import React, { useState, useEffect } from 'react';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex divide-x divide-gray-200 h-[300px]">
      {/* Template List */}
      <div className="w-1/2 overflow-y-auto p-4 space-y-2">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Reply Templates</h3>
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => handleSelect(template)}
            onMouseEnter={() => setSelectedTemplate(template)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              selectedTemplate?.id === template.id ? 'bg-gray-100' : ''
            }`}
          >
            {template.name}
          </button>
        ))}
      </div>

      {/* Preview Panel */}
      <div className="w-1/2 p-4 bg-gray-50 overflow-y-auto">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Preview</h3>
        <div className="prose prose-sm max-w-none text-gray-600">
          {selectedTemplate ? (
            <div className="whitespace-pre-wrap">{selectedTemplate.content}</div>
          ) : (
            <p className="text-gray-400 italic">
              Hover over a template to preview its content
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplateSelector;