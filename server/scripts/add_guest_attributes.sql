-- Add new attributes to guests table
CREATE TYPE guest_language AS ENUM ('czech', 'english');

ALTER TABLE guests 
ADD COLUMN IF NOT EXISTS language guest_language DEFAULT 'english',
ADD COLUMN IF NOT EXISTS company VARCHAR(255),
ADD COLUMN IF NOT EXISTS note TEXT;