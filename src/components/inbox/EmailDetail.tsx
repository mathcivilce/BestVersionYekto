import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Star, Tag, Clock, User, Edit2, ArrowRight, Trash2, Loader2, StickyNote } from 'lucide-react';
import DOMPurify from 'dompurify';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import CustomerSidebar from '../customer/CustomerSidebar';
import TemplateSelector from '../email/TemplateSelector';
import EmailPresenceIndicator from '../presence/EmailPresenceIndicator';
import { useInbox } from '../../contexts/InboxContext';
import { useAuth } from '../../contexts/AuthContext';
import { getThreadSubject } from '../../utils/email';

interface EmailDetailProps {
  email: any;
  onBack: () => void;
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const EmailDetail: React.FC<EmailDetailProps> = ({ email, onBack }) => {
  const { user } = useAuth();
  const [assignedUser, setAssignedUser] = useState<any>(null);
  const [loadingAssignment, setLoadingAssignment] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [replyMode, setReplyMode] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [sending, setSending] = useState(false);
  const [thread, setThread] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const navigate = useNavigate();
  const { deleteEmail } = useInbox();



  const threadSubject = useMemo(() => 
    getThreadSubject(thread, email.thread_id || email.id),
    [thread, email]
  );

  useEffect(() => {
    const fetchAssignedUser = async () => {
      if (!email.assigned_to) return;
      
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', email.assigned_to)
          .single();

        if (error) throw error;
        setAssignedUser(data);
      } catch (err) {
        console.error('Error fetching assigned user:', err);
      }
    };

    fetchAssignedUser();
  }, [email.assigned_to]);

  const handleAssign = async (userId: string | null) => {
    try {
      setLoadingAssignment(true);

      const { error } = await supabase
        .from('emails')
        .update({ assigned_to: userId })
        .eq('id', email.id);

      if (error) throw error;

      if (userId) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', userId)
          .single();
          
        setAssignedUser(profile);
        toast.success('Email assigned successfully');
      } else {
        setAssignedUser(null);
        toast.success('Email unassigned');
      }
    } catch (err) {
      console.error('Error assigning email:', err);
      toast.error('Failed to assign email');
    } finally {
      setLoadingAssignment(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteEmail(email.id);
      navigate('/inbox');
    } catch (error) {
      console.error('Error deleting email:', error);
    }
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!replyContent.trim()) {
      toast.error('Please enter a reply message');
      return;
    }

