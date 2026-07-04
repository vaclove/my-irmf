/**
 * Subtitle sync jobs: /api/subtitle-syncs
 *
 * A job re-times a movie's subtitle track (subtitles_cs or subtitles_en) to the
 * movie's audio with alass, saving the result as a new synced file
 * (subtitles_{lang}_synced) next to the untouched original. Jobs run
 * out-of-process in the transcode worker via the shared storage queue; the app
 * inserts the row, enqueues the message, and the client polls progress here.
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { logAuditEvent } = require('../utils/auditLogger');
const subtitleSyncQueue = require('../services/subtitleSyncQueue');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];
const SUBTITLE_KINDS = ['subtitles_cs', 'subtitles_en'];

function notConfigured(res) {
  return res
    .status(503)
    .json({ error: 'Subtitle sync is not configured (needs Drive + storage queue)' });
}

/**
 * Resolve the movie's subtitle source row and the reference video (proxy
 * preferred — much smaller to stream; master fallback). Returns
 * {source, reference, referenceKind} with nulls when missing.
 */
async function resolveFiles(movieId, subtitleKind) {
  const res = await pool.query(
    'SELECT file_kind, drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = ANY($2)',
    [movieId, [subtitleKind, 'movie_proxy', 'movie']]
  );
  const byKind = new Map(res.rows.map((r) => [r.file_kind, r]));
  const reference = byKind.get('movie_proxy') || byKind.get('movie') || null;
  return {
    source: byKind.get(subtitleKind) || null,
    reference,
    referenceKind: byKind.has('movie_proxy') ? 'movie_proxy' : byKind.has('movie') ? 'movie' : null,
  };
}

/** Shared validation + insert + enqueue used by create and retry. */
async function createJob(req, res, { movieId, subtitleKind, operation }) {
  const movieRes = await pool.query('SELECT id FROM movies WHERE id = $1', [movieId]);
  if (movieRes.rows.length === 0) {
    return res.status(404).json({ error: 'Movie not found' });
  }

  const { source, reference, referenceKind } = await resolveFiles(movieId, subtitleKind);
  if (!source) {
    return res.status(400).json({ error: 'Movie has no subtitle file of this kind to sync' });
  }
  if (!reference) {
    return res.status(400).json({ error: 'Movie has no video file to sync against' });
  }

  // One active sync per movie+track.
  const active = await pool.query(
    `SELECT id FROM subtitle_sync_jobs
       WHERE movie_id = $1 AND subtitle_kind = $2 AND status IN ('pending', 'running')`,
    [movieId, subtitleKind]
  );
  if (active.rows.length > 0) {
    return res.status(409).json({ error: 'A sync job is already active for this subtitle track' });
  }

  const insert = await pool.query(
    `INSERT INTO subtitle_sync_jobs
       (movie_id, subtitle_kind, source_drive_file_id, reference_drive_file_id, reference_kind, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING *`,
    [
      movieId,
      subtitleKind,
      source.drive_file_id,
      reference.drive_file_id,
      referenceKind,
      req.user?.email || null,
    ]
  );
  const job = insert.rows[0];
  try {
    await subtitleSyncQueue.enqueueJob(job.id);
  } catch (queueError) {
    await pool.query(
      `UPDATE subtitle_sync_jobs SET status = 'failed', error_message = $2,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [job.id, ('Failed to enqueue: ' + queueError.message).slice(0, 1000)]
    );
    throw queueError;
  }

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'subtitle_sync_job',
    resourceId: job.id,
    newData: { movie_id: movieId, subtitle_kind: subtitleKind, operation },
  });

  res.status(201).json({ job });
}

// POST / — create + enqueue a sync job for a movie's subtitle track.
router.post('/', async (req, res) => {
  if (!subtitleSyncQueue.isConfigured()) return notConfigured(res);
  try {
    const { movie_id, subtitle_kind } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });
    if (!SUBTITLE_KINDS.includes(subtitle_kind)) {
      return res
        .status(400)
        .json({ error: "subtitle_kind must be 'subtitles_cs' or 'subtitles_en'" });
    }
    await createJob(req, res, { movieId: movie_id, subtitleKind: subtitle_kind, operation: 'create' });
  } catch (error) {
    // Partial unique index: another request already created an active job.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A sync job is already active for this subtitle track' });
    }
    logError(error, req, { operation: 'create_subtitle_sync_job' });
    res.status(500).json({ error: error.message });
  }
});

// GET /movie/:movieId — all non-dismissed jobs for a movie (newest first).
router.get('/movie/:movieId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM subtitle_sync_jobs
         WHERE movie_id = $1 AND dismissed_at IS NULL
         ORDER BY created_at DESC`,
      [req.params.movieId]
    );
    res.json({ jobs: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_subtitle_sync_jobs' });
    res.status(500).json({ error: error.message });
  }
});

// GET /:id — single job (polling).
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_sync_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'get_subtitle_sync_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/cancel — request cancellation. Pending jobs cancel immediately;
// running jobs get cancel_requested set and the worker honors it between checks.
router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_sync_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = result.rows[0];

    if (job.status === 'pending') {
      await pool.query(
        `UPDATE subtitle_sync_jobs SET status = 'cancelled', cancel_requested = true,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
      );
    } else if (job.status === 'running') {
      await pool.query(
        'UPDATE subtitle_sync_jobs SET cancel_requested = true WHERE id = $1',
        [req.params.id]
      );
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    logError(error, req, { operation: 'cancel_subtitle_sync_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/retry — re-run a terminal job against the movie's current files.
router.post('/:id/retry', async (req, res) => {
  if (!subtitleSyncQueue.isConfigured()) return notConfigured(res);
  try {
    const result = await pool.query('SELECT * FROM subtitle_sync_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const old = result.rows[0];
    if (!TERMINAL_STATUSES.includes(old.status)) {
      return res.status(409).json({ error: 'Only terminal jobs can be retried' });
    }

    await createJob(req, res, {
      movieId: old.movie_id,
      subtitleKind: old.subtitle_kind,
      operation: 'retry',
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A sync job is already active for this subtitle track' });
    }
    logError(error, req, { operation: 'retry_subtitle_sync_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/dismiss — hide a terminal job from the movie's job list.
router.post('/:id/dismiss', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_sync_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = result.rows[0];

    if (!TERMINAL_STATUSES.includes(job.status)) {
      return res.status(409).json({ error: 'Only finished jobs can be dismissed' });
    }

    await pool.query(
      'UPDATE subtitle_sync_jobs SET dismissed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );

    await logAuditEvent({
      req,
      action: 'update',
      resource: 'subtitle_sync_job',
      resourceId: job.id,
      newData: { dismissed: true },
    });

    res.json({ message: 'Job dismissed' });
  } catch (error) {
    logError(error, req, { operation: 'dismiss_subtitle_sync_job' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
