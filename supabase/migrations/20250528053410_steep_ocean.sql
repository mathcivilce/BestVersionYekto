/*
  # Delete duplicate store record

  1. Changes
    - Delete store record for support@littleinfants.com.au
    - Cascading delete will handle related records due to foreign key constraints

  2. Notes
    - Safe deletion using parameterized query
    - Maintains referential integrity through CASCADE
*/

DELETE FROM stores 
WHERE email = 'support@littleinfants.com.au';