/**
 * EmailPerformance Component
 * 
 * A dashboard component that displays performance metrics for each connected email account.
 * It provides insights into email volume, response times, and resolution rates across
 * different email accounts/integrations.
 * 
 * Performance Metrics:
 * - Email volume per account
 * - Average response time (calculated from email timestamps)
 * - Resolution rate percentage with visual progress bar
 * - Color-coded account identification
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
 * - Filters emails by connected email account association
 * - Calculates resolution rates based on email status
 * - Computes average response times (placeholder logic)
 * - Handles edge cases for accounts with no emails
 * - Shows only connected and active email integrations
 * 
 * UI Components:
 * - Structured table with proper accessibility headers
 * - Color-coded account indicators matching account themes
 * - Progress bars for visual resolution rate display
 * - Responsive design with overflow handling
 * 
 * Used in:
 * - Main dashboard for email account comparison
 * - Performance monitoring and reporting
 * - Email account management and optimization insights
 * - Team performance evaluation
 */

import React from 'react';
import { useInbox } from '../../contexts/InboxContext';

/**
 * EmailPerformance Functional Component
 * 
 * Renders a performance metrics table for all connected email accounts.
 * Calculates and displays key performance indicators for each email account.
 */
const EmailPerformance: React.FC = () => {
  // Access global email and store data from InboxContext
  const { emails, stores } = useInbox();
  
  /**
   * Calculate Email Account Performance Metrics
   * 
   * Processes emails and connected email accounts to generate performance statistics.
   * Only includes connected email accounts (email integrations) and removes duplicates.
   * Calculates email volume, response times, and resolution rates.
   * 
   * Metrics Calculated:
   * - Total emails per email account
   * - Average response time (placeholder calculation)
   * - Resolution rate percentage
   * - Visual identifiers (color coding)
   * 
   * @returns Array of email account metrics objects with calculated performance data
   */
  const calculateEmailAccountMetrics = () => {
    // Filter to only connected email accounts and remove duplicates
    const connectedEmailAccounts = stores.filter(store => 
      store.connected && 
      store.platform === 'outlook' && 
      store.status === 'active'
    );

    // Remove duplicates based on email address
    const uniqueEmailAccounts = connectedEmailAccounts.reduce((unique, store) => {
      const existingStore = unique.find(s => s.email === store.email);
      if (!existingStore) {
        unique.push(store);
      }
      return unique;
    }, [] as typeof connectedEmailAccounts);

    return uniqueEmailAccounts.map(store => {
      // Filter emails associated with this specific email account
      const accountEmails = emails.filter(email => email.storeName === store.name);
      
      // Count resolved emails for resolution rate calculation
      const resolvedEmails = accountEmails.filter(email => email.status === 'resolved');
      
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
      
      // Return comprehensive email account metrics object
      return {
        id: store.id,                           // Email account unique identifier
        name: store.name,                       // Email account display name
        email: store.email,                     // Email address
        color: store.color,                     // Account color for visual identification
        emails: accountEmails.length,           // Total email count for this account
        avgResponse: `${avgResponseHours}h`,    // Formatted average response time
        resolution: `${Math.round((resolvedEmails.length / accountEmails.length) * 100) || 0}%` // Resolution rate percentage
      };
    });
  };
  
  // Generate performance metrics for all connected email accounts
  const emailAccountMetrics = calculateEmailAccountMetrics();
  
  return (
    // Main container with white background and border
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Table header section */}
      <div className="p-5 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">Email Performance</h3>
      </div>
      
      {/* Scrollable table container for responsive design */}
      <div className="overflow-x-auto">
        {emailAccountMetrics.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-500">
              <p className="text-sm">No connected email accounts found.</p>
              <p className="text-xs mt-1">Connect email accounts to see performance metrics.</p>
            </div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            {/* Table header with column definitions */}
            <thead className="bg-gray-50">
              <tr>
                {/* Email account name column with color indicator */}
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email Account
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
            
            {/* Table body with email account performance data */}
            <tbody className="bg-white divide-y divide-gray-200">
              {emailAccountMetrics.map((account) => (
                <tr key={account.id} className="hover:bg-gray-50">
                  {/* Email account name cell with color indicator */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {/* Color dot matching account theme */}
                      <div 
                        className="h-3 w-3 rounded-full mr-3" 
                        style={{ backgroundColor: account.color }}
                      ></div>
                      
                      {/* Email account name and email address */}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{account.name}</div>
                        <div className="text-xs text-gray-500">{account.email}</div>
                      </div>
                    </div>
                  </td>
                  
                  {/* Email count cell */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {account.emails}
                  </td>
                  
                  {/* Average response time cell */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {account.avgResponse}
                  </td>
                  
                  {/* Resolution rate cell with progress bar visualization */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {/* Percentage text */}
                      <div className="text-sm text-gray-900 mr-2">{account.resolution}</div>
                      
                      {/* Progress bar container */}
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        {/* Progress bar fill based on resolution percentage */}
                        <div 
                          className="bg-blue-600 h-2 rounded-full" 
                          style={{ width: account.resolution }}
                        ></div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default EmailPerformance;