import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
import { Client } from 'npm:@microsoft/microsoft-graph-client';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { emailId, content } = await req.json();
    
    // Get auth token from request header
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
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

    // Get the email details and user info
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    if (userError || !user) {
      throw new Error('Failed to get user information');
    }

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

    let accessToken = email.store.access_token;

    // Function to refresh token if needed
    const refreshTokenIfNeeded = async () => {
      console.log('Attempting to refresh token for email sending...');
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

      // Get updated store data
      const { data: updatedStore, error: updateError } = await supabase
        .from('stores')
        .select('access_token')
        .eq('id', email.store.id)
        .single();

      if (updateError) throw updateError;
      
      accessToken = updatedStore.access_token;
      console.log('Token refreshed successfully for email sending');
      return accessToken;
    };

    // Create Graph client with retry logic
    const createGraphClient = (token: string) => {
      return Client.init({
        authProvider: (done) => {
          done(null, token);
        }
      });
    };

    const sendEmailWithRetry = async (maxRetries = 1) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const graphClient = createGraphClient(accessToken);

          console.log(`Attempting to send email (attempt ${attempt + 1})...`);

          // Send the reply
          await graphClient
            .api('/me/sendMail')
            .post({
              message: {
                subject: `Re: ${email.subject}`,
                body: {
                  contentType: 'HTML',
                  content: content
                },
                toRecipients: [{
                  emailAddress: {
                    address: email.from
                  }
                }]
              },
              saveToSentItems: true
            });

          console.log('Email sent successfully');
          return;

        } catch (error: any) {
          console.error(`Email send attempt ${attempt + 1} failed:`, {
            status: error.statusCode,
            message: error.message
          });

          if (error.statusCode === 401 && attempt < maxRetries) {
            // Token expired, try to refresh
            try {
              await refreshTokenIfNeeded();
              console.log('Retrying email send with refreshed token...');
            } catch (refreshError) {
              console.error('Token refresh failed during email send:', refreshError);
              throw new Error(`Authentication failed: ${refreshError.message}`);
            }
          } else {
            throw new Error(`Failed to send email: ${error.message}`);
          }
        }
      }
    };

    await sendEmailWithRetry(1);

    // Update email status
    await supabase
      .from('emails')
      .update({ 
        status: 'resolved',
        read: true
      })
      .eq('id', emailId);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-email function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});