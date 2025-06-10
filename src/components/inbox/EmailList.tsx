import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, Star, Clock, Tag, Inbox, RefreshCw, ArrowLeft, ArrowRight, AlertOctagon, Search } from 'lucide-react';
import { useInbox } from '../../contexts/InboxContext';
import EmailListItem from './EmailListItem';
import EmailFilter from './EmailFilter';
import { format } from 'date-fns';
import { getThreadSubject } from '../../utils/email';

interface EmailListProps {
  storeId?: string;
}

const ITEMS_PER_PAGE = 20;

const EmailList: React.FC<EmailListProps> = ({ storeId }) => {
  const { emails, stores, loading, error, syncEmails, refreshEmails } = useInbox();
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedStore, setSelectedStore] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [dateRange, setDateRange] = useState({
    from: '',
    to: ''
  });
  const [searchTerm, setSearchTerm] = useState('');

  const store = storeId ? stores.find(s => s.id === storeId) : null;

  const formatLastSynced = (date: string | null | undefined) => {
    if (!date) return 'Never synced';
    return format(new Date(date), 'MMM d, yyyy HH:mm:ss');
  };

  const handleSync = async () => {
    if (!store && !storeId) return;
    
    try {
      setSyncing(true);
      await syncEmails(storeId || store?.id || '');
    } catch (error) {
      console.error('Error syncing emails:', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshEmails();
    } catch (error) {
      console.error('Error refreshing emails:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) return null;
    return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  };

  // Group emails by thread and get the latest email from each thread
  const threadMap = useMemo(() => {
    const map = new Map();
    
    emails.forEach(email => {
      if (!email) return;
      const threadId = email.thread_id || email.id;
      const existingEmail = map.get(threadId);
      
      if (!existingEmail || new Date(email.date) > new Date(existingEmail.date)) {
        // Get the canonical subject for the thread
        const threadSubject = getThreadSubject(emails, threadId);
        map.set(threadId, { ...email, threadSubject });
      }
    });
    
    return map;
  }, [emails]);

  // Convert Map back to array and apply filters
  const filteredEmails = Array.from(threadMap.values())
    .filter(email => !storeId || email.store_id === storeId)
    .filter(email => selectedStore === 'all' || email.storeName === selectedStore)
    .filter(email => selectedStatus === 'all' || email.status === selectedStatus)
    .filter(email => {
      if (!dateRange.from && !dateRange.to) return true;
      const emailDate = new Date(email.date);
      const fromDate = dateRange.from ? new Date(dateRange.from) : null;
      const toDate = dateRange.to ? new Date(dateRange.to) : null;
      
      if (fromDate && toDate) {
        return emailDate >= fromDate && emailDate <= toDate;
      } else if (fromDate) {
        return emailDate >= fromDate;
      } else if (toDate) {
        return emailDate <= toDate;
      }
      return true;
    })
    .filter(email => {
      if (!searchTerm.trim()) return true;
      
      const query = searchTerm.toLowerCase();
      const subject = (email.threadSubject || email.subject || '').toLowerCase();
      const content = (email.content || email.snippet || '').toLowerCase();
      const fromEmail = (email.from || '').toLowerCase();
      
      return subject.includes(query) || 
             content.includes(query) || 
             fromEmail.includes(query);
    })
    .sort((a, b) => {
      if (sortBy === 'date') {
        return sortDirection === 'asc'
          ? new Date(a.date).getTime() - new Date(b.date).getTime()
          : new Date(b.date).getTime() - new Date(a.date).getTime();
      } else if (sortBy === 'priority') {
        return sortDirection === 'asc'
          ? a.priority - b.priority
          : b.priority - a.priority;
      }
      return 0;
    });

  const totalPages = Math.ceil(filteredEmails.length / ITEMS_PER_PAGE);
  const paginatedEmails = filteredEmails.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo(0, 0);
  };

  const renderPaginationButtons = () => {
    const buttons = [];
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => handlePageChange(i)}
          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
            currentPage === i
              ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
          }`}
        >
          {i}
        </button>
      );
    }

    return buttons;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mb-2"></div>
          <p className="text-sm text-gray-500">Loading emails...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-3">
            <AlertOctagon className="w-6 h-6 text-red-600" />
          </div>
          <div className="text-red-500 mb-2">Error loading emails</div>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700"
          >
            <RefreshCw size={16} className="mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (filteredEmails.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {!storeId && (
          <EmailFilter 
            selectedStore={selectedStore}
            setSelectedStore={setSelectedStore}
            selectedStatus={selectedStatus}
            setSelectedStatus={setSelectedStatus}
            dateRange={dateRange}
            setDateRange={setDateRange}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
          />
        )}
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <div className="w-16 h-16 mb-4 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
              <Inbox className="w-8 h-8 text-blue-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No emails found</h3>
            <p className="text-gray-500 mb-4">
              {emails.length === 0
                ? "Your inbox is empty. Connect email accounts to get started."
                : "No emails match your current filters."}
            </p>
            {emails.length === 0 ? (
              <button
                onClick={() => navigate('/connections')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Connect Email Accounts
              </button>
            ) : (
              <button
                onClick={() => {
                  setSelectedStore('all');
                  setSelectedStatus('all');
                  setDateRange({ from: '', to: '' });
                  setSearchTerm('');
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {!storeId && (
        <EmailFilter 
          selectedStore={selectedStore}
          setSelectedStore={setSelectedStore}
          selectedStatus={selectedStatus}
          setSelectedStatus={setSelectedStatus}
          dateRange={dateRange}
          setDateRange={setDateRange}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
        />
      )}
      
      {storeId && (
        <div className="border-b border-gray-200 bg-white p-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search emails..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      )}
      
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <Clock size={16} className="text-gray-400" />
          <span>Last synced: {formatLastSynced(store?.lastSynced)}</span>
          {(syncing || refreshing) && (
            <span className="text-blue-600 flex items-center">
              <RefreshCw size={14} className="animate-spin mr-1" />
              {syncing ? 'Syncing...' : 'Refreshing...'}
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            title="Refresh emails from database"
          >
            <RefreshCw size={16} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          
          {store && (
            <button
              onClick={handleSync}
              disabled={syncing || loading}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
              title="Sync new emails from Microsoft"
            >
              <RefreshCw size={16} className={`mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync New'}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center px-4 py-2 border-b border-gray-200 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
        <div className="w-8"></div>
        <div 
          className="flex-1 flex items-center cursor-pointer"
          onClick={() => toggleSort('subject')}
        >
          Subject {getSortIcon('subject')}
        </div>
        <div 
          className="w-32 flex items-center cursor-pointer"
          onClick={() => toggleSort('date')}
        >
          <Clock size={14} className="mr-1" /> Date {getSortIcon('date')}
        </div>
        <div 
          className="w-24 flex items-center cursor-pointer"
          onClick={() => toggleSort('priority')}
        >
          <Star size={14} className="mr-1" /> Priority {getSortIcon('priority')}
        </div>
        <div className="w-24 flex items-center">
          <Tag size={14} className="mr-1" /> Status
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto divide-y divide-gray-200">
        {paginatedEmails.map(email => (
          <EmailListItem 
            key={email.id} 
            email={email}
            threadSubject={email.threadSubject}
            onClick={() => navigate(`/inbox/email/${email.id}`)} 
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-white">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing <span className="font-medium">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span>{' '}
                to{' '}
                <span className="font-medium">
                  {Math.min(currentPage * ITEMS_PER_PAGE, filteredEmails.length)}
                </span>{' '}
                of <span className="font-medium">{filteredEmails.length}</span> results
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="sr-only">Previous</span>
                  <ArrowLeft size={16} />
                </button>
                {renderPaginationButtons()}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="sr-only">Next</span>
                  <ArrowRight size={16} />
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailList;