import React from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { useInbox } from '../../contexts/InboxContext';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const AnalyticsDashboard: React.FC = () => {
  const { emails, stores } = useInbox();

  // Response Time Trend Data
  const responseTimeData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [{
      label: 'Average Response Time (hours)',
      data: [2.5, 2.1, 2.8, 1.9, 2.3, 1.8, 2.0],
      borderColor: 'rgb(59, 130, 246)',
      tension: 0.1,
    }]
  };

  // Email Volume by Store
  const volumeByStore = {
    labels: stores.map(store => store.name),
    datasets: [{
      data: stores.map(store => 
        emails.filter(email => email.storeName === store.name).length
      ),
      backgroundColor: stores.map(store => store.color),
    }]
  };

  // Resolution Rate Data
  const resolutionData = {
    labels: ['Resolved', 'Pending', 'Open'],
    datasets: [{
      data: [
        emails.filter(e => e.status === 'resolved').length,
        emails.filter(e => e.status === 'pending').length,
        emails.filter(e => e.status === 'open').length,
      ],
      backgroundColor: [
        'rgb(34, 197, 94)',
        'rgb(234, 179, 8)',
        'rgb(59, 130, 246)',
      ],
    }]
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Response Time Trend</h3>
          <Line 
            data={responseTimeData}
            options={{
              responsive: true,
              scales: {
                y: {
                  beginAtZero: true,
                  title: {
                    display: true,
                    text: 'Hours'
                  }
                }
              }
            }}
          />
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Email Volume by Store</h3>
          <Bar 
            data={volumeByStore}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  display: false
                }
              }
            }}
          />
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Resolution Status</h3>
          <div className="w-2/3 mx-auto">
            <Doughnut 
              data={resolutionData}
              options={{
                responsive: true,
                plugins: {
                  legend: {
                    position: 'bottom'
                  }
                }
              }}
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Key Metrics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-600 mb-1">Average Response Time</p>
              <p className="text-2xl font-semibold text-blue-700">2.3h</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-green-600 mb-1">Resolution Rate</p>
              <p className="text-2xl font-semibold text-green-700">85%</p>
            </div>
            <div className="p-4 bg-yellow-50 rounded-lg">
              <p className="text-sm text-yellow-600 mb-1">Customer Satisfaction</p>
              <p className="text-2xl font-semibold text-yellow-700">4.8/5</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <p className="text-sm text-purple-600 mb-1">Total Conversations</p>
              <p className="text-2xl font-semibold text-purple-700">{emails.length}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;