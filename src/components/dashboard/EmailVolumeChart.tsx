/**
 * EmailVolumeChart Component
 * 
 * A dashboard component that visualizes email volume over time using a simple bar chart.
 * Displays the last 7 days of email activity with daily breakdowns and summary statistics.
 * 
 * Features:
 * - Real-time data from InboxContext
 * - 7-day email volume visualization
 * - Interactive bar chart with hover effects
 * - Summary statistics (total emails, average per day)
 * - Responsive design with consistent spacing
 * - Future enhancement placeholder for time period selection
 * 
 * Data Processing:
 * - Calculates daily email counts for the last 7 days
 * - Handles date comparison and filtering
 * - Normalizes bar heights based on maximum count
 * - Provides fallback visualization for empty data
 * 
 * Used in:
 * - Main dashboard for email volume overview
 * - Performance monitoring and trend analysis
 * - Quick visual assessment of email activity
 */

import React from 'react';
import { useInbox } from '../../contexts/InboxContext';

/**
 * EmailVolumeChart Functional Component
 * 
 * Renders a bar chart showing email volume for the last 7 days.
 * Connects to the global inbox state for real-time email data.
 */
const EmailVolumeChart: React.FC = () => {
  // Access global email data from InboxContext
  const { emails } = useInbox();
  
  /**
   * Calculate Daily Email Counts
   * 
   * Processes the email array to generate daily counts for the last 7 days.
   * Creates a data structure suitable for chart rendering with normalized values.
   * 
   * Algorithm:
   * 1. Generate array of last 7 days (including today)
   * 2. For each day, count emails received on that date
   * 3. Format day names for display (Mon, Tue, Wed, etc.)
   * 4. Return array of {day, count} objects for chart rendering
   * 
   * @returns Array<{day: string, count: number}> - Daily email counts for chart
   */
  const getDailyEmailCounts = () => {
    const today = new Date();
    
    // Generate array of last 7 days (today going backwards)
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - i); // Subtract days to go backwards
      return date;
    }).reverse(); // Reverse to show oldest to newest (left to right)

    // Calculate email count for each day
    return days.map(day => {
      // Filter emails to find those received on this specific day
      const count = emails.filter(email => {
        const emailDate = new Date(email.date);
        // Compare date strings to match exact day (ignores time)
        return emailDate.toDateString() === day.toDateString();
      }).length;

      return {
        day: day.toLocaleDateString('en-US', { weekday: 'short' }), // Format as "Mon", "Tue", etc.
        count
      };
    });
  };

  // Process email data for chart rendering
  const data = getDailyEmailCounts();
  
  // Calculate chart scaling and summary statistics
  const maxCount = Math.max(...data.map(d => d.count));        // Highest daily count for scaling
  const totalEmails = data.reduce((sum, day) => sum + day.count, 0); // Sum of all emails
  const avgPerDay = Math.round(totalEmails / 7);               // Average emails per day
  
  return (
    // Main chart container with white background and shadow
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      {/* Chart header with title and time period selector */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">Email Volume</h3>
        
        {/* Time period selector (placeholder for future enhancement) */}
        <select className="text-sm border-gray-300 rounded-md">
          <option>Last 7 days</option>
          <option>Last 30 days</option>
          <option>Last 90 days</option>
        </select>
      </div>
      
      {/* Chart area with fixed height for consistent layout */}
      <div className="h-64">
        {/* Bar chart container with flex layout for equal spacing */}
        <div className="flex h-full items-end space-x-2">
          {data.map((item, index) => (
            <div key={index} className="flex-1 flex flex-col items-center">
              {/* Individual bar with dynamic height based on email count */}
              <div 
                className="w-full bg-blue-500 rounded-t-md hover:bg-blue-600 transition-all"
                style={{ 
                  // Calculate bar height as percentage of maximum count
                  height: `${(item.count / maxCount) * 100}%`,
                  minHeight: '4px' // Ensure bars are visible even with 0 count
                }}
              ></div>
              
              {/* Day label below each bar */}
              <div className="text-xs text-gray-600 mt-2">{item.day}</div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Summary statistics section */}
      <div className="mt-2 pt-4 border-t border-gray-200">
        <div className="flex justify-between text-sm">
          {/* Total emails count */}
          <div className="text-gray-500">
            <span className="font-medium text-gray-900">{totalEmails}</span> total emails
          </div>
          
          {/* Average emails per day */}
          <div className="text-gray-500">
            <span className="font-medium text-gray-900">{avgPerDay}</span> avg/day
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailVolumeChart;