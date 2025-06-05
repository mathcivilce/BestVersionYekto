import React from 'react';
import { useParams } from 'react-router-dom';
import EmailList from '../components/inbox/EmailList';
import { useInbox } from '../contexts/InboxContext';

const Inbox: React.FC = () => {
  const { storeId } = useParams();
  const { stores } = useInbox();

  const store = storeId ? stores.find(s => s.id === storeId) : null;
  
  return (
    <div className="h-full flex flex-col">
      {store && (
        <div className="bg-white border-b border-gray-200 px-4 py-3 mb-4">
          <div className="flex items-center">
            <div 
              className="h-3 w-3 rounded-full mr-2" 
              style={{ backgroundColor: store.color }}
            ></div>
            <h2 className="text-lg font-medium text-gray-900">{store.name}</h2>
            <span className="ml-2 text-sm text-gray-500">{store.email}</span>
          </div>
        </div>
      )}
      
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex-1">
        <EmailList storeId={storeId} />
      </div>
    </div>
  );
};

export default Inbox;