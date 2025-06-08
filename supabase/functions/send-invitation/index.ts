/**
 * Send Team Invitation Edge Function
 * 
 * This Deno Edge Function handles sending team invitation emails via SendGrid.
 * It's part of the multi-tenant team management system that allows business owners
 * and admins to invite new team members with role-based access control.
 * 
 * Team Management Features:
 * - Role-based invitations (admin, agent, observer)
 * - Personalized email templates with dynamic content
 * - Secure token-based invitation acceptance
 * - Expiration date handling for security
 * - Professional email branding with business context
 * 
 * SendGrid Integration:
 * - Uses SendGrid's Dynamic Template API for professional emails
 * - Custom template with personalization and branding
 * - Delivery tracking and analytics via categories
 * - Professional sender reputation management
 * 
 * Security Features:
 * - Secure invitation tokens for authentication
 * - Time-limited invitations with expiration dates
 * - Role validation and access control
 * - Reply-to configuration for direct communication
 * 
 * Multi-Tenant Support:
 * - Business-specific branding and context
 * - Inviter information for accountability
 * - Custom acceptance URLs with proper routing
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Team Invitation Email Request Interface
 * 
 * Defines the structure of invitation email requests from the frontend.
 * Contains all necessary information for personalized team invitations.
 */
interface InvitationEmailRequest {
  email: string;              // Invitee's email address
  firstName: string;          // Invitee's first name for personalization
  lastName: string;           // Invitee's last name for personalization
  jobTitle: string;           // Invitee's job title/position
  role: 'admin' | 'agent' | 'observer'; // Platform access level
  invitationToken: string;    // Secure token for invitation acceptance
  inviterName: string;        // Name of person sending the invitation
  inviterEmail: string;       // Email of person sending the invitation
  businessName: string;       // Business name for branding and context
  expiresAt: string;          // Invitation expiration timestamp
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse and extract invitation details from request
    const {
      email,
      firstName,
      lastName,
      jobTitle,
      role,
      invitationToken,
      inviterName,
      inviterEmail,
      businessName,
      expiresAt
    }: InvitationEmailRequest = await req.json();

    // Validate required fields for email composition
    if (!email || !firstName || !lastName || !businessName || !invitationToken) {
      throw new Error('Missing required email parameters');
    }

    // Verify SendGrid API configuration
    const sendGridApiKey = Deno.env.get('SENDGRID_API_KEY');
    if (!sendGridApiKey) {
      throw new Error('SendGrid API key not configured');
    }

    // Create secure invitation acceptance URL
    // This URL includes the invitation token for secure authentication
    const acceptanceUrl = `${Deno.env.get('SITE_URL') || 'https://project-ze-pikeno.vercel.app'}/accept-invitation?token=${invitationToken}`;
    
    // Format expiration date for user-friendly display
    // Shows full date with day of week for clarity
    const expirationDate = new Date(expiresAt).toLocaleDateString('en-US', {
      weekday: 'long',     // "Monday"
      year: 'numeric',     // "2024"
      month: 'long',       // "January"
      day: 'numeric'       // "15"
    });

    /**
     * Get Role Description for Email Template
     * 
     * Provides user-friendly descriptions of what each role can do
     * in the platform. Helps invitees understand their access level.
     * 
     * @param role - The role being assigned to the invitee
     * @returns string - Human-readable role description
     */
    const getRoleDescription = (role: string) => {
      switch (role) {
        case 'admin':
          return 'You will have full access to manage the team, billing, and all platform features.';
        case 'agent':
          return 'You will be able to view and reply to emails, add notes, and manage customer interactions.';
        case 'observer':
          return 'You will have read-only access to view emails, notes, and team activities.';
        default:
          return 'You will have access to the customer support platform.';
      }
    };

    // Compose email payload for SendGrid Dynamic Template API
    // Uses dynamic template with personalized data for professional appearance
    const emailPayload = {
      personalizations: [
        {
          to: [{ email, name: `${firstName} ${lastName}` }], // Recipient with full name
          dynamic_template_data: {
            // Template variables for personalization
            businessName,                               // Business context
            firstName,                                  // Personal greeting
            lastName,                                   // Full name context
            jobTitle,                                   // Position/role context
            email,                                      // Confirmation of recipient
            role: role.charAt(0).toUpperCase() + role.slice(1), // Capitalized role name
            inviterName,                                // Who sent the invitation
            inviterEmail,                               // Contact for questions
            acceptanceUrl,                              // Secure acceptance link
            expirationDate,                             // When invitation expires
            roleDescription: getRoleDescription(role)    // What they can do
          }
        }
      ],
      from: {
        email: 'support@littleinfants.com.au',         // Professional sender address
        name: `${businessName} Team`                    // Business-branded sender name
      },
      reply_to: {
        email: inviterEmail,                            // Direct replies to inviter
        name: inviterName                               // Inviter's name for replies
      },
      // Dynamic template ID for professional invitation design
      template_id: Deno.env.get('SENDGRID_TEMPLATE_ID') || 'd-c71197a807fd43589425232c43fe9e79',
      categories: ['team-invitation', 'customer-support'], // Analytics and tracking
      custom_args: {
        // Custom data for tracking and analytics
        invitation_token: invitationToken,
        business_name: businessName,
        invitee_role: role
      }
    };

    // Send email via SendGrid API
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendGridApiKey}`,   // API authentication
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    // Handle SendGrid API errors
    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid API error:', response.status, errorText);
      throw new Error(`SendGrid API error: ${response.status} ${errorText}`);
    }

    // Log successful email delivery for monitoring
    console.log('Email sent successfully via SendGrid:', {
      to: email,
      subject: `Welcome to ${businessName} - Team Invitation`,
      business: businessName,
      role: role
    });

    // Return success response with invitation details
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Invitation email sent successfully',
        acceptanceUrl: acceptanceUrl,   // For testing/verification purposes
        expires: expirationDate         // Formatted expiration for display
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error sending invitation email:', error);
    
    // Return error response with details for debugging
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
}); 