/**
 * Email Webhook Edge Function
 * 
 * This Deno Edge Function handles webhook notifications from Microsoft Graph API
 * for real-time email updates. It processes incoming email notifications and
 * synchronizes them with the local database.
 * 
 * Microsoft Graph Webhook Flow:
 * 1. Application creates webhook subscription via Graph API
 * 2. Microsoft Graph validates subscription by sending validation token
 * 3. Function responds with validation token to confirm subscription
 * 4. When new emails arrive, Microsoft Graph sends webhook notifications
 * 5. Function processes notifications and fetches email details
 * 6. Function saves emails to database with duplicate prevention
 * 
 * Key Features:
 * - Subscription validation handling for Graph API compliance
 * - Client state verification for security
 * - Real-time email synchronization with Universal RFC2822 Threading
 * - Token expiration handling with automatic store status updates
 * - Duplicate prevention using composite unique constraints
 * - Multi-tenant support with business/user isolation
 * - Consistent threading with sync-emails function
 * 
 * Security Measures:
 * - Client state verification to prevent unauthorized notifications
 * - Subscription ID validation against database records
 * - Token-based authentication with Graph API
 * - Error handling for expired or invalid tokens
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";
import { Client } from "npm:@microsoft/microsoft-graph-client";
import { 
  createEmailProvider, 
  getProviderTypeFromPlatform, 
  AttachmentProcessor 
} from "../_shared/email-providers.ts";

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Extract specific header value from internetMessageHeaders array
 */
function extractHeader(headers: any[], headerName: string): string | null {
  if (!headers || !Array.isArray(headers)) return null;
  
  const header = headers.find(h => 
    h.name && h.name.toLowerCase() === headerName.toLowerCase()
  );
  
  return header?.value || null;
}

/**
 * Extract multiple Message-IDs from References header
 */
function extractReferences(referencesHeader: string | null): string | null {
  if (!referencesHeader) return null;
  
  // References header contains space-separated Message-IDs in angle brackets
  // Example: "<id1@domain.com> <id2@domain.com> <id3@domain.com>"
  return referencesHeader.trim();
}

/**
 * 🌍 UNIVERSAL RFC2822 HEADER EXTRACTION
 * Extract embedded RFC2822 headers from email content for universal threading
 * This enables cross-platform threading compatibility with Gmail, Yahoo, Apple Mail, etc.
 * 
 * @param htmlContent - Email HTML content that may contain embedded headers
 * @returns Object containing extracted RFC2822 headers
 */
function extractEmbeddedRFC2822Headers(htmlContent: string): {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  threadTopic?: string;
  threadIndex?: string;
} {
  if (!htmlContent) return {};
  
  try {
    // Look for our embedded RFC2822 headers block
    const headerBlockMatch = htmlContent.match(
      /<!--\[RFC2822-THREADING-HEADERS-START\]-->(.*?)<!--\[RFC2822-THREADING-HEADERS-END\]-->/s
    );
    
    if (!headerBlockMatch) return {};
    
    const headerBlock = headerBlockMatch[1];
    const headers: any = {};
    
    // Extract individual headers using regex
    const messageIdMatch = headerBlock.match(/Message-ID:\s*([^\n\r]+)/);
    if (messageIdMatch) headers.messageId = messageIdMatch[1].trim();
    
    const inReplyToMatch = headerBlock.match(/In-Reply-To:\s*([^\n\r]+)/);
    if (inReplyToMatch) headers.inReplyTo = inReplyToMatch[1].trim();
    
    const referencesMatch = headerBlock.match(/References:\s*([^\n\r]+)/);
    if (referencesMatch) headers.references = referencesMatch[1].trim();
    
    const threadTopicMatch = headerBlock.match(/Thread-Topic:\s*([^\n\r]+)/);
    if (threadTopicMatch) headers.threadTopic = threadTopicMatch[1].trim();
    
    const threadIndexMatch = headerBlock.match(/Thread-Index:\s*([^\n\r]+)/);
    if (threadIndexMatch) headers.threadIndex = threadIndexMatch[1].trim();
    
    console.log('🌍 Extracted embedded RFC2822 headers:', Object.keys(headers));
    return headers;
    
  } catch (error) {
    console.error('Error extracting embedded RFC2822 headers:', error);
    return {};
  }
}

serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Handle Microsoft Graph subscription validation
    // When creating a webhook subscription, Graph API sends a validation token
    // that must be returned immediately to confirm the subscription
    const url = new URL(req.url);
    const validationToken = url.searchParams.get('validationToken');
    
    if (validationToken) {
      console.log('Handling subscription validation');
      return new Response(validationToken, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Initialize Supabase client with service role for admin operations
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

    // Parse webhook notification payload from Microsoft Graph
    // Graph API sends notifications in a standardized format with multiple notifications per request
    const payload = await req.json();
    console.log('Received notification:', payload);

    // Process each notification in the payload
    // Multiple notifications can be batched together for efficiency
    for (const notification of payload.value) {
      const { subscriptionId, clientState, resource } = notification;
      
      // Verify subscription exists and clientState matches for security
      // Client state acts as a shared secret to verify notification authenticity
      const { data: subscription, error: subError } = await supabase
        .from('graph_subscriptions')
        .select('store_id, client_state')
        .eq('subscription_id', subscriptionId)
        .single();

      if (subError || !subscription) {
        console.error('Subscription not found:', subscriptionId);
        continue; // Skip this notification if subscription is invalid
      }

      // Verify client state matches to prevent unauthorized notifications
      if (subscription.client_state !== clientState) {
        console.error('Client state mismatch');
        continue; // Skip this notification if client state doesn't match
      }

      // Get store details including access tokens for Graph API calls
      const { data: store, error: storeError } = await supabase
        .from('stores')
        .select('*')
        .eq('id', subscription.store_id)
        .single();

      if (storeError || !store) {
        console.error('Store not found:', subscription.store_id);
        continue; // Skip this notification if store is invalid
      }

      // Initialize Microsoft Graph client with store's access token
      // This allows us to fetch detailed email information from the Graph API
      const graphClient = Client.init({
        authProvider: (done) => {
          done(null, store.access_token);
        }
      });

      try {
        // Extract message ID from Graph API resource path
        // Handle multiple possible resource formats from Microsoft Graph
        console.log('Full resource path:', resource);
        
        let messageId = null;
        
        // Method 1: Standard format "Users/{userId}/Messages/{messageId}"
        if (resource.includes('/Messages/')) {
          const parts = resource.split('/Messages/');
          if (parts.length > 1) {
            // Get the message ID part and remove any query parameters
            messageId = parts[1].split('?')[0].split('&')[0];
          }
        }
        
        // Method 2: Alternative format - extract from any URL-like resource
        if (!messageId && resource.includes('/')) {
          const pathSegments = resource.split('/');
          // Look for a segment that looks like a message ID (usually long alphanumeric)
          for (let i = 0; i < pathSegments.length; i++) {
            const segment = pathSegments[i];
            // Message IDs are typically long (>20 chars) and alphanumeric
            if (segment.length > 20 && /^[A-Za-z0-9_-]+$/.test(segment)) {
              messageId = segment;
              break;
            }
          }
        }
        
        // Method 3: If all else fails, try to find the last path segment
        if (!messageId) {
          const pathSegments = resource.split('/').filter(Boolean);
          if (pathSegments.length > 0) {
            // Take the last segment and clean it
            messageId = pathSegments[pathSegments.length - 1].split('?')[0];
          }
        }
        
        if (!messageId) {
          console.error('⚠️ Could not extract message ID from resource path');
          console.error('Resource:', resource);
          continue; // Skip if we can't parse the message ID
        }
        
        console.log('✅ Processing message ID:', messageId);
        
        // Fetch detailed message information from Microsoft Graph API
        // Enhanced to include internetMessageHeaders for universal threading
        const message = await graphClient
          .api(`/me/messages/${messageId}`)
          .select('id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,body,conversationId,internetMessageId,internetMessageHeaders')
          .get();

        // 🌍 UNIVERSAL RFC2822 THREADING: Extract headers from multiple sources
        // Priority: 1) Embedded RFC2822 headers (from our sent emails)
        //          2) X-prefixed headers (from our Graph API emails)  
        //          3) Standard email headers (from external emails)
        // This ensures cross-platform compatibility with Gmail, Yahoo, Apple Mail, etc.
        const embeddedHeaders = extractEmbeddedRFC2822Headers(message.body?.content || '');
        
        // Multi-source RFC2822 header extraction with priority
        const messageIdHeader = embeddedHeaders.messageId || 
                               extractHeader(message.internetMessageHeaders, 'X-Message-ID-RFC2822') ||
                               extractHeader(message.internetMessageHeaders, 'Message-ID') || 
                               message.internetMessageId;
        
        const inReplyToHeader = embeddedHeaders.inReplyTo || 
                               extractHeader(message.internetMessageHeaders, 'X-In-Reply-To-RFC2822') ||
                               extractHeader(message.internetMessageHeaders, 'In-Reply-To');
        
        const referencesHeader = embeddedHeaders.references || 
                                extractHeader(message.internetMessageHeaders, 'X-References-RFC2822') ||
                                extractReferences(extractHeader(message.internetMessageHeaders, 'References'));
        
        const threadIndexHeader = embeddedHeaders.threadIndex || 
                                 extractHeader(message.internetMessageHeaders, 'X-Thread-Index') ||
                                 extractHeader(message.internetMessageHeaders, 'Thread-Index');
        
        // Extract recipient emails for threading context
        const toEmails = message.toRecipients?.map((r: any) => r.emailAddress?.address).filter(Boolean).join(',') || '';

        console.log('🌍 Universal threading headers extracted:', {
          messageId: messageIdHeader,
          inReplyTo: inReplyToHeader,
          references: referencesHeader,
          threadIndex: threadIndexHeader
        });

        // 🏢 ENTERPRISE RFC 2822 THREADING: Use enterprise-grade threading function
        // Supports RFC 2822, Microsoft Exchange, and all email providers
        const { data: threadResult, error: threadError } = await supabase
          .rpc('get_or_create_thread_id_universal', {
            p_message_id_header: messageIdHeader,
            p_in_reply_to_header: inReplyToHeader,
            p_references_header: referencesHeader,
            p_subject: message.subject || 'No Subject',
            p_from_email: message.from?.emailAddress?.address || '',
            p_to_email: toEmails,
            p_date: message.receivedDateTime || new Date().toISOString(),
            p_user_id: store.user_id,
            p_store_id: store.id,
            p_microsoft_conversation_id: message.conversationId,
            p_thread_index_header: threadIndexHeader
          });

        if (threadError) {
          console.error('Error getting thread ID:', threadError);
        }

        const universalThreadId = threadResult || messageIdHeader || message.conversationId;

        // 🎯 SMART REFERENCE ARCHITECTURE: Extract attachment metadata
        let attachmentCount = 0;
        let linkedAttachments: any[] = [];
        const emailId = crypto.randomUUID(); // Generate email ID for attachment linking
        
        try {
          // Set up global supabase client for provider status updates
          (globalThis as any).supabaseClient = supabase;
          
          // Create email provider for attachment metadata extraction
          const providerType = getProviderTypeFromPlatform(store.platform || 'outlook');
          const emailProvider = createEmailProvider(providerType, store.id, store.access_token);
          
          // Extract attachment metadata (not content - just metadata!)
          const attachmentMetadata = await emailProvider.extractAttachmentMetadata(messageId);
          
          if (attachmentMetadata && attachmentMetadata.length > 0) {
            console.log(`Found ${attachmentMetadata.length} attachments for email ${messageId}`);
            
            // Extract content IDs from email HTML to link with attachments
            const contentIds = AttachmentProcessor.extractContentIdFromHtml(message.body?.content || '');
            
            // Link content IDs to attachments for inline image detection
            linkedAttachments = await AttachmentProcessor.linkContentIdsToAttachments(
              contentIds, 
              attachmentMetadata
            );
            
            attachmentCount = linkedAttachments.length;
            console.log(`Found ${attachmentCount} attachment references (will process after email save)`);
          }
        } catch (attachmentError) {
          console.error('Error extracting attachments (non-fatal):', attachmentError);
          // Don't fail email processing if attachment extraction fails
        }

        // 🔥 DUPLICATE PREVENTION: Check if email already exists before processing
        // This prevents duplicate emails when Microsoft syncs back our sent emails
        const { data: existingEmail } = await supabase
          .from('emails')
          .select('id, from, graph_id')
          .or(`graph_id.eq.${message.id},message_id_header.eq.${messageIdHeader}`)
          .eq('user_id', store.user_id)
          .single();

        let actualEmailId: string;

        if (existingEmail) {
          // Email already exists - check if it needs updating with Graph ID
          actualEmailId = existingEmail.id;
          console.log('📧 Email already exists:', message.id, 'Existing ID:', actualEmailId);
          
          // If existing email doesn't have graph_id but this one does, update it
          if (!existingEmail.graph_id && message.id) {
            console.log('🔄 Updating existing email with Graph ID...');
            await supabase
              .from('emails')
              .update({ 
                graph_id: message.id,
                microsoft_conversation_id: message.conversationId,
                // Update sender info to match Microsoft's format for consistency
                from: message.from?.emailAddress?.address || existingEmail.from
              })
              .eq('id', existingEmail.id);
            
            console.log('✅ Updated existing email with Graph metadata');
          }
          
          // Skip attachment processing since it's already done
          continue;
        } else {
          // 🎯 THREAD ASSIGNMENT INHERITANCE: Check if thread already has an assignment
          let inheritedAssignment = null;
          if (universalThreadId) {
            const { data: existingThreadEmail } = await supabase
              .from('emails')
              .select('assigned_to')
              .eq('thread_id', universalThreadId)
              .eq('user_id', store.user_id)
              .not('assigned_to', 'is', null)
              .order('date', { ascending: false })
              .limit(1)
              .single();
            
            if (existingThreadEmail?.assigned_to) {
              inheritedAssignment = existingThreadEmail.assigned_to;
              console.log('🔗 Inheriting thread assignment:', inheritedAssignment);
            }
          }

          // Save new email to database with universal threading and duplicate prevention
          const { data: savedEmail, error: saveError } = await supabase
            .from('emails')
            .upsert({
              id: emailId,                                              // Use generated ID for new emails
              graph_id: message.id,                                     // Microsoft Graph message ID
              thread_id: universalThreadId,                            // Universal thread ID using RFC2822 standards
              subject: message.subject || 'No Subject',                // Email subject line
              from: message.from?.emailAddress?.address || '',         // Sender email address
              snippet: message.bodyPreview || '',                      // Email preview text
              content: message.body?.content || '',                    // Full email body content
              date: message.receivedDateTime || new Date().toISOString(), // Email received timestamp
              read: message.isRead || false,                           // Read status
              priority: 1,                                             // Default priority level
              status: 'open',                                          // Default email status
              assigned_to: inheritedAssignment,                       // 🎯 INHERIT THREAD ASSIGNMENT
              store_id: store.id,                                      // Associated email store
              user_id: store.user_id,                                  // User who owns this email
              business_id: store.business_id,                          // Business context for multi-tenancy
              internet_message_id: message.internetMessageId,         // Standard email message ID
              microsoft_conversation_id: message.conversationId,      // Store original conversationId for reference
              // 🌍 Universal RFC2822 threading headers for cross-platform compatibility
              message_id_header: messageIdHeader,                     // RFC2822 Message-ID header
              in_reply_to_header: inReplyToHeader,                    // RFC2822 In-Reply-To header
              references_header: referencesHeader,                    // RFC2822 References header
              thread_index_header: threadIndexHeader,                 // Outlook Thread-Index header for compatibility
              conversation_root_id: universalThreadId,                // Root message ID for this conversation
              has_attachments: attachmentCount > 0,                   // Smart Reference Architecture: metadata flag
              attachment_reference_count: attachmentCount,            // Smart Reference Architecture: count for UI
              processed_by_custom_threading: true,                    // Mark as processed by universal threading
              // 🎯 SMART DIRECTION DETECTION: Determine if email is inbound or outbound
              direction: (message.from?.emailAddress?.address || '').toLowerCase() === store.email.toLowerCase() ? 'outbound' : 'inbound',
              recipient: toEmails                                      // Store the actual recipients (our store email)
            }, {
              onConflict: 'graph_id,user_id',                         // Prevent duplicates by Graph ID + User
              ignoreDuplicates: false                                  // Update if exists
            })
            .select('id')
            .single();

          if (saveError) {
            console.error('Error saving email:', saveError);
            continue; // Continue processing other notifications even if one fails
          }

          actualEmailId = savedEmail?.id || emailId;
          console.log('✅ Email saved successfully with universal threading:', message.id, 'New ID:', actualEmailId);
        }

        // 🎯 NOW process attachment metadata AFTER email is saved
        if (linkedAttachments.length > 0) {
          try {
            await AttachmentProcessor.processAttachmentMetadata(
              linkedAttachments,
              actualEmailId,  // Use actual ID from database
              store.user_id,
              supabase
            );
            console.log(`Successfully processed ${linkedAttachments.length} attachment references`);
          } catch (attachmentError) {
            console.error('Error saving attachment references:', attachmentError);
            // Don't fail email processing if attachment saving fails
          }
        }
        
      } catch (error) {
        console.error('Error processing message:', error);
        
        // Handle token expiration by updating store status
        // When access tokens expire, Graph API returns 401 Unauthorized
        if (error.statusCode === 401) {
          console.log('Access token expired for store:', store.id);
          
          // Mark store as having issues and disconnected
          // This will trigger token refresh logic in the frontend
          await supabase
            .from('stores')
            .update({ 
              status: 'issue',                // Indicates authentication issue
              connected: false                // Mark as disconnected for UI
            })
            .eq('id', store.id);
        }
      }
    }

    // Return success response to acknowledge webhook processing
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook error:', error);
    
    // Return error response with details for debugging
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});