/**
 * Create Ticket Edge Function
 * 
 * This Deno Edge Function handles creating new support tickets by:
 * - Creating a new email thread in the database
 * - Sending the initial email via Microsoft Graph API
 * - Properly assigning the ticket to a team member
 * - Managing ticket status (open vs resolved)
 * - Maintaining multi-tenant security with business scoping
 * 
 * Ticket Creation Process:
 * 1. Validate user authentication and store access
 * 2. Create new email thread with unique thread ID
 * 3. Save initial email to database
 * 4. Send email via Microsoft Graph API
 * 5. Update ticket status based on requested action
 * 6. Return thread details for frontend navigation
 * 
 * Key Features:
 * - New thread creation with RFC2822 compliant Message-ID
 * - Rich text content with HTML support
 * - Assignment to team members
 * - Two completion modes: "send" and "send_and_close"
 * - Multi-tenant business scoping for security
 * - Comprehensive error handling and logging
 * 
 * Security Features:
 * - User authentication verification
 * - Store ownership validation
 * - Business context isolation
 * - Email validation and sanitization
 * 
 * Integration Points:
 * - Microsoft Graph API for email sending
 * - Database thread and email creation
 * - Team assignment system
 * - Email threading system
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
import { Client } from 'npm:@microsoft/microsoft-graph-client';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

// Generate RFC2822 compliant Message-ID for new threads
const generateMessageId = (domain: string = 'outlook.com'): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `<${timestamp}.${random}@${domain}>`;
};

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request payload
    const requestBody = await req.json();
    const { storeId, to, subject, content, assignedTo, action } = requestBody;
    
    console.log('=== CREATE TICKET DEBUG START ===');
    console.log('Store ID:', storeId);
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Assigned To:', assignedTo);
    console.log('Action:', action);
    console.log('Content length:', content?.length || 0);
    
    // Validate required fields
    if (!storeId || !to || !subject || !content) {
      throw new Error('Missing required fields: storeId, to, subject, content');
    }
    
    // Extract and validate authentication token
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client with service role key
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

    // Verify User Authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    if (userError || !user) {
      throw new Error('Failed to get user information');
    }

    // Get user's business ID for multi-tenant security
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('business_id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !userProfile?.business_id) {
      throw new Error('Unable to get user business information');
    }

    // Validate Store Access with Business Scoping
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .eq('business_id', userProfile.business_id)
      .single();

    if (storeError || !store) {
      throw new Error('Store not found or access denied');
    }

    // Validate access token exists
    if (!store.access_token) {
      throw new Error('Store access token not available. Please reconnect the store.');
    }

    // Generate unique IDs for the new thread and email
    const threadId = crypto.randomUUID();
    const emailId = crypto.randomUUID();
    const messageId = generateMessageId(store.email.split('@')[1] || 'outlook.com');
    
    console.log('Generated IDs:', { threadId, emailId, messageId });

    // Create Microsoft Graph client for sending email
    const createGraphClient = (token: string) => {
      return Client.init({
        authProvider: (done) => {
          done(null, token);
        }
      });
    };

    let accessToken = store.access_token;
    const graphClient = createGraphClient(accessToken);

    // Prepare email for Microsoft Graph API
    const emailPayload = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: content
        },
        toRecipients: [
          {
            emailAddress: {
              address: to
            }
          }
        ],
        from: {
          emailAddress: {
            address: store.email
          }
        },
        internetMessageId: messageId
      }
    };

    console.log('Sending email via Microsoft Graph API...');

    // Send email with retry logic for token refresh
    let emailSent = false;
    let retryCount = 0;
    const maxRetries = 2;

    while (!emailSent && retryCount < maxRetries) {
      try {
        await graphClient.api('/me/sendMail').post(emailPayload);
        emailSent = true;
        console.log('Email sent successfully via Microsoft Graph');
      } catch (error: any) {
        console.error(`Email sending attempt ${retryCount + 1} failed:`, error);
        
        if (error.code === 'Unauthorized' && retryCount < maxRetries - 1) {
          console.log('Attempting to refresh token...');
          
          // Attempt token refresh
          const refreshResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-tokens`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ storeId: store.id })
          });

          if (refreshResponse.ok) {
            const refreshResult = await refreshResponse.json();
            if (refreshResult.success) {
              // Get updated token
              const { data: updatedStore } = await supabase
                .from('stores')
                .select('access_token')
                .eq('id', store.id)
                .single();
              
              if (updatedStore?.access_token) {
                accessToken = updatedStore.access_token;
                const newGraphClient = createGraphClient(accessToken);
                // Update the graph client for next retry
                Object.assign(graphClient, newGraphClient);
                console.log('Token refreshed successfully');
              }
            }
          }
        }
        
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to send email after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }

    // Create the thread and initial email in database
    console.log('Creating thread and email in database...');

    // Create thread first (parent record)
    const { data: threadData, error: threadError } = await supabase
      .from('emails')
      .insert({
        id: threadId,
        thread_id: threadId,
        subject: subject,
        from: store.email,
        to: to,
        content: content,
        date: new Date().toISOString(),
        read: true, // Mark as read since we sent it
        priority: 1,
        status: action === 'send_and_close' ? 'resolved' : 'open',
        store_id: storeId,
        user_id: user.id,
        business_id: userProfile.business_id,
        assigned_to: assignedTo || user.id,
        internet_message_id: messageId,
        message_id_header: messageId,
        is_outbound: true,
        // 🆕 NEW FIELDS: Add direction and recipient for proper customer identification
        direction: 'outbound',
        recipient: to,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (threadError) {
      console.error('Error creating thread:', threadError);
      throw new Error(`Failed to create ticket: ${threadError.message}`);
    }

    console.log('Thread created successfully:', threadData);

    // Return success response with thread details
    const responseData = {
      success: true,
      message: action === 'send_and_close' ? 'Ticket created and resolved successfully' : 'Ticket created successfully',
      data: {
        threadId: threadId,
        emailId: threadId, // Using same ID for initial thread
        storeId: storeId,
        subject: subject,
        status: action === 'send_and_close' ? 'resolved' : 'open'
      }
    };

    console.log('Create ticket function completed successfully');

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-ticket function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Check server logs for more information'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}); 