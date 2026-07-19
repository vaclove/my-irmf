/**
 * Subtitle quality gate: /api/subtitle-quality
 *
 * Runs lint a movie's subtitle file and store per-cue flags with optional
 * LLM fix suggestions (services/subtitleQualityRunner). Runs are created
 * automatically after translation jobs; this API also starts them on demand,
 * serves run status for polling, and manages flag lifecycle (open ->
 * accepted / dismissed / stale).
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { logAuditEvent } = require('../utils/auditLogger');
const googleDrive = require('../services/googleDrive');
const subtitleQualityRunner = require('../services/subtitleQualityRunner');

const router = express.Router();

const LANGS = ['cs', 'en', 'cs_synced', 'en_synced'];
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

// POST /runs — start a quality check for one subtitle file of a movie.
router.post('/runs', async (req, res) => {
  if (!googleDrive.isConfigured()) {
    return res.status(503).json({ error: 'Google Drive is not configured' });
  }
  try {
    const { movie_id, lang } = req.body || {};
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });
    if (!LANGS.includes(lang)) {
      return res.status(400).json({ error: `lang must be one of ${LANGS.join(', ')}` });
    }

    const fileRow = await pool.query(
      'SELECT drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movie_id, `subtitles_${lang}`]
    );
    if (fileRow.rows.length === 0) {
      return res.status(400).json({ error: 'Movie has no such subtitle file' });
    }

    const insert = await pool.query(
      `INSERT INTO subtitle_quality_runs (movie_id, lang, file_drive_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [movie_id, lang, fileRow.rows[0].drive_file_id, req.user?.email || null]
    );
    const run = insert.rows[0];
    subtitleQualityRunner.enqueue(run.id);

    await logAuditEvent({
      req,
      action: 'create',
      resource: 'subtitle_quality_run',
      resourceId: run.id,
      newData: { movie_id, lang },
    });

    res.status(201).json({ run });
  } catch (error) {
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ error: 'A quality check is already running for these subtitles' });
    }
    logError(error, req, { operation: 'create_subtitle_quality_run' });
    res.status(500).json({ error: error.message });
  }
});

// GET /runs/movie/:movieId — all non-dismissed runs for a movie (newest first).
router.get('/runs/movie/:movieId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM subtitle_quality_runs
       WHERE movie_id = $1 AND dismissed_at IS NULL
       ORDER BY created_at DESC`,
      [req.params.movieId]
    );
    res.json({ runs: result.rows });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_subtitle_quality_runs' });
    res.status(500).json({ error: error.message });
  }
});

// GET /runs/:id — single run (polling).
router.get('/runs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_quality_runs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Run not found' });
    res.json({ run: result.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'get_subtitle_quality_run' });
    res.status(500).json({ error: error.message });
  }
});

// POST /runs/:id/cancel — pending runs cancel immediately; running runs get
// cancel_requested and the runner honors it between phases/batches.
router.post('/runs/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_quality_runs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Run not found' });
    const run = result.rows[0];

    if (run.status === 'pending') {
      await pool.query(
        `UPDATE subtitle_quality_runs SET status = 'cancelled', cancel_requested = true,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
      );
      subtitleQualityRunner.cancel(req.params.id);
    } else if (run.status === 'running') {
      await pool.query('UPDATE subtitle_quality_runs SET cancel_requested = true WHERE id = $1', [
        req.params.id,
      ]);
      subtitleQualityRunner.cancel(req.params.id);
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    logError(error, req, { operation: 'cancel_subtitle_quality_run' });
    res.status(500).json({ error: error.message });
  }
});

// POST /runs/:id/dismiss — hide a terminal run from the movie's list.
router.post('/runs/:id/dismiss', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subtitle_quality_runs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Run not found' });
    if (!TERMINAL_STATUSES.includes(result.rows[0].status)) {
      return res.status(409).json({ error: 'Only finished runs can be dismissed' });
    }
    await pool.query(
      'UPDATE subtitle_quality_runs SET dismissed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Run dismissed' });
  } catch (error) {
    logError(error, req, { operation: 'dismiss_subtitle_quality_run' });
    res.status(500).json({ error: error.message });
  }
});

// GET /flags/movie/:movieId?lang=cs — open flags for one subtitle track.
router.get('/flags/movie/:movieId', async (req, res) => {
  try {
    const { lang } = req.query;
    if (!LANGS.includes(lang)) {
      return res.status(400).json({ error: `lang query must be one of ${LANGS.join(', ')}` });
    }
    const result = await pool.query(
      `SELECT * FROM subtitle_quality_flags
       WHERE movie_id = $1 AND lang = $2 AND status = 'open'
       ORDER BY cue_index, severity`,
      [req.params.movieId, lang]
    );
    const counts = { error: 0, warn: 0, info: 0 };
    for (const f of result.rows) counts[f.severity] = (counts[f.severity] || 0) + 1;
    res.json({ flags: result.rows, counts });
  } catch (error) {
    logError(error, req, { operation: 'get_subtitle_quality_flags' });
    res.status(500).json({ error: error.message });
  }
});

// GET /flags/movie/:movieId/summary — open-flag counts per lang + latest runs
// (one cheap query each; drives the badges in the movie files section).
router.get('/flags/movie/:movieId/summary', async (req, res) => {
  try {
    const [flagRes, runRes] = await Promise.all([
      pool.query(
        `SELECT lang, severity, COUNT(*)::int AS count FROM subtitle_quality_flags
         WHERE movie_id = $1 AND status = 'open' GROUP BY lang, severity`,
        [req.params.movieId]
      ),
      pool.query(
        `SELECT DISTINCT ON (lang) * FROM subtitle_quality_runs
         WHERE movie_id = $1 ORDER BY lang, created_at DESC`,
        [req.params.movieId]
      ),
    ]);
    const counts = {};
    for (const row of flagRes.rows) {
      if (!counts[row.lang]) counts[row.lang] = { open: 0, error: 0, warn: 0, info: 0 };
      counts[row.lang][row.severity] = row.count;
      counts[row.lang].open += row.count;
    }
    const latestRuns = {};
    for (const run of runRes.rows) latestRuns[run.lang] = run;
    res.json({ counts, latest_runs: latestRuns });
  } catch (error) {
    logError(error, req, { operation: 'get_subtitle_quality_summary' });
    res.status(500).json({ error: error.message });
  }
});

// POST /flags/resolve — bulk transition open flags to accepted/dismissed.
router.post('/flags/resolve', async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (!['accepted', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: "status must be 'accepted' or 'dismissed'" });
    }
    const result = await pool.query(
      `UPDATE subtitle_quality_flags
       SET status = $2, resolved_at = CURRENT_TIMESTAMP, resolved_by = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($1) AND status = 'open' RETURNING id`,
      [ids, status, req.user?.email || null]
    );

    await logAuditEvent({
      req,
      action: 'update',
      resource: 'subtitle_quality_flag',
      resourceId: result.rows[0]?.id || ids[0],
      newData: { status, count: result.rowCount },
    });

    res.json({ updated: result.rowCount });
  } catch (error) {
    logError(error, req, { operation: 'resolve_subtitle_quality_flags' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
