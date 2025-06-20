/**
 * Create Ticket Page
 * 
 * This page allows users to create new tickets/email threads by composing
 * an initial email to send to a recipient. The ticket will be created within
 * the context of the specified store and assigned to the current user.
 * 
 * Features:
 * - Store-specific ticket creation
 * - Email composition with rich text editor
 * - Template integration
 * - Assignment management
 * - Multi-tenant business scoping
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Send, X, User, Mail, FileText, Layout } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useInbox } from '../contexts/InboxContext';
import { useAuth } from '../contexts/AuthContext';
import TemplateSelector from '../components/email/TemplateSelector';

const CreateTicket: React.FC = () => {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const { stores, loading, refreshEmails } = useInbox();
  const { user } = useAuth();
  
  const [store, setStore] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  
  // Form state
  const [formData, setFormData] = useState({
    to: '',
    subject: '',
    assignedTo: '',
    content: ''
  });
  
  const [emailSuggestions, setEmailSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Form validation
  const [errors, setErrors] = useState<{
    to?: string;
    subject?: string;
    content?: string;
  }>({});

  // Quill editor configuration
  const quillModules = {
    toolbar: [
      [{ 'header': [1, 2, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'indent': '-1'}, { 'indent': '+1' }],
      ['link', 'image'],
      ['clean']
    ],
  };

  const quillFormats = [
    'header', 'bold', 'italic', 'underline', 'strike',
    'color', 'background', 'list', 'bullet', 'indent',
    'link', 'image'
  ];

  // Draft saving functionality
  useEffect(() => {
    const draftKey = `create-ticket-draft-${storeId}`;
    
    // Load draft on component mount (only once)
    const savedDraft = localStorage.getItem(draftKey);
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        setFormData(prev => ({
          ...prev,
          to: draft.to || '',
          subject: draft.subject || '',
          content: draft.content || ''
          // Don't restore assignedTo - keep default user assignment
        }));
        setLastSaved(new Date(draft.savedAt));
      } catch (error) {
        console.error('Error loading draft:', error);
      }
    }
  }, [storeId]); // Only depend on storeId, not form data

  // Separate effect for auto-saving
  useEffect(() => {
    const draftKey = `create-ticket-draft-${storeId}`;
    
    // Auto-save draft every 30 seconds
    const saveInterval = setInterval(() => {
      if (formData.to || formData.subject || formData.content) {
        const draft = {
          to: formData.to,
          subject: formData.subject,
          content: formData.content,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(draftKey, JSON.stringify(draft));
        setLastSaved(new Date());
      }
    }, 30000);

    return () => {
      clearInterval(saveInterval);
    };
  }, [formData.to, formData.subject, formData.content, storeId]);

  // Clear draft on successful submission
  const clearDraft = () => {
    const draftKey = `create-ticket-draft-${storeId}`;
    localStorage.removeItem(draftKey);
    setLastSaved(null);
  };

  // Clear all form data and draft
  const clearForm = () => {
    const confirmed = window.confirm('Are you sure you want to clear all form data? This action cannot be undone.');
    if (confirmed) {
      setFormData({
        to: '',
        subject: '',
        assignedTo: user?.id || '',
        content: ''
      });
      clearDraft();
      setErrors({});
    }
  };

  // Find and validate store access
  useEffect(() => {
    if (!loading && stores && storeId) {
      const foundStore = stores.find(s => s.id === storeId);
      if (foundStore) {
        setStore(foundStore);
        // Set default assignment to current user
        setFormData(prev => ({ ...prev, assignedTo: user?.id || '' }));
      } else {
        navigate('/inbox');
        return;
      }
    }
    setPageLoading(false);
  }, [stores, storeId, loading, navigate, user]);

  // Load team members for assignment dropdown
  useEffect(() => {
    const loadTeamMembers = async () => {
      if (!user) return;
      
      try {
        // Import the TeamService dynamically to avoid circular dependencies
        const { TeamService } = await import('../services/teamService');
        const members = await TeamService.getTeamMembers();
        setTeamMembers(members);
      } catch (error) {
        console.error('Error loading team members:', error);
        // Fallback to current user only
        setTeamMembers([]);
      }
    };
    
    loadTeamMembers();
  }, [user]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Enter to send
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        if (!isSubmitting && validateForm()) {
          handleSubmit('send');
        }
      }
      
      // Escape to hide templates
      if (event.key === 'Escape' && showTemplates) {
        setShowTemplates(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSubmitting, showTemplates, formData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear any pending suggestions
      setEmailSuggestions([]);
      setShowSuggestions(false);
    };
  }, []);

  // Handle back navigation
  const handleBack = () => {
    navigate(`/inbox/${storeId}`);
  };

  // Handle form field changes
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field as keyof typeof errors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  // Handle email suggestion selection
  const handleSuggestionSelect = (email: string) => {
    setFormData(prev => ({ ...prev, to: email }));
    setShowSuggestions(false);
    setEmailSuggestions([]);
  };

  // Handle Quill editor changes
  const handleQuillChange = (content: string) => {
    setFormData(prev => ({ ...prev, content }));
    
    // Clear content error when user starts typing
    if (errors.content) {
      setErrors(prev => ({ ...prev, content: undefined }));
    }
  };

  // Handle template selection
  const handleTemplateSelect = (templateContent: string) => {
    setFormData(prev => ({ ...prev, content: templateContent }));
    setShowTemplates(false);
    
    // Clear content error when template is selected
    if (errors.content) {
      setErrors(prev => ({ ...prev, content: undefined }));
    }
  };

  // Helper function to strip HTML tags for validation
  const stripHTML = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };

  // Contact search functionality
  const searchContacts = async (searchTerm: string) => {
    if (!searchTerm || searchTerm.length < 3) {
      setEmailSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      // Import supabase to search for previous email contacts
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      );
      
      // Search for emails from this business that contain the search term
      const { data: emails } = await supabase
        .from('emails')
        .select('from, to')
        .or(`from.ilike.%${searchTerm}%,to.ilike.%${searchTerm}%`)
        .eq('store_id', storeId)
        .limit(10);

      if (emails) {
        // Extract unique email addresses
        const allEmails = [...emails.flatMap(e => [e.from, e.to])];
        const uniqueEmails = [...new Set(allEmails)]
          .filter(email => email && email.toLowerCase().includes(searchTerm.toLowerCase()))
          .slice(0, 5);
        
        setEmailSuggestions(uniqueEmails);
        setShowSuggestions(uniqueEmails.length > 0);
      }
    } catch (error) {
      console.error('Error searching contacts:', error);
      setEmailSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Debounced contact search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (formData.to) {
        searchContacts(formData.to);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [formData.to, storeId]);

  // Form validation
  const validateForm = () => {
    const newErrors: typeof errors = {};
    
    // Email validation
    if (!formData.to.trim()) {
      newErrors.to = 'Recipient email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.to.trim())) {
        newErrors.to = 'Please enter a valid email address';
      }
    }
    
    // Subject validation
    if (!formData.subject.trim()) {
      newErrors.subject = 'Subject is required';
    }
    
    // Content validation - strip HTML to check for actual content
    const plainTextContent = stripHTML(formData.content).trim();
    if (!plainTextContent) {
      newErrors.content = 'Message content is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (action: 'send' | 'send_and_close') => {
    if (!validateForm()) return;
    
    // Confirm Send & Close action
    if (action === 'send_and_close') {
      const confirmed = window.confirm(
        'Are you sure you want to send this email and mark the ticket as resolved? This will close the ticket immediately.'
      );
      if (!confirmed) return;
    }
    
    setIsSubmitting(true);
    try {
      // Get current session for API call  
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      );
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('No active session found');
      }

      // Call create-ticket edge function
      console.log('Submitting ticket:', { 
        storeId, 
        to: formData.to.trim(),
        subject: formData.subject.trim(),
        content: formData.content,
        assignedTo: formData.assignedTo,
        action 
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-ticket`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          storeId,
          to: formData.to.trim(),
          subject: formData.subject.trim(),
          content: formData.content,
          assignedTo: formData.assignedTo,
          action
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create ticket');
      }

      console.log('Ticket created successfully:', result);

      // Show success message
      const { toast } = await import('react-hot-toast');
      toast.success(result.message || 'Ticket created successfully');

      // Clear draft
      clearDraft();

      // Refresh inbox to show new ticket
      try {
        await refreshEmails();
      } catch (refreshError) {
        console.warn('Failed to refresh emails after ticket creation:', refreshError);
        // Non-fatal error - ticket was still created successfully
      }

      // Navigate based on action
      if (action === 'send') {
        // Navigate to the created thread
        navigate(`/inbox/email/${result.data.threadId}`);
      } else {
        // Navigate back to store inbox
        navigate(`/inbox/${storeId}`);
      }
    } catch (error: any) {
      console.error('Error creating ticket:', error);
      const { toast } = await import('react-hot-toast');
      toast.error(error.message || 'Failed to create ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (pageLoading || loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="mt-2 text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Store not found or access denied</p>
          <button
            onClick={() => navigate('/inbox')}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
          >
            Back to Inbox
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={handleBack}
              className="inline-flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} className="mr-1" /> Back to inbox
            </button>
          </div>
        </div>
        
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Create Ticket</h1>
        
        <div className="flex items-center text-sm text-gray-600">
          <div className="flex items-center mr-4">
            <div 
              className="h-3 w-3 rounded-full mr-2" 
              style={{ backgroundColor: store.color }}
            ></div>
            <span>{store.name}</span>
          </div>
          <span className="text-gray-500">•</span>
          <span className="ml-2">{store.email}</span>
        </div>
      </div>
      
      {/* Form Content */}
      <div className="flex-1 bg-gray-50 overflow-auto">
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-lg shadow">
            {/* Form Header */}
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Compose New Ticket</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create a new support ticket and send the initial message
              </p>
            </div>
            
            {/* Form Fields */}
            <div className="p-6 space-y-6">
              {/* To Field */}
              <div className="relative">
                <label htmlFor="to" className="block text-sm font-medium text-gray-700 mb-2">
                  <Mail size={16} className="inline mr-2" />
                  To
                </label>
                <input
                  type="email"
                  id="to"
                  value={formData.to}
                  onChange={(e) => handleInputChange('to', e.target.value)}
                  placeholder="customer@example.com"
                  className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm ${
                    errors.to ? 'border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500' : ''
                  }`}
                />
                {errors.to && (
                  <p className="mt-2 text-sm text-red-600">{errors.to}</p>
                )}
                                 {/* Email suggestions dropdown */}
                 {showSuggestions && emailSuggestions.length > 0 && (
                   <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 overflow-y-auto">
                     {emailSuggestions.map((email, index) => (
                       <button
                         key={index}
                         type="button"
                         onClick={() => handleSuggestionSelect(email)}
                         className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                       >
                         {email}
                       </button>
                     ))}
                   </div>
                 )}
              </div>

              {/* Subject Field */}
              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                  <FileText size={16} className="inline mr-2" />
                  Subject
                </label>
                <input
                  type="text"
                  id="subject"
                  value={formData.subject}
                  onChange={(e) => handleInputChange('subject', e.target.value)}
                  placeholder="Enter ticket subject"
                  className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm ${
                    errors.subject ? 'border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500' : ''
                  }`}
                />
                {errors.subject && (
                  <p className="mt-2 text-sm text-red-600">{errors.subject}</p>
                )}
              </div>

                             {/* Assignment Field */}
               <div>
                 <label htmlFor="assignedTo" className="block text-sm font-medium text-gray-700 mb-2">
                   <User size={16} className="inline mr-2" />
                   Assign to
                 </label>
                 <select
                   id="assignedTo"
                   value={formData.assignedTo}
                   onChange={(e) => handleInputChange('assignedTo', e.target.value)}
                   className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                 >
                   <option value={user?.id || ''}>{user?.email} (Me)</option>
                   {teamMembers.map((member) => (
                     <option key={member.user_id} value={member.user_id}>
                       {member.email} - {member.first_name} {member.last_name} ({member.role})
                     </option>
                   ))}
                 </select>
               </div>

              {/* Rich Text Editor */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="content" className="block text-sm font-medium text-gray-700">
                    Message
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200"
                  >
                                         <Layout size={14} className="mr-1" />
                    {showTemplates ? 'Hide Templates' : 'Use Template'}
                  </button>
                </div>
                
                {/* Template Selector */}
                {showTemplates && (
                  <div className="border border-gray-300 rounded-t-lg border-b-0 mb-0">
                    <TemplateSelector
                      onSelect={handleTemplateSelect}
                      onClose={() => setShowTemplates(false)}
                      existingContent={formData.content}
                    />
                  </div>
                )}
                
                <div className={`${errors.content ? 'border-red-300' : 'border-gray-300'} ${showTemplates ? 'rounded-b-md border-t-0' : 'rounded-md'}`}>
                  <ReactQuill
                    theme="snow"
                    value={formData.content}
                    onChange={handleQuillChange}
                    modules={quillModules}
                    formats={quillFormats}
                    placeholder="Type your message here..."
                    style={{
                      height: '200px',
                      marginBottom: '42px' // Account for toolbar height
                    }}
                  />
                </div>
                {errors.content && (
                  <p className="mt-2 text-sm text-red-600">{errors.content}</p>
                )}
              </div>
            </div>
            
            {/* Form Actions */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-gray-500">
                    <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded">Ctrl</kbd> + 
                    <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded ml-1">Enter</kbd>
                    <span className="ml-2">to send</span>
                  </div>
                  
                  {lastSaved && (
                    <div className="text-xs text-gray-400">
                      Draft saved at {lastSaved.toLocaleTimeString()}
                    </div>
                  )}
                  
                  {(formData.to || formData.subject || formData.content) && (
                    <button
                      type="button"
                      onClick={clearForm}
                      className="text-xs text-red-600 hover:text-red-800 underline"
                    >
                      Clear Form
                    </button>
                  )}
                  
                  {formData.content && (
                    <div className="text-xs text-gray-400">
                      {stripHTML(formData.content).length} characters
                    </div>
                  )}
                </div>
                
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => handleSubmit('send_and_close')}
                    disabled={isSubmitting}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Send email and mark ticket as resolved"
                  >
                    {isSubmitting ? (
                      <Loader2 size={16} className="animate-spin mr-2" />
                    ) : (
                      <X size={16} className="mr-2" />
                    )}
                    Send & Close
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handleSubmit('send')}
                    disabled={isSubmitting}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    title="Send email and keep ticket open (Ctrl+Enter)"
                  >
                    {isSubmitting ? (
                      <Loader2 size={16} className="animate-spin mr-2" />
                    ) : (
                      <Send size={16} className="mr-2" />
                    )}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateTicket; 