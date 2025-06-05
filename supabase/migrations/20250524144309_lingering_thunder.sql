/*
  # Add access_token column to stores table

  1. Changes
    - Add access_token column to stores table to store Microsoft Graph access tokens
    - Make access_token nullable since not all stores will have one

  2. Security
    - Column is protected by existing RLS policies
*/

ALTER TABLE stores ADD COLUMN IF NOT EXISTS access_token text;