import React from 'react';
import { useInbox } from '../../contexts/InboxContext';

const EmailVolumeChart: React.FC = () => {
  const { emails } = useInbox();
  
  // Calculate emails per day for the last 7 days
  const getDailyEmailCounts = () => {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      return date;
    }).reverse();

    return days.map(day => {
      const count = emails.filter(email => {
        const emailDate = new Date(email.date);
        return emailDate.toDateString() === day.toDateString();
      }).length;

      return {
        day: day.toLocaleDateString('en-US', { weekday: 'short' }),
        count
      };
    });
  };

  const data = getDailyEmailCounts();
  const maxCount = Math.max(...data.map(d => d.count));
  const totalEmails = data.reduce((sum, day) => sum + day.count, 0);
  const avgPerDay = Math.round(totalEmails / 7);
  
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">Email Volume</h3>
        <select className="text-sm border-gray-300 rounded-md">
          <option>Last 7 days</option>
          <option>Last 30 days</option>
          <option>Last 90 days</option>
        </select>
      </div>
      
      <div className="h-64">
        <div className="flex h-full items-end space-x-2">
          {data.map((item, index) => (
            <div key={index} className="flex-1 flex flex-col items-center">
              <div 
                className="w-full bg-blue-500 rounded-t-md hover:bg-blue-600 transition-all"
                style={{ 
                  height: `${(item.count / maxCount) * 100}%`,
                  minHeight: '4px'
                }}
              ></div>
              <div className="text-xs text-gray-600 mt-2">{item.day}</div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="mt-2 pt-4 border-t border-gray-200">
        <div className="flex justify-between text-sm">
          <div className="text-gray-500">
            <span className="font-medium text-gray-900">{totalEmails}</span> total emails
          </div>
          <div className="text-gray-500">
            <span className="font-medium text-gray-900">{avgPerDay}</span> avg/day
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailVolumeChart;