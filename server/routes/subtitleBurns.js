/**
 * Burned-in subtitle exports: /api/subtitle-burns
 *
 * A job renders the movie master with CS and/or EN subtitles burned in — a
 * ~60 s preview clip or the full movie — as a temporary download for the
 * screening laptop. Jobs run in the movie worker via the shared storage queue;
 * the app inserts the row, enqueues the message, and the client polls here.
 * Downloads are short-lived SAS links straight to Blob Storage (files of
 * 10+ GB can't go through the App Service).
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { logAuditEvent } = require('../utils/auditLogger');
const subtitleBurnQueue = require('../services/subtitleBurnQueue');
const exportStorage = require('../services/exportStorage');
const movieStorage = require('../services/movieStorage');
const { parseCues, chooseLayout, subtitleStats } = require('../utils/subtitleBurn');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];
const KINDS = ['preview', 'full'];
const SUBTITLE_CHOICES = {
  cs: ['subtitles_cs', 'subtitles_cs_synced'],
  en: ['subtitles_en', 'subtitles_en_synced'],
};
const SOURCE_KINDS = ['movie', ...SUBTITLE_CHOICES.cs, ...SUBTITLE_CHOICES.en];
const PREVIEW_LENGTH_SECONDS = 60;

// A completed export whose blob still exists.
const JOB_COLUMNS = `*, (status = 'completed' AND blob_name IS NOT NULL AND blob_deleted_at IS NULL
  AND expires_at > CURRENT_TIMESTAMP) AS available`;

function notConfigured(res) {
  return res.status(503).json({ error: 'Subtitle export is not configured (needs movie storage + storage queue)' });
}

/** The movie's master and subtitle rows by kind. */
async function loadSources(movieId) {
  const res = await pool.query(
    'SELECT * FROM movie_files WHERE movie_id = $1 AND file_kind = ANY($2)',
    [movieId, SOURCE_KINDS]
  );
  return new Map(res.rows.map((r) => [r.file_kind, r]));
}

/**
 * Validate the {cs, en} subtitle choice against the movie's files.
 * @returns {{error?: string, cs?: object|null, en?: object|null}} rows
 */
function pickSubtitles(sources, { cs, en }) {
  const picked = {};
  for (const lang of ['cs', 'en']) {
    const kind = lang === 'cs' ? cs : en;
    if (kind == null || kind === '') {
      picked[lang] = null;
      continue;
    }
    if (!SUBTITLE_CHOICES[lang].includes(kind)) return { error: `Invalid ${lang} subtitle file` };
    const row = sources.get(kind);
    if (!row) return { error: `The movie has no ${kind.replace(/_/g, ' ')} file` };
    picked[lang] = row;
  }
  if (!picked.cs && !picked.en) return { error: 'Choose at least one subtitle language' };
  return picked;
}

