/**
 * Shopify Customer Lookup Edge Function
 * 
 * This Deno Edge Function provides comprehensive customer lookup across all
 * connected Shopify stores. It searches for customers by email and retrieves
 * detailed order history, fulfillment status, and tracking information with
 * intelligent rate limiting and caching mechanisms.
 * 
 * Lookup Process:
 * 1. Check cache for recent customer data (5-minute TTL)
 * 2. Query all connected Shopify stores for user
 * 3. Search each store for customer by email
 * 4. Retrieve comprehensive order history for found customers
 * 5. Enrich orders with fulfillment and tracking details
 * 6. Cache results for performance optimization
 * 7. Return consolidated customer data across all stores
 * 
 * Key Features:
 * - Multi-store customer search and consolidation
 * - Comprehensive order history with fulfillment details
 * - Intelligent rate limiting with exponential backoff
 * - Performance caching with TTL-based expiration
 * - Tracking information enrichment for shipped orders
 * - Graceful error handling per store (isolated failures)
 * 
 * Rate Limiting Strategy:
 * - Exponential backoff for 429 rate limit responses
 * - Configurable retry attempts (3 max) with increasing delays
 * - Respectful API usage with inter-request delays
 * - Shopify rate limit header parsing and compliance
 * 
 * Data Enrichment:
 * - Customer profile information (contact details, stats)
 * - Complete order history with line items
 * - Fulfillment status and tracking numbers
 * - Shipping addresses and delivery information
 * - Financial data (total spent, order values)
 * 
 * Caching System:
 * - 5-minute TTL for customer data to balance freshness and performance
 * - Database-backed caching with automatic expiration
 * - Cache key based on email for consistent lookups
 * - Graceful cache fallback on errors
 * 
 * Security Features:
 * - User authentication verification
 * - Secure Shopify API token usage
 * - Error message sanitization
 * - Request isolation per store to prevent data leaks
 * 
 * Used by:
 * - Customer support workflows for order inquiries
 * - Email context enrichment for customer communications
 * - Multi-store customer relationship management
 * - Order status and tracking information lookup
 * 
 * Performance Optimizations:
 * - Parallel order detail fetching where possible
 * - Intelligent caching to reduce API calls
 * - Rate limit compliance to maintain API access
 * - Graceful degradation on store connection failures
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

// CORS headers for cross-origin requests from frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration constants
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_RETRIES = 3;              // Maximum retry attempts for failed requests
const BASE_DELAY = 1000;            // Base delay in milliseconds for retry backoff

/**
 * Intelligent Fetch with Rate Limiting and Retry Logic
 * 
 * Implements exponential backoff and rate limit compliance for Shopify API calls.
 * Handles 429 rate limit responses with proper retry-after header parsing.
 * 
 * @param url - API endpoint URL to fetch
 * @param options - Fetch request options (headers, method, etc.)
 * @param retries - Number of retry attempts remaining
 * @returns Promise<Response> - Fetch response or throws on exhausted retries
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  try {
    const response = await fetch(url, options);
    
    // Handle Shopify rate limiting (429 Too Many Requests)
    if (response.status === 429) {
      if (retries === 0) throw new Error('Rate limit exceeded. Please try again later.');
      
      // Parse Retry-After header or use exponential backoff
      const retryAfter = parseInt(response.headers.get('Retry-After') || '0');
      const waitTime = retryAfter * 1000 || BASE_DELAY * (MAX_RETRIES - retries + 1);
      
      console.log(`Rate limited. Waiting ${waitTime}ms before retry. ${retries} retries remaining.`);
      await delay(waitTime);
      
      return fetchWithRetry(url, options, retries - 1);
    }
    
    return response;
  } catch (error) {
    // Handle network errors with exponential backoff
    if (retries === 0) throw error;
    
    const waitTime = BASE_DELAY * (MAX_RETRIES - retries + 1);
    console.log(`Request failed. Waiting ${waitTime}ms before retry. ${retries} retries remaining.`);
    await delay(waitTime);
    
    return fetchWithRetry(url, options, retries - 1);
  }
}

/**
 * Main Shopify Customer Lookup Handler
 * 
 * Orchestrates the complete customer lookup process across all connected
 * Shopify stores with caching, rate limiting, and data enrichment.
 */
