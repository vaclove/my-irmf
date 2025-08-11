const { pool } = require('../models/database');
const guestImageStorage = require('./guestImageStorage');

class PhotoMigrationService {
  constructor() {
    this.migrationInProgress = false;
  }

  /**
   * Migrate guest photos from database to S3
   * This runs at application startup
   */
  async migrateGuestPhotos() {
    if (this.migrationInProgress) {
      console.log('📸 Photo migration already in progress, skipping...');
      return;
    }

    try {
      this.migrationInProgress = true;
      console.log('📸 Starting guest photo migration to S3...');

      // Get all guests with photos that haven't been migrated yet
      const result = await pool.query(`
        SELECT id, first_name, last_name, photo 
        FROM guests 
        WHERE photo IS NOT NULL 
        AND photo != '' 
        AND (image_migrated IS NULL OR image_migrated = FALSE)
        ORDER BY id
      `);

      const guestsToMigrate = result.rows;
      console.log(`📸 Found ${guestsToMigrate.length} guest photos to migrate`);

      if (guestsToMigrate.length === 0) {
        console.log('📸 No guest photos need migration');
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      // Process guests in batches to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < guestsToMigrate.length; i += batchSize) {
        const batch = guestsToMigrate.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (guest) => {
          try {
            console.log(`📸 Migrating photo for: ${guest.first_name} ${guest.last_name} (ID: ${guest.id})`);
            
            // Skip if already exists in S3 (in case of retry)
            const exists = await guestImageStorage.guestImagesExist(guest.id);
            if (exists) {
              console.log(`📸 Images already exist for guest ${guest.id}, marking as migrated`);
              await this.markGuestAsMigrated(guest.id, guest.id.toString());
              successCount++;
              return;
            }

            // Migrate the photo
            const uploadResult = await guestImageStorage.migrateBase64Image(guest.photo, guest.id);
            
            // Update database with S3 path and mark as migrated
            await this.markGuestAsMigrated(guest.id, uploadResult.basePath);
            
            console.log(`📸 ✅ Successfully migrated photo for guest ${guest.id}`);
            successCount++;
            
          } catch (error) {
            console.error(`📸 ❌ Failed to migrate photo for guest ${guest.id}:`, error.message);
            errors.push(`Guest ${guest.id} (${guest.first_name} ${guest.last_name}): ${error.message}`);
            errorCount++;
          }
        });

        // Wait for batch to complete
        await Promise.all(batchPromises);
        
        // Small delay between batches to be gentle on the system
        if (i + batchSize < guestsToMigrate.length) {
          await this.delay(1000); // 1 second delay
        }
      }

      // Log migration summary
      console.log(`📸 Photo migration completed:`);
      console.log(`   ✅ Successfully migrated: ${successCount}`);
      console.log(`   ❌ Failed migrations: ${errorCount}`);
      
      if (errors.length > 0) {
        console.log(`   Errors:`);
        errors.forEach(error => console.log(`     - ${error}`));
      }

      // Log next steps if there were failures
      if (errorCount > 0) {
        console.log(`📸 Note: Failed migrations can be retried by restarting the application`);
      }

    } catch (error) {
      console.error('📸 ❌ Photo migration failed:', error);
      throw error;
    } finally {
      this.migrationInProgress = false;
    }
  }

  /**
   * Mark a guest as successfully migrated and store the S3 path
   */
  async markGuestAsMigrated(guestId, imagePath) {
    await pool.query(`
      UPDATE guests 
      SET image_path = $1, image_migrated = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [imagePath, guestId]);
  }

  /**
   * Get migration status for all guests
   */
  async getMigrationStatus() {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_guests,
        COUNT(CASE WHEN photo IS NOT NULL AND photo != '' THEN 1 END) as guests_with_photos,
        COUNT(CASE WHEN image_migrated = TRUE THEN 1 END) as migrated_guests,
        COUNT(CASE WHEN photo IS NOT NULL AND photo != '' AND (image_migrated IS NULL OR image_migrated = FALSE) THEN 1 END) as pending_migration
      FROM guests
    `);

    return result.rows[0];
  }

  /**
   * Helper function to create delays
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up old photo data after successful migration (optional, manual)
   * This should only be run after verifying all photos migrated successfully
   */
  async cleanupOldPhotoData() {
    console.log('🧹 WARNING: This will permanently delete photo data from database');
    console.log('🧹 Make sure all photos have been successfully migrated to S3 first');
    
    // For safety, this requires explicit confirmation and should be run manually
    throw new Error('Photo cleanup must be run manually with explicit confirmation');
  }
}

module.exports = new PhotoMigrationService();