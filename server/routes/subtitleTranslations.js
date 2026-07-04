/**
 * Subtitle translation jobs: /api/subtitle-translations
 *
 * A job machine-translates a movie's subtitles between Czech and English
 * (movie_files kinds subtitles_cs <-> subtitles_en) with the Anthropic API.
 * Jobs run in-process (subtitleTranslator service); the app inserts the row,
 * enqueues in memory, and the client polls progress here.
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { logAuditEvent } = require('../utils/auditLogger');
const googleDrive = require('../services/googleDrive');
const subtitleTranslator = require('../services/subtitleTranslator');
const { DIRECTIONS } = require('../services/subtitleTranslator');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

function notConfigured(res) {
  if (!subtitleTranslator.isConfigured()) {
    return res
      .status(503)
      .json({ error: 'Subtitle translation is not configured (ANTHROPIC_API_KEY missing)' });
  }
  return res.status(503).json({ error: 'Google Drive is not configured' });
}

function isReady() {
  return subtitleTranslator.isConfigured() && googleDrive.isConfigured();
}

/** Load a movie's subtitle rows for a direction: {source, target} rows or nulls. */
async function getSubtitleRows(movieId, direction) {
  const dir = DIRECTIONS[direction];
  const res = await pool.query(
    'SELECT file_kind, drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = ANY($2)',
    [movieId, [dir.sourceKind, dir.targetKind]]
  );
  const byKind = new Map(res.rows.map((r) => [r.file_kind, r]));
  return {
    source: byKind.get(dir.sourceKind) || null,
    target: byKind.get(dir.targetKind) || null,
  };
}

/** Shared validation + insert + enqueue used by create and retry. */
async function createJob(req, res, { movieId, direction, overwrite, operation }) {
  const movieRes = await pool.query('SELECT id FROM movies WHERE id = $1', [movieId]);
  if (movieRes.rows.length === 0) {
    return res.status(404).json({ error: 'Movie not found' });
  }

  const dir = DIRECTIONS[direction];
  const { source, target } = await getSubtitleRows(movieId, direction);
  if (!source) {
    return res
      .status(400)
      .json({ error: `Movie has no ${dir.sourceLang} subtitles to translate` });
  }
  if (target && !overwrite) {
    return res.status(409).json({
      error: `${dir.targetLang} subtitles already exist — confirm overwrite to replace them`,
      code: 'TARGET_EXISTS',
    });
  }

  // One active translation per movie.
  const active = await pool.query(
    "SELECT id FROM subtitle_translation_jobs WHERE movie_id = $1 AND status IN ('pending', 'running')",
    [movieId]
  );
  if (active.rows.length > 0) {
    return res.status(409).json({ error: 'A translation job is already active for this movie' });
  }

  const insert = await pool.query(
    `INSERT INTO subtitle_translation_jobs (movie_id, direction, source_drive_file_id, model, status, created_by)
     VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
    [movieId, direction, source.drive_file_id, subtitleTranslator.getModel(), req.user?.email || null]
  );
  const job = insert.rows[0];
  subtitleTranslator.enqueue(job.id);

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'subtitle_translation_job',
    resourceId: job.id,
    newData: { movie_id: movieId, direction, overwrite: !!overwrite, operation },
  });

  res.status(201).json({ job });
}

// POST / — create + enqueue a translation job for a movie.
router.post('/', async (req, res) => {
  if (!isReady()) return notConfigured(res);
  try {
    const { movie_id, direction, overwrite } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });
    if (!DIRECTIONS[direction]) {
      return res.status(400).json({ error: "direction must be 'cs_to_en' or 'en_to_cs'" });
    }
    await createJob(req, res, {
      movieId: movie_id,
      direction,
      overwrite: overwrite === true,
      operation: 'create',
    });
  } catch (error) {
    // Partial unique index: another request already created an active job.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A translation job is already active for this movie' });
    }
    logError(error, req, { operation: 'create_subtitle_translation_job' });
    res.status(500).json({ error: error.message });
  }
});

// GET /movie/:movieId — all jobs for a movie (newest first).
router.get('/movie/:movieId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM subtitle_translation_jobs WHERE movie_id = $1 ORDER BY created_at DESC',
      [req.params.movieId]
    );
    res.json({ jobs: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_subtitle_translation_jobs' });
    res.status(500).json({ error: error.message });
  }
});

// GET /:id — single job (polling).
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_translation_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'get_subtitle_translation_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/cancel — request cancellation. Pending jobs cancel immediately;
// running jobs get cancel_requested set and the runner honors it between batches.
router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_translation_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = result.rows[0];

    if (job.status === 'pending') {
      await pool.query(
        `UPDATE subtitle_translation_jobs SET status = 'cancelled', cancel_requested = true,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
      );
      subtitleTranslator.cancel(req.params.id);
    } else if (job.status === 'running') {
      await pool.query(
        'UPDATE subtitle_translation_jobs SET cancel_requested = true WHERE id = $1',
        [req.params.id]
      );
      subtitleTranslator.cancel(req.params.id);
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    logError(error, req, { operation: 'cancel_subtitle_translation_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/retry — re-run a terminal job against the movie's current subtitles.
router.post('/:id/retry', async (req, res) => {
  if (!isReady()) return notConfigured(res);
  try {
    const result = await pool.query('SELECT * FROM subtitle_translation_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const old = result.rows[0];
    if (!TERMINAL_STATUSES.includes(old.status)) {
      return res.status(409).json({ error: 'Only terminal jobs can be retried' });
    }

    // A retry re-runs an explicitly requested translation, so an existing
    // target (possibly the failed run's partial predecessor) may be replaced.
    await createJob(req, res, {
      movieId: old.movie_id,
      direction: old.direction,
      overwrite: true,
      operation: 'retry',
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A translation job is already active for this movie' });
    }
    logError(error, req, { operation: 'retry_subtitle_translation_job' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
