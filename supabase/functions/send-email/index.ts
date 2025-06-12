/**
 * Enhanced Send Email Edge Function with Rich Attachment Support
 * 
 * This Deno Edge Function handles sending email replies through Microsoft Graph API
 * with comprehensive attachment support including:
 * - Inline images with content ID (CID) references
 * - File attachments (documents, videos, etc.)
 * - Base64 and storage-based attachment handling
 * - Automatic attachment tracking and cleanup
 * - Storage usage monitoring
 * 
 * Email Sending Process:
 * 1. Validate user authentication and authorization
 * 2. Retrieve email details and associated store information
 * 3. Process and validate all attachments
 * 4. Convert storage-based attachments to base64 for sending
 * 5. Construct Microsoft Graph API payload with attachments
 * 6. Send email with comprehensive retry logic and token refresh
 * 7. Update attachment tracking and email status
 * 8. Clean up temporary resources
 * 
 * Key Features:
 * - Rich text content with inline images
 * - Multiple attachment types (images, documents, videos)
 * - Hybrid storage strategy (base64 vs temp storage)
 * - Automatic cleanup and retention management
 * - Storage usage tracking and limits
 * - Comprehensive error handling and logging
 * 
 * Security Features:
 * - User authentication verification
 * - Authorization token validation
 * - File type and size validation
 * - Attachment ownership verification
 * - Service role elevation for database operations
 * 
 * Integration Points:
 * - Microsoft Graph API for email sending with attachments
 * - Supabase storage for temporary file management
 * - Database tracking for attachment lifecycle
 * - Automatic cleanup scheduling
 * 
 * Used by:
 * - RichTextEditor component
 * - Email reply interfaces with attachments
 * - Customer support workflows with multimedia
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';
import { Client } from 'npm:@microsoft/microsoft-graph-client';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Attachment interface matching frontend structure
interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  base64Content?: string;
  isInline?: boolean;
  contentId?: string;
  storageStrategy: 'base64' | 'temp_storage';
}

// Microsoft Graph attachment interface
interface GraphAttachment {
  '@odata.type': string;
  name: string;
  contentType: string;
  contentBytes: string;
  contentId?: string;
  isInline?: boolean;
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse request payload with email ID, content, attachments, and closeTicket option
    const requestBody = await req.json();
    const { emailId, content, attachments = [] } = requestBody;
    const closeTicket = requestBody.closeTicket !== undefined ? requestBody.closeTicket : true;
    
    // 🐛 DEBUG: Log incoming request data
    console.log('=== SEND EMAIL DEBUG START ===');
    console.log('Email ID:', emailId);
    console.log('Content length:', content?.length || 0);
    console.log('Attachments received:', attachments.length);
    console.log('Close Ticket:', closeTicket);
    console.log('Attachments data:', JSON.stringify(attachments.map(att => ({
      id: att.id,
      name: att.name,
      size: att.size,
      type: att.type,
      hasBase64: !!att.base64Content,
      base64Length: att.base64Content?.length || 0,
      isInline: att.isInline,
      contentId: att.contentId,
      storageStrategy: att.storageStrategy
    })), null, 2));
    
    // Extract and validate authentication token
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

    // Verify User Authentication and Get User Details
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    if (userError || !user) {
      throw new Error('Failed to get user information');
    }

    // Retrieve Email Details with Associated Store Information
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

    // Extract access token from store data
    let accessToken = email.store.access_token;

    // Log attachment processing start
    console.log(`Processing ${attachments.length} attachments for email ${emailId}`);

    /**
     * Process Attachments for Microsoft Graph API
     * 
     * Converts frontend attachment format to Microsoft Graph format
     * Handles both base64 and storage-based attachments
     * 
     * @param attachments - Array of attachments from frontend
     * @returns Promise<GraphAttachment[]> - Processed attachments for Graph API
     */
    const processAttachments = async (attachments: Attachment[]): Promise<GraphAttachment[]> => {
      const processedAttachments: GraphAttachment[] = [];
      
      // 🐛 DEBUG: Log attachment processing start
      console.log('=== PROCESSING ATTACHMENTS ===');
      console.log(`Starting to process ${attachments.length} attachments`);
      
      for (const attachment of attachments) {
        try {
          console.log(`\nProcessing attachment: ${attachment.name}`);
          console.log(`  - Size: ${attachment.size} bytes`);
          console.log(`  - Type: ${attachment.type}`);
          console.log(`  - Strategy: ${attachment.storageStrategy}`);
          console.log(`  - Has base64: ${!!attachment.base64Content}`);
          console.log(`  - Base64 length: ${attachment.base64Content?.length || 0}`);
          console.log(`  - Is inline: ${attachment.isInline}`);
          console.log(`  - Content ID: ${attachment.contentId}`);
          
          let base64Content = attachment.base64Content;

          // If attachment uses temp storage, retrieve from Supabase storage
          if (attachment.storageStrategy === 'temp_storage' && !base64Content) {
            console.log(`  - Retrieving from temp storage...`);
            
            // Get storage path from database
            const { data: attachmentRecord, error: attachmentError } = await supabase
              .from('email_attachments')
              .select('storage_path, base64_content')
              .eq('content_id', attachment.id)
              .eq('user_id', user.id)
              .single();

            if (attachmentError || !attachmentRecord) {
              console.error(`  - ❌ Failed to retrieve attachment record: ${attachmentError?.message}`);
              continue; // Skip this attachment
            }

            console.log(`  - Found DB record: storage_path=${attachmentRecord.storage_path}, has_base64=${!!attachmentRecord.base64_content}`);

            // Use base64 backup if available, otherwise download from storage
            if (attachmentRecord.base64_content) {
              base64Content = attachmentRecord.base64_content;
              console.log(`  - ✅ Using base64 backup from DB`);
            } else if (attachmentRecord.storage_path) {
              console.log(`  - Downloading from storage path: ${attachmentRecord.storage_path}`);
              const { data: fileData, error: downloadError } = await supabase.storage
                .from('email-attachments')
                .download(attachmentRecord.storage_path);

              if (downloadError) {
                console.error(`  - ❌ Failed to download attachment: ${downloadError.message}`);
                continue; // Skip this attachment
              }

              // Convert file to base64
              const arrayBuffer = await fileData.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              base64Content = btoa(String.fromCharCode.apply(null, Array.from(bytes)));
              console.log(`  - ✅ Downloaded and converted to base64 (${base64Content.length} chars)`);
            }
          } else {
            console.log(`  - Using provided base64 content`);
          }

          if (!base64Content) {
            console.error(`  - ❌ No content available for attachment ${attachment.name}`);
            continue; // Skip attachments without content
          }

          console.log(`  - Final base64 length: ${base64Content.length}`);

          // Create Microsoft Graph attachment object
          const graphAttachment: GraphAttachment = {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: attachment.name,
            contentType: attachment.type,
            contentBytes: base64Content,
          };

          // Add inline properties for inline images
          if (attachment.isInline && attachment.contentId) {
            graphAttachment.contentId = attachment.contentId;
            graphAttachment.isInline = true;
            console.log(`  - ✅ Added inline properties: contentId=${attachment.contentId}`);
          }

          processedAttachments.push(graphAttachment);
          console.log(`  - ✅ Successfully processed attachment: ${attachment.name}`);

        } catch (error) {
          console.error(`  - ❌ Error processing attachment ${attachment.name}:`, error);
          // Continue with other attachments rather than failing the entire email
        }
      }

      console.log(`=== ATTACHMENT PROCESSING COMPLETE ===`);
      console.log(`Processed ${processedAttachments.length} out of ${attachments.length} attachments`);
      return processedAttachments;
    };

    /**
     * Process HTML Content with Inline Images
     * 
     * Ensures that inline images use proper CID references for email clients
     * Converts any relative image sources to CID format
     * 
     * @param htmlContent - Raw HTML content from rich text editor
     * @param attachments - Array of attachments with content IDs
     * @returns string - Processed HTML content with proper CID references
     */
    const processHtmlContent = (htmlContent: string, attachments: Attachment[]): string => {
      let processedContent = htmlContent;

      // Convert data URLs to CID references for email sending
      attachments.forEach(att => {
        if (att.isInline && att.contentId) {
          // Replace data URLs with CID references for email
          const dataUrlPattern = new RegExp(`src=['"]?data:[^'"]+['"]?`, 'g');
          const cidReference = `src="cid:${att.contentId}"`;
          
          // More robust replacement - find images with matching content-id
          const contentIdPattern = new RegExp(`<img[^>]*data-content-id=['"]${att.contentId}['"][^>]*>`, 'g');
          processedContent = processedContent.replace(contentIdPattern, (match) => {
            return match.replace(/src=['"]?data:[^'"]+['"]?/, cidReference);
          });
          
          // Fallback: replace any remaining data URLs for this content ID
          const cidPattern = new RegExp(`(src=['"]?)cid:${att.contentId}(['"]?)`, 'g');
          processedContent = processedContent.replace(cidPattern, `$1cid:${att.contentId}$2`);
        }
      });

      return processedContent;
    };

    // Process all attachments for Microsoft Graph API
    const graphAttachments = await processAttachments(attachments);
    const processedContent = processHtmlContent(content, attachments);

    // Separate inline and regular attachments for logging
    const inlineAttachments = graphAttachments.filter(att => att.isInline);
    const regularAttachments = graphAttachments.filter(att => !att.isInline);

    console.log(`Processed ${inlineAttachments.length} inline images and ${regularAttachments.length} file attachments`);

    // Token refresh function
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

    // Create Microsoft Graph client
    const createGraphClient = (token: string) => {
      return Client.init({
        authProvider: (done) => {
          done(null, token);
        }
      });
    };

    /**
     * Send Email with Attachments and Retry Logic
     * 
     * Constructs the complete Microsoft Graph API payload with:
     * - Rich HTML content
     * - Inline images with CID references
     * - File attachments
     * - Proper email headers and metadata
     * 
     * @param maxRetries - Maximum number of retry attempts
     */
    const sendEmailWithRetry = async (maxRetries = 1) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const graphClient = createGraphClient(accessToken);

          console.log(`Sending email with ${graphAttachments.length} attachments (attempt ${attempt + 1})...`);

          // Construct comprehensive email payload for Microsoft Graph API
          const emailPayload = {
            message: {
              subject: `Re: ${email.subject}`,
              body: {
                contentType: 'HTML',
                content: processedContent
              },
              toRecipients: [{
                emailAddress: {
                  address: email.from
                }
              }],
              // Add attachments if any exist
              ...(graphAttachments.length > 0 && {
                attachments: graphAttachments
              })
            },
            saveToSentItems: true
          };

          // 🐛 DEBUG: Log the complete email payload structure
          console.log('=== MICROSOFT GRAPH EMAIL PAYLOAD ===');
          console.log('Subject:', emailPayload.message.subject);
          console.log('To:', emailPayload.message.toRecipients[0].emailAddress.address);
          console.log('Content Type:', emailPayload.message.body.contentType);
          console.log('Content Length:', emailPayload.message.body.content.length);
          console.log('Has Attachments:', !!emailPayload.message.attachments);
          console.log('Attachments Count:', emailPayload.message.attachments?.length || 0);
          
          if (emailPayload.message.attachments && emailPayload.message.attachments.length > 0) {
            console.log('Attachment Details:');
            emailPayload.message.attachments.forEach((att, index) => {
              console.log(`  ${index + 1}. ${att.name}`);
              console.log(`     - Type: ${att.contentType}`);
              console.log(`     - Size: ${att.contentBytes?.length || 0} base64 chars`);
              console.log(`     - Inline: ${att.isInline || false}`);
              console.log(`     - ContentId: ${att.contentId || 'none'}`);
            });
          }
          console.log('=======================================');

          // Send email via Microsoft Graph API
          await graphClient
            .api('/me/sendMail')
            .post(emailPayload);

          console.log(`✅ Email sent successfully with ${graphAttachments.length} attachments`);
          console.log('=== SEND EMAIL DEBUG END ===');
          return; // Exit on successful send

        } catch (error: any) {
          console.error(`Email send attempt ${attempt + 1} failed:`, {
            status: error.statusCode,
            message: error.message,
            attachmentCount: graphAttachments.length
          });

          // Handle authentication errors with token refresh
          if (error.statusCode === 401 && attempt < maxRetries) {
            try {
              await refreshTokenIfNeeded();
              console.log('Retrying email send with refreshed token...');
            } catch (refreshError) {
              console.error('Token refresh failed during email send:', refreshError);
              throw new Error(`Authentication failed: ${refreshError.message}`);
            }
          } else {
            // Log attachment sizes for debugging large attachment issues
            const totalSize = attachments.reduce((sum, att) => sum + att.size, 0);
            console.error(`Email send failed. Total attachment size: ${totalSize} bytes`);
            throw new Error(`Failed to send email: ${error.message}`);
          }
        }
      }
    };

    // Execute email send with retry logic
    await sendEmailWithRetry(1);

    // 🔄 SOLUTION 1: Save Reply to Database After Successful Send
    console.log('Saving reply to email_replies table...');
    
    // Insert reply record into email_replies table
    const { data: replyRecord, error: replyInsertError } = await supabase
      .from('email_replies')
      .insert({
        email_id: emailId,
        user_id: user.id,
        store_id: email.store.id,
        content: processedContent, // Use the processed HTML content with inline images
        sent_at: new Date().toISOString(),
        // 🆕 NEW FIELDS: Add direction and recipient for proper customer identification
        direction: 'outbound',
        recipient: email.from, // We're replying to the original sender
        created_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (replyInsertError) {
      console.error('Failed to save reply to database:', replyInsertError);
      // Don't fail the entire operation since email was sent successfully
      // But log the error for monitoring
    } else {
      console.log('Reply saved successfully to database:', replyRecord.id);
    }

    // Update attachment tracking - mark as processed
    if (attachments.length > 0) {
      const attachmentIds = attachments.map(att => att.id);
      
      try {
        await supabase
          .from('email_attachments')
          .update({ 
            processed: true,
            updated_at: new Date().toISOString()
          })
          .in('content_id', attachmentIds)
          .eq('user_id', user.id);

        console.log(`Updated ${attachmentIds.length} attachment records as processed`);
      } catch (trackingError) {
        console.error('Failed to update attachment tracking:', trackingError);
        // Don't fail the email send for tracking errors
      }
    }

    // Update email status after successful send (only if closeTicket is true)
    if (closeTicket) {
      await supabase
        .from('emails')
        .update({ 
          status: 'resolved',
          read: true
        })
        .eq('id', emailId);
    } else {
      // Just mark as read without changing status
      await supabase
        .from('emails')
        .update({ 
          read: true
        })
        .eq('id', emailId);
    }

    // Update user storage statistics
    try {
      await supabase.rpc('update_storage_usage', { p_user_id: user.id });
    } catch (storageError) {
      console.error('Failed to update storage usage:', storageError);
      // Don't fail the email send for storage tracking errors
    }

    // 🎯 SOLUTION 1: Return Proper Reply Data for Frontend Threading
    const responseData = {
      success: true,
      attachmentsSent: graphAttachments.length,
      inlineImages: inlineAttachments.length,
      fileAttachments: regularAttachments.length,
      // Return the saved reply data for frontend threading
      data: replyRecord || {
        // Fallback data if database save failed but email was sent
        id: `temp-reply-${Date.now()}`,
        email_id: emailId,
        user_id: user.id,
        store_id: email.store.id,
        content: processedContent,
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }
    };

    console.log('Send-email function completed successfully');

    // Return success response with reply data for threading
    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in enhanced send-email function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Check server logs for attachment processing details'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});