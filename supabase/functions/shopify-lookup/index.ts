import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  try {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      if (retries === 0) throw new Error('Rate limit exceeded. Please try again later.');
      
      const retryAfter = parseInt(response.headers.get('Retry-After') || '0');
      const waitTime = retryAfter * 1000 || BASE_DELAY * (MAX_RETRIES - retries + 1);
      
      console.log(`Rate limited. Waiting ${waitTime}ms before retry. ${retries} retries remaining.`);
      await delay(waitTime);
      
      return fetchWithRetry(url, options, retries - 1);
    }
    
    return response;
  } catch (error) {
    if (retries === 0) throw error;
    
    const waitTime = BASE_DELAY * (MAX_RETRIES - retries + 1);
    console.log(`Request failed. Waiting ${waitTime}ms before retry. ${retries} retries remaining.`);
    await delay(waitTime);
    
    return fetchWithRetry(url, options, retries - 1);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    console.log(`Looking up customer with email: ${email}`);
    
    if (!email) {
      throw new Error('Email parameter is required');
    }

    const authHeader = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: { headers: { Authorization: `Bearer ${authHeader}` } },
        auth: { persistSession: false }
      }
    );

    const cacheKey = `shopify_customer:${email}`;
    const cachedData = await getCacheEntry(supabase, cacheKey);
    if (cachedData) {
      console.log('Returning cached data');
      return new Response(
        JSON.stringify(cachedData),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    const customerData = [];
    for (const shopifyStore of shopifyStores) {
      try {
        if (customerData.length > 0) {
          console.log('Waiting 1000ms before next store lookup...');
          await delay(1000);
        }

        console.log(`Searching for customer in store: ${shopifyStore.shop_domain}`);
        
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

        await delay(1000);

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

        // Fetch fulfillment and shipping data for each order
        const ordersWithDetails = await Promise.all(orders.map(async (order: any) => {
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

          if (order.fulfillment_status === 'fulfilled') {
            await delay(1000);
            
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
        console.error(`Error fetching data from store ${shopifyStore.shop_domain}:`, error);
      }
    }

    console.log(`Found customer data in ${customerData.length} stores`);
    
    const response = {
      found: customerData.length > 0,
      stores: customerData,
    };

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

async function getCacheEntry(supabase: any, key: string): Promise<any> {
  try {
    console.log(`Fetching cache entry for key: ${key}`);
    const { data, error } = await supabase
      .from('cache_entries')
      .select('value')
      .eq('key', key)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    console.log('Cache hit');
    return data.value;
  } catch (err) {
    console.error('Cache get failed:', err);
    return null;
  }
}

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