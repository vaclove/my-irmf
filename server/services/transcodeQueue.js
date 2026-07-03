/**
 * Transcode job queue: the app side only inserts a movie_transcode_jobs row and
 * drops a {job_id} message on an Azure Storage Queue. An out-of-process worker
 * (Azure Container Apps Job, KEDA queue trigger) does the actual ffmpeg work.
 *
 * Configuration:
 *   AZURE_STORAGE_CONNECTION_STRING  connection string for the storage account
 *   TRANSCODE_QUEUE_NAME             queue name (default 'movie-transcodes')
 *   MOVIE_TRANSCODE_ENABLED          'false' disables enqueueing entirely
 *
 * Transcoding also requires Google Drive to be configured (the worker reads the
 * master and writes the proxy there).
 */

const { QueueServiceClient } = require('@azure/storage-queue');
const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');

const QUEUE_NAME = process.env.TRANSCODE_QUEUE_NAME || 'movie-transcodes';

let cachedClient = null;
let ensuredQueue = false;

function connectionString() {
  return process.env.AZURE_STORAGE_CONNECTION_STRING || null;
}

/** Whether transcoding can be enqueued: storage + Drive configured + enabled. */
function isConfigured() {
  return (
    !!connectionString() &&
    googleDrive.isConfigured() &&
    process.env.MOVIE_TRANSCODE_ENABLED !== 'false'
  );
}

function getQueueClient() {
  if (cachedClient) return cachedClient;
  cachedClient = QueueServiceClient.fromConnectionString(connectionString()).getQueueClient(QUEUE_NAME);
  return cachedClient;
}

/** Send a job id to the queue (base64 — the Storage Queue default encoding). */
async function enqueueJob(jobId) {
  const client = getQueueClient();
  if (!ensuredQueue) {
    await client.createIfNotExists();
    ensuredQueue = true;
  }
  const body = Buffer.from(JSON.stringify({ job_id: jobId }), 'utf8').toString('base64');
  await client.sendMessage(body);
}

/**
 * Create + enqueue a transcode job for a movie's master, if appropriate.
 * No-op (returns null) when transcoding is unconfigured, the movie has no master
 * file row, or an active job already exists. Errors are logged, not thrown, so
 * callers can fire-and-forget from upload/download completion paths.
 *
 * @returns {Promise<object|null>} the inserted job row, or null
 */
async function enqueueForMovie(movieId, createdBy) {
  try {
    if (!isConfigured()) return null;

    const master = await pool.query(
      "SELECT drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = 'movie'",
      [movieId]
    );
    if (master.rows.length === 0) return null;

    const active = await pool.query(
      "SELECT id FROM movie_transcode_jobs WHERE movie_id = $1 AND status IN ('pending', 'running')",
      [movieId]
    );
    if (active.rows.length > 0) return null;

    const insert = await pool.query(
      `INSERT INTO movie_transcode_jobs (movie_id, source_drive_file_id, status, created_by)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
      [movieId, master.rows[0].drive_file_id, createdBy || null]
    );
    const job = insert.rows[0];
    try {
      await enqueueJob(job.id);
    } catch (queueError) {
      await pool.query(
        `UPDATE movie_transcode_jobs SET status = 'failed', error_message = $2,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id, ('Failed to enqueue: ' + queueError.message).slice(0, 1000)]
      );
      throw queueError;
    }
    logger.info('[TranscodeQueue] enqueued job', { jobId: job.id, movieId });
    return job;
  } catch (error) {
    logger.error('[TranscodeQueue] enqueueForMovie failed', {
      movieId,
      error: error.message,
    });
    return null;
  }
}

module.exports = { isConfigured, enqueueJob, enqueueForMovie, QUEUE_NAME };