/** Shared validation + insert + enqueue used by create and retry. */
async function createJob(req, res, { movieId, kind, cs, en, previewStart, operation }) {
  const movieRes = await pool.query('SELECT id FROM movies WHERE id = $1', [movieId]);
  if (movieRes.rows.length === 0) return res.status(404).json({ error: 'Movie not found' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: "kind must be 'preview' or 'full'" });
  if (previewStart != null && !(Number.isFinite(Number(previewStart)) && Number(previewStart) >= 0)) {
    return res.status(400).json({ error: 'preview_start_seconds must be a non-negative number' });
  }

  const sources = await loadSources(movieId);
  const master = sources.get('movie');
  if (!master) return res.status(400).json({ error: 'The movie has no master file' });
  const picked = pickSubtitles(sources, { cs, en });
  if (picked.error) return res.status(400).json({ error: picked.error });

  const active = await pool.query(
    `SELECT id FROM subtitle_burn_jobs WHERE movie_id = $1 AND kind = $2 AND status IN ('pending', 'running')`,
    [movieId, kind]
  );
  if (active.rows.length > 0) {
    return res.status(409).json({ error: `A ${kind} export is already running for this movie` });
  }

  const insert = await pool.query(
    `INSERT INTO subtitle_burn_jobs
       (movie_id, kind, source_ref, subtitle_cs_kind, subtitle_cs_ref, subtitle_en_kind, subtitle_en_ref,
        preview_start_seconds, preview_length_seconds, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10) RETURNING ${JOB_COLUMNS}`,
    [
      movieId,
      kind,
      movieStorage.fileRef(master),
      picked.cs?.file_kind || null,
      picked.cs ? movieStorage.fileRef(picked.cs) : null,
      picked.en?.file_kind || null,
      picked.en ? movieStorage.fileRef(picked.en) : null,
      kind === 'preview' && previewStart != null ? Number(previewStart) : null,
      kind === 'preview' ? PREVIEW_LENGTH_SECONDS : null,
      req.user?.email || null,
    ]
  );
  const job = insert.rows[0];
  try {
    await subtitleBurnQueue.enqueueJob(job.id);
  } catch (queueError) {
    await pool.query(
      `UPDATE subtitle_burn_jobs SET status = 'failed', error_message = $2,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [job.id, ('Failed to enqueue: ' + queueError.message).slice(0, 1000)]
    );
    throw queueError;
  }

  await logAuditEvent({
    req,
    action: 'create',
    resource: 'subtitle_burn_job',
    resourceId: job.id,
    newData: { movie_id: movieId, kind, cs: picked.cs?.file_kind || null, en: picked.en?.file_kind || null, operation },
  });

  res.status(201).json({ job });
}

async function loadJob(id) {
  const result = await pool.query(`SELECT ${JOB_COLUMNS} FROM subtitle_burn_jobs WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

// GET /movie/:movieId — the movie's exports (newest first) and which source
// files exist.
router.get('/movie/:movieId', async (req, res) => {
  try {
    const [jobs, sources] = await Promise.all([
      pool.query(
        `SELECT ${JOB_COLUMNS} FROM subtitle_burn_jobs
         WHERE movie_id = $1 AND dismissed_at IS NULL ORDER BY created_at DESC`,
        [req.params.movieId]
      ),
      loadSources(req.params.movieId),
    ]);
    res.json({
      configured: subtitleBurnQueue.isConfigured(),
      jobs: jobs.rows,
      sources: Object.fromEntries(SOURCE_KINDS.map((k) => [k, sources.has(k)])),
    });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_subtitle_burns' });
    res.status(500).json({ error: error.message });
  }
});

// POST /check — readability numbers for the chosen subtitle files and the
// layout the render will use (paired when the timings match).
router.post('/check', async (req, res) => {
  try {
    const { movie_id, cs, en } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });
    const picked = pickSubtitles(await loadSources(movie_id), { cs, en });
    if (picked.error) return res.status(400).json({ error: picked.error });

    const cues = {};
    const result = {};
    for (const lang of ['cs', 'en']) {
      if (!picked[lang]) continue;
      try {
        cues[lang] = parseCues((await movieStorage.readSubtitleRow(picked[lang])).text);
      } catch (e) {
        return res.status(422).json({ error: `${lang.toUpperCase()} subtitles: ${e.message}` });
      }
      result[lang] = subtitleStats(cues[lang]);
    }
    const { layout, ratio } = chooseLayout(cues.cs, cues.en);
    res.json({ ...result, layout, paired_ratio: ratio });
  } catch (error) {
    logError(error, req, { operation: 'check_subtitle_burn' });
    res.status(500).json({ error: error.message });
  }
});

// POST / — create + enqueue an export.
router.post('/', async (req, res) => {
  if (!subtitleBurnQueue.isConfigured()) return notConfigured(res);
  try {
    const { movie_id, kind, cs, en, preview_start_seconds } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });
    await createJob(req, res, {
      movieId: movie_id,
      kind,
      cs,
      en,
      previewStart: preview_start_seconds ?? null,
      operation: 'create',
    });
  } catch (error) {
    // Partial unique index: another request already created an active job.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An export of this kind is already running for this movie' });
    }
    logError(error, req, { operation: 'create_subtitle_burn' });
    res.status(500).json({ error: error.message });
  }
});

