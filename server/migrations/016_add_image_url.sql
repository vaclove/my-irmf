-- Add image_url column to movies table
ALTER TABLE movies 
ADD COLUMN IF NOT EXISTS image_url VARCHAR(255);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_movies_image_url ON movies(image_url);

-- Comment on the new column
COMMENT ON COLUMN movies.image_url IS 'Base path for movie images in Azure Blob Storage (e.g., 2024/123)';