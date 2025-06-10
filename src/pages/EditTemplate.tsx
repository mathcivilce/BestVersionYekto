import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import RichTextEditor from '../components/email/RichTextEditor';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

interface Template {
  id: string;
  name: string;
  content: string;
  created_at: string;
}

const EditTemplate: React.FC = () => {
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const [template, setTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    content: ''
  });
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchTemplate = async () => {
      if (!templateId) {
        toast.error('Template ID is required');
        navigate('/workflows/templates');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('reply_templates')
          .select('*')
          .eq('id', templateId)
          .single();

        if (error) throw error;

        if (!data) {
          toast.error('Template not found');
          navigate('/workflows/templates');
          return;
        }

        setTemplate(data);
        setFormData({
          name: data.name,
          content: data.content
        });
      } catch (error) {
        console.error('Error fetching template:', error);
        toast.error('Failed to load template');
        navigate('/workflows/templates');
      } finally {
        setLoading(false);
      }
    };

    fetchTemplate();
  }, [templateId, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    
    if (!formData.content.trim()) {
      toast.error('Please enter template content');
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase
        .from('reply_templates')
        .update({
          name: formData.name.trim(),
          content: formData.content
        })
        .eq('id', templateId);

      if (error) throw error;

      toast.success('Template updated successfully');
      navigate('/workflows/templates');
    } catch (error) {
      console.error('Error updating template:', error);
      toast.error('Failed to update template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!template) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/workflows/templates')}
            className="inline-flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} className="mr-1" /> Back to Templates
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Edit Template</h1>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white shadow rounded-lg">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Template Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Template Name *
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-md border border-gray-300 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
              placeholder="Enter template name..."
              required
            />
          </div>

          {/* Template Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template Content *
            </label>
            <div className="border border-gray-300 rounded-md">
              <RichTextEditor
                value={formData.content}
                onChange={(content, attachments) => {
                  setFormData({ ...formData, content });
                  setAttachments(attachments);
                }}
                placeholder="Write your template content..."
                disabled={saving}
                showStorageInfo={false}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Use formatting, links, and other rich text features. This content will be preserved when the template is used.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/workflows/templates')}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Updating...
                </>
              ) : (
                <>
                  <Save size={16} className="mr-2" />
                  Update Template
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditTemplate; 