// GET /:id — single job (polling).
router.get('/:id', async (req, res) => {
  try {
    const job = await loadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (error) {
    logError(error, req, { operation: 'get_subtitle_burn' });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Redirect to the export blob: as a download (attachment) or for inline
 * playback (the preview player).
 */
async function redirectToExport(req, res, { inline }) {
  try {
    const job = await loadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.available) return res.status(410).json({ error: 'This export is no longer available' });
    const movieRes = await pool.query('SELECT name_cs, name_en FROM movies WHERE id = $1', [job.movie_id]);
    const movie = movieRes.rows[0] || {};
    const langs = [job.subtitle_cs_ref && 'CS', job.subtitle_en_ref && 'EN'].filter(Boolean).join('+');
    const title = String(movie.name_cs || movie.name_en || 'movie').replace(/[/\\:*?"<>|]/g, '-');
    const downloadName = `${title} (${langs})${job.kind === 'preview' ? ' - preview' : ''}.mp4`;
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, await exportStorage.readUrl(job.blob_name, inline ? {} : { downloadName }));
  } catch (error) {
    logError(error, req, { operation: 'download_subtitle_burn' });
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
}

// GET /:id/download — save the export.
router.get('/:id/download', (req, res) => redirectToExport(req, res, { inline: false }));

// GET /:id/play — the export for a <video> element.
router.get('/:id/play', (req, res) => redirectToExport(req, res, { inline: true }));

// POST /:id/cancel — pending jobs cancel immediately; running jobs get
// cancel_requested and the worker stops between checks.
router.post('/:id/cancel', async (req, res) => {
  try {
    const job = await loadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'pending') {
      await pool.query(
        `UPDATE subtitle_burn_jobs SET status = 'cancelled', cancel_requested = true,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id]
      );
    } else if (job.status === 'running') {
      await pool.query('UPDATE subtitle_burn_jobs SET cancel_requested = true WHERE id = $1', [job.id]);
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    logError(error, req, { operation: 'cancel_subtitle_burn' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/retry — re-run a terminal job with the same choices against the
// movie's current files.
router.post('/:id/retry', async (req, res) => {
  if (!subtitleBurnQueue.isConfigured()) return notConfigured(res);
  try {
    const old = await loadJob(req.params.id);
    if (!old) return res.status(404).json({ error: 'Job not found' });
    if (!TERMINAL_STATUSES.includes(old.status)) {
      return res.status(409).json({ error: 'Only finished exports can be retried' });
    }
    await createJob(req, res, {
      movieId: old.movie_id,
      kind: old.kind,
      cs: old.subtitle_cs_kind,
      en: old.subtitle_en_kind,
      previewStart: old.preview_start_seconds,
      operation: 'retry',
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An export of this kind is already running for this movie' });
    }
    logError(error, req, { operation: 'retry_subtitle_burn' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/dismiss — remove a finished export from the list and delete its file.
router.post('/:id/dismiss', async (req, res) => {
  try {
    const job = await loadJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!TERMINAL_STATUSES.includes(job.status)) {
      return res.status(409).json({ error: 'Only finished exports can be removed' });
    }
    if (job.blob_name && !job.blob_deleted_at) {
      await exportStorage.deleteBlob(job.blob_name);
    }
    await pool.query(
      `UPDATE subtitle_burn_jobs SET dismissed_at = CURRENT_TIMESTAMP,
         blob_deleted_at = CASE WHEN blob_name IS NOT NULL THEN COALESCE(blob_deleted_at, CURRENT_TIMESTAMP) END
       WHERE id = $1`,
      [job.id]
    );
    await logAuditEvent({
      req,
      action: 'delete',
      resource: 'subtitle_burn_job',
      resourceId: job.id,
      oldData: { movie_id: job.movie_id, kind: job.kind, file_name: job.file_name },
    });
    res.json({ message: 'Export removed' });
  } catch (error) {
    logError(error, req, { operation: 'dismiss_subtitle_burn' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
