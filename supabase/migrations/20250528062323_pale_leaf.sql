/*
  # Add Microsoft Graph webhook subscriptions table

  1. New Tables
    - `graph_subscriptions`
      - Store Microsoft Graph webhook subscription details
      - Track subscription expiration and renewal
      - Link to stores table

  2. Security
    - Enable RLS
    - Add policies for authenticated users
    - Ensure proper cascading deletes
*/

-- Check if table exists before creating
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'graph_subscriptions'
  ) THEN
    -- Create table
    CREATE TABLE graph_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id uuid REFERENCES stores ON DELETE CASCADE NOT NULL,
      subscription_id text NOT NULL,
      resource text NOT NULL,
      client_state text NOT NULL,
      expiration_date timestamptz NOT NULL,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE(store_id, resource)
    );

    -- Enable RLS
    ALTER TABLE graph_subscriptions ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Safely drop existing policy
DROP POLICY IF EXISTS "Users can manage their graph subscriptions" ON graph_subscriptions;

-- Create new policy
CREATE POLICY "Users can manage their graph subscriptions"
  ON graph_subscriptions
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = graph_subscriptions.store_id
    AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stores s
    WHERE s.id = graph_subscriptions.store_id
    AND s.user_id = auth.uid()
  ));

-- Safely create updated_at trigger
DO $$ 
BEGIN
  -- Drop trigger if it exists
  DROP TRIGGER IF EXISTS update_graph_subscriptions_updated_at ON graph_subscriptions;
  
  -- Create trigger
  CREATE TRIGGER update_graph_subscriptions_updated_at
    BEFORE UPDATE ON graph_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
END $$;