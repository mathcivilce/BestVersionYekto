import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import EmailList from '../components/inbox/EmailList';
import { useInbox } from '../contexts/InboxContext';

const OpenTickets: React.FC = () => {
  const { storeId } = useParams();
  const { stores } = useInbox();
  const navigate = useNavigate();

  // Open Tickets requires a specific store selection
  if (!storeId) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mb-4 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Select an Email Account</h2>
          <p className="text-gray-600 mb-6">
            Choose a connected email account to view its open tickets.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft size={16} className="mr-2" />
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const store = stores.find(s => s.id === storeId);

  if (!store) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mb-4 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Email Account Not Found</h2>
          <p className="text-gray-600 mb-6">
            The selected email account could not be found or is not connected.
          </p>
          <button
            onClick={() => navigate('/connections')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Check Email Connections
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 mb-4">
        <div className="flex items-center">
          <div 
            className="h-3 w-3 rounded-full mr-2" 
            style={{ backgroundColor: store.color }}
          ></div>
          <h2 className="text-lg font-medium text-gray-900">{store.name} - Open Tickets</h2>
          <span className="ml-2 text-sm text-gray-500">{store.email}</span>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex-1">
        <EmailList 
          storeId={storeId} 
          defaultStatusFilter="open"
          hideStatusFilter={true}
        />
      </div>
    </div>
  );
};

export default OpenTickets; 