/**
 * Shopify Store Connection Edge Function
 * 
 * This Deno Edge Function handles the connection of Shopify stores to the
 * email management system. It validates Shopify credentials, creates store
 * records, and sets up the necessary database relationships for e-commerce
 * integration and customer email management.
 * 
 * Connection Process:
 * 1. Validate required Shopify credentials (domain, access token, store name)
 * 2. Test credentials against Shopify Admin API
 * 3. Retrieve shop information from Shopify
 * 4. Verify user authentication and business association
 * 5. Create store record in main stores table
 * 6. Create Shopify-specific record with credentials
 * 7. Handle rollback on any failure for data consistency
 * 
 * Key Features:
 * - Shopify Admin API credential validation
 * - Multi-tenant business association
 * - Atomic database operations with rollback
 * - Secure credential storage for Shopify access
 * - Integration with main store management system
 * 
 * Security Features:
 * - Shopify access token validation via API test
 * - User authentication verification
 * - Business association validation
 * - Secure credential storage in dedicated table
 * - Service role elevation for database operations
 * 
 * Database Operations:
 * - stores table: Main store record with platform 'shopify'
 * - shopify_stores table: Shopify-specific credentials and settings
 * - Rollback mechanisms for transaction-like behavior
 * - Business association for multi-tenant isolation
 * 
 * E-commerce Integration:
 * - Shopify Admin API integration for shop data
 * - Customer email access for support workflows
 * - Order notification and management capabilities
 * - Shop branding with Shopify green color scheme
 * 
 * Error Handling:
 * - Credential validation before database operations
 * - User and business verification
 * - Atomic operations with rollback on failures
 * - Comprehensive error messaging for debugging
 * 
 * Used by:
 * - E-commerce store connection flows
 * - Shopify app installation processes
 * - Multi-platform email management setup
 * - Customer support system integration
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Shopify Store Connection Handler
 * 
 * Main function that orchestrates the Shopify store connection process.
 * Handles credential validation, API testing, and database record creation.
 */
serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse and validate request payload
    const { store_domain, access_token, store_name } = await req.json();

    // Validate Required Shopify Credentials
    if (!store_domain || !access_token || !store_name) {
      throw new Error('Missing required fields');
    }

    // Test Shopify Credentials via Admin API
    // Validate access token and retrieve shop information
    const shopifyResponse = await fetch(`https://${store_domain}/admin/api/2023-04/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': access_token,
        'Content-Type': 'application/json',
      },
    });

    if (!shopifyResponse.ok) {
      throw new Error('Invalid Shopify credentials');
    }

    const shopData = await shopifyResponse.json();

    // Extract and Validate User Authentication
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client with service role for admin operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Service role to bypass RLS
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Verify User Identity and Get User Details
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader);
    
    if (userError || !user) {
      throw new Error('Failed to get user information');
    }

    // Retrieve User's Business Association
    // Required for multi-tenant data isolation
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('business_id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !userProfile?.business_id) {
      throw new Error('Business information not found. Please contact support.');
    }

    // Create Main Store Record
    // Insert into main stores table with Shopify platform designation
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .insert({
        name: store_name,                   // User-provided store name
        platform: 'shopify',               // Platform identifier for system compatibility
        email: shopData.shop.email,        // Shop email from Shopify API
        color: '#96bf48',                   // Shopify green branding
        connected: true,                    // Mark as connected and active
        status: 'active',
        user_id: user.id,                   // User ownership for access control
        business_id: userProfile.business_id // Business association for multi-tenancy
      })
      .select()
      .single();

    if (storeError) {
      throw storeError;
    }

    // Create Shopify-Specific Store Record
    // Store Shopify credentials and domain in dedicated table
    const { error: shopifyStoreError } = await supabase
      .from('shopify_stores')
      .insert({
        store_id: store.id,                 // Reference to main store record
        shop_domain: store_domain,          // Shopify shop domain
        access_token: access_token,         // Shopify access token for API calls
      });

    // Handle Shopify Store Creation Failure with Rollback
    if (shopifyStoreError) {
      // Rollback main store creation to maintain data consistency
      await supabase.from('stores').delete().eq('id', store.id);
      throw shopifyStoreError;
    }

    // Return Success Response with Store Details
    return new Response(
      JSON.stringify({ success: true, store }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
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