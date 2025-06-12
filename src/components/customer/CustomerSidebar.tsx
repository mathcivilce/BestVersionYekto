import React, { useState, useEffect } from 'react';
import { User, Phone, Mail, ShoppingBag, Calendar, ExternalLink, Loader2, Package, AlertTriangle, MapPin } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface CustomerSidebarProps {
  email: {
    from: string;
    direction?: 'inbound' | 'outbound';
    recipient?: string;
    storeName?: string;
    storeColor?: string;
  };
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const CustomerSidebar: React.FC<CustomerSidebarProps> = ({ email }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerData, setCustomerData] = useState<any>(null);

  useEffect(() => {
    const fetchCustomerData = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          throw new Error('Not authenticated');
        }

        // 🎯 SMART CUSTOMER DETECTION: Determine the actual customer email based on direction
        const customerEmail = email.direction === 'outbound' 
          ? email.recipient  // For outbound emails, customer is the recipient
          : email.from;      // For inbound emails, customer is the sender

        console.log('🔍 Customer Detection:', {
          direction: email.direction,
          from: email.from,
          recipient: email.recipient,
          detectedCustomer: customerEmail
        });

        if (!customerEmail) {
          throw new Error('Unable to determine customer email');
        }

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopify-lookup?email=${encodeURIComponent(customerEmail)}`,
          {
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch customer data');
        }

        setCustomerData(data);
      } catch (err) {
        console.error('Error fetching customer data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    // Only fetch if we have enough information to determine customer
    if (email.from && (email.direction !== 'outbound' || email.recipient)) {
      fetchCustomerData();
    }
  }, [email.from, email.direction, email.recipient]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="mt-2 text-sm text-gray-500">Loading customer data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-3">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!customerData?.found) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
            <User className="w-6 h-6 text-gray-600" />
          </div>
          <p className="text-sm text-gray-500">No Shopify customer data found for this email.</p>
        </div>
      </div>
    );
  }

  const store = customerData.stores[0];
  const customer = store.customer;
  const orders = store.orders;

  // Handle customer name click to navigate to tickets page
  const handleCustomerClick = () => {
    const encodedEmail = encodeURIComponent(customer.email);
    navigate(`/customer/${encodedEmail}/tickets`);
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Customer header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center mb-3">
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mr-3">
            <User size={20} className="text-gray-600" />
          </div>
          <div>
            <h3 
              className="text-lg font-medium text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
              onClick={handleCustomerClick}
              title="View all tickets for this customer"
            >
              {customer.firstName} {customer.lastName}
            </h3>
            <div className="flex items-center">
              <div 
                className="h-3 w-3 rounded-full mr-2" 
                style={{ backgroundColor: email.storeColor }}
              ></div>
              <span className="text-sm text-gray-600">{store.store.name}</span>
            </div>
          </div>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center text-gray-600">
            <Mail size={14} className="mr-2" />
            <span>{customer.email}</span>
          </div>
          {customer.phone && (
            <div className="flex items-center text-gray-600">
              <Phone size={14} className="mr-2" />
              <span>{customer.phone}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Customer stats */}
      <div className="p-4 border-b border-gray-200">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Customer Stats
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-3 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-500 mb-1">Total Orders</div>
            <div className="text-lg font-semibold text-gray-900">{customer.ordersCount}</div>
          </div>
          <div className="bg-white p-3 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-500 mb-1">Total Spent</div>
            <div className="text-lg font-semibold text-gray-900">
              ${parseFloat(customer.totalSpent).toFixed(2)}
            </div>
          </div>
        </div>
      </div>
      
      {/* Recent orders */}
      <div className="p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Recent Orders
        </h4>
        <div className="space-y-3">
          {orders.map((order: any) => (
            <div key={order.id} className="bg-white p-3 rounded-lg border border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <div className="font-medium text-gray-900">{order.number}</div>
                <div className={`text-xs px-2 py-0.5 rounded-full ${
                  order.fulfillmentStatus === 'fulfilled'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {order.fulfillmentStatus || 'Unfulfilled'}
                </div>
              </div>
              
              <div className="flex items-center text-xs text-gray-500 mb-2">
                <Calendar size={12} className="mr-1" />
                <span>{format(new Date(order.date), 'MMM d, yyyy')}</span>
                <span className="mx-2">•</span>
                <span>${parseFloat(order.totalPrice).toFixed(2)}</span>
              </div>
              
              <div className="text-xs text-gray-600">
                <div className="font-medium mb-1">Items:</div>
                <ul className="space-y-1 pl-2">
                  {order.lineItems.map((item: any, idx: number) => (
                    <li key={idx} className="flex justify-between">
                      <span>{item.name} × {item.quantity}</span>
                      <span>${parseFloat(item.price).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Shipping Address */}
              {order.shipping_address && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center text-xs text-gray-600 mb-1">
                    <MapPin size={12} className="mr-1" />
                    <span className="font-medium">Shipping Address</span>
                  </div>
                  <div className="pl-4 text-xs text-gray-600">
                    <p>{order.shipping_address.name}</p>
                    <p>{order.shipping_address.address1}</p>
                    {order.shipping_address.address2 && <p>{order.shipping_address.address2}</p>}
                    <p>
                      {order.shipping_address.city}, {order.shipping_address.province_code}{' '}
                      {order.shipping_address.zip}
                    </p>
                    <p>{order.shipping_address.country}</p>
                  </div>
                </div>
              )}

              {/* Shipping Information */}
              {order.fulfillmentStatus === 'fulfilled' && order.tracking && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center text-xs text-gray-600 mb-1">
                    <Package size={12} className="mr-1" />
                    <span className="font-medium">Shipping Details</span>
                  </div>
                  <div className="pl-4 space-y-1 text-xs">
                    {order.tracking.number && (
                      <div>
                        <span className="text-gray-500">Tracking #: </span>
                        <span className="text-gray-900">{order.tracking.number}</span>
                      </div>
                    )}
                    {order.tracking.url && (
                      <a 
                        href={order.tracking.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 flex items-center"
                      >
                        Track Package <ExternalLink size={10} className="ml-1" />
                      </a>
                    )}
                  </div>
                </div>
              )}
              
              <div className="mt-2 pt-2 border-t border-gray-100">
                <a 
                  href={`https://${store.store.domain}/admin/orders/${order.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center"
                >
                  View in Shopify <ExternalLink size={12} className="ml-1" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CustomerSidebar;