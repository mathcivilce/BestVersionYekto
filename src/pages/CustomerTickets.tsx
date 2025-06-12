import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertTriangle, Mail } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { toast } from 'react-hot-toast';
import CustomerSidebar from '../components/customer/CustomerSidebar';
import ThreadListItem from '../components/customer/ThreadListItem';
import Pagination from '../components/ui/Pagination';
import { useAuth } from '../contexts/AuthContext';

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

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const CustomerTickets: React.FC = () => {
  const { customerEmail } = useParams<{ customerEmail: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [threads, setThreads] = useState<CustomerThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalThreads, setTotalThreads] = useState(0);
  
  const threadsPerPage = 10;
  const totalPages = Math.ceil(totalThreads / threadsPerPage);
  
  // Safely decode the customer email with error handling
  const decodedEmail = React.useMemo(() => {
    if (!customerEmail) return '';
    try {
      return decodeURIComponent(customerEmail);
    } catch (error) {
      console.error('Error decoding customer email:', error);
      return '';
    }
  }, [customerEmail]);

  // Fetch threads function
  const fetchThreads = async (page: number) => {
    try {
      setLoading(true);
      setError(null);
      
      if (!user?.id || !decodedEmail) {
        throw new Error('Missing required data');
      }

      const offset = (page - 1) * threadsPerPage;

      // Get threads
      const { data: threadsData, error: threadsError } = await supabase
        .rpc('get_customer_threads', {
          customer_email_param: decodedEmail,
          user_id_param: user.id,
          page_limit: threadsPerPage,
          page_offset: offset
        });

      if (threadsError) throw threadsError;

      // Get total count
      const { data: countData, error: countError } = await supabase
        .rpc('get_customer_threads_count', {
          customer_email_param: decodedEmail,
          user_id_param: user.id
        });

      if (countError) throw countError;

      setThreads(threadsData || []);
      setTotalThreads(countData || 0);
      setCurrentPage(page);
      
    } catch (err) {
      console.error('Error fetching customer threads:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      toast.error('Failed to load customer threads');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (decodedEmail && user?.id) {
      fetchThreads(1);
    }
  }, [decodedEmail, user?.id]);

  // Handle thread click
  const handleThreadClick = async (thread: CustomerThread) => {
    try {
      // Find the first email in this thread to navigate to
      const { data: firstEmail, error } = await supabase
        .from('emails')
        .select('id')
        .eq('thread_id', thread.thread_id)
        .eq('user_id', user?.id)
        .order('date', { ascending: true })
        .limit(1)
        .single();

      if (error) throw error;

      navigate(`/inbox/email/${firstEmail.id}`);
    } catch (err) {
      console.error('Error navigating to thread:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to open thread';
      toast.error(errorMessage);
    }
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    fetchThreads(page);
  };

  // Back to inbox
  const handleBackToInbox = () => {
    navigate('/inbox');
  };

  if (!decodedEmail) {
    return (
      <div className="flex h-screen">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Customer Email</h2>
            <p className="text-gray-600 mb-4">The customer email in the URL is not valid.</p>
            <button
              onClick={handleBackToInbox}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Inbox
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Main Content - Thread List */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center min-w-0 flex-1">
              <button
                onClick={handleBackToInbox}
                className="mr-3 sm:mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-gray-600" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Customer Tickets</h1>
                <p className="text-sm text-gray-600 truncate">{decodedEmail}</p>
              </div>
            </div>
            <div className="text-sm text-gray-500 ml-4 whitespace-nowrap">
              {totalThreads} ticket{totalThreads !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
                <p className="text-sm text-gray-500">Loading tickets...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Error Loading Tickets</h3>
                <p className="text-gray-600 mb-4">{error}</p>
                <button
                  onClick={() => fetchThreads(currentPage)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : threads.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Tickets Found</h3>
                <p className="text-gray-600">This customer doesn't have any tickets yet.</p>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-y-auto">
                <div className="divide-y divide-gray-200">
                  {threads.map((thread) => (
                    <ThreadListItem
                      key={thread.thread_id}
                      thread={thread}
                      customerEmail={decodedEmail}
                      onClick={handleThreadClick}
                    />
                  ))}
                </div>
              </div>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t border-gray-200 bg-white px-6 py-4">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Customer Sidebar */}
      <div className="w-80 bg-white border-l border-gray-200 hidden lg:block">
        <CustomerSidebar 
          email={{ 
            from: decodedEmail,
            storeName: 'Loading...', // Will be populated by CustomerSidebar
            storeColor: '#3B82F6' 
          }} 
        />
      </div>
    </div>
  );
};

export default CustomerTickets; 