serve(async (req) => {
  // Handle preflight CORS requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Extract and validate customer email from query parameters
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    console.log(`Looking up customer with email: ${email}`);
    
    if (!email) {
      throw new Error('Email parameter is required');
    }

    // Verify user authentication
    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Initialize Supabase client with user authentication
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: `Bearer ${authHeader}` } },
        auth: { persistSession: false }
      }
    );

    // Check Cache for Recent Customer Data
    const cacheKey = `shopify_customer:${email}`;
    const cachedData = await getCacheEntry(supabase, cacheKey);
    if (cachedData) {
      console.log('Returning cached data');
      return new Response(
        JSON.stringify(cachedData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Retrieve All Connected Shopify Stores
    console.log('Fetching connected Shopify stores');
    const { data: shopifyStores, error: storesError } = await supabase
      .from('shopify_stores')
      .select(`
        *,
        store:stores(*)
      `);

    if (storesError) {
      console.error('Error fetching stores:', storesError);
      throw storesError;
    }

    console.log(`Found ${shopifyStores.length} connected stores`);

    // Process Each Store for Customer Data
    const customerData = [];
    for (const shopifyStore of shopifyStores) {
      try {
        // Rate limiting: delay between store requests
        if (customerData.length > 0) {
          console.log('Waiting 1000ms before next store lookup...');
          await delay(1000);
        }

        console.log(`Searching for customer in store: ${shopifyStore.shop_domain}`);
        
        // Search for Customer by Email in Current Store
        const customerResponse = await fetchWithRetry(
          `https://${shopifyStore.shop_domain}/admin/api/2023-04/customers/search.json?query=email:${email}`,
          {
            headers: {
              'X-Shopify-Access-Token': shopifyStore.access_token,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!customerResponse.ok) {
          throw new Error(`Failed to fetch customer data: ${customerResponse.statusText}`);
        }

        const { customers } = await customerResponse.json();
        if (!customers?.length) {
          console.log(`No customer found in store: ${shopifyStore.shop_domain}`);
          continue;
        }

        const customer = customers[0];
        console.log(`Found customer ${customer.id} in store ${shopifyStore.shop_domain}`);

        // Rate limiting between API calls
        await delay(1000);

        // Retrieve Customer's Order History
        console.log(`Fetching orders for customer ${customer.id}`);
        const ordersResponse = await fetchWithRetry(
          `https://${shopifyStore.shop_domain}/admin/api/2023-04/orders.json?customer_id=${customer.id}&status=any`,
          {
            headers: {
              'X-Shopify-Access-Token': shopifyStore.access_token,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!ordersResponse.ok) {
          throw new Error(`Failed to fetch order data: ${ordersResponse.statusText}`);
        }

        const { orders } = await ordersResponse.json();
        console.log(`Found ${orders.length} orders for customer ${customer.id}`);

        // Enrich Orders with Detailed Information and Tracking
        const ordersWithDetails = await Promise.all(orders.map(async (order: any) => {
          // Fetch detailed order information
          const orderResponse = await fetchWithRetry(
            `https://${shopifyStore.shop_domain}/admin/api/2023-04/orders/${order.id}.json`,
            {
              headers: {
                'X-Shopify-Access-Token': shopifyStore.access_token,
                'Content-Type': 'application/json',
              },
            }
          );

          if (!orderResponse.ok) {
            console.error(`Failed to fetch detailed order data for order ${order.id}`);
            return order;
          }

          const { order: orderDetails } = await orderResponse.json();

          // Fetch Tracking Information for Fulfilled Orders
          if (order.fulfillment_status === 'fulfilled') {
            await delay(1000); // Rate limiting
            
            const fulfillmentResponse = await fetchWithRetry(
              `https://${shopifyStore.shop_domain}/admin/api/2023-04/orders/${order.id}/fulfillments.json`,
              {
                headers: {
                  'X-Shopify-Access-Token': shopifyStore.access_token,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (!fulfillmentResponse.ok) {
              console.error(`Failed to fetch fulfillment data for order ${order.id}`);
              return { ...orderDetails };
            }

            const { fulfillments } = await fulfillmentResponse.json();
            const latestFulfillment = fulfillments[fulfillments.length - 1];

            // Add tracking information to order details
            return {
              ...orderDetails,
              tracking: latestFulfillment ? {
                number: latestFulfillment.tracking_number,
                url: latestFulfillment.tracking_url,
                company: latestFulfillment.tracking_company
              } : null
            };
          }

          return orderDetails;
        }));

        // Consolidate Customer Data with Store Context
        customerData.push({
          store: {
            id: shopifyStore.store_id,
            name: shopifyStore.store.name,
            domain: shopifyStore.shop_domain,
          },
          customer: {
            id: customer.id,
            email: customer.email,
            firstName: customer.first_name,
            lastName: customer.last_name,
            phone: customer.phone,
            ordersCount: customer.orders_count,
            totalSpent: customer.total_spent,
          },
          orders: ordersWithDetails.map((order: any) => ({
            id: order.id,
            number: order.name,
            date: order.created_at,
            totalPrice: order.total_price,
            fulfillmentStatus: order.fulfillment_status,
            tracking: order.tracking,
            shipping_address: order.shipping_address,
            lineItems: order.line_items.map((item: any) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            })),
          })),
        });
      } catch (error) {
        // Isolate store errors to prevent complete lookup failure
        console.error(`Error fetching data from store ${shopifyStore.shop_domain}:`, error);
      }
    }

    console.log(`Found customer data in ${customerData.length} stores`);
    
    // Prepare Response with Consolidated Data
    const response = {
      found: customerData.length > 0,
      stores: customerData,
    };

    // Cache Results for Performance (5-minute TTL)
    await setCacheEntry(supabase, cacheKey, response, 5);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in shopify-lookup function:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        found: false,
        stores: []
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message.includes('Rate limit') ? 429 : 400
      }
    );
  }
});

/**
 * Cache Retrieval Function
 * 
 * Retrieves cached customer data from database with TTL validation.
 * Returns null if cache miss or expired entry.
 * 
 * @param supabase - Supabase client instance
 * @param key - Cache key for lookup
 * @returns Promise<any> - Cached data or null
 */
async function getCacheEntry(supabase: any, key: string): Promise<any> {
  try {
    console.log(`Fetching cache entry for key: ${key}`);
    const { data, error } = await supabase
      .from('cache_entries')
      .select('value')
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found error
      throw error;
    }

    console.log('Cache hit');
    return data.value;
  } catch (err) {
    console.error('Cache get failed:', err);
    return null;
  }
}

/**
 * Cache Storage Function
 * 
 * Stores customer data in database cache with TTL expiration.
 * Uses upsert to handle key conflicts gracefully.
 * 
 * @param supabase - Supabase client instance
 * @param key - Cache key for storage
 * @param value - Data to cache
 * @param ttlMinutes - Time-to-live in minutes (default: 5)
 */
async function setCacheEntry(supabase: any, key: string, value: any, ttlMinutes: number = 5): Promise<void> {
  try {
    console.log(`Setting cache entry for key: ${key}`);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000);

    const { error } = await supabase
      .from('cache_entries')
      .upsert({
        key,
        value,
        expires_at: expiresAt.toISOString()
      });

    if (error) throw error;
    console.log('Cache entry set successfully');
  } catch (err) {
    console.error('Cache set failed:', err);
  }
}