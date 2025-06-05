import React from 'react';
import { Store, Mail, Check, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface StoreCardProps {
  store: {
    id: string;
    name: string;
    platform: 'shopify' | 'woocommerce';
    email: string;
    connected: boolean;
    status: 'active' | 'issue' | 'pending';
    color: string;
    lastSynced?: string;
  };
  onConnect: (storeId: string) => void;
  onDisconnect: (storeId: string) => void;
  onRefresh?: (storeId: string) => void;
  syncing?: boolean;
}

const StoreCard: React.FC<StoreCardProps> = ({ store, onConnect, onDisconnect, onRefresh, syncing }) => {
  const getStatusIcon = () => {
    if (syncing) {
      return <RefreshCw size={16} className="text-blue-500 animate-spin" />;
    }
    
    switch (store.status) {
      case 'active':
        return <Check size={16} className="text-green-500" />;
      case 'issue':
        return <AlertCircle size={16} className="text-red-500" />;
      case 'pending':
        return (
          <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      default:
        return null;
    }
  };

  const getStatusText = () => {
    if (syncing) return 'Syncing...';
    
    switch (store.status) {
      case 'active':
        return 'Connected';
      case 'issue':
        return 'Connection issue';
      case 'pending':
        return 'Connecting...';
      default:
        return '';
    }
  };

  const getStatusColor = () => {
    if (syncing) return 'text-blue-700 bg-blue-50';
    
    switch (store.status) {
      case 'active':
        return 'text-green-700 bg-green-50';
      case 'issue':
        return 'text-red-700 bg-red-50';
      case 'pending':
        return 'text-blue-700 bg-blue-50';
      default:
        return 'text-gray-700 bg-gray-50';
    }
  };

  const getPlatformIcon = () => {
    switch (store.platform) {
      case 'shopify':
        return <Store size={20} />;
      case 'woocommerce':
        return <Store size={20} />;
      default:
        return <Store size={20} />;
    }
  };

  const getLastSyncedText = () => {
    if (!store.lastSynced) return 'Never synced';
    if (syncing) return 'Syncing...';
    
    const date = new Date(store.lastSynced);
    const timeAgo = formatDistanceToNow(date, { addSuffix: true });
    const exactTime = format(date, 'MMM d, yyyy HH:mm');
    
    return `Last synced ${timeAgo} (${exactTime})`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-5 border-b border-gray-100">
        <div className="flex justify-between items-start">
          <div className="flex items-center">
            <div 
              className="p-2 rounded-lg mr-3"
              style={{ backgroundColor: `${store.color}20`, color: store.color }}
            >
              {getPlatformIcon()}
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">{store.name}</h3>
              <p className="text-sm text-gray-500">{store.platform.charAt(0).toUpperCase() + store.platform.slice(1)}</p>
            </div>
          </div>
          
          <div className={`flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="ml-1">{getStatusText()}</span>
          </div>
        </div>
      </div>
      
      <div className="p-5">
        <div className="flex items-center text-sm text-gray-600 mb-4">
          <Mail size={16} className="mr-2" />
          <span>{store.email}</span>
        </div>
        
        <p className="text-xs text-gray-500 mb-4">
          {getLastSyncedText()}
        </p>
        
        <div className="flex space-x-3">
          {store.connected ? (
            <>
              <button
                onClick={() => onDisconnect(store.id)}
                className="flex-1 px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Disconnect
              </button>
              {onRefresh && (
                <button
                  onClick={() => onRefresh(store.id)}
                  disabled={syncing}
                  className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <RefreshCw size={16} className={`${syncing ? 'animate-spin' : ''}`} />
                </button>
              )}
              <a
                href="#"
                className="flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100"
              >
                View Store <ExternalLink size={14} className="ml-1" />
              </a>
            </>
          ) : (
            <button
              onClick={() => onConnect(store.id)}
              className="flex-1 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoreCard;