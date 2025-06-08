/**
 * StorePerformance Component
 * 
 * A dashboard component that displays performance metrics for each connected email store.
 * It provides insights into email volume, response times, and resolution rates across
 * different email accounts/stores.
 * 
 * Performance Metrics:
 * - Email volume per store
 * - Average response time (calculated from email timestamps)
 * - Resolution rate percentage with visual progress bar
 * - Color-coded store identification
 * 
 * Features:
 * - Real-time data from InboxContext
 * - Responsive table design with horizontal scrolling
 * - Visual indicators (color dots, progress bars)
 * - Hover effects for better user interaction
 * - Automatic percentage calculations
 * - Time-based metrics with hour formatting
 * 
 * Data Processing:
 * - Filters emails by store association
 * - Calculates resolution rates based on email status
 * - Computes average response times (placeholder logic)
 * - Handles edge cases for stores with no emails
 * 
 * UI Components:
 * - Structured table with proper accessibility headers
 * - Color-coded store indicators matching store themes
 * - Progress bars for visual resolution rate display
 * - Responsive design with overflow handling
 * 
 * Used in:
 * - Main dashboard for store comparison
 * - Performance monitoring and reporting
 * - Store management and optimization insights
 * - Team performance evaluation
 */

import React from 'react';
import { useInbox } from '../../contexts/InboxContext';

/**
 * StorePerformance Functional Component
 * 
 * Renders a performance metrics table for all connected email stores.
 * Calculates and displays key performance indicators for each store.
 */
const StorePerformance: React.FC = () => {
  // Access global email and store data from InboxContext
  const { emails, stores } = useInbox();
  
  /**
   * Calculate Store Performance Metrics
   * 
   * Processes emails and stores to generate performance statistics for each store.
   * Calculates email volume, response times, and resolution rates.
   * 
   * Metrics Calculated:
   * - Total emails per store
   * - Average response time (placeholder calculation)
   * - Resolution rate percentage
   * - Visual identifiers (color coding)
   * 
   * @returns Array of store metrics objects with calculated performance data
   */
  const calculateStoreMetrics = () => {
    return stores.map(store => {
      // Filter emails associated with this specific store
      const storeEmails = emails.filter(email => email.storeName === store.name);
      
      // Count resolved emails for resolution rate calculation
      const resolvedEmails = storeEmails.filter(email => email.status === 'resolved');
      
      // Calculate Average Response Time
      // Note: This is placeholder logic - in a real implementation,
      // we would use actual resolution timestamps vs creation timestamps
      const avgResponse = resolvedEmails.length > 0
        ? resolvedEmails.reduce((sum, email) => {
            const created = new Date(email.date);
            const resolved = new Date(email.date); // TODO: Use actual resolution timestamp
            return sum + (resolved.getTime() - created.getTime());
          }, 0) / resolvedEmails.length
        : 0;
      
      // Convert average response time from milliseconds to hours
      const avgResponseHours = Math.round((avgResponse / (1000 * 60 * 60)) * 10) / 10;
      
      // Return comprehensive store metrics object
      return {
        id: store.id,                           // Store unique identifier
        name: store.name,                       // Store display name
        color: store.color,                     // Store color for visual identification
        emails: storeEmails.length,             // Total email count for this store
        avgResponse: `${avgResponseHours}h`,    // Formatted average response time
        resolution: `${Math.round((resolvedEmails.length / storeEmails.length) * 100) || 0}%` // Resolution rate percentage
      };
    });
  };
  
  // Generate performance metrics for all stores
  const storeMetrics = calculateStoreMetrics();
  
  return (
    // Main container with white background and border
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Table header section */}
      <div className="p-5 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">Store Performance</h3>
      </div>
      
      {/* Scrollable table container for responsive design */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          {/* Table header with column definitions */}
          <thead className="bg-gray-50">
            <tr>
              {/* Store name column with color indicator */}
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Store
              </th>
              
              {/* Email volume column */}
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Emails
              </th>
              
              {/* Average response time column */}
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Avg Response Time
              </th>
              
              {/* Resolution rate column with progress bar */}
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Resolution Rate
              </th>
            </tr>
          </thead>
          
          {/* Table body with store performance data */}
          <tbody className="bg-white divide-y divide-gray-200">
            {storeMetrics.map((store) => (
              <tr key={store.id} className="hover:bg-gray-50">
                {/* Store name cell with color indicator */}
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {/* Color dot matching store theme */}
                    <div 
                      className="h-3 w-3 rounded-full mr-3" 
                      style={{ backgroundColor: store.color }}
                    ></div>
                    
                    {/* Store name text */}
                    <div className="text-sm font-medium text-gray-900">{store.name}</div>
                  </div>
                </td>
                
                {/* Email count cell */}
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {store.emails}
                </td>
                
                {/* Average response time cell */}
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {store.avgResponse}
                </td>
                
                {/* Resolution rate cell with progress bar visualization */}
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {/* Percentage text */}
                    <div className="text-sm text-gray-900 mr-2">{store.resolution}</div>
                    
                    {/* Progress bar container */}
                    <div className="w-24 bg-gray-200 rounded-full h-2">
                      {/* Progress bar fill based on resolution percentage */}
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