import React, { useState, useEffect } from 'react';
import { Plug, ShoppingBag, Loader2, XCircle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import ShopifyConnectModal from '../components/integrations/ShopifyConnectModal';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

interface ShopifyStore {
  id: string;
  store: {
    name: string;
    connected: boolean;
    created_at: string;
    last_synced: string | null;
  };
  shop_domain: string;
  created_at: string;
}

const Integrations: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<ShopifyStore[]>([]);

  const fetchStores = async () => {
    try {
      console.log('Integrations: Starting fetchStores');
      setLoading(true);
      
      // Check authentication first
      const { data: authUser, error: authError } = await supabase.auth.getUser();
      console.log('Integrations: Auth check result:', {
        hasUser: !!authUser.user,
        userId: authUser.user?.id,
        userEmail: authUser.user?.email,
        authError
      });

      console.log('Integrations: About to query shopify_stores table');
      const { data, error } = await supabase
        .from('shopify_stores')
        .select(`
          id,
          shop_domain,
          created_at,
          store:stores (
            name,
            connected,
            created_at,
            last_synced
          )
        `)
        .order('created_at', { ascending: false });

      console.log('Integrations: shopify_stores query result:', {
        dataLength: data?.length,
        data,
        error: error?.message,
        errorDetails: error
      });

      if (error) {
        console.error('Integrations: Query error details:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      
      console.log('Integrations: Setting stores data:', data);
      setStores(data || []);
    } catch (error) {
      console.error('Integrations: Error fetching stores:', error);
      console.error('Integrations: Error details:', {
        message: (error as any)?.message,
        name: (error as any)?.name,
        stack: (error as any)?.stack
      });
      toast.error('Failed to load connected stores');
    } finally {
      console.log('Integrations: fetchStores completed, setting loading to false');
      setLoading(false);
    }
  };

  const disconnectStore = async (storeId: string) => {
    try {
      const { error } = await supabase
        .from('stores')
        .update({ connected: false })
        .eq('id', storeId);

      if (error) throw error;

      setStores(stores.map(store => 
        store.id === storeId 
          ? { ...store, store: { ...store.store, connected: false }} 
          : store
      ));
      
      toast.success('Store disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting store:', error);
      toast.error('Failed to disconnect store');
    }
  };

  useEffect(() => {
    fetchStores();
  }, []);

  const integrations = [
    {
      id: 'shopify',
      name: 'Shopify',
      description: 'Connect your Shopify store to sync customer data and orders.',
      icon: ShoppingBag,
      status: 'available',
      color: 'green'
    }
  ];

  return (
    <>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-medium text-gray-900">Integrations</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((integration) => {
            const Icon = integration.icon;
            return (
              <div
                key={integration.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
              >
                <div className="flex items-start">
                  <div className={`p-3 rounded-lg bg-${integration.color}-50 text-${integration.color}-600`}>
                    <Icon size={24} />
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      {integration.name}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {integration.description}
                    </p>
                  </div>
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                  >
                    <Plug size={16} className="mr-2" />
                    Connect
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Connected Stores Table */}
        <div className="bg-white shadow-sm rounded-lg border border-gray-200">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Connected Stores</h3>
          </div>
          
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="ml-2 text-gray-600">Loading stores...</span>
              </div>
            ) : stores.length === 0 ? (
              <div className="text-center py-8">
                <XCircle className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No stores connected</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Connect your first Shopify store to get started.
                </p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Store Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Store Domain
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Connected At
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stores.map((store) => (
                    <tr key={store.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {store.store.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {store.shop_domain}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          store.store.connected
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {store.store.connected ? '🟢 Connected' : '🔴 Disconnected'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(store.store.last_synced || store.store.created_at), 'PPp')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button
                          onClick={() => disconnectStore(store.id)}
                          disabled={!store.store.connected}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Disconnect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <ShopifyConnectModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          fetchStores(); // Refresh the stores list after connecting
        }}
      />
    </>
  );
};

export default Integrations;