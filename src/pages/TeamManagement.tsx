import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Mail, MoreVertical, Crown, Shield, Eye, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { TeamService } from '../services/teamService';
import { TeamMember, TeamInvitation, UserRole, InviteTeamMemberRequest } from '../types/team';
import InviteTeamMemberModal from '../components/team/InviteTeamMemberModal';

const TeamManagement: React.FC = () => {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);

  // Safe date formatting function
  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid Date';
      return format(date, 'MMM d, yyyy');
    } catch (error) {
      console.error('Error formatting date:', dateString, error);
      return 'Invalid Date';
    }
  };

  useEffect(() => {
    loadTeamData();
  }, []);

  const loadTeamData = async () => {
    try {
      console.log('TeamManagement: Starting loadTeamData');
      setLoading(true);
      
      console.log('TeamManagement: About to fetch team data...');
      const [members, invitations, profile] = await Promise.all([
        TeamService.getTeamMembers(),
        TeamService.getPendingInvitations(),
        TeamService.getCurrentUserProfile(),
      ]);

      console.log('TeamManagement: Team data fetched:', {
        membersCount: members?.length || 0,
        members: members,
        invitationsCount: invitations?.length || 0,
        invitations: invitations,
        profile: profile,
        profileBusinessId: profile?.business_id
      });

      setTeamMembers(members);
      setPendingInvitations(invitations);
      setCurrentUserProfile(profile);
    } catch (error) {
      console.error('TeamManagement: Error loading team data:', error);
      console.error('TeamManagement: Error details:', {
        message: (error as any)?.message,
        name: (error as any)?.name,
        stack: (error as any)?.stack
      });
      toast.error('Failed to load team data');
    } finally {
      console.log('TeamManagement: loadTeamData completed');
      setLoading(false);
    }
  };

  const handleInviteMember = async (request: InviteTeamMemberRequest) => {
    try {
      await TeamService.inviteTeamMember(request);
      toast.success(`Invitation sent successfully to ${request.firstName} ${request.lastName}`);
      loadTeamData(); // Refresh data
    } catch (error: any) {
      console.error('TeamManagement: Error inviting member:', error);
      toast.error(error.message || 'Failed to send invitation');
      throw error; // Re-throw to let modal handle it
    }
  };

  const handleRemoveMember = async (userId: string, memberName: string) => {
    if (window.confirm(`Are you sure you want to remove ${memberName} from the team?`)) {
      try {
        await TeamService.removeMember(userId);
        toast.success('Member removed successfully');
        loadTeamData();
      } catch (error: any) {
        toast.error(error.message || 'Failed to remove member');
      }
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      await TeamService.cancelInvitation(invitationId);
      toast.success('Invitation cancelled');
      loadTeamData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel invitation');
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    try {
      await TeamService.resendInvitation(invitationId);
      toast.success('Invitation resent');
    } catch (error: any) {
      toast.error(error.message || 'Failed to resend invitation');
    }
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Crown size={16} className="text-yellow-500" />;
      case 'agent':
        return <Shield size={16} className="text-blue-500" />;
      case 'observer':
        return <Eye size={16} className="text-gray-500" />;
      default:
        return null;
    }
  };

  const getRoleBadge = (role: UserRole) => {
    const baseClasses = "px-2 py-1 text-xs font-medium rounded-full";
    switch (role) {
      case 'admin':
        return `${baseClasses} bg-yellow-100 text-yellow-800`;
      case 'agent':
        return `${baseClasses} bg-blue-100 text-blue-800`;
      case 'observer':
        return `${baseClasses} bg-gray-100 text-gray-800`;
      default:
        return baseClasses;
    }
  };

  const isCurrentUserAdmin = currentUserProfile?.role === 'admin';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your team members and their roles
          </p>
        </div>
        {isCurrentUserAdmin && (
          <button
            onClick={() => setIsInviteModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus size={16} className="mr-2" />
            Invite Member
          </button>
        )}
      </div>

      {/* Team Members */}
      <div className="bg-white shadow-sm rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900 flex items-center">
            <Users size={20} className="mr-2" />
            Team Members ({teamMembers.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Joined
                </th>
                {isCurrentUserAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {teamMembers.map((member) => (
                <tr key={member.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-700">
                          {(member.first_name?.[0] || member.email[0]).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {member.first_name && member.last_name
                            ? `${member.first_name} ${member.last_name}`
                            : member.email}
                        </div>
                        <div className="text-sm text-gray-500">{member.email}</div>
                        {member.job_title && (
                          <div className="text-xs text-gray-400">{member.job_title}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {getRoleIcon(member.role)}
                      <span className={`ml-2 ${getRoleBadge(member.role)}`}>
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(member.created_at)}
                  </td>
                  {isCurrentUserAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        {member.user_id !== currentUserProfile?.user_id && (
                          <>
                            <button
                              onClick={() => handleRemoveMember(
                                member.user_id,
                                member.first_name && member.last_name
                                  ? `${member.first_name} ${member.last_name}`
                                  : member.email
                              )}
                              className="p-1 text-red-600 hover:text-red-900"
                              title="Remove member"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invitations */}
      {isCurrentUserAdmin && pendingInvitations.length > 0 && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900 flex items-center">
              <Mail size={20} className="mr-2" />
              Pending Invitations ({pendingInvitations.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Invitee
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Invited
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Expires
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pendingInvitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {invitation.first_name && invitation.last_name
                            ? `${invitation.first_name} ${invitation.last_name}`
                            : 'Pending User'}
                        </div>
                        <div className="text-sm text-gray-500">{invitation.email}</div>
                        {invitation.job_title && (
                          <div className="text-xs text-gray-400">{invitation.job_title}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={getRoleBadge(invitation.role)}>
                        {invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(invitation.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(invitation.expires_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleResendInvitation(invitation.id)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Resend
                        </button>
                        <button
                          onClick={() => handleCancelInvitation(invitation.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite Team Member Modal */}
      <InviteTeamMemberModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onInvite={handleInviteMember}
      />
    </div>
  );
};

export default TeamManagement; 