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
   * Generate a versioned base path for a movie image upload.
   * Every upload gets its own folder, so replacing an image changes its URL
   * and the year-long Cache-Control below never serves a stale image.
   */
  generateBasePath(year, movieId) {
    return `${year}/${movieId}/${Date.now()}`;
  }

  /**
   * Upload movie image with all size variants
   */
  async uploadMovieImage(imageBuffer, year, movieId) {
    const uploadResults = {};
    const extension = 'jpg'; // We'll convert all images to JPEG for consistency
    const basePath = this.generateBasePath(year, movieId);

    try {
      // Process and upload each size
      for (const [sizeName, config] of Object.entries(ImageStorageService.IMAGE_SIZES)) {
        const blobPath = `${basePath}/${config.suffix}.${extension}`;
        
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
        basePath,
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
   * Delete a movie's images (all versions, including the legacy unversioned
   * layout `${year}/${movieId}/<size>.jpg`), optionally keeping one version.
   */
  async deleteMovieImages(year, movieId, { keepBasePath } = {}) {
    const deletionPromises = [];

    for await (const blob of this.containerClient.listBlobsFlat({ prefix: `${year}/${movieId}/` })) {
      if (keepBasePath && blob.name.startsWith(`${keepBasePath}/`)) continue;
      deletionPromises.push(
        this.containerClient.getBlockBlobClient(blob.name).deleteIfExists()
          .catch(err => console.error(`Failed to delete ${blob.name}:`, err))
      );
    }

    await Promise.all(deletionPromises);
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