    try {
      setSending(true);

      // Auto-assign to the replying user if not already assigned
      if (!email.assigned_to) {
        await handleAssign(user?.id || null);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            emailId: email.id,
            content: replyContent
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send reply');
      }

      const { data: reply } = await response.json();

      setThread(prev => [...prev, {
        ...reply,
        type: 'reply',
        timestamp: new Date().getTime()
      }]);

      toast.success('Reply sent successfully');
      setReplyContent('');
      setReplyMode(false);
    } catch (err) {
      console.error('Error sending reply:', err);
      toast.error(err.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const handleTemplateSelect = (content: string) => {
    setReplyContent(content);
    setShowTemplates(false);
  };

  useEffect(() => {
    const fetchThread = async () => {
      try {
        setLoading(true);
        
        // Fetch all emails in the thread
        const { data: threadEmails, error: threadError } = await supabase
          .from('emails')
          .select('*')
          .or(`thread_id.eq.${email.thread_id},id.eq.${email.id}`)
          .order('date', { ascending: true });

        if (threadError) throw threadError;

        // Fetch replies for all emails in the thread
        const { data: replies, error: repliesError } = await supabase
          .from('email_replies')
          .select('*')
          .in('email_id', threadEmails.map(e => e.id))
          .order('sent_at', { ascending: true });

        if (repliesError) throw repliesError;

        // Fetch internal notes
        const { data: notes, error: notesError } = await supabase
          .from('internal_notes')
          .select('*')
          .in('email_id', threadEmails.map(e => e.id))
          .order('created_at', { ascending: true });

        if (notesError) throw notesError;

        // If we have notes, fetch the corresponding user profiles
        let userProfiles: Record<string, any> = {};
        if (notes && notes.length > 0) {
          const uniqueUserIds = [...new Set(notes.map(n => n.user_id))];
          const { data: profiles, error: profilesError } = await supabase
            .from('user_profiles')
            .select('user_id, first_name, last_name')
            .in('user_id', uniqueUserIds);

          if (profilesError) throw profilesError;

          // Create a map of user_id to profile data
          userProfiles = (profiles || []).reduce((acc, profile) => ({
            ...acc,
            [profile.user_id]: profile
          }), {});
        }

        // Combine and sort all messages by date
        const allMessages = [
          ...threadEmails.map((e: any) => ({ 
            ...e, 
            type: 'email',
            timestamp: new Date(e.date).getTime()
          })),
          ...replies.map((r: any) => ({ 
            ...r, 
            type: 'reply',
            timestamp: new Date(r.sent_at).getTime()
          })),
          ...notes.map((n: any) => {
            const userProfile = userProfiles[n.user_id];
            return {
              ...n,
              type: 'note',
              timestamp: new Date(n.created_at).getTime(),
              author: userProfile
                ? `${userProfile.first_name} ${userProfile.last_name}`.trim() || 'Unknown User'
                : 'Unknown User'
            };
          })
        ].sort((a, b) => a.timestamp - b.timestamp);

        setThread(allMessages);
      } catch (error) {
        console.error('Error fetching thread:', error);
        toast.error('Failed to load email thread');
      } finally {
        setLoading(false);
      }
    };

    if (email.id) {
      fetchThread();
    }
  }, [email]);

  const handleSubmitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!noteContent.trim()) {
      toast.error('Please enter a note');
      return;
    }

    try {
      setSending(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      // Get user profile
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('first_name, last_name')
        .eq('user_id', session.user.id)
        .single();

      const { data: note, error } = await supabase
        .from('internal_notes')
        .insert({
          email_id: email.id,
          user_id: session.user.id,
          content: noteContent,
        })
        .select()
        .single();

      if (error) throw error;

      setThread(prev => [...prev, {
        ...note,
        type: 'note',
        timestamp: new Date().getTime(),
        author: userProfile
          ? `${userProfile.first_name} ${userProfile.last_name}`.trim() || 'Unknown User'
          : 'Unknown User'
      }]);

      toast.success('Note added successfully');
      setNoteContent('');
      setNoteMode(false);
    } catch (err) {
      console.error('Error adding note:', err);
      toast.error('Failed to add note');
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'resolved':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const renderEmailContent = (content: string) => {
    if (!content) return null;

    const isHTML = /<[a-z][\s\S]*>/i.test(content);

    if (isHTML) {
      return (
        <div
          className="prose prose-sm max-w-none text-gray-700"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(content, {
              ALLOWED_TAGS: [
                'p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img',
                'blockquote', 'pre', 'code', 'div', 'span'
              ],
              ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class'],
              ALLOW_DATA_ATTR: false
            })
          }}
        />
      );
    }

    return (
      <div className="whitespace-pre-wrap text-gray-700">
        {content}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row">
      <div className={`flex-1 flex flex-col h-full ${showSidebar ? 'md:mr-64' : ''}`}>
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={onBack}
              className="inline-flex items-center text-gray-600 hover:text-gray-900"
            >
              <ChevronLeft size={20} className="mr-1" /> Back to inbox
            </button>
            
            <div className="flex items-center space-x-4">
              
              <div className="relative">
                <button
                  disabled={loadingAssignment}
                  onClick={() => handleAssign(user?.id || null)}
                  className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md ${
                    assignedUser
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {loadingAssignment ? (
                    <Loader2 size={16} className="animate-spin mr-2" />
                  ) : (
                    <User size={16} className="mr-2" />
                  )}
                  {assignedUser 
                    ? `Assigned to ${assignedUser.first_name} ${assignedUser.last_name}`
                    : 'Unassigned'
                  }
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full">
                  <Tag size={18} />
                </button>
                <button 
                  onClick={handleDelete}
                  className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-gray-100 rounded-full"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </div>
          
          <h1 className="text-xl font-semibold text-gray-900 mb-1">{threadSubject}</h1>
          
          <div className="flex flex-wrap items-center text-sm text-gray-600">
            <div className="flex items-center mr-4">
              <div 
                className="h-3 w-3 rounded-full mr-2" 
                style={{ backgroundColor: email.storeColor }}
              ></div>
              <span>{email.storeName}</span>
            </div>
            
            <div className="flex items-center mr-4">
              <Clock size={14} className="mr-1" />
              <span>{formatDate(email.date)}</span>
            </div>
            
            <div className="flex items-center mr-4">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(email.status)}`}>
                {email.status}
              </span>
            </div>
            
            <div className="flex items-center">
              {Array.from({ length: 3 }).map((_, i) => (
                <Star 
                  key={i}
                  size={14}
                  className={`${
                    i < email.priority
                      ? 'text-yellow-400 fill-current'
                      : 'text-gray-300'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-4 bg-white">
          {/* Real-time presence indicator */}
          <EmailPresenceIndicator emailId={email.id} />
          
          {thread.map((message, index) => (
            <div key={message.id} className="mb-6">
              <div className="flex items-start mb-3">
                <div className="mr-3 mt-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    message.type === 'note' 
                      ? 'bg-yellow-100 text-yellow-600'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {message.type === 'note' ? (
                      <StickyNote size={16} />
                    ) : (
                      <User size={16} />
                    )}
                  </div>
                </div>
                
                <div>
                  <div className="flex items-center">
                    <span className="font-medium text-gray-900">
                      {message.type === 'reply' ? 'You' : message.type === 'note' ? message.author : message.from}
                    </span>
                    <span className="mx-2 text-gray-500">•</span>
                    <span className="text-sm text-gray-500">
                      {formatDate(message.type === 'reply' ? message.sent_at : message.type === 'note' ? message.created_at : message.date)}
                    </span>
                  </div>
                  {index === 0 && message.type === 'email' && (
                    <span className="text-sm text-gray-600 block mt-1">
                      To: support@yourbusiness.com
                    </span>
                  )}
                </div>
              </div>
              
              <div className={`pl-11 ${
                message.type === 'note' 
                  ? 'bg-yellow-50 border-l-4 border-yellow-200 p-4 rounded'
                  : ''
              }`}>
                {renderEmailContent(message.content)}
              </div>
            </div>
          ))}
          
          <div className="pl-11 mt-6 space-y-4">
            {!replyMode && !noteMode && (
              <div className="flex space-x-4">
                <button
                  onClick={() => setReplyMode(true)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
                >
                  <Edit2 size={16} className="mr-2" /> Reply
                </button>
                <button
                  onClick={() => setNoteMode(true)}
                  className="inline-flex items-center px-4 py-2 border border-yellow-300 rounded-md shadow-sm text-sm font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 focus:outline-none"
                >
                  <StickyNote size={16} className="mr-2" /> Add Internal Note
                </button>
              </div>
            )}

            {replyMode && (
              <form onSubmit={handleSubmitReply}>
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  {showTemplates && (
                    <div className="border-b border-gray-200">
                      <TemplateSelector
                        onSelect={handleTemplateSelect}
                        onClose={() => setShowTemplates(false)}
                        existingContent={replyContent}
                      />
                    </div>
                  )}
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Write your reply..."
                    className="w-full p-3 text-gray-700 focus:outline-none"
                    rows={6}
                    disabled={sending}
                  ></textarea>
                  
                  <div className="bg-gray-50 px-3 py-2 border-t border-gray-300 flex justify-between items-center">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setShowTemplates(!showTemplates)}
                        className="px-3 py-1.5 text-gray-600 hover:text-gray-900"
                        disabled={sending}
                      >
                        {showTemplates ? 'Hide Templates' : 'Use Template'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyMode(false);
                          setReplyContent('');
                        }}
                        className="px-3 py-1.5 text-gray-600 hover:text-gray-900"
                        disabled={sending}
                      >
                        Cancel
                      </button>
                    </div>
                    
                    <button
                      type="submit"
                      disabled={sending}
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center disabled:opacity-50"
                    >
                      {sending ? (
                        <>
                          <Loader2 size={16} className="mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Send Reply <ArrowRight size={16} className="ml-1" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {noteMode && (
              <form onSubmit={handleSubmitNote}>
                <div className="border border-yellow-300 rounded-lg overflow-hidden bg-yellow-50">
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Write your internal note..."
                    className="w-full p-3 text-gray-700 focus:outline-none bg-yellow-50"
                    rows={4}
                    disabled={sending}
                  ></textarea>
                  
                  <div className="bg-yellow-100 px-3 py-2 border-t border-yellow-200 flex justify-between items-center">
                    <button
                      type="button"
                      onClick={() => setNoteMode(false)}
                      className="px-3 py-1.5 text-yellow-700 hover:text-yellow-900"
                      disabled={sending}
                    >
                      Cancel
                    </button>
                    
                    <button
                      type="submit"
                      disabled={sending}
                      className="px-4 py-1.5 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 flex items-center disabled:opacity-50"
                    >
                      {sending ? (
                        <>
                          <Loader2 size={16} className="mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          Add Note <StickyNote size={16} className="ml-1" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
      
      <div 
        className={`border-l border-gray-200 bg-gray-50 w-full md:w-64 fixed md:relative right-0 top-0 bottom-0 z-10 transform transition-transform duration-300 ease-in-out ${
          showSidebar ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
        } ${showSidebar ? 'md:block' : 'hidden md:block'}`}
      >
        <CustomerSidebar email={email} />
      </div>
      
      <button
        onClick={() => setShowSidebar(!showSidebar)}
        className="hidden md:block absolute right-4 top-4 z-20 p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
      >
        {showSidebar ? (
          <ChevronLeft size={20} />
        ) : (
          <ChevronLeft size={20} className="rotate-180 transform" />
        )}
      </button>


    </div>
  );
}

export default EmailDetail;