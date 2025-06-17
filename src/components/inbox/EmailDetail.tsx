import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Star, Tag, Clock, User, Edit2, ArrowRight, Trash2, Loader2, StickyNote } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import toast from 'react-hot-toast';
import CustomerSidebar from '../customer/CustomerSidebar';
import TemplateSelector from '../email/TemplateSelector';
import RichTextEditor from '../email/RichTextEditor';
import EmailPresenceIndicator from '../presence/EmailPresenceIndicator';
import { useInbox } from '../../contexts/InboxContext';
import { useAuth } from '../../contexts/AuthContext';
import { getThreadSubject } from '../../utils/email';
import EmailAssignmentIndicator from '../assignment/EmailAssignmentIndicator';
import EmailContentWithAttachments from '../EmailContentWithAttachments';

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
  const [showSidebar, setShowSidebar] = useState(true);
  const [replyMode, setReplyMode] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<any[]>([]);
  const [noteContent, setNoteContent] = useState('');
  const [sending, setSending] = useState(false);
  const [thread, setThread] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [realtimeSubscription, setRealtimeSubscription] = useState<any>(null);
  const [currentStore, setCurrentStore] = useState<any>(null);


  const navigate = useNavigate();
  const { deleteEmail, markAsRead } = useInbox();

  // Memoize stable email properties to prevent unnecessary re-renders
  const emailId = email.id;
  const threadId = email.thread_id;

  const threadSubject = useMemo(() => 
    getThreadSubject(thread, threadId || emailId),
    [thread, threadId, emailId]
  );

  // Fetch current user profile
  useEffect(() => {
    const fetchCurrentUserProfile = async () => {
      if (!user?.id) return;
      
      try {
        const { data: profile, error } = await supabase
          .from('user_profiles')
          .select('first_name, last_name')
          .eq('user_id', user.id)
          .single();

        if (error) throw error;
        setCurrentUserProfile(profile);
      } catch (error) {
        console.error('Error fetching current user profile:', error);
      }
    };

    fetchCurrentUserProfile();
  }, [user?.id]);

  // Fetch current store information
  useEffect(() => {
    const fetchCurrentStore = async () => {
      if (!email?.store_id) return;
      
      try {
        const { data: store, error } = await supabase
          .from('stores')
          .select('email, name')
          .eq('id', email.store_id)
          .single();

        if (error) throw error;
        setCurrentStore(store);
      } catch (error) {
        console.error('Error fetching current store:', error);
      }
    };

    fetchCurrentStore();
  }, [email?.store_id]);

  // Mark email as read when opening it
  useEffect(() => {
    const markEmailAsRead = async () => {
      if (email && !email.read) {
        try {
          await markAsRead(emailId);
        } catch (error) {
          console.error('Error marking email as read:', error);
        }
      }
    };

    markEmailAsRead();
  }, [email, emailId, markAsRead]);

  // Helper function to fetch user profile for realtime notes
  const fetchUserProfile = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('first_name, last_name')
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return profile;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  };

  // Handle incoming realtime notes
  const handleRealtimeNote = async (payload: any) => {
    const { new: newNote } = payload;
    
    // Don't add if it's from the current user (already added optimistically)
    if (newNote.user_id === user?.id) {
      return;
    }

    // Only add if it's for the current email
    if (newNote.email_id !== emailId) {
      return;
    }

    try {
      // Fetch the user profile for the note author
      const userProfile = await fetchUserProfile(newNote.user_id);
      const authorName = userProfile
        ? `${userProfile.first_name} ${userProfile.last_name}`.trim() || 'Unknown User'
        : 'Unknown User';

      // Create the note object to add to thread
      const noteToAdd = {
        ...newNote,
        type: 'note',
        timestamp: new Date(newNote.created_at).getTime(),
        author: authorName
      };

      // Add to thread state
      setThread(prev => {
        // Check if note already exists to prevent duplicates
        const noteExists = prev.some(item => 
          item.type === 'note' && 
          item.id === newNote.id
        );
        
        if (noteExists) {
          return prev;
        }

        // Add and sort by timestamp
        return [...prev, noteToAdd].sort((a, b) => a.timestamp - b.timestamp);
      });

      // Show a subtle notification
      toast.success(`${authorName} added a note`, {
        duration: 3000,
        icon: '📝'
      });
    } catch (error) {
      console.error('Error handling realtime note:', error);
    }
  };

  // Set up realtime subscription for internal notes
  useEffect(() => {
    if (!emailId || !user?.id) return;

    // Create realtime subscription
    const subscription = supabase
      .channel(`internal_notes_${emailId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'internal_notes',
          filter: `email_id=eq.${emailId}`
        },
        handleRealtimeNote
      )
      .subscribe();

    setRealtimeSubscription(subscription);

    // Cleanup function
    return () => {
      if (subscription) {
        supabase.removeChannel(subscription);
      }
    };
  }, [emailId, user?.id]);

  useEffect(() => {
    const fetchThread = async () => {
      try {
        setLoading(true);
        
        // Fetch all emails in the thread
        let threadQuery = `id.eq.${emailId}`;
        if (threadId) {
          threadQuery = `thread_id.eq.${threadId},id.eq.${emailId}`;
        }
        
        const { data: threadEmails, error: threadError } = await supabase
          .from('emails')
          .select('*')
          .or(threadQuery)
          .order('date', { ascending: true });

        if (threadError) throw threadError;

        // Fetch replies for all emails in the thread
        const { data: replies, error: repliesError } = await supabase
          .from('email_replies')
          .select('*')
          .in('email_id', threadEmails.map(e => e.id))
          .order('sent_at', { ascending: true });

        if (repliesError) throw repliesError;

        // Fetch attachments for all emails and replies
        const allMessageIds = [
          ...threadEmails.map(e => e.id),
          ...(replies || []).map(r => r.id)
        ];
        
        const { data: attachments, error: attachmentsError } = await supabase
          .from('email_attachments')
          .select('*')
          .in('email_id', allMessageIds);

        if (attachmentsError) throw attachmentsError;

        // Fetch internal notes
        const { data: notes, error: notesError } = await supabase
          .from('internal_notes')
          .select('*')
          .in('email_id', threadEmails.map(e => e.id))
          .order('created_at', { ascending: true });

        if (notesError) throw notesError;

        // If we have notes or replies, fetch the corresponding user profiles
        let userProfiles: Record<string, any> = {};
        const allUserIds = [
          ...(notes || []).map(n => n.user_id),
          ...(replies || []).map(r => r.user_id)
        ];
        
        if (allUserIds.length > 0) {
          const uniqueUserIds = [...new Set(allUserIds)];
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

        // Create attachment mapping by email_id and content_id
        const attachmentMap: Record<string, Record<string, any>> = {};
        (attachments || []).forEach(att => {
          if (!attachmentMap[att.email_id]) {
            attachmentMap[att.email_id] = {};
          }
          if (att.content_id) {
            attachmentMap[att.email_id][att.content_id] = att;
          }
        });

        // Combine and sort all messages by date
        const allMessages = [
          ...threadEmails.map((e: any) => ({ 
            ...e, 
            type: 'email',
            timestamp: new Date(e.date).getTime(),
            attachments: attachmentMap[e.id] || {}
          })),
          ...replies.map((r: any) => {
            // Show team member's personal name for accountability and personalization
            const userProfile = userProfiles[r.user_id];
            return {
              ...r, 
              type: 'reply',
              timestamp: new Date(r.sent_at).getTime(),
              author: userProfile
                ? `${userProfile.first_name} ${userProfile.last_name}`.trim() || 'Unknown User'
                : 'Unknown User',
              attachments: attachmentMap[r.id] || {}
            };
          }),
          ...notes.map((n: any) => {
            const userProfile = userProfiles[n.user_id];
            return {
              ...n,
              type: 'note',
              timestamp: new Date(n.created_at).getTime(),
              author: userProfile
                ? `${userProfile.first_name} ${userProfile.last_name}`.trim() || 'Unknown User'
                : 'Unknown User',
              attachments: {}
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

    if (emailId) {
      fetchThread();
    }
  }, [emailId, threadId]);

  // Cleanup realtime subscription on unmount
  useEffect(() => {
    return () => {
      if (realtimeSubscription) {
        supabase.removeChannel(realtimeSubscription);
      }
    };
  }, [realtimeSubscription]);

  const handleDelete = async () => {
    try {
      await deleteEmail(emailId);
      navigate('/inbox');
    } catch (error) {
      console.error('Error deleting email:', error);
    }
  };

  const handleClose = async () => {
    try {
      // Update email status to resolved
      const { error } = await supabase
        .from('emails')
        .update({ status: 'resolved' })
        .eq('id', emailId);

      if (error) {
        throw error;
      }

      // Navigate back to inbox
      onBack();
    } catch (error) {
      console.error('Error closing ticket:', error);
      toast.error('Failed to close ticket');
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

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Prepare attachments for backend
      const processedAttachments = replyAttachments.map(att => ({
        id: att.id,
        name: att.name,
        size: att.size,
        type: att.type,
        base64Content: att.base64Content,
        isInline: att.isInline,
        contentId: att.contentId,
        storageStrategy: att.storageStrategy
      }));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailId: emailId,
        content: replyContent,
        attachments: processedAttachments,
        closeTicket: false
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send reply');
  }

  const { data: reply } = await response.json();

  // Show team member's personal name for accountability and personalization
  const authorName = currentUserProfile
    ? `${currentUserProfile.first_name} ${currentUserProfile.last_name}`.trim() || 'You'
    : 'You';

  setThread(prev => [...prev, {
    ...reply,
    type: 'reply',
    timestamp: new Date().getTime(),
    author: authorName
  }]);

  toast.success('Reply sent successfully');
      setReplyContent('');
      setReplyAttachments([]);
      setReplyMode(false);
    } catch (err) {
      console.error('Error sending reply:', err);
      toast.error(err.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const handleSubmitReplyAndClose = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!replyContent.trim()) {
      toast.error('Please enter a reply message');
      return;
    }

    try {
      setSending(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Prepare attachments for backend
      const processedAttachments = replyAttachments.map(att => ({
        id: att.id,
        name: att.name,
        size: att.size,
        type: att.type,
        base64Content: att.base64Content,
        isInline: att.isInline,
        contentId: att.contentId,
        storageStrategy: att.storageStrategy
      }));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        emailId: emailId,
        content: replyContent,
        attachments: processedAttachments,
        closeTicket: true
      })
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send reply');
  }

  const { data: reply } = await response.json();

  // Show team member's personal name for accountability and personalization
  const authorName = currentUserProfile
    ? `${currentUserProfile.first_name} ${currentUserProfile.last_name}`.trim() || 'You'
    : 'You';

  setThread(prev => [...prev, {
    ...reply,
    type: 'reply',
    timestamp: new Date().getTime(),
    author: authorName
  }]);

  toast.success('Reply sent and ticket closed');
      setReplyContent('');
      setReplyAttachments([]);
      setReplyMode(false);
      
      // Navigate back to inbox
      onBack();
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

  const handleSubmitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!noteContent.trim()) {
      toast.error('Please enter a note');
      return;
    }

    try {
      setSending(true);

      const { error } = await supabase
        .from('internal_notes')
        .insert({
          email_id: emailId,
          user_id: user?.id,
          content: noteContent
        });

      if (error) throw error;

      // Add note to thread - use personal name for internal notes (different from replies)
      const authorName = currentUserProfile
        ? `${currentUserProfile.first_name} ${currentUserProfile.last_name}`.trim() || 'You'
        : 'You';

      setThread(prev => [...prev, {
        id: `note-${Date.now()}`,
        content: noteContent,
        type: 'note',
        timestamp: new Date().getTime(),
        author: authorName,
        created_at: new Date().toISOString(),
        user_id: user?.id
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

  const renderEmailContent = (content: string, attachments?: Record<string, any>) => {
    if (!content) return null;

    return (
      <EmailContentWithAttachments 
        htmlContent={content}
        emailId={emailId}
        className="prose prose-sm max-w-none text-gray-700"
      />
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
      <div className="flex-1 flex flex-col h-full">
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="inline-flex items-center text-gray-600 hover:text-gray-900"
              >
                <ChevronLeft size={20} className="mr-1" /> Back to inbox
              </button>
              
              <button
                onClick={handleClose}
                disabled={email.status === 'resolved'}
                className={`
                  inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md 
                  transition-all duration-200 ease-in-out
                  ${email.status === 'resolved'
                    ? 'text-gray-700 cursor-not-allowed opacity-75' 
                    : 'text-gray-700 hover:bg-gray-200 cursor-pointer'
                  }
                `}
                style={{ backgroundColor: '#F3F4F6' }}
              >
                {email.status === 'resolved' ? 'Closed' : 'Close'}
              </button>
            </div>
            
            <div className="flex items-center space-x-4">
              <EmailAssignmentIndicator 
                emailId={emailId} 
                initialAssignedTo={email.assigned_to}
              />
              
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
        
        <div className="flex-1 overflow-auto bg-white pl-4 pt-4">
          {/* Real-time presence indicator */}
          <EmailPresenceIndicator emailId={emailId} />
          
          {thread.map((message, index) => (
            <div key={message.id} className="mb-6 pr-4">
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
                      {message.type === 'reply' ? message.author : message.type === 'note' ? message.author : message.from}
                    </span>
                    <span className="mx-2 text-gray-500">•</span>
                    <span className="text-sm text-gray-500">
                      {formatDate(message.type === 'reply' ? message.sent_at : message.type === 'note' ? message.created_at : message.date)}
                    </span>
                  </div>
                  {index === 0 && message.type === 'email' && (
                    <span className="text-sm text-gray-600 block mt-1">
                      To: {message.direction === 'outbound' 
                        ? message.recipient 
                        : (currentStore?.email || 'support@yourbusiness.com')
                      }
                    </span>
                  )}
                </div>
              </div>
              
              <div className={`pl-11 ${
                message.type === 'note' 
                  ? 'bg-yellow-50 border-l-4 border-yellow-200 p-4 rounded'
                  : ''
              }`}>
                {renderEmailContent(message.content, message.attachments)}
              </div>
            </div>
          ))}
          
          <div className="pl-11 mt-6 space-y-4 pb-4 pr-4">
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
              <div className="space-y-0">
                {showTemplates && (
                  <div className="border border-gray-300 rounded-t-lg border-b-0 mb-0">
                    <TemplateSelector
                      onSelect={handleTemplateSelect}
                      onClose={() => setShowTemplates(false)}
                      existingContent={replyContent}
                    />
                  </div>
                )}
                <form onSubmit={handleSubmitReply}>
                  <div className={`border border-gray-300 ${showTemplates ? 'rounded-b-lg border-t-0' : 'rounded-lg'} overflow-hidden`}>
                    {/* Replace textarea with RichTextEditor */}
                    <RichTextEditor
                      value={replyContent}
                      onChange={(content, attachments) => {
                        setReplyContent(content);
                        setReplyAttachments(attachments);
                      }}
                      placeholder="Write your reply..."
                      disabled={sending}
                      showStorageInfo={true}
                    />
                  
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
                          setReplyAttachments([]);
                        }}
                        className="px-3 py-1.5 text-gray-600 hover:text-gray-900"
                        disabled={sending}
                      >
                        Cancel
                      </button>
                    </div>
                    
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={handleSubmitReplyAndClose}
                        disabled={sending || replyAttachments.some(att => !att.base64Content)}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center disabled:opacity-50"
                      >
                        {sending ? (
                          <>
                            <Loader2 size={16} className="mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          'Send & Close'
                        )}
                      </button>
                      
                      <button
                        type="submit"
                        disabled={sending || replyAttachments.some(att => !att.base64Content)}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center disabled:opacity-50"
                      >
                        {sending ? (
                          <>
                            <Loader2 size={16} className="mr-2 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          'Send'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
              </div>
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
        className={`border-l border-gray-200 bg-gray-50 w-full md:w-80 fixed md:relative right-0 top-0 bottom-0 z-10 transform transition-transform duration-300 ease-in-out ${
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