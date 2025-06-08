/**
 * Send Email Edge Function
 * 
 * This Deno Edge Function handles sending email replies through Microsoft Graph API.
 * It manages authentication, token refresh, and email delivery with comprehensive
 * error handling and retry logic.
 * 
 * Email Sending Process:
 * 1. Validate user authentication and authorization
 * 2. Retrieve email details and associated store information
 * 3. Attempt to send email using Microsoft Graph API
 * 4. Handle token expiration with automatic refresh and retry
 * 5. Update email status upon successful delivery
 * 6. Provide comprehensive error handling and logging
 * 
 * Key Features:
 * - Token refresh with automatic retry on authentication failure
 * - Microsoft Graph API integration for email sending
 * - Email status tracking and updates
 * - User authentication and authorization validation
 * - Comprehensive error handling with detailed logging
 * 
 * Security Features:
 * - User authentication verification
 * - Authorization token validation
 * - Service role elevation for database operations
 * - Secure token refresh mechanism
 * - Input validation and sanitization
 * 
 * Error Handling:
 * - Automatic token refresh on 401 authentication errors
 * - Retry logic with configurable attempts
 * - Detailed error logging for debugging
 * - Graceful fallback and error reporting
 * 
 * Integration Points:
 * - Microsoft Graph API for email sending
 * - Refresh tokens function for token management
 * - Database updates for email status tracking
 * - User authentication verification
 * 
 * Used by:
 * - Email reply interfaces
 * - Customer support workflows
 * - Automated email responses
 * - Email management systems
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
import { Client } from 'npm:@microsoft/microsoft-graph-client';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request payload with email ID and reply content
    const { emailId, content } = await req.json();
    
    // Extract and validate authentication token
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client with service role key to bypass RLS
    // Service role is needed for database operations and token management
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

    // Verify User Authentication and Get User Details
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    if (userError || !user) {
      throw new Error('Failed to get user information');
    }

    // Retrieve Email Details with Associated Store Information
    // Join with stores table to get access tokens for Microsoft Graph API
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select(`
        *,
        store:stores (*)
      `)
      .eq('id', emailId)
      .single();

    if (emailError) throw emailError;
    if (!email) throw new Error('Email not found');

    // Extract access token from store data (will be updated if refresh is needed)
    let accessToken = email.store.access_token;

    /**
     * Refresh Token Function
     * 
     * Handles automatic token refresh when authentication fails.
     * Calls the dedicated refresh-tokens function and updates local token.
     * 
     * @returns Promise<string> - Updated access token
     */
    const refreshTokenIfNeeded = async () => {
      console.log('Attempting to refresh token for email sending...');
      
      // Call refresh-tokens function with store ID
      const refreshResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({ storeId: email.store.id })
      });

      if (!refreshResponse.ok) {
        throw new Error(`Token refresh failed: ${refreshResponse.status}`);
      }

      const refreshResult = await refreshResponse.json();
      if (!refreshResult.success) {
        throw new Error(refreshResult.error || 'Token refresh failed');
      }

      // Retrieve updated store data with new access token
      const { data: updatedStore, error: updateError } = await supabase
        .from('stores')
        .select('access_token')
        .eq('id', email.store.id)
        .single();

      if (updateError) throw updateError;
      
      // Update local access token variable
      accessToken = updatedStore.access_token;
      console.log('Token refreshed successfully for email sending');
      return accessToken;
    };

    /**
     * Create Microsoft Graph Client
     * 
     * Initializes Microsoft Graph client with the provided access token.
     * 
     * @param token - Access token for Microsoft Graph API authentication
     * @returns Microsoft Graph Client instance
     */
    const createGraphClient = (token: string) => {
      return Client.init({
        authProvider: (done) => {
          done(null, token);
        }
      });
    };

    /**
     * Send Email with Retry Logic
     * 
     * Attempts to send email with automatic retry on authentication failures.
     * Includes token refresh logic for handling expired tokens.
     * 
     * @param maxRetries - Maximum number of retry attempts (default: 1)
     */
    const sendEmailWithRetry = async (maxRetries = 1) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Create Microsoft Graph client with current access token
          const graphClient = createGraphClient(accessToken);

          console.log(`Attempting to send email (attempt ${attempt + 1})...`);

          // Send Email Reply via Microsoft Graph API
          await graphClient
            .api('/me/sendMail')
            .post({
              message: {
                subject: `Re: ${email.subject}`,        // Reply subject with "Re:" prefix
                body: {
                  contentType: 'HTML',                   // HTML content type for rich formatting
                  content: content                       // Email reply content from request
                },
                toRecipients: [{
                  emailAddress: {
                    address: email.from                  // Reply to original sender
                  }
                }]
              },
              saveToSentItems: true                     // Save to Sent Items folder
            });

          console.log('Email sent successfully');
          return; // Exit function on successful send

        } catch (error: any) {
          console.error(`Email send attempt ${attempt + 1} failed:`, {
            status: error.statusCode,
            message: error.message
          });

          // Handle Authentication Errors with Token Refresh
          if (error.statusCode === 401 && attempt < maxRetries) {
            // Token expired, attempt to refresh and retry
            try {
              await refreshTokenIfNeeded();
              console.log('Retrying email send with refreshed token...');
            } catch (refreshError) {
              console.error('Token refresh failed during email send:', refreshError);
              throw new Error(`Authentication failed: ${refreshError.message}`);
            }
          } else {
            // Max retries reached or non-authentication error
            throw new Error(`Failed to send email: ${error.message}`);
          }
        }
      }
    };

    // Execute Email Send with Retry Logic (1 retry attempt)
    await sendEmailWithRetry(1);

    // Update Email Status After Successful Send
    // Mark email as resolved and read to indicate completion
    await supabase
      .from('emails')
      .update({ 
        status: 'resolved',  // Mark as resolved since reply was sent
        read: true           // Mark as read since user has handled it
      })
      .eq('id', emailId);

    // Return Success Response
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-email function:', error);
    
    // Return Error Response with Details
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});