import React, { useState, useEffect } from 'react';
import { Plus, Mail, Loader2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import ConnectStoreModal from '../components/connections/ConnectStoreModal';
import { useInbox } from '../contexts/InboxContext';
import { TeamService } from '../services/teamService';
import { UserProfile } from '../types/team';

const Connections: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [disconnectingStores, setDisconnectingStores] = useState<Set<string>>(new Set());
  const { stores, disconnectStore, loading, error } = useInbox();
  
  // Filter for email-connected stores only
  const emailStores = stores.filter(store => store.platform === 'outlook');

  // Check if current user is admin
  const isAdmin = userProfile?.role === 'admin';

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const profile = await TeamService.getCurrentUserProfile();
        setUserProfile(profile);
      } catch (error) {
        console.error('Error loading user profile:', error);
      } finally {
        setProfileLoading(false);
      }
    };

    loadUserProfile();
  }, []);

  const handleDisconnect = async (storeId: string) => {
    try {
      // Add store to disconnecting set
      setDisconnectingStores(prev => new Set(prev).add(storeId));
      
      await disconnectStore(storeId);
    } catch (error) {
      console.error('Error disconnecting store:', error);
    } finally {
      // Remove store from disconnecting set
      setDisconnectingStores(prev => {
        const newSet = new Set(prev);
        newSet.delete(storeId);
        return newSet;
      });
    }
  };
  
  if (loading || profileLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="mt-2 text-sm text-gray-500">Loading email accounts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-3">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <p className="text-red-600 mb-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-900">Email Integrations</h2>
      </div>

      {/* Microsoft Integration Card */}
      {isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-start">
              <img 
                src="/icons/microsoft-icon.png" 
                alt="Microsoft icon"
                className="w-12 h-12 rounded-lg"
              />
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-medium text-gray-900">
                  Microsoft
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Connect your Microsoft Outlook account to manage emails in one place.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
              >
                <Mail size={16} className="mr-2" />
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connected Email Accounts Table */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Connected Email Accounts</h3>
        </div>
        <div className="overflow-x-auto">
          {emailStores.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                <Mail className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">No email accounts connected</h3>
              <p className="text-gray-500 mb-4 max-w-md mx-auto">
                {isAdmin 
                  ? "Connect your email accounts to start managing customer support in one place."
                  : "No email accounts have been connected yet. Contact your admin to connect email accounts."
                }
              </p>
              {isAdmin && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                >
                  <Plus size={16} className="mr-2" />
                  Connect Your First Email
                </button>
              )}
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Account Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email Address
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Synced
                  </th>
                  {isAdmin && (
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {emailStores.map((store) => (
                  <tr key={store.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                          <Mail size={16} />
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">{store.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {store.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        store.status === 'connecting'
                          ? 'bg-yellow-100 text-yellow-800'
                          : store.connected
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {store.status === 'connecting' 
                          ? '🟡 Connecting' 
                          : store.connected 
                          ? '🟢 Connected' 
                          : '🔴 Disconnected'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {store.lastSynced ? format(new Date(store.lastSynced), 'PPp') : 'Never'}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => handleDisconnect(store.id)}
                          disabled={disconnectingStores.has(store.id)}
                          className="inline-flex items-center text-red-600 hover:text-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {disconnectingStores.has(store.id) ? (
                            <>
                              <Loader2 size={14} className="animate-spin mr-1" />
                              Disconnecting...
                            </>
                          ) : (
                            'Disconnect'
                          )}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      
      {isAdmin && (
        <ConnectStoreModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
};

export default Connections;