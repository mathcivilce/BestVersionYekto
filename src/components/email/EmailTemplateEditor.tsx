import React, { useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Save } from 'lucide-react';

interface EmailTemplateEditorProps {
  initialContent?: string;
  onSave: (content: string) => void;
}

const EmailTemplateEditor: React.FC<EmailTemplateEditorProps> = ({ initialContent = '', onSave }) => {
  const [content, setContent] = useState(initialContent);

  const modules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'color': [] }, { 'background': [] }],
      ['link'],
      ['clean']
    ],
  };

  const handleSave = () => {
    onSave(content);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">Email Template Editor</h3>
        <button
          onClick={handleSave}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <Save size={16} className="mr-2" />
          Save Template
        </button>
      </div>
      
      <div className="p-4">
        <ReactQuill
          theme="snow"
          value={content}
          onChange={setContent}
          modules={modules}
          className="h-96"
        />
        
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Available Variables:</h4>
          <div className="bg-gray-50 p-3 rounded-md">
            <ul className="text-sm text-gray-600 space-y-1">
              <li><code>{'{{customerName}}'}</code> - Customer's full name</li>
              <li><code>{'{{orderNumber}}'}</code> - Order reference number</li>
              <li><code>{'{{storeName}}'}</code> - Your store name</li>
              <li><code>{'{{supportEmail}}'}</code> - Support email address</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailTemplateEditor;