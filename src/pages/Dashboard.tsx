import React, { useMemo, useEffect } from 'react';
import { Inbox, Clock, Users, Store } from 'lucide-react';
import StatsCard from '../components/dashboard/StatsCard';
import EmailVolumeChart from '../components/dashboard/EmailVolumeChart';
import StorePerformance from '../components/dashboard/StorePerformance';
import { useInbox } from '../contexts/InboxContext';
import { useAuth } from '../contexts/AuthContext';

const Dashboard: React.FC = () => {
  const { emails, stores } = useInbox();
  const { user } = useAuth();

  // Basic debugging - check if component loads
  React.useEffect(() => {
    console.log('Dashboard: Component mounted');
    console.log('Dashboard: User from context:', user);
    console.log('Dashboard: InboxContext emails:', emails.length);
    console.log('Dashboard: InboxContext stores:', stores.length);
  }, []);

  useEffect(() => {
    console.log('Dashboard: Main useEffect triggered with:', {
      userExists: !!user,
      userId: user?.id,
      userEmail: user?.email,
      emailsLength: emails.length,
      storesLength: stores.length
    });
  }, [user, emails, stores]);

  const stats = useMemo(() => {
    // Calculate total emails
    const totalEmails = emails.length;

    // Calculate average response time (in hours)
    const resolvedEmails = emails.filter(e => e.status === 'resolved');
    const avgResponseTime = resolvedEmails.length > 0
      ? resolvedEmails.reduce((sum, email) => {
          const created = new Date(email.date);
          const resolved = new Date(email.date); // In real app, use actual resolution time
          return sum + (resolved.getTime() - created.getTime());
        }, 0) / (resolvedEmails.length * 1000 * 60 * 60)
      : 0;

    // Calculate active stores
    const activeStores = stores.filter(s => s.connected && s.status === 'active').length;

    // Calculate status distribution
    const statusCounts = emails.reduce((acc, email) => {
      acc[email.status] = (acc[email.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEmails,
      avgResponseTime: avgResponseTime.toFixed(1),
      activeStores,
      statusCounts
    };
  }, [emails, stores]);

  const getStatusPercentage = (status: string) => {
    if (stats.totalEmails === 0) return 0;
    return ((stats.statusCounts[status] || 0) / stats.totalEmails * 100).toFixed(1);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Emails"
          value={stats.totalEmails}
          icon={<Inbox size={20} />}
          color="blue"
        />
        
        <StatsCard
          title="Avg Response Time"
          value={`${stats.avgResponseTime}h`}
          icon={<Clock size={20} />}
          color="green"
        />
        
        <StatsCard
          title="Active Stores"
          value={stats.activeStores}
          icon={<Store size={20} />}
          color="indigo"
        />
        
        <StatsCard
          title="Team Members"
          value={stores.length > 0 ? '1' : '0'}
          icon={<Users size={20} />}
          color="purple"
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EmailVolumeChart />
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Status Distribution</h3>
            <select className="text-sm border-gray-300 rounded-md">
              <option>All Stores</option>
              {stores.map(store => (
                <option key={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
          
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Open</span>
                <span className="text-gray-500">
                  {stats.statusCounts.open || 0} ({getStatusPercentage('open')}%)
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full" 
                  style={{ width: `${getStatusPercentage('open')}%` }}
                ></div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Pending</span>
                <span className="text-gray-500">
                  {stats.statusCounts.pending || 0} ({getStatusPercentage('pending')}%)
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-yellow-500 h-2.5 rounded-full" 
                  style={{ width: `${getStatusPercentage('pending')}%` }}
                ></div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Resolved</span>
                <span className="text-gray-500">
                  {stats.statusCounts.resolved || 0} ({getStatusPercentage('resolved')}%)
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-green-500 h-2.5 rounded-full" 
                  style={{ width: `${getStatusPercentage('resolved')}%` }}
                ></div>
              </div>
            </div>
          </div>
          
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex justify-between text-sm">
              <div className="text-gray-500">
                <span className="font-medium text-green-600">
                  {stats.statusCounts.resolved || 0}
                </span> resolved
              </div>
              <div className="text-gray-500">
                <span className="font-medium text-blue-600">
                  {stats.statusCounts.pending || 0}
                </span> pending
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <StorePerformance />
    </div>
  );
};

export default Dashboard;