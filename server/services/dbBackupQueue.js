/**
 * DB backup queue: the app side only drops a {type: 'db_backup'} message on
 * the SAME Azure Storage Queue the transcode worker drains. The worker
 * dispatches on the message type, runs pg_dump against DATABASE_URL, uploads
 * the dump to the shared drive's Backups folder, and prunes to the newest
 * `retain` backups (permanent delete).
 *
 * Configuration:
 *   AZURE_STORAGE_CONNECTION_STRING  connection string for the storage account
 *   TRANSCODE_QUEUE_NAME             queue name (default 'movie-transcodes')
 *   DB_BACKUP_ENABLED                'false' disables enqueueing entirely
 *
 * Backups also require Google Drive to be configured (the worker uploads the
 * dump there).
 */

const { QueueServiceClient } = require('@azure/storage-queue');
const googleDrive = require('./googleDrive');
const { QUEUE_NAME } = require('./transcodeQueue');

let cachedClient = null;
let ensuredQueue = false;

function connectionString() {
  return process.env.AZURE_STORAGE_CONNECTION_STRING || null;
}

/** Whether backups can be enqueued: storage + Drive configured + enabled. */
function isConfigured() {
  return (
    !!connectionString() &&
    googleDrive.isConfigured() &&
    process.env.DB_BACKUP_ENABLED !== 'false'
  );
}

function getQueueClient() {
  if (cachedClient) return cachedClient;
  cachedClient = QueueServiceClient.fromConnectionString(connectionString()).getQueueClient(QUEUE_NAME);
  return cachedClient;
}

/**
 * Enqueue a db_backup message (base64, typed). `retain` = number of backups
 * to keep on Drive; it travels in the message so the worker needs no env var.
 */
async function enqueueBackup({ retain = 7, requestedBy = null } = {}) {
  const client = getQueueClient();
  if (!ensuredQueue) {
    await client.createIfNotExists();
    ensuredQueue = true;
  }
  const body = Buffer.from(
    JSON.stringify({
      type: 'db_backup',
      retain,
      requested_at: new Date().toISOString(),
      requested_by: requestedBy,
    }),
    'utf8'
  ).toString('base64');
  await client.sendMessage(body);
}

module.exports = { isConfigured, enqueueBackup };
