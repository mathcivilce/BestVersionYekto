import React, { useState, useEffect } from 'react';
import { Plug, ShoppingBag, Loader2, XCircle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import ShopifyConnectModal from '../components/integrations/ShopifyConnectModal';
import { useInbox } from '../contexts/InboxContext';

// Initialize Supabase client for database operations
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// TypeScript interface defining the structure of a Shopify store record
// This matches the database schema for shopify_stores table with nested store data
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

/**
 * Integrations Page Component
 * 
 * This component manages the integrations page where users can:
 * 1. View available integrations (currently only Shopify)
 * 2. Connect new Shopify stores via a modal
 * 3. View and manage connected stores in a table
 * 4. Disconnect existing stores
 * 
 * Key functionality:
 * - Fetches connected stores from database on mount
 * - Displays integration cards with connect buttons
 * - Shows connected stores table with status and actions
 * - Handles store disconnection with optimistic UI updates
 */
const Integrations: React.FC = () => {
  // Modal state for controlling the Shopify connection modal visibility
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Loading state for the initial stores fetch operation
  const [loading, setLoading] = useState(true);
  
  // Array of connected Shopify stores fetched from database
  const [stores, setStores] = useState<ShopifyStore[]>([]);
  
  // Set to track which stores are currently being disconnected (for loading states)
  const [disconnectingStores, setDisconnectingStores] = useState<Set<string>>(new Set());
  
  // Get inbox stores from context (currently not actively used but available)
  const { stores: inboxStores } = useInbox();

  /**
   * Fetches connected Shopify stores from the database
   * 
   * This function:
   * 1. Authenticates the current user
   * 2. Queries shopify_stores table with nested store data
   * 3. Updates the stores state with fetched data
   * 4. Handles and logs any errors that occur
   * 
   * The query joins shopify_stores with the stores table to get full store details
   */
  const fetchStores = async () => {
    try {
      console.log('Integrations: Starting fetchStores');
      setLoading(true);
      
      // Check authentication first - ensures user is logged in before querying
      const { data: authUser, error: authError } = await supabase.auth.getUser();
      console.log('Integrations: Auth check result:', {
        hasUser: !!authUser.user,
        userId: authUser.user?.id,
        userEmail: authUser.user?.email,
        authError
      });

      console.log('Integrations: About to query shopify_stores table');
      
      // Query shopify_stores with nested store data using foreign key relationship
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

  /**
   * Disconnects a Shopify store by setting its connected status to false
   * 
   * This function:
   * 1. Adds the store to disconnecting set (for loading UI)
   * 2. Updates the store's connected status in database
   * 3. Updates local state with optimistic update
   * 4. Shows success/error messages
   * 5. Removes store from disconnecting set when done
   * 
   * @param storeId - The ID of the store to disconnect
   */
  const disconnectStore = async (storeId: string) => {
    try {
      // Add store to disconnecting set for loading state UI
      setDisconnectingStores(prev => new Set(prev).add(storeId));
      
      // Update the stores table to mark store as disconnected
      const { error } = await supabase
        .from('stores')
        .update({ connected: false })
        .eq('id', storeId);

      if (error) throw error;

      // Optimistically update local state to reflect disconnection
      setStores(stores.map(store => 
        store.id === storeId 
          ? { ...store, store: { ...store.store, connected: false }} 
          : store
      ));
      
      toast.success('Store disconnected successfully');
    } catch (error) {
      console.error('Error disconnecting store:', error);
      toast.error('Failed to disconnect store');
    } finally {
      // Remove store from disconnecting set regardless of success/failure
      setDisconnectingStores(prev => {
        const newSet = new Set(prev);
        newSet.delete(storeId);
        return newSet;
      });
    }
  };

  // Fetch stores when component mounts
  useEffect(() => {
    fetchStores();
  }, []);

  // Static configuration for available integrations
  // Currently only Shopify is supported, but this structure allows for easy expansion
  const integrations = [
    {
      id: 'shopify',
      name: 'Shopify',
      description: 'Connect your Shopify store to sync customer data and orders.',
      icon: '/icons/shopify-icon.png',
      status: 'available',
      color: 'green'
    }
  ];

  return (
    <>
      <div className="space-y-6">
        {/* Page Header - Simple title without action buttons */}
        {/* Note: Previously had "Connect Shopify Store" and "Test Real-time" buttons here, 
             but they were removed to avoid duplication with the integration card's Connect button */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        </div>

        {/* Integration Cards Grid - Shows available integrations */}
        {/* Each card has its own Connect button that opens the connection modal */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((integration) => {
            return (
              <div
                key={integration.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
              >
                {/* Integration header with icon and description */}
                <div className="flex items-start">
                  <img 
                    src={integration.icon} 
                    alt={`${integration.name} icon`}
                    className="w-12 h-12 rounded-lg"
                  />
                  <div className="ml-4 flex-1">
                    <h3 className="text-lg font-medium text-gray-900">
                      {integration.name}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {integration.description}
                    </p>
                  </div>
                </div>

                {/* Connect button - Opens the ShopifyConnectModal */}
                {/* This is the primary way users should connect new stores */}
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

        {/* Connected Stores Table - Shows all connected stores with management options */}
        <div className="bg-white shadow-sm rounded-lg border border-gray-200">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Connected Stores</h3>
          </div>
          
          <div className="overflow-x-auto">
            {/* Loading state - Shows spinner while fetching stores */}
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="ml-2 text-gray-600">Loading stores...</span>
              </div>
            ) : stores.length === 0 ? (
              /* Empty state - Shows when no stores are connected */
              <div className="text-center py-8">
                <XCircle className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No stores connected</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Connect your first Shopify store to get started.
                </p>
              </div>
            ) : (
              /* Stores table - Shows connected stores with actions */
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
                      {/* Store name from nested store object */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {store.store.name}
                      </td>
                      
                      {/* Shopify domain (e.g., mystore.myshopify.com) */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {store.shop_domain}
                      </td>
                      
                      {/* Connection status badge - Green for connected, Red for disconnected */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          store.store.connected
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {store.store.connected ? '🟢 Connected' : '🔴 Disconnected'}
                        </span>
                      </td>
                      
                      {/* Last sync time or creation time if never synced */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(store.store.last_synced || store.store.created_at), 'PPp')}
                      </td>
                      
                      {/* Disconnect action button - Shows loading state during disconnection */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button
                          onClick={() => disconnectStore(store.id)}
                          disabled={!store.store.connected || disconnectingStores.has(store.id)}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Shopify Connection Modal - Controlled by isModalOpen state */}
      {/* Opens when user clicks Connect button in integration card */}
      {/* Refreshes stores list after successful connection */}
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