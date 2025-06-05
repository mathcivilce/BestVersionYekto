/*
  # Delete duplicate store record

  1. Changes
    - Delete store record for support@littleinfants.com.au
    - This will cascade delete related records due to foreign key constraints

  2. Notes
    - Safe to run multiple times due to WHERE clause
*/

DELETE FROM stores 
WHERE email = 'support@littleinfants.com.au';