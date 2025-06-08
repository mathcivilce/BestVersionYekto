/**
 * Accept Team Invitation Edge Function
 * 
 * This Deno Edge Function handles the acceptance of team invitations, creating user profiles
 * and associating users with their respective businesses in the multi-tenant system.
 * 
 * Invitation Acceptance Flow:
 * 1. Validate invitation token and user authentication
 * 2. Check if user profile already exists (handle duplicate calls)
 * 3. Verify invitation is valid and not expired
 * 4. Confirm user email if not already confirmed
 * 5. Create user profile with business association and role
 * 6. Mark invitation as accepted with timestamp
 * 
 * Multi-Tenant Features:
 * - Business association for proper data isolation
 * - Role-based access control (admin, agent, observer)
 * - Invitation tracking and audit trail
 * - Business name resolution for profile context
 * 
 * Security Features:
 * - Token-based invitation validation
 * - User authentication verification
 * - Expiration date enforcement
 * - Duplicate call protection
 * - Service role elevation for admin operations
 * 
 * Error Handling:
 * - Comprehensive validation with specific error messages
 * - PostgreSQL error code interpretation
 * - Graceful handling of duplicate operations
 * - Detailed logging for debugging and monitoring
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Accept Invitation Request Interface
 * 
 * Defines the structure of invitation acceptance requests.
 * Supports both authenticated calls and direct calls from signup flow.
 */
interface AcceptInvitationRequest {
  token: string;            // Secure invitation token for validation
  user_id: string;          // User ID from Supabase Auth
  direct_call?: boolean;    // Flag for direct calls without user session (from signup)
}

Deno.serve(async (req: Request) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('accept-invitation: Function called');
    
    // Parse and validate request payload
    const { token, user_id, direct_call }: AcceptInvitationRequest = await req.json();

    // Validate required parameters
    if (!token || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing token or user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('accept-invitation: Processing for user:', user_id, 'token:', token.substring(0, 8) + '...', 'direct_call:', direct_call);

    // Create Supabase client with service role for elevated permissions
    // Service role is needed to create user profiles and update invitation status
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authentication Validation
    // For direct calls from signup flow, skip user session validation since we trust the user_id
    // For authenticated calls, verify the user session matches the provided user_id
    if (!direct_call) {
      // Verify authenticated user session matches the user_id parameter
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

    // Check for Existing User Profile
    // Handle duplicate calls gracefully by checking if user profile already exists
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

    // Validate Invitation Token
    // Retrieve invitation details and verify the token is valid
    const { data: invitation, error: inviteError } = await supabase
      .from('team_invitations')
      .select('*')
      .eq('invitation_token', token)
      .in('status', ['pending', 'accepted']) // Allow both pending and already accepted invitations
      .single();

    if (inviteError || !invitation) {
      console.error('accept-invitation: Invalid invitation:', inviteError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invitation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('accept-invitation: Found invitation:', invitation.id, 'for business:', invitation.business_id);

    // Check Invitation Expiration
    // Enforce time-limited invitations for security
    if (new Date(invitation.expires_at) < new Date()) {
      console.error('accept-invitation: Invitation expired');
      return new Response(
        JSON.stringify({ error: 'Invitation has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Resolve Business Information
    // Get business name for user profile context
    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', invitation.business_id)
      .single();

    const businessName = business?.name || 'Unknown Business';

    // Email Confirmation Handling
    // Ensure user email is confirmed for full platform access
    const { data: userData } = await supabase.auth.admin.getUserById(user_id);
    
    if (userData.user && !userData.user.email_confirmed_at) {
      // Email not confirmed yet, confirm it manually using admin API
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

    // Create User Profile with Business Association
    // This establishes the user's role and business context in the multi-tenant system
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        user_id: user_id,                       // Link to Supabase Auth user
        business_id: invitation.business_id,    // Multi-tenant business association
        business_name: businessName,            // Cached business name for efficiency
        role: invitation.role,                  // Role-based access control
        invited_by: invitation.invited_by,      // Audit trail of who invited this user
        first_name: invitation.first_name,      // User's first name from invitation
        last_name: invitation.last_name,        // User's last name from invitation
        job_title: invitation.job_title,        // User's job title/position
        created_at: new Date().toISOString()    // Profile creation timestamp
      });

    // Handle Profile Creation Errors
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
      
      // Provide specific error messages based on PostgreSQL error codes
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

    // Mark Invitation as Accepted
    // Update invitation status for audit trail and prevent reuse
    const { error: acceptError } = await supabase
      .from('team_invitations')
      .update({
        status: 'accepted',                     // Mark invitation as completed
        accepted_at: new Date().toISOString(),  // Record acceptance timestamp
      })
      .eq('id', invitation.id);

    if (acceptError) {
      console.error('accept-invitation: Error updating invitation status:', acceptError);
      // Don't return error here as profile was created successfully
      // The invitation status update is for audit purposes only
    } else {
      console.log('accept-invitation: Invitation marked as accepted');
    }

    // Return success response with user context
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Invitation accepted successfully',
        business_name: businessName,    // Business context for frontend
        role: invitation.role           // User role for access control
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('accept-invitation: Unexpected error:', error);
    
    // Return generic error response for unexpected failures
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 