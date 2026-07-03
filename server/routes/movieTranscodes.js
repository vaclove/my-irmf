/**
 * Movie transcode jobs: /api/movie-transcodes
 *
 * A job generates the web-playable 720p proxy from a movie's master. Jobs run
 * out-of-process in a worker triggered via a storage queue; the app inserts the
 * row, enqueues the message, and the client polls progress here.
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const googleDrive = require('../services/googleDrive');
const transcodeQueue = require('../services/transcodeQueue');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function notConfigured(res) {
  return res
    .status(503)
    .json({ error: 'Transcoding is not configured (needs Drive + storage queue)' });
}

/** Load a movie's master (movie kind) drive_file_id, or null. */
async function getMasterFileId(movieId) {
  const res = await pool.query(
    "SELECT drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = 'movie'",
    [movieId]
  );
  return res.rows[0]?.drive_file_id || null;
}

// POST / — create + enqueue a transcode job for a movie's master.
router.post('/', async (req, res) => {
  if (!transcodeQueue.isConfigured()) return notConfigured(res);
  try {
    const { movie_id } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });

    const movieRes = await pool.query('SELECT id FROM movies WHERE id = $1', [movie_id]);
    if (movieRes.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    const masterFileId = await getMasterFileId(movie_id);
    if (!masterFileId) {
      return res.status(400).json({ error: 'Movie has no master file to transcode' });
    }

    // One active transcode per movie.
    const active = await pool.query(
      "SELECT id FROM movie_transcode_jobs WHERE movie_id = $1 AND status IN ('pending', 'running')",
      [movie_id]
    );
    if (active.rows.length > 0) {
      return res.status(409).json({ error: 'A transcode job is already active for this movie' });
    }

    const insert = await pool.query(
      `INSERT INTO movie_transcode_jobs (movie_id, source_drive_file_id, status, created_by)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
      [movie_id, masterFileId, req.user?.email || null]
    );
    const job = insert.rows[0];
    try {
      await transcodeQueue.enqueueJob(job.id);
    } catch (queueError) {
      await pool.query(
        `UPDATE movie_transcode_jobs SET status = 'failed', error_message = $2,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id, 'Failed to enqueue: ' + queueError.message]
      );
      throw queueError;
    }
    res.status(201).json({ job });
  } catch (error) {
    logError(error, req, { operation: 'create_transcode_job' });
    res.status(500).json({ error: error.message });
  }
});

// GET /movie/:movieId — all jobs for a movie (newest first).
router.get('/movie/:movieId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM movie_transcode_jobs WHERE movie_id = $1 ORDER BY created_at DESC',
      [req.params.movieId]
    );
    res.json({ jobs: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_transcode_jobs' });
    res.status(500).json({ error: error.message });
  }
});

// GET /:id — single job (polling).
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM movie_transcode_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'get_transcode_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/cancel — request cancellation. Pending jobs cancel immediately;
// running jobs get cancel_requested set and the worker honors it between checks.
router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM movie_transcode_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = result.rows[0];

    if (job.status === 'pending') {
      await pool.query(
        `UPDATE movie_transcode_jobs SET status = 'cancelled', cancel_requested = true,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
      );
    } else if (job.status === 'running') {
      await pool.query(
        'UPDATE movie_transcode_jobs SET cancel_requested = true WHERE id = $1',
        [req.params.id]
      );
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    logError(error, req, { operation: 'cancel_transcode_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/retry — re-run a terminal job against the movie's current master.
router.post('/:id/retry', async (req, res) => {
  if (!transcodeQueue.isConfigured()) return notConfigured(res);
  try {
    const result = await pool.query('SELECT * FROM movie_transcode_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const old = result.rows[0];
    if (!TERMINAL_STATUSES.includes(old.status)) {
      return res.status(409).json({ error: 'Only terminal jobs can be retried' });
    }

    const active = await pool.query(
      "SELECT id FROM movie_transcode_jobs WHERE movie_id = $1 AND status IN ('pending', 'running')",
      [old.movie_id]
    );
    if (active.rows.length > 0) {
      return res.status(409).json({ error: 'A transcode job is already active for this movie' });
    }

    // Re-resolve the current master (it may have been replaced since the old job).
    const masterFileId = await getMasterFileId(old.movie_id);
    if (!masterFileId) {
      return res.status(400).json({ error: 'Movie has no master file to transcode' });
    }

    const insert = await pool.query(
      `INSERT INTO movie_transcode_jobs (movie_id, source_drive_file_id, status, created_by)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
      [old.movie_id, masterFileId, req.user?.email || null]
    );
    const job = insert.rows[0];
    await transcodeQueue.enqueueJob(job.id);
    res.status(201).json({ job });
  } catch (error) {
    logError(error, req, { operation: 'retry_transcode_job' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
