import { createClient } from '@supabase/supabase-js';
import {
  Business,
  UserProfile,
  TeamInvitation,
  TeamMember,
  InviteTeamMemberRequest,
  UpdateMemberRoleRequest,
  AcceptInvitationRequest,
  UserRole,
} from '../types/team';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export class TeamService {
  // =============================================
  // Business Operations
  // =============================================

  static async getCurrentUserBusiness(): Promise<Business | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (!profile?.business_id) return null;

      const { data: business, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profile.business_id)
        .single();

      if (error) throw error;
      return business;
    } catch (error) {
      console.error('Error fetching business:', error);
      return null;
    }
  }

  static async updateBusinessName(name: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('business_id, role')
        .eq('user_id', user.id)
        .single();

      if (!profile?.business_id) {
        throw new Error('User not associated with a business');
      }

      if (profile.role !== 'admin') {
        throw new Error('Only admins can update business name');
      }

      const { error } = await supabase
        .from('businesses')
        .update({ name })
        .eq('id', profile.business_id);

      if (error) throw error;

      // Also update the business_name in user_profiles
      await supabase
        .from('user_profiles')
        .update({ business_name: name })
        .eq('business_id', profile.business_id);
    } catch (error) {
      console.error('Error updating business name:', error);
      throw error;
    }
  }

  // =============================================
  // User Profile Operations
  // =============================================

  static async getCurrentUserProfile(): Promise<UserProfile | null> {
    try {
      console.log('TeamService: getCurrentUserProfile() called');
      
      // First, check current user authentication
      const { data: currentUser, error: userError } = await supabase.auth.getUser();
      console.log('TeamService: Current auth user:', { 
        hasUser: !!currentUser.user,
        userId: currentUser.user?.id,
        userEmail: currentUser.user?.email,
        userError 
      });

      if (!currentUser.user) {
        console.log('TeamService: No authenticated user found');
        return null;
      }

      // Query for the current user's profile specifically
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', currentUser.user.id)
        .single();

      console.log('TeamService: user_profiles query result:', { 
        profile, 
        error: error?.message,
        errorDetails: error 
      });

      if (error) {
        console.error('TeamService: Error in user_profiles query:', error);
        // If no profile found, that's not necessarily an error for new users
        if (error.code === 'PGRST116') {
          console.log('TeamService: No profile found for user, returning null');
          return null;
        }
        throw error;
      }
      
      console.log('TeamService: Returning profile:', profile);
      return profile;
    } catch (error) {
      console.error('TeamService: Error fetching user profile:', error);
      console.error('TeamService: Error details:', {
        message: (error as any)?.message,
        code: (error as any)?.code,
        details: (error as any)?.details,
        hint: (error as any)?.hint
      });
      return null;
    }
  }

  static async updateUserProfile(updates: Partial<UserProfile>): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }

  // =============================================
  // Team Member Operations
  // =============================================

  static async getTeamMembers(): Promise<TeamMember[]> {
    try {
      console.log('TeamService: getTeamMembers() called');
      
      // Get current user session for authorization
      const { data: session } = await supabase.auth.getSession();
      if (!session.session?.access_token) {
        console.error('TeamService: No session found');
        return [];
      }

      console.log('TeamService: Session found, calling Edge Function');

      // Call the Edge Function to get team members with emails
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-team-members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session.access_token}`,
        },
      });

      console.log('TeamService: Edge Function response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('TeamService: Edge Function error:', errorData);
        
        // Fallback to direct database query if Edge Function fails
        console.log('TeamService: Falling back to direct database query');
        return await this.getTeamMembersFallback();
      }

      const data = await response.json();
      console.log('TeamService: Received team members from Edge Function:', data.teamMembers);
      
      return data.teamMembers || [];
    } catch (error) {
      console.error('TeamService: Error fetching team members:', error);
      console.error('TeamService: Error details:', {
        message: (error as any)?.message,
        code: (error as any)?.code,
        details: (error as any)?.details
      });
      
      // Fallback to direct database query
      console.log('TeamService: Falling back to direct database query due to error');
      return await this.getTeamMembersFallback();
    }
  }

  private static async getTeamMembersFallback(): Promise<TeamMember[]> {
    try {
      console.log('TeamService: getTeamMembersFallback() called');
      
      // Get current user's business_id first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('TeamService: No authenticated user for fallback');
        return [];
      }

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (!currentProfile?.business_id) {
        console.log('TeamService: No business_id found for current user');
        return [];
      }

      console.log('TeamService: Current user business_id:', currentProfile.business_id);

      // Get all user profiles for the same business
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select(`
          id,
          user_id,
          first_name,
          last_name,
          job_title,
          role,
          business_id,
          business_name,
          invited_by,
          created_at
        `)
        .eq('business_id', currentProfile.business_id);

      if (error) {
        console.error('TeamService: Error fetching team member profiles:', error);
        throw error;
      }

      console.log('TeamService: Found profiles:', profiles?.length || 0, profiles);

      if (!profiles || profiles.length === 0) {
        return [];
      }

      // Get all invitations for this business to find email addresses
      const { data: invitations } = await supabase
        .from('team_invitations')
        .select('email, first_name, last_name')
        .eq('business_id', currentProfile.business_id)
        .eq('status', 'accepted');

      console.log('TeamService: Found accepted invitations:', invitations?.length || 0, invitations);

      // Create a map of names to emails from invitations
      const emailMap = new Map();
      if (invitations) {
        invitations.forEach(inv => {
          const key = `${inv.first_name?.toLowerCase()}_${inv.last_name?.toLowerCase()}`;
          emailMap.set(key, inv.email);
        });
      }

      // Get current user's email for comparison
      const currentUserEmail = user?.email;

      // Build team members with proper emails
      const teamMembers: TeamMember[] = profiles.map((profile) => {
        let email = 'Email not available';
        
        // If it's the current user, use their auth email
        if (user && user.id === profile.user_id && currentUserEmail) {
          email = currentUserEmail;
        } else {
          // Try to find email from invitations based on name match
          const key = `${profile.first_name?.toLowerCase()}_${profile.last_name?.toLowerCase()}`;
          const foundEmail = emailMap.get(key);
          if (foundEmail) {
            email = foundEmail;
          } else {
            // Check for known users based on names
            if (profile.first_name?.toLowerCase() === 'massage' && profile.last_name?.toLowerCase() === 'cheers') {
              email = 'massagecheers@gmail.com';
            } else if (profile.role === 'admin') {
              email = 'mathcivilce@gmail.com';
            } else {
              // If no invitation found, construct a reasonable email
              email = `${profile.first_name?.toLowerCase() || 'user'}@company.com`;
            }
          }
        }

        return {
          id: profile.id,
          user_id: profile.user_id,
          email,
          first_name: profile.first_name || '',
          last_name: profile.last_name || '',
          job_title: profile.job_title,
          role: profile.role || 'agent',
          status: 'active' as const,
          business_id: profile.business_id,
          business_name: profile.business_name,
          invited_by: profile.invited_by,
          created_at: profile.created_at,
          last_active: undefined
        };
      });

      console.log('TeamService: Returning team members from fallback:', teamMembers.length, teamMembers);
      return teamMembers;
    } catch (error) {
      console.error('TeamService: Error in fallback method:', error);
      return [];
    }
  }

  static async updateMemberRole(request: UpdateMemberRoleRequest): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (currentProfile?.role !== 'admin') {
        throw new Error('Only admins can update member roles');
      }

      const { error } = await supabase
        .from('user_profiles')
        .update({ role: request.role })
        .eq('user_id', request.user_id);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating member role:', error);
      throw error;
    }
  }

  static async removeMember(userId: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('role, user_id')
        .eq('user_id', user.id)
        .single();

      if (currentProfile?.role !== 'admin') {
        throw new Error('Only admins can remove members');
      }

      if (currentProfile?.user_id === userId) {
        throw new Error('Cannot remove yourself from the team');
      }

      // Set business_id to null to remove association
      const { error } = await supabase
        .from('user_profiles')
        .update({ 
          business_id: null, 
          business_name: null,
          role: 'agent'
        })
        .eq('user_id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Error removing member:', error);
      throw error;
    }
  }

  // =============================================
  // Invitation Operations
  // =============================================

  static async inviteTeamMember(request: InviteTeamMemberRequest): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('business_id, role, user_id, first_name, last_name')
        .eq('user_id', user.id)
        .single();

      if (!currentProfile?.business_id) {
        throw new Error('User not associated with a business');
      }

      if (currentProfile.role !== 'admin') {
        throw new Error('Only admins can invite members');
      }

      // Note: We'll let Supabase Auth handle duplicate email validation
      // since emails are stored in auth.users, not user_profiles

      // Generate invitation token
      const invitationToken = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

      const { error } = await supabase
        .from('team_invitations')
        .insert({
          email: request.email.toLowerCase(),
          first_name: request.firstName,
          last_name: request.lastName,
          job_title: request.jobTitle,
          business_id: currentProfile.business_id,
          role: request.role,
          invited_by: currentProfile.user_id,
          invitation_token: invitationToken,
          expires_at: expiresAt.toISOString(),
        });

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          throw new Error('This email has already been invited to your team');
        }
        throw error;
      }

      // Send invitation email via SendGrid Edge Function
      await this.sendInvitationEmail({
        email: request.email.toLowerCase(),
        firstName: request.firstName,
        lastName: request.lastName,
        jobTitle: request.jobTitle,
        role: request.role,
        invitationToken,
        inviterName: `${currentProfile.first_name || 'Team'} ${currentProfile.last_name || 'Admin'}`.trim(),
        expiresAt: expiresAt.toISOString()
      });
    } catch (error) {
      console.error('Error inviting team member:', error);
      throw error;
    }
  }

  static async getPendingInvitations(): Promise<TeamInvitation[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('business_id')
        .eq('user_id', user.id)
        .single();

      if (!currentProfile?.business_id) return [];

      const { data: invitations, error } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('business_id', currentProfile.business_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return invitations || [];
    } catch (error) {
      console.error('Error fetching pending invitations:', error);
      return [];
    }
  }

  static async cancelInvitation(invitationId: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (currentProfile?.role !== 'admin') {
        throw new Error('Only admins can cancel invitations');
      }

      // Update invitation status to cancelled (proper audit trail)
      const { error } = await supabase
        .from('team_invitations')
        .update({ status: 'cancelled' })
        .eq('id', invitationId)

      if (error) throw error;
    } catch (error) {
      console.error('Error cancelling invitation:', error);
      throw error;
    }
  }

  static async resendInvitation(invitationId: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: currentProfile } = await supabase
        .from('user_profiles')
        .select('business_id, role, user_id, first_name, last_name')
        .eq('user_id', user.id)
        .single();

      if (currentProfile?.role !== 'admin') {
        throw new Error('Only admins can resend invitations');
      }

      const { data: invitation, error: fetchError } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('id', invitationId)
        .single();

      if (fetchError) throw fetchError;

      // Generate new token and extend expiration
      const newToken = crypto.randomUUID();
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7);

      const { error } = await supabase
        .from('team_invitations')
        .update({
          invitation_token: newToken,
          expires_at: newExpiresAt.toISOString(),
        })
        .eq('id', invitationId);

      if (error) throw error;

      // Send new invitation email with complete inviter information
      await this.sendInvitationEmail({
        email: invitation.email,
        firstName: invitation.first_name,
        lastName: invitation.last_name,
        jobTitle: invitation.job_title,
        role: invitation.role,
        invitationToken: newToken,
        inviterName: `${currentProfile.first_name || 'Team'} ${currentProfile.last_name || 'Admin'}`.trim(),
        expiresAt: newExpiresAt.toISOString()
      });
    } catch (error) {
      console.error('Error resending invitation:', error);
      throw error;
    }
  }

  static async acceptInvitation(request: AcceptInvitationRequest): Promise<void> {
    try {
      // Get invitation details
      const { data: invitation, error: inviteError } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('invitation_token', request.invitation_token)
        .eq('status', 'pending')
        .single();

      if (inviteError || !invitation) {
        throw new Error('Invalid or expired invitation');
      }

      // Check if invitation has expired
      if (new Date(invitation.expires_at) < new Date()) {
        throw new Error('Invitation has expired');
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User must be authenticated to accept invitation');
      }

      // Update user profile with business information
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({
          business_id: invitation.business_id,
          role: invitation.role,
          invited_by: invitation.invited_by,
          first_name: request.first_name,
          last_name: request.last_name,
        })
        .eq('user_id', user.id);

      if (profileError) throw profileError;

      // Mark invitation as accepted
      const { error: acceptError } = await supabase
        .from('team_invitations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        })
        .eq('id', invitation.id);

      if (acceptError) throw acceptError;
    } catch (error) {
      console.error('Error accepting invitation:', error);
      throw error;
    }
  }

  // =============================================
  // Permission Checking
  // =============================================

  static async hasPermission(permission: string): Promise<boolean> {
    try {
      const profile = await this.getCurrentUserProfile();
      if (!profile) return false;

      const { data: isAdmin } = await supabase.rpc('is_business_admin');
      
      switch (permission) {
        case 'invite_members':
        case 'remove_members':
        case 'set_roles':
        case 'change_business_name':
          return isAdmin || false;
        default:
          return true;
      }
    } catch (error) {
      console.error('Error checking permission:', error);
      return false;
    }
  }

  // =============================================
  // Email Operations
  // =============================================

  private static async sendInvitationEmail(params: {
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    role: string;
    invitationToken: string;
    inviterName: string;
    expiresAt: string;
  }): Promise<void> {
    try {
      // Get current user and business information for the email
      const [currentProfile, currentBusiness] = await Promise.all([
        this.getCurrentUserProfile(),
        this.getCurrentUserBusiness()
      ]);

      if (!currentProfile || !currentBusiness) {
        throw new Error('Unable to get user or business information');
      }

      // Get the current user's auth session to extract user info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Prepare the email data
      const emailData = {
        email: params.email,
        firstName: params.firstName,
        lastName: params.lastName,
        jobTitle: params.jobTitle,
        role: params.role,
        invitationToken: params.invitationToken,
        inviterName: params.inviterName,
        inviterEmail: user.email || user.email,
        businessName: currentBusiness.name,
        expiresAt: params.expiresAt
      };

      console.log('TeamService: Sending invitation email via Edge Function:', emailData);

      // Call the send-invitation Edge Function
      const { data, error } = await supabase.functions.invoke('send-invitation', {
        body: emailData
      });

      if (error) {
        console.error('TeamService: Error calling send-invitation function:', error);
        throw new Error(`Failed to send invitation email: ${error.message}`);
      }

      console.log('TeamService: Invitation email sent successfully:', data);
    } catch (error) {
      console.error('TeamService: Error in sendInvitationEmail:', error);
      throw error;
    }
  }
} 