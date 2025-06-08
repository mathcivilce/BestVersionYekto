/**
 * Validate Team Invitation Edge Function
 * 
 * This Deno Edge Function validates team invitation tokens and retrieves
 * invitation details for the signup/acceptance flow. It handles token validation,
 * expiration checking, and data enrichment for the frontend.
 * 
 * Validation Process:
 * 1. Verify invitation token exists and is valid
 * 2. Check invitation status (must be 'pending')
 * 3. Validate expiration date and update status if expired
 * 4. Enrich invitation data with business and inviter information
 * 5. Return comprehensive invitation details for frontend display
 * 
 * Key Features:
 * - Token-based invitation validation
 * - Automatic expiration handling with status updates
 * - Data enrichment with business and inviter details
 * - Comprehensive error handling for various failure cases
 * - Service role access for bypassing RLS policies
 * 
 * Data Enrichment:
 * - Business name resolution for context
 * - Inviter name extraction from user metadata
 * - Fallback handling for missing inviter information
 * - Formatted response data for frontend consumption
 * 
 * Security Features:
 * - Token-based authentication (no user session required)
 * - Automatic expiration enforcement
 * - Status tracking for audit trails
 * - Service role elevation for data access
 * 
 * Used by:
 * - Invitation acceptance pages
 * - Signup flows with invitation context
 * - Team invitation management interfaces
 * - Email invitation links
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Validate Invitation Request Interface
 * 
 * Defines the structure of validation requests containing
 * the invitation token to be verified.
 */
interface ValidateInvitationRequest {
  token: string; // Secure invitation token for validation
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse and validate request payload
    const { token }: ValidateInvitationRequest = await req.json();

    // Validate required token parameter
    if (!token) {
      throw new Error('Invitation token is required');
    }

    // Initialize Supabase client with service role key to bypass RLS
    // Service role is needed to access team_invitations table and related data
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

    // Look up invitation by token with enriched data
    // Join with businesses table for business name and inviter details
    const { data: invitation, error: invitationError } = await supabase
      .from('team_invitations')
      .select(`
        *,
        businesses!inner(name),
        inviter:auth.users!invited_by(email, raw_user_meta_data)
      `)
      .eq('invitation_token', token)          // Match the provided token
      .eq('status', 'pending')                // Only validate pending invitations
      .single();

    // Handle invalid or missing invitation
    if (invitationError || !invitation) {
      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: 'Invalid or expired invitation token' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check Invitation Expiration
    // Compare current time with invitation expiration timestamp
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);
    
    if (expiresAt < now) {
      // Update invitation status to expired for audit trail
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

    // Prepare Enriched Invitation Details
    // Combine invitation data with business and inviter information for frontend display
    const invitationDetails = {
      id: invitation.id,                      // Invitation unique identifier
      email: invitation.email,                // Invitee email address
      business_id: invitation.business_id,    // Business association for multi-tenancy
      role: invitation.role,                  // Assigned role for access control
      invited_by: invitation.invited_by,      // User ID of inviter
      expires_at: invitation.expires_at,      // Expiration timestamp
      created_at: invitation.created_at,      // Invitation creation timestamp
      businessName: invitation.businesses?.name || 'Unknown Business', // Business context
      
      // Extract inviter name with fallbacks
      inviterName: invitation.inviter?.raw_user_meta_data?.first_name && invitation.inviter?.raw_user_meta_data?.last_name
        ? `${invitation.inviter.raw_user_meta_data.first_name} ${invitation.inviter.raw_user_meta_data.last_name}` // Full name from metadata
        : invitation.inviter?.email?.split('@')[0] || 'Team Admin', // Fallback to email prefix or generic name
    };

    // Log successful validation for monitoring
    console.log('Invitation validated successfully:', {
      token: token.substring(0, 8) + '...',  // Partial token for security
      email: invitation.email,
      business: invitationDetails.businessName,
      role: invitation.role,
      expires: invitation.expires_at
    });

    // Return successful validation with enriched details
    return new Response(
      JSON.stringify({ 
        valid: true, 
        invitation: invitationDetails 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error validating invitation:', error);
    
    // Return error response with details for debugging
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