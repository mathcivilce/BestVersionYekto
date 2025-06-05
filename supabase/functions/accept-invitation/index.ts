import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AcceptInvitationRequest {
  token: string;
  user_id: string;
  direct_call?: boolean; // Flag for direct calls without user session
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('accept-invitation: Function called');
    
    const { token, user_id, direct_call }: AcceptInvitationRequest = await req.json();

    if (!token || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing token or user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('accept-invitation: Processing for user:', user_id, 'token:', token.substring(0, 8) + '...', 'direct_call:', direct_call);

    // Create Supabase client with service role for elevated permissions
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // For direct calls, skip user session validation since we already have user_id from signup
    // The user_id comes directly from supabase.auth.signUp() so it's trusted
    if (!direct_call) {
      // For authenticated calls, verify the user session matches the user_id
      const authHeader = req.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
            global: { headers: { Authorization: authHeader } }
          });
          
          const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
          if (userError || !user || user.id !== user_id) {
            console.error('accept-invitation: User authentication mismatch');
            return new Response(
              JSON.stringify({ error: 'Unauthorized - user mismatch' }),
              { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          console.log('accept-invitation: User authentication verified');
        } catch (authError) {
          console.warn('accept-invitation: Authentication check failed, proceeding with service role');
        }
      }
    }

    // Check if user already has a profile (handle duplicate calls)
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id, business_id')
      .eq('user_id', user_id)
      .single();

    if (existingProfile) {
      console.log('accept-invitation: User already has profile, skipping creation');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'User profile already exists',
          existing: true
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get invitation details
    const { data: invitation, error: inviteError } = await supabase
      .from('team_invitations')
      .select('*')
      .eq('invitation_token', token)
      .in('status', ['pending', 'accepted']) // Allow both pending and already accepted
      .single();

    if (inviteError || !invitation) {
      console.error('accept-invitation: Invalid invitation:', inviteError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invitation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('accept-invitation: Found invitation:', invitation.id, 'for business:', invitation.business_id);

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      console.error('accept-invitation: Invitation expired');
      return new Response(
        JSON.stringify({ error: 'Invitation has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get business name for the profile
    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', invitation.business_id)
      .single();

    const businessName = business?.name || 'Unknown Business';

    // Check if email is already confirmed (by database trigger)
    const { data: userData } = await supabase.auth.admin.getUserById(user_id);
    
    if (userData.user && !userData.user.email_confirmed_at) {
      // Email not confirmed yet, confirm it manually
      const { error: confirmError } = await supabase.auth.admin.updateUserById(user_id, {
        email_confirm: true
      });

      if (confirmError) {
        console.warn('accept-invitation: Could not confirm email:', confirmError);
      } else {
        console.log('accept-invitation: Email confirmed for user');
      }
    } else {
      console.log('accept-invitation: Email already confirmed by trigger');
    }

    // Create user profile with business information
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        user_id: user_id,
        business_id: invitation.business_id,
        business_name: businessName,
        role: invitation.role,
        invited_by: invitation.invited_by,
        first_name: invitation.first_name,
        last_name: invitation.last_name,
        job_title: invitation.job_title,
        created_at: new Date().toISOString()
      });

    if (profileError) {
      console.error('accept-invitation: Error creating profile:', profileError);
      console.error('accept-invitation: Profile data attempted:', {
        user_id,
        business_id: invitation.business_id,
        business_name: businessName,
        role: invitation.role,
        invited_by: invitation.invited_by,
        first_name: invitation.first_name,
        last_name: invitation.last_name,
        job_title: invitation.job_title
      });
      
      // More specific error message based on the error type
      let errorMessage = 'Failed to create user profile';
      if (profileError.code === '42501') {
        errorMessage = 'Permission denied when creating user profile. Please contact support.';
      } else if (profileError.code === '23505') {
        errorMessage = 'User profile already exists for this account.';
      } else if (profileError.message) {
        errorMessage = `Profile creation failed: ${profileError.message}`;
      }
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage,
          details: profileError.message,
          code: profileError.code 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('accept-invitation: User profile created successfully');

    // Mark invitation as accepted
    const { error: acceptError } = await supabase
      .from('team_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invitation.id);

    if (acceptError) {
      console.error('accept-invitation: Error updating invitation status:', acceptError);
      // Don't return error here as profile was created successfully
    } else {
      console.log('accept-invitation: Invitation marked as accepted');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Invitation accepted successfully',
        business_name: businessName,
        role: invitation.role
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('accept-invitation: Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 