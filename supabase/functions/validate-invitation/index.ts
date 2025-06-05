import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidateInvitationRequest {
  token: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { token }: ValidateInvitationRequest = await req.json();

    if (!token) {
      throw new Error('Invitation token is required');
    }

    // Initialize Supabase client with service role key to bypass RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Look up the invitation by token
    const { data: invitation, error: invitationError } = await supabase
      .from('team_invitations')
      .select(`
        *,
        businesses!inner(name),
        inviter:auth.users!invited_by(email, raw_user_meta_data)
      `)
      .eq('invitation_token', token)
      .eq('status', 'pending')
      .single();

    if (invitationError || !invitation) {
      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: 'Invalid or expired invitation token' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if invitation has expired
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);
    
    if (expiresAt < now) {
      // Update invitation status to expired
      await supabase
        .from('team_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);

      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: 'This invitation has expired' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return the validated invitation with additional details
    const invitationDetails = {
      id: invitation.id,
      email: invitation.email,
      business_id: invitation.business_id,
      role: invitation.role,
      invited_by: invitation.invited_by,
      expires_at: invitation.expires_at,
      created_at: invitation.created_at,
      businessName: invitation.businesses?.name || 'Unknown Business',
      inviterName: invitation.inviter?.raw_user_meta_data?.first_name && invitation.inviter?.raw_user_meta_data?.last_name
        ? `${invitation.inviter.raw_user_meta_data.first_name} ${invitation.inviter.raw_user_meta_data.last_name}`
        : invitation.inviter?.email?.split('@')[0] || 'Team Admin',
    };

    console.log('Invitation validated successfully:', {
      token: token.substring(0, 8) + '...',
      email: invitation.email,
      business: invitationDetails.businessName,
      role: invitation.role,
      expires: invitation.expires_at
    });

    return new Response(
      JSON.stringify({ 
        valid: true, 
        invitation: invitationDetails 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error validating invitation:', error);
    return new Response(
      JSON.stringify({ 
        valid: false, 
        error: error.message || 'Failed to validate invitation' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}); 