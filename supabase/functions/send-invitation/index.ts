import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvitationEmailRequest {
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  role: 'admin' | 'agent' | 'observer';
  invitationToken: string;
  inviterName: string;
  inviterEmail: string;
  businessName: string;
  expiresAt: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    if (!email || !firstName || !lastName || !businessName || !invitationToken) {
      throw new Error('Missing required email parameters');
    }

    const sendGridApiKey = Deno.env.get('SENDGRID_API_KEY');
    if (!sendGridApiKey) {
      throw new Error('SendGrid API key not configured');
    }

    // Create the acceptance URL
    const acceptanceUrl = `${Deno.env.get('SITE_URL') || 'https://project-ze-pikeno.vercel.app'}/accept-invitation?token=${invitationToken}`;
    
    // Format expiration date
    const expirationDate = new Date(expiresAt).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Get role description
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

    // Send email via SendGrid using Dynamic Template
    const emailPayload = {
      personalizations: [
        {
          to: [{ email, name: `${firstName} ${lastName}` }],
          dynamic_template_data: {
            businessName,
            firstName,
            lastName,
            jobTitle,
            email,
            role: role.charAt(0).toUpperCase() + role.slice(1),
            inviterName,
            inviterEmail,
            acceptanceUrl,
            expirationDate,
            roleDescription: getRoleDescription(role)
          }
        }
      ],
      from: {
        email: 'support@littleinfants.com.au',
        name: `${businessName} Team`
      },
      reply_to: {
        email: inviterEmail,
        name: inviterName
      },
      template_id: Deno.env.get('SENDGRID_TEMPLATE_ID') || 'd-c71197a807fd43589425232c43fe9e79',
      categories: ['team-invitation', 'customer-support'],
      custom_args: {
        invitation_token: invitationToken,
        business_name: businessName,
        invitee_role: role
      }
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendGridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid API error:', response.status, errorText);
      throw new Error(`SendGrid API error: ${response.status} ${errorText}`);
    }

    console.log('Email sent successfully via SendGrid:', {
      to: email,
      subject: `Welcome to ${businessName} - Team Invitation`,
      business: businessName,
      role: role
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Invitation email sent successfully',
        acceptanceUrl: acceptanceUrl,
        expires: expirationDate
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error sending invitation email:', error);
    
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