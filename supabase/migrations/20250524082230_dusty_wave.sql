/*
  # Add Shopify integration tables

  1. New Tables
    - `shopify_stores`
      - `id` (uuid, primary key)
      - `store_id` (uuid, references stores)
      - `shop_domain` (text)
      - `access_token` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `shopify_customers`
      - `id` (uuid, primary key)
      - `shopify_id` (text)
      - `email` (text)
      - `first_name` (text)
      - `last_name` (text)
      - `phone` (text)
      - `orders_count` (integer)
      - `total_spent` (numeric)
      - `store_id` (uuid, references stores)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `shopify_orders`
      - `id` (uuid, primary key)
      - `shopify_id` (text)
      - `order_number` (text)
      - `customer_id` (uuid, references shopify_customers)
      - `total_price` (numeric)
      - `fulfillment_status` (text)
      - `created_at` (timestamptz)
      - `store_id` (uuid, references stores)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

-- Create shopify_stores table
CREATE TABLE IF NOT EXISTS shopify_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores ON DELETE CASCADE NOT NULL,
  shop_domain text NOT NULL,
  access_token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id)
);

-- Create shopify_customers table
CREATE TABLE IF NOT EXISTS shopify_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_id text NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  orders_count integer DEFAULT 0,
  total_spent numeric(10,2) DEFAULT 0,
  store_id uuid REFERENCES stores ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(shopify_id, store_id)
);

-- Create shopify_orders table
CREATE TABLE IF NOT EXISTS shopify_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_id text NOT NULL,
  order_number text NOT NULL,
  customer_id uuid REFERENCES shopify_customers ON DELETE CASCADE NOT NULL,
  total_price numeric(10,2) NOT NULL,
  fulfillment_status text,
  created_at timestamptz DEFAULT now(),
  store_id uuid REFERENCES stores ON DELETE CASCADE NOT NULL,
  UNIQUE(shopify_id, store_id)
);

-- Enable RLS
ALTER TABLE shopify_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their Shopify stores"
  ON shopify_stores
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = shopify_stores.store_id
    AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = shopify_stores.store_id
    AND s.user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their Shopify customers"
  ON shopify_customers
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = shopify_customers.store_id
    AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = shopify_customers.store_id
    AND s.user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their Shopify orders"
  ON shopify_orders
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = shopify_orders.store_id
    AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = shopify_orders.store_id
    AND s.user_id = auth.uid()
  ));

-- Add updated_at triggers
CREATE TRIGGER update_shopify_stores_updated_at
    BEFORE UPDATE ON shopify_stores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shopify_customers_updated_at
    BEFORE UPDATE ON shopify_customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();