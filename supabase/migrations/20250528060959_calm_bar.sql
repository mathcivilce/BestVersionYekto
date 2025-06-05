/*
  # Add Microsoft Graph subscription tracking

  1. New Tables
    - `graph_subscriptions`
      - Track Microsoft Graph webhook subscriptions
      - Store subscription details and expiration
      - Link to stores table

  2. Security
    - Enable RLS
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS graph_subscriptions (
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

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Users can manage their graph subscriptions" ON graph_subscriptions;

-- Create policies
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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_graph_subscriptions_updated_at ON graph_subscriptions;

-- Add updated_at trigger
CREATE TRIGGER update_graph_subscriptions_updated_at
    BEFORE UPDATE ON graph_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();