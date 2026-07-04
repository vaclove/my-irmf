/**
 * Subtitle sync job queue: the app side only inserts a subtitle_sync_jobs row
 * and drops a {job_id, type: 'subtitle_sync'} message on the SAME Azure Storage
 * Queue the transcode worker drains. The worker dispatches on the message type
 * (absent type = transcode), extracts audio with ffmpeg, and aligns the subtitle
 * timings with alass.
 *
 * Configuration:
 *   AZURE_STORAGE_CONNECTION_STRING  connection string for the storage account
 *   TRANSCODE_QUEUE_NAME             queue name (default 'movie-transcodes')
 *   SUBTITLE_SYNC_ENABLED            'false' disables enqueueing entirely
 *
 * Syncing also requires Google Drive to be configured (the worker reads the
 * video + subtitle and writes the synced SRT there).
 */

const { QueueServiceClient } = require('@azure/storage-queue');
const googleDrive = require('./googleDrive');
const { QUEUE_NAME } = require('./transcodeQueue');

let cachedClient = null;
let ensuredQueue = false;

function connectionString() {
  return process.env.AZURE_STORAGE_CONNECTION_STRING || null;
}

/** Whether sync jobs can be enqueued: storage + Drive configured + enabled. */
function isConfigured() {
  return (
    !!connectionString() &&
    googleDrive.isConfigured() &&
    process.env.SUBTITLE_SYNC_ENABLED !== 'false'
  );
}

function getQueueClient() {
  if (cachedClient) return cachedClient;
  cachedClient = QueueServiceClient.fromConnectionString(connectionString()).getQueueClient(QUEUE_NAME);
  return cachedClient;
}

/** Send a sync job id to the shared queue (base64, typed message). */
async function enqueueJob(jobId) {
  const client = getQueueClient();
  if (!ensuredQueue) {
    await client.createIfNotExists();
    ensuredQueue = true;
  }
  const body = Buffer.from(
    JSON.stringify({ job_id: jobId, type: 'subtitle_sync' }),
    'utf8'
  ).toString('base64');
  await client.sendMessage(body);
}

module.exports = { isConfigured, enqueueJob };
