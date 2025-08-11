const { BlobServiceClient } = require('@azure/storage-blob');
const sharp = require('sharp');

class GuestImageStorageService {
  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const customDomain = process.env.AZURE_STORAGE_CUSTOM_DOMAIN || 'https://s3.irmf.cz';
    
    // Use different containers for dev and production
    const containerName = process.env.NODE_ENV === 'production' ? 'guests' : 'guests-dev';
    
    if (!accountName || !accountKey) {
      throw new Error('Azure Storage configuration missing in environment variables');
    }

    const connectionString = `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
    this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    this.containerClient = this.blobServiceClient.getContainerClient(containerName);
    this.containerName = containerName;
    this.customDomain = customDomain;
    
    // Ensure container exists
    this.initializeContainer();
  }

  async initializeContainer() {
    try {
      await this.containerClient.createIfNotExists({
        access: 'blob' // Public read access for images
      });
    } catch (error) {
      console.error('Error initializing guest image container:', error);
    }
  }

  /**
   * Image size configurations for guest photos
   */
  static IMAGE_SIZES = {
    original: { width: null, height: null, suffix: 'original' },
    thumbnail: { width: 150, height: 150, suffix: 'thumbnail' }, // Square thumbnails for avatars
    medium: { width: 300, height: 300, suffix: 'medium' }
  };

  /**
   * Generate blob path for a guest image
   */
  generateBlobPath(guestId, sizeSuffix, extension = 'jpg') {
    return `${guestId}/${sizeSuffix}.${extension}`;
  }

  /**
   * Upload guest image with all size variants
   */
  async uploadGuestImage(imageBuffer, guestId) {
    const uploadResults = {};
    const extension = 'jpg'; // Convert all images to JPEG for consistency

    try {
      // Process and upload each size
      for (const [sizeName, config] of Object.entries(GuestImageStorageService.IMAGE_SIZES)) {
        const blobPath = this.generateBlobPath(guestId, config.suffix, extension);
        
        let processedBuffer;
        if (sizeName === 'original') {
          // For original, just ensure it's in JPEG format with reasonable size limit
          processedBuffer = await sharp(imageBuffer)
            .resize(800, 800, { // Max 800px for originals
              fit: 'inside',
              withoutEnlargement: true
            })
            .jpeg({ quality: 90, progressive: true })
            .toBuffer();
        } else if (sizeName === 'thumbnail') {
          // Square crop for thumbnails (good for avatars)
          processedBuffer = await sharp(imageBuffer)
            .resize(config.width, config.height, {
              fit: 'cover', // This will crop to exact square
              position: 'center'
            })
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();
        } else {
          // Other sizes
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

      return {
        basePath: guestId.toString(),
        urls: uploadResults
      };
    } catch (error) {
      console.error('Error uploading guest image:', error);
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
  getImageUrl(guestId, size = 'thumbnail') {
    const sizeConfig = GuestImageStorageService.IMAGE_SIZES[size];
    if (!sizeConfig) {
      throw new Error(`Invalid image size: ${size}`);
    }
    return `${this.customDomain}/${this.containerName}/${guestId}/${sizeConfig.suffix}.jpg`;
  }

  /**
   * Delete all image sizes for a guest
   */
  async deleteGuestImages(guestId) {
    const deletionPromises = [];

    for (const config of Object.values(GuestImageStorageService.IMAGE_SIZES)) {
      const blobPath = this.generateBlobPath(guestId, config.suffix, 'jpg');
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
      deletionPromises.push(
        blockBlobClient.deleteIfExists()
          .catch(err => console.error(`Failed to delete ${blobPath}:`, err))
      );
    }

    await Promise.all(deletionPromises);
  }

  /**
   * Check if guest images exist
   */
  async guestImagesExist(guestId) {
    const blobPath = this.generateBlobPath(guestId, 'original', 'jpg');
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
  async migrateBase64Image(base64Data, guestId) {
    // Extract actual base64 data (remove data:image/...;base64, prefix if present)
    const base64Match = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
    const cleanBase64 = base64Match ? base64Match[1] : base64Data;
    
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(cleanBase64, 'base64');
    
    // Upload with all sizes
    return await this.uploadGuestImage(imageBuffer, guestId);
  }
}

// Export singleton instance
module.exports = new GuestImageStorageService();