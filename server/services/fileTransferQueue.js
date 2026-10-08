/**
 * Drive <-> Azure file transfer jobs (table movie_file_transfer_jobs). The app
 * inserts a row and drops a {job_id, type: 'file_transfer'} message on the
 * shared movie worker queue; the worker streams the bytes.
 *
 *   drive_to_azure  import a Drive file (migration, files dropped into Drive)
 *   azure_to_drive  write the Drive backup of an Azure master
 *
 * Needs the storage queue, Drive and the movie storage account.
 */

const { QueueServiceClient } = require('@azure/storage-queue');
const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const movieStorage = require('./movieStorage');
const { QUEUE_NAME } = require('./transcodeQueue');

// A failed import of the same source isn't retried automatically sooner than
// this (folder scans run every 45 minutes; Drive download quotas reset daily).
const FAILED_RETRY_AFTER_HOURS = 24;

let cachedClient = null;
let ensuredQueue = false;

function isConfigured() {
  return (
    !!process.env.AZURE_STORAGE_CONNECTION_STRING &&
    googleDrive.isConfigured() &&
    movieStorage.isConfigured()
  );
}

function getQueueClient() {
  if (!cachedClient) {
    cachedClient = QueueServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    ).getQueueClient(QUEUE_NAME);
  }
  return cachedClient;
}

async function sendMessage(jobId) {
  const client = getQueueClient();
  if (!ensuredQueue) {
    await client.createIfNotExists();
    ensuredQueue = true;
  }
  const body = Buffer.from(JSON.stringify({ job_id: jobId, type: 'file_transfer' }), 'utf8').toString(
    'base64'
  );
  await client.sendMessage(body);
}

/**
 * Create + enqueue a transfer unless one is already active for the same
 * movie/kind/direction, or (automatic callers, `respectBackoff`) the same
 * source failed recently. Never throws; returns the job row or null.
 */
async function enqueue({
  movieId,
  fileKind,
  direction,
  sourceRef,
  transcodeAfter = false,
  replaceExisting = false,
  createdBy,
  respectBackoff = false,
}) {
  try {
    if (!isConfigured()) return null;
    const active = await pool.query(
      `SELECT id FROM movie_file_transfer_jobs
       WHERE movie_id = $1 AND file_kind = $2 AND direction = $3 AND status IN ('pending', 'running')`,
      [movieId, fileKind, direction]
    );
    if (active.rows.length > 0) return null;

    if (respectBackoff) {
      const recent = await pool.query(
        `SELECT id FROM movie_file_transfer_jobs
         WHERE movie_id = $1 AND file_kind = $2 AND direction = $3 AND source_ref = $4
           AND status IN ('failed', 'cancelled')
           AND finished_at > CURRENT_TIMESTAMP - make_interval(hours => $5)`,
        [movieId, fileKind, direction, sourceRef, FAILED_RETRY_AFTER_HOURS]
      );
      if (recent.rows.length > 0) return null;
    }

    const insert = await pool.query(
      `INSERT INTO movie_file_transfer_jobs
         (movie_id, file_kind, direction, source_ref, transcode_after, replace_existing, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [movieId, fileKind, direction, sourceRef, transcodeAfter, replaceExisting, createdBy || null]
    );
    const job = insert.rows[0];
    try {
      await sendMessage(job.id);
    } catch (queueError) {
      await pool.query(
        `UPDATE movie_file_transfer_jobs SET status = 'failed', error_message = $2,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id, ('Failed to enqueue: ' + queueError.message).slice(0, 1000)]
      );
      throw queueError;
    }
    logger.info('[FileTransfer] enqueued', { jobId: job.id, movieId, fileKind, direction });
    return job;
  } catch (error) {
    // 23505: a concurrent request created the active job first.
    if (error.code !== '23505') {
      logger.error('[FileTransfer] enqueue failed', { movieId, fileKind, direction, error: error.message });
    }
    return null;
  }
}

/** Import a legacy Drive row into Azure. */
function enqueueImport(row, { createdBy, respectBackoff = false, transcodeAfter } = {}) {
  return enqueue({
    movieId: row.movie_id,
    fileKind: row.file_kind,
    direction: 'drive_to_azure',
    sourceRef: row.drive_file_id,
    // A master that has no preview yet gets one once it is in Azure.
    transcodeAfter: transcodeAfter ?? false,
    createdBy,
    respectBackoff,
  });
}

/** Back up an Azure master to Drive. */
function enqueueBackup(row, { createdBy } = {}) {
  return enqueue({
    movieId: row.movie_id,
    fileKind: row.file_kind,
    direction: 'azure_to_drive',
    sourceRef: movieStorage.fileRef(row),
    createdBy,
  });
}

module.exports = { isConfigured, enqueue, enqueueImport, enqueueBackup, sendMessage };
