/**
 * Dashboard Component
 * 
 * The main dashboard page that provides an overview of the email management system.
 * It displays key metrics, charts, and performance indicators for email handling.
 * 
 * Key Features:
 * - Real-time statistics from inbox context
 * - Email volume visualization
 * - Email performance metrics
 * - Status distribution with progress bars
 * - Responsive grid layout for different screen sizes
 * 
 * Data Sources:
 * - useInbox: Provides emails and stores data
 * - useAuth: Provides current user information
 * - TeamService: Provides team member information
 * 
 * The component uses React.useMemo for performance optimization of calculations
 * and useEffect for debugging and monitoring data flow.
 */

import React, { useMemo, useEffect, useState } from 'react';
import { Inbox, Clock, Users, Mail } from 'lucide-react';

// Dashboard-specific components
import StatsCard from '../components/dashboard/StatsCard';
import EmailVolumeChart from '../components/dashboard/EmailVolumeChart';
import EmailPerformance from '../components/dashboard/StorePerformance';

// Context hooks for data access
import { useInbox } from '../contexts/InboxContext';
import { useAuth } from '../contexts/AuthContext';
import { TeamService } from '../services/teamService';
import { TeamMember } from '../types/team';

const Dashboard: React.FC = () => {
  const { emails, stores } = useInbox();
  const { user } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(true);

  // Development debugging - monitor component initialization
  React.useEffect(() => {
    console.log('Dashboard: Component mounted');
    console.log('Dashboard: User from context:', user);
    console.log('Dashboard: InboxContext emails:', emails.length);
    console.log('Dashboard: InboxContext stores:', stores.length);
  }, []);

  // Load team members
  useEffect(() => {
    const loadTeamMembers = async () => {
      if (!user) {
        setTeamMembersLoading(false);
        return;
      }
      
      try {
        const members = await TeamService.getTeamMembers();
        setTeamMembers(members);
      } catch (error) {
        console.error('Dashboard: Error loading team members:', error);
        setTeamMembers([]);
      } finally {
        setTeamMembersLoading(false);
      }
    };

    loadTeamMembers();
  }, [user]);

  // Monitor data changes for debugging
  useEffect(() => {
    console.log('Dashboard: Main useEffect triggered with:', {
      userExists: !!user,
      userId: user?.id,
      userEmail: user?.email,
      emailsLength: emails.length,
      storesLength: stores.length,
      teamMembersCount: teamMembers.length
    });
  }, [user, emails, stores, teamMembers]);

  /**
   * Calculate dashboard statistics
   * 
   * Uses useMemo for performance optimization to avoid recalculating
   * statistics on every render. Only recalculates when emails or stores change.
   * 
   * Calculated metrics:
   * - Total email count
   * - Average response time (currently simplified - needs actual resolution timestamps)
   * - Active email accounts count (connected and active status)
   * - Email status distribution for progress visualization
   */
  const stats = useMemo(() => {
    // Calculate total emails across all stores
    const totalEmails = emails.length;

    // Calculate average response time (in hours)
    // NOTE: This is a simplified calculation - in production, should use actual resolution timestamps
    const resolvedEmails = emails.filter(e => e.status === 'resolved');
    const avgResponseTime = resolvedEmails.length > 0
      ? resolvedEmails.reduce((sum, email) => {
          const created = new Date(email.date);
          const resolved = new Date(email.date); // TODO: Use actual resolution time from database
          return sum + (resolved.getTime() - created.getTime());
        }, 0) / (resolvedEmails.length * 1000 * 60 * 60) // Convert milliseconds to hours
      : 0;

    // Calculate number of actively connected email accounts
    const activeEmails = stores.filter(s => s.connected && s.status === 'active').length;

    // Calculate email status distribution for progress bars
    const statusCounts = emails.reduce((acc, email) => {
      acc[email.status] = (acc[email.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEmails,
      avgResponseTime: avgResponseTime.toFixed(1),
      activeEmails,
      statusCounts
    };
  }, [emails, stores]);

  /**
   * Calculate percentage for status distribution
   * 
   * @param status - Email status to calculate percentage for
   * @returns Percentage as string with one decimal place
   */
  const getStatusPercentage = (status: string) => {
    if (stats.totalEmails === 0) return 0;
    return ((stats.statusCounts[status] || 0) / stats.totalEmails * 100).toFixed(1);
  };

  return (
    <div className="space-y-6">
      {/* Top Statistics Cards */}
      {/* Responsive grid: 1 column on mobile, 2 on tablet, 4 on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Emails Metric */}
        <StatsCard
          title="Total Emails"
          value={stats.totalEmails}
          icon={<Inbox size={20} />}
          color="blue"
        />
        
        {/* Average Response Time Metric */}
        <StatsCard
          title="Avg Response Time"
          value={`${stats.avgResponseTime}h`}
          icon={<Clock size={20} />}
          color="green"
        />
        
        {/* Active Email Accounts Count */}
        <StatsCard
          title="Active Emails"
          value={stats.activeEmails}
          icon={<Mail size={20} />}
          color="indigo"
        />
        
        {/* Team Members Count */}
        <StatsCard
          title="Team Members"
          value={teamMembersLoading ? '...' : teamMembers.length}
          icon={<Users size={20} />}
          color="purple"
        />
      </div>
      
      {/* Charts and Analytics Section */}
      {/* Responsive grid: 1 column on mobile/tablet, 2 on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Email Volume Trend Chart */}
        <EmailVolumeChart />
        
        {/* Status Distribution Panel */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          {/* Panel Header with Store Filter */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Status Distribution</h3>
            {/* Store Filter Dropdown */}
            <select className="text-sm border-gray-300 rounded-md">
              <option>All Stores</option>
              {stores.map(store => (
                <option key={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
          
          {/* Status Progress Bars */}
          <div className="space-y-4">
            {/* Open Emails Progress Bar */}
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
            
            {/* Pending Emails Progress Bar */}
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
            
            {/* Resolved Emails Progress Bar */}
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
          
          {/* Summary Footer */}
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
      
      {/* Email Performance Analytics */}
      <EmailPerformance />
    </div>
  );
};

export default Dashboard;