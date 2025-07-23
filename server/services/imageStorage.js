const { BlobServiceClient } = require('@azure/storage-blob');
const sharp = require('sharp');
const path = require('path');

class ImageStorageService {
  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const containerName = process.env.AZURE_STORAGE_MOVIES_CONTAINER;
    const customDomain = process.env.AZURE_STORAGE_CUSTOM_DOMAIN || 'https://s3.irmf.cz';
    
    if (!accountName || !accountKey || !containerName) {
      throw new Error('Azure Storage configuration missing in environment variables');
    }

    const connectionString = `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(containerName);
    this.containerName = containerName;
    this.customDomain = customDomain;
  }

  /**
   * Image size configurations
   */
  static IMAGE_SIZES = {
    original: { width: null, height: null, suffix: 'original' },
    large: { width: 1200, height: null, suffix: 'large' },
    medium: { width: 600, height: null, suffix: 'medium' },
    thumbnail: { width: 300, height: null, suffix: 'thumbnail' },
    small: { width: 150, height: null, suffix: 'small' }
  };

  /**
   * Generate blob path for a movie image
   */
  generateBlobPath(year, movieId, sizeSuffix, extension = 'jpg') {
    return `${year}/${movieId}/${sizeSuffix}.${extension}`;
  }

  /**
   * Upload movie image with all size variants
   */
  async uploadMovieImage(imageBuffer, year, movieId) {
    const uploadResults = {};
    const extension = 'jpg'; // We'll convert all images to JPEG for consistency

    try {
      // Process and upload each size
      for (const [sizeName, config] of Object.entries(ImageStorageService.IMAGE_SIZES)) {
        const blobPath = this.generateBlobPath(year, movieId, config.suffix, extension);
        
        let processedBuffer;
        if (sizeName === 'original') {
          // For original, just ensure it's in JPEG format
          processedBuffer = await sharp(imageBuffer)
            .jpeg({ quality: 90, progressive: true })
            .toBuffer();
        } else {
          // Resize for other variants
          processedBuffer = await sharp(imageBuffer)
            .resize(config.width, config.height, {
              fit: 'inside',
              withoutEnlargement: true
            })
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();
        }

        // Upload to blob storage
        const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
        await blockBlobClient.upload(processedBuffer, processedBuffer.length, {
          blobHTTPHeaders: {
            blobContentType: 'image/jpeg',
            blobCacheControl: 'public, max-age=31536000' // Cache for 1 year
          }
        });

        uploadResults[sizeName] = this.getBlobUrl(blobPath);
      }

      // Return the base path (without size suffix and extension)
      return {
        basePath: `${year}/${movieId}`,
        urls: uploadResults
      };
    } catch (error) {
      console.error('Error uploading movie image:', error);
      throw error;
    }
  }

  /**
   * Get full URL for a blob
   */
  getBlobUrl(blobPath) {
    return `${this.customDomain}/${this.containerName}/${blobPath}`;
  }

  /**
   * Get URL for specific image size
   */
  getImageUrl(basePath, size = 'medium') {
    const sizeConfig = ImageStorageService.IMAGE_SIZES[size];
    if (!sizeConfig) {
      throw new Error(`Invalid image size: ${size}`);
    }
    return `${this.customDomain}/${this.containerName}/${basePath}/${sizeConfig.suffix}.jpg`;
  }

  /**
   * Delete all image sizes for a movie
   */
  async deleteMovieImages(year, movieId) {
    const deletionPromises = [];

    for (const config of Object.values(ImageStorageService.IMAGE_SIZES)) {
      const blobPath = this.generateBlobPath(year, movieId, config.suffix, 'jpg');
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
      deletionPromises.push(
        blockBlobClient.deleteIfExists()
          .catch(err => console.error(`Failed to delete ${blobPath}:`, err))
      );
    }

    await Promise.all(deletionPromises);
  }

  /**
   * Check if movie images exist
   */
  async movieImagesExist(year, movieId) {
    const blobPath = this.generateBlobPath(year, movieId, 'original', 'jpg');
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
    
    try {
      const exists = await blockBlobClient.exists();
      return exists;
    } catch (error) {
      console.error('Error checking blob existence:', error);
      return false;
    }
  }

  /**
   * Migrate image from base64 to blob storage
   */
  async migrateBase64Image(base64Data, year, movieId) {
    // Extract actual base64 data (remove data:image/...;base64, prefix if present)
    const base64Match = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
    const cleanBase64 = base64Match ? base64Match[1] : base64Data;
    
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(cleanBase64, 'base64');
    
    // Upload with all sizes
    return await this.uploadMovieImage(imageBuffer, year, movieId);
  }
}

// Export singleton instance
module.exports = new ImageStorageService();