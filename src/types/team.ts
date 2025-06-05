// Team Management Types

export interface Business {
  id: string;
  name: string;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  business_id?: string;
  business_name?: string;
  role: 'admin' | 'agent' | 'observer';
  invited_by?: string;
  invitation_token?: string;
  invitation_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamInvitation {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  job_title?: string;
  business_id: string;
  role: 'admin' | 'agent' | 'observer';
  invited_by: string;
  invitation_token: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  expires_at: string;
  created_at: string;
  accepted_at?: string;
}

export interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  job_title?: string;
  role: 'admin' | 'agent' | 'observer';
  status: 'active' | 'inactive';
  business_id: string;
  business_name?: string;
  invited_by?: string;
  created_at: string;
  last_active?: string;
}

export interface InviteTeamMemberRequest {
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  role: 'admin' | 'agent' | 'observer';
}

export interface UpdateMemberRoleRequest {
  user_id: string;
  role: 'admin' | 'agent' | 'observer';
}

export interface AcceptInvitationRequest {
  invitation_token: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  password: string;
  password_confirmation: string;
}

export interface InvitationDetails {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  job_title?: string;
  business_id: string;
  business_name: string;
  role: 'admin' | 'agent' | 'observer';
  invited_by: string;
  inviter_name: string;
  expires_at: string;
  created_at: string;
}

// Role Permissions
export const ROLE_PERMISSIONS = {
  admin: {
    viewEmails: true,
    replyEmails: true,
    assignConversations: true,
    addNotes: true,
    inviteMembers: true,
    removeMembers: true,
    setRoles: true,
    accessBilling: true,
    changeBusinessName: true,
    viewCustomerProfiles: true,
  },
  agent: {
    viewEmails: true,
    replyEmails: true,
    assignConversations: 'self-only',
    addNotes: true,
    inviteMembers: false,
    removeMembers: false,
    setRoles: false,
    accessBilling: false,
    changeBusinessName: false,
    viewCustomerProfiles: true,
  },
  observer: {
    viewEmails: true,
    replyEmails: false,
    assignConversations: false,
    addNotes: true,
    inviteMembers: false,
    removeMembers: false,
    setRoles: false,
    accessBilling: false,
    changeBusinessName: false,
    viewCustomerProfiles: true,
  },
} as const;

export type UserRole = 'admin' | 'agent' | 'observer';
export type Permission = keyof typeof ROLE_PERMISSIONS.admin; 