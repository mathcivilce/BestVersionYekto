import React from 'react';
import { useInbox } from '../../contexts/InboxContext';

const StorePerformance: React.FC = () => {
  const { emails, stores } = useInbox();
  
  const calculateStoreMetrics = () => {
    return stores.map(store => {
      const storeEmails = emails.filter(email => email.storeName === store.name);
      const resolvedEmails = storeEmails.filter(email => email.status === 'resolved');
      
      // Calculate average response time (if we have resolved emails)
      const avgResponse = resolvedEmails.length > 0
        ? resolvedEmails.reduce((sum, email) => {
            const created = new Date(email.date);
            const resolved = new Date(email.date); // In a real app, use actual resolution timestamp
            return sum + (resolved.getTime() - created.getTime());
          }, 0) / resolvedEmails.length
        : 0;
      
      const avgResponseHours = Math.round((avgResponse / (1000 * 60 * 60)) * 10) / 10;
      
      return {
        id: store.id,
        name: store.name,
        color: store.color,
        emails: storeEmails.length,
        avgResponse: `${avgResponseHours}h`,
        resolution: `${Math.round((resolvedEmails.length / storeEmails.length) * 100) || 0}%`
      };
    });
  };
  
  const storeMetrics = calculateStoreMetrics();
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-5 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">Store Performance</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Store
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Emails
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Avg Response Time
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Resolution Rate
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {storeMetrics.map((store) => (
              <tr key={store.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div 
                      className="h-3 w-3 rounded-full mr-3" 
                      style={{ backgroundColor: store.color }}
                    ></div>
                    <div className="text-sm font-medium text-gray-900">{store.name}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {store.emails}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {store.avgResponse}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="text-sm text-gray-900 mr-2">{store.resolution}</div>
                    <div className="w-24 bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full" 
                        style={{ width: store.resolution }}
                      ></div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StorePerformance;