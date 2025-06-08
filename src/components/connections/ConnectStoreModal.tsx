import React, { useState } from 'react';
import { X, Mail, Calendar, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { useInbox } from '../../contexts/InboxContext';

interface ConnectStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ConnectStoreModal: React.FC<ConnectStoreModalProps> = ({ isOpen, onClose }) => {
  const { connectStore, connectStoreServerOAuth, loading } = useInbox();
  const [storeData, setStoreData] = useState({
    name: '',
    platform: 'outlook',
    color: '#2563eb',
    syncFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    syncTo: new Date().toISOString().split('T')[0]
  });
  
  // PRODUCTION: Always use server-side OAuth for robust token management
  // Server-side OAuth provides:
  // - Automatic token refresh (no user interruption)
  // - Persistent connections (works 24/7)
  // - Better security (tokens stored server-side)
  // - Enterprise-grade reliability
  const oauthMethod = 'server_side';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setStoreData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Always use server-side OAuth for production reliability
      await connectStoreServerOAuth(storeData);
      onClose();
      toast.success('Email account connected successfully!');
    } catch (err: any) {
      console.error('Error connecting email account:', err);
      toast.error(err.message || 'Failed to connect email account');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true">
          <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
        </div>

        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex justify-between items-center pb-3 border-b border-gray-200 mb-4">
              <h3 className="text-lg font-medium text-gray-900">Connect Email Account</h3>
              <button
                onClick={onClose}
                className="bg-white rounded-md text-gray-400 hover:text-gray-500"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    Account Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={storeData.name}
                    onChange={handleChange}
                    required
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="My Work Email"
                  />
                </div>

                <div>
                  <label htmlFor="platform" className="block text-sm font-medium text-gray-700">
                    Email Provider
                  </label>
                  <select
                    id="platform"
                    name="platform"
                    value={storeData.platform}
                    onChange={handleChange}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  >
                    <option value="outlook">Microsoft Outlook / Office 365</option>
                    <option value="gmail">Google Gmail</option>
                  </select>
                </div>

                {/* Enterprise OAuth Information */}
                <div className="border-l-4 border-green-400 bg-green-50 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <Shield className="h-5 w-5 text-green-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-green-800">Enterprise-Grade Security</h3>
                      <div className="mt-2 text-sm text-green-700">
                        <p className="mb-2">Your email connection includes:</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                          <li>Automatic token refresh (no interruptions)</li>
                          <li>Secure server-side token storage</li>
                          <li>24/7 persistent email synchronization</li>
                          <li>Enterprise-grade OAuth 2.0 with PKCE</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="syncFrom" className="block text-sm font-medium text-gray-700">
                      Sync From
                    </label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Calendar size={16} className="text-gray-400" />
                      </div>
                      <input
                        type="date"
                        id="syncFrom"
                        name="syncFrom"
                        value={storeData.syncFrom}
                        onChange={handleChange}
                        max={storeData.syncTo}
                        className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="syncTo" className="block text-sm font-medium text-gray-700">
                      Sync To
                    </label>
                    <div className="mt-1 relative rounded-md shadow-sm">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Calendar size={16} className="text-gray-400" />
                      </div>
                      <input
                        type="date"
                        id="syncTo"
                        name="syncTo"
                        value={storeData.syncTo}
                        onChange={handleChange}
                        min={storeData.syncFrom}
                        max={new Date().toISOString().split('T')[0]}
                        className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-md bg-blue-50 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <Mail className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800">
                        {storeData.platform === 'outlook' ? 'Microsoft Outlook' : 'Google Gmail'} Integration
                      </h3>
                      <div className="mt-2 text-sm text-blue-700">
                        <p>
                          You'll be securely redirected to {storeData.platform === 'outlook' ? 'Microsoft' : 'Google'} to authorize your email account. 
                          Your connection will be maintained automatically with enterprise-grade security.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed sm:ml-3 sm:w-auto sm:text-sm"
                >
                  {loading ? 'Connecting...' : 'Connect Email Account'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed sm:mt-0 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectStoreModal;