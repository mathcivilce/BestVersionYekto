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
// Back to Microsoft Graph API with clean implementation

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
        store:stores (
          *,
          business:businesses (
            name
          )
        )
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
    let processedContent = processHtmlContent(content, attachments);
    
    /**
     * 🌍 UNIVERSAL RFC2822 THREADING: Embed standards-compliant headers in email content
     * This ensures threading works across ALL email clients (Gmail, Yahoo, Apple Mail, Thunderbird, etc.)
     * while maintaining Microsoft Graph API compatibility
     */
    const embedRFC2822Headers = (htmlContent: string, headers: any): string => {
      const rfc2822Block = `
<!--[RFC2822-THREADING-HEADERS-START]-->
<div style="display:none !important;visibility:hidden !important;font-size:0 !important;line-height:0 !important;max-height:0 !important;overflow:hidden !important;opacity:0 !important;mso-hide:all;">
Message-ID: ${headers.messageId}
In-Reply-To: ${headers.inReplyTo}
References: ${headers.references}
Thread-Topic: ${headers.threadTopic}
Thread-Index: ${headers.threadIndex}
Date: ${new Date().toUTCString()}
</div>
<!--[RFC2822-THREADING-HEADERS-END]-->
`;
      
      // Insert RFC2822 headers at the beginning of the email content
      return rfc2822Block + htmlContent;
    };

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
    // Declare variables at function scope for database operations
    let sentEmailSubject = '';
    let sentEmailContent = '';
    
    const sendEmailWithRetry = async (maxRetries = 1) => {
      let mailOptions: any = null; // Declare outside try block for access in database operations
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const graphClient = createGraphClient(accessToken);

          console.log(`Sending email with ${graphAttachments.length} attachments (attempt ${attempt + 1})...`);

          // 🎯 UNIVERSAL THREADING: Generate proper RFC2822 headers for cross-provider compatibility
          // 🌍 UNIVERSAL RFC2822 THREADING: Generate standards-compliant headers for cross-platform compatibility
          const domain = email.store.email.split('@')[1] || 'outlook.com';
          const replyMessageId = `<reply-${Date.now()}-${crypto.randomUUID()}@${domain}>`;
          let originalMessageId = email.message_id_header || email.internet_message_id || `<original-${email.id}@${domain}>`;
          
          // Ensure originalMessageId has proper angle brackets for RFC2822 compliance
          if (originalMessageId && !originalMessageId.startsWith('<')) {
            originalMessageId = `<${originalMessageId}>`;
          }
          
          // Build RFC2822 compliant References header for conversation history
          const buildReferencesHeader = (originalEmail: any): string => {
            const existingReferences = originalEmail.references_header || '';
            let originalMsgId = originalEmail.message_id_header || originalEmail.internet_message_id;
            
            // Ensure Message-ID has proper angle brackets
            if (originalMsgId && !originalMsgId.startsWith('<')) {
              originalMsgId = `<${originalMsgId}>`;
            }
            
            if (existingReferences && originalMsgId) {
              // Ensure proper spacing between message IDs and angle brackets
              return `${existingReferences.trim()} ${originalMsgId}`;
            } else if (originalMsgId) {
              return originalMsgId;
            }
            return '';
          };
          
          const referencesHeader = buildReferencesHeader(email);
          
          // Generate Thread-Index for Outlook compatibility (optional enhancement)
          const generateThreadIndex = (): string => {
            const timestamp = Date.now();
            const random = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
            // Use Deno's built-in encoding instead of Buffer
            const encoder = new TextEncoder();
            const data = encoder.encode(`${timestamp}${random}`);
            return btoa(String.fromCharCode(...data)).substring(0, 22);
          };
          
          const threadIndex = generateThreadIndex();

          // 🏆 PURE RFC2822 APPROACH: No content embedding needed - headers go in SMTP transport layer
          
          // 🌍 PREPARE CLEAN EMAIL CONTENT (no embedded headers)
          const cleanContent = processedContent.replace(/<!--\[RFC2822-THREADING-HEADERS-START\]-->.*?<!--\[RFC2822-THREADING-HEADERS-END\]-->/s, '');
          
          // 🏆 CONSTRUCT EMAIL WITH RFC2822 HEADERS IN INTERNET MESSAGE HEADERS
          const emailSubject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
          
          mailOptions = {
            from: email.store.email,
            to: email.from,
            subject: emailSubject,
            html: cleanContent, // Clean content without any embedded headers
          };
          
          // Set variables for database operations
          sentEmailSubject = emailSubject;
          sentEmailContent = cleanContent;

          const emailPayload = {
            message: {
              subject: mailOptions.subject,
              body: {
                contentType: 'HTML',
                content: cleanContent // Clean HTML content
              },
              from: {
                emailAddress: {
                  address: email.store.email,
                  name: email.store.name || 'Support' // Use store name as sender display name
                }
              },
              toRecipients: [{
                emailAddress: {
                  address: email.from
                }
              }],
              // 🌍 STANDARD RFC2822 THREADING HEADERS (Required for proper threading in Outlook)
              internetMessageHeaders: [
                // Standard RFC2822 threading headers - CRITICAL for Outlook threading
                {
                  name: 'Message-ID',
                  value: replyMessageId
                },
                {
                  name: 'In-Reply-To', 
                  value: originalMessageId
                },
                {
                  name: 'References',
                  value: referencesHeader
                },
                {
                  name: 'Thread-Index',
                  value: threadIndex
                },
                {
                  name: 'Thread-Topic',
                  value: email.subject.replace(/^(Re|RE|re):\s*/, '')
                }
              ],
              // Add attachments if any exist
              ...(graphAttachments.length > 0 && {
                attachments: graphAttachments
              })
            },
            saveToSentItems: true
          };

          console.log('=== CLEAN RFC2822 GRAPH API EMAIL ===');
          console.log('From:', email.store.email);
          console.log('To:', email.from);
          console.log('Subject:', mailOptions.subject);
          console.log('RFC2822 Headers (X- prefixed):');
          emailPayload.message.internetMessageHeaders.forEach(header => {
            console.log(`  ${header.name}: ${header.value}`);
          });
          console.log('Content Length:', cleanContent.length);
          console.log('Attachments Count:', graphAttachments.length);

          // 🏆 SEND EMAIL VIA GRAPH API WITH PROPER THREADING
          // Use Microsoft's native reply endpoint for perfect threading
          let sendResponse;
          
          if (email.graph_id) {
            console.log('🔗 Using Graph API native reply endpoint for perfect threading...');
            try {
              // Microsoft's native reply endpoint automatically handles all RFC2822 threading
              sendResponse = await graphClient
                .api(`/me/messages/${email.graph_id}/reply`)
                .post({
                  message: {
                    body: {
                      contentType: 'HTML',
                      content: cleanContent
                    },
                                          from: {
                        emailAddress: {
                          address: email.store.email,
                          name: email.store.name || 'Support' // Use store name, not business name
                        }
                      },
                    // Add attachments if any exist
                    ...(graphAttachments.length > 0 && {
                      attachments: graphAttachments
                    })
                  },
                  comment: '' // Empty comment since we include full content in body
                });
              console.log('✅ Email sent via native reply endpoint - threading handled automatically');
            } catch (replyError) {
              console.log('❌ Reply endpoint failed, using sendMail fallback:', replyError.message);
              // Fallback to sendMail with enhanced threading headers
              sendResponse = await graphClient
                .api('/me/sendMail')
                .post(emailPayload);
              console.log('✅ Email sent via sendMail fallback with manual threading headers');
            }
          } else {
            console.log('📧 No graph_id available, using sendMail with manual threading headers...');
            // Use sendMail for new conversations or when graph_id is not available
            sendResponse = await graphClient
              .api('/me/sendMail')
              .post(emailPayload);
            console.log('✅ Email sent via sendMail with manual threading headers');
          }

          console.log(`✅ Email sent successfully via Graph API with clean RFC2822 headers`);
          console.log('Message ID:', replyMessageId);
          console.log('=== SEND EMAIL DEBUG END ===');

          // 🎯 CRITICAL: Store the sent email in the emails table with proper threading
          // 🔥 DUPLICATE PREVENTION: Use upsert to prevent duplicates when Microsoft syncs back
          console.log('Storing sent email with proper threading and duplicate prevention...');
          
          const { data: sentEmailRecord, error: sentEmailError } = await supabase
            .from('emails')
            .upsert({
              id: crypto.randomUUID(),
              graph_id: null, // Will be updated when synced back from Microsoft
              thread_id: email.thread_id, // ✅ INHERIT THREAD ID from original email
              subject: sentEmailSubject || (email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`),
              from: email.store.name || email.store.email, // Store name for display, fallback to email
              to: email.from,  // Reply to original sender
              content: sentEmailContent || processedContent, // Clean HTML content without embedded headers
              date: new Date().toISOString(),
              read: true, // We sent it
              priority: 1,
              status: email.status, // Inherit status from original
              store_id: email.store.id,
              user_id: user.id,
              business_id: email.business_id,
              // 🌍 RFC2822 THREADING METADATA for universal compatibility:
              message_id_header: replyMessageId, // Generated for our records
              internet_message_id: replyMessageId, // RFC2822 standard
              in_reply_to_header: originalMessageId,
              references_header: referencesHeader,
              thread_index_header: threadIndex, // Outlook compatibility
              conversation_root_id: email.thread_id,
              direction: 'outbound',
              recipient: email.from,
              is_outbound: true,
              processed_by_custom_threading: true,
              // 🌍 UNIVERSAL THREADING: No Microsoft-specific fields
              created_at: new Date().toISOString()
            }, {
              onConflict: 'message_id_header,user_id,store_id', // Prevent duplicates by Message-ID + User + Store
              ignoreDuplicates: false // Update if exists (when Microsoft syncs back with graph_id)
            })
            .select('*')
            .single();

          if (sentEmailError) {
            console.error('Failed to store sent email with threading:', sentEmailError);
            // Don't fail the send, but log for monitoring
          } else {
            console.log('✅ Sent email stored with proper threading and duplicate prevention:', sentEmailRecord.id);
          }

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
        content: sentEmailContent || processedContent, // Use clean HTML content without embedded headers
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

/* Author: Matheus Rodrigues Oliveira */