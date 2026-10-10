/**
 * Subtitle burn job queue: the app side only inserts a subtitle_burn_jobs row
 * and drops a {job_id, type: 'subtitle_burn'} message on the SAME Azure
 * Storage Queue the movie worker drains. The worker renders the export and
 * streams it into the temporary exports container (see exportStorage).
 *
 * Configuration:
 *   AZURE_STORAGE_CONNECTION_STRING  connection string for the queue's account
 *   TRANSCODE_QUEUE_NAME             queue name (default 'movie-transcodes')
 *   MOVIE_STORAGE_CONNECTION_STRING  movie storage account (exports container)
 *   SUBTITLE_BURN_ENABLED            'false' disables enqueueing entirely
 */

const { QueueServiceClient } = require('@azure/storage-queue');
const exportStorage = require('./exportStorage');
const { QUEUE_NAME } = require('./transcodeQueue');

let cachedClient = null;
let ensuredQueue = false;

function connectionString() {
  return process.env.AZURE_STORAGE_CONNECTION_STRING || null;
}

/** Whether burn jobs can be enqueued: queue + export storage configured + enabled. */
function isConfigured() {
  return !!connectionString() && exportStorage.isConfigured() && process.env.SUBTITLE_BURN_ENABLED !== 'false';
}

function getQueueClient() {
  if (cachedClient) return cachedClient;
  cachedClient = QueueServiceClient.fromConnectionString(connectionString()).getQueueClient(QUEUE_NAME);
  return cachedClient;
}

/** Send a burn job id to the shared queue (base64, typed message). */
async function enqueueJob(jobId) {
  const client = getQueueClient();
  if (!ensuredQueue) {
    await client.createIfNotExists();
    ensuredQueue = true;
  }
  const body = Buffer.from(JSON.stringify({ job_id: jobId, type: 'subtitle_burn' }), 'utf8').toString('base64');
  await client.sendMessage(body);
}

module.exports = { isConfigured, enqueueJob };
