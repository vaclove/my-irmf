/**
 * Movie download jobs: /api/movie-downloads
 *
 * A job pulls a file from a public Google Drive link or an FTP URL into the
 * movie's Drive folder. Jobs run in-process (movieDownloader) with progress
 * polled by the client.
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const googleDrive = require('../services/googleDrive');
const movieDownloader = require('../services/movieDownloader');
const { FILE_KINDS } = require('../utils/movieFileNaming');

const router = express.Router();

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

function detectSourceType(url) {
  if (!url) return null;
  if (/^ftp:\/\//i.test(url)) return 'ftp';
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) return 'gdrive';
  if (movieDownloader.extractDriveFileId(url)) return 'gdrive';
  return null;
}

/**
 * Strip any embedded credentials from a job's source_url before returning it to
 * clients. The raw value stays in the DB for the downloader to use internally.
 */
function redactJob(job) {
  if (!job || !job.source_url) return job;
  try {
    const u = new URL(job.source_url);
    if (u.username || u.password) {
      u.username = u.username ? '***' : '';
      u.password = u.password ? '***' : '';
      return { ...job, source_url: u.toString() };
    }
    return job;
  } catch {
    return job;
  }
}

// POST / — create + enqueue a download job.
router.post('/', async (req, res) => {
  if (!googleDrive.isConfigured()) {
    return res.status(503).json({ error: 'Google Drive is not configured' });
  }
  try {
    const { movie_id, file_kind, source_url } = req.body;
    if (!movie_id) return res.status(400).json({ error: 'movie_id is required' });
    if (!FILE_KINDS.includes(file_kind)) {
      return res.status(400).json({ error: 'Invalid file_kind' });
    }
    const sourceType = detectSourceType(source_url);
    if (!sourceType) {
      return res
        .status(400)
        .json({ error: 'URL must be a public Google Drive link or an ftp:// URL' });
    }

    const movieRes = await pool.query('SELECT id FROM movies WHERE id = $1', [movie_id]);
    if (movieRes.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }

    // Guard against duplicate/concurrent jobs for the same movie + file_kind:
    // two active jobs would race on ensureMovieFolder/upsertFileRow and could
    // orphan a Drive file.
    const activeCheck = await pool.query(
      `SELECT id FROM movie_download_jobs
       WHERE movie_id = $1 AND file_kind = $2 AND status IN ('pending', 'running')`,
      [movie_id, file_kind]
    );
    if (activeCheck.rows.length > 0) {
      return res
        .status(409)
        .json({ error: 'A download job is already active for this file kind' });
    }

    const insert = await pool.query(
      `INSERT INTO movie_download_jobs
         (movie_id, file_kind, source_type, source_url, status, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [movie_id, file_kind, sourceType, source_url, req.user?.email || null]
    );
    const job = insert.rows[0];
    movieDownloader.enqueue(job.id);
    res.status(201).json({ job: redactJob(job) });
  } catch (error) {
    logError(error, req, { operation: 'create_download_job' });
    res.status(500).json({ error: error.message });
  }
});

// GET /movie/:movieId — all jobs for a movie (newest first).
router.get('/movie/:movieId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM movie_download_jobs WHERE movie_id = $1 ORDER BY created_at DESC',
      [req.params.movieId]
    );
    res.json({ jobs: result.rows.map(redactJob) });
  } catch (error) {
    logError(error, req, { operation: 'get_movie_download_jobs' });
    res.status(500).json({ error: error.message });
  }
});

// GET /:id — single job (polling).
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM movie_download_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: redactJob(result.rows[0]) });
  } catch (error) {
    logError(error, req, { operation: 'get_download_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/cancel — request cancellation of a running/pending job.
router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM movie_download_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    movieDownloader.cancel(req.params.id);
    // If it was still pending (never started), mark cancelled immediately.
    if (result.rows[0].status === 'pending') {
      await pool.query(
        `UPDATE movie_download_jobs SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
      );
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    logError(error, req, { operation: 'cancel_download_job' });
    res.status(500).json({ error: error.message });
  }
});

// POST /:id/retry — clone a terminal job as a fresh pending job.
router.post('/:id/retry', async (req, res) => {
  if (!googleDrive.isConfigured()) {
    return res.status(503).json({ error: 'Google Drive is not configured' });
  }
  try {
    const result = await pool.query('SELECT * FROM movie_download_jobs WHERE id = $1', [
      req.params.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const old = result.rows[0];
    if (!TERMINAL_STATUSES.includes(old.status)) {
      return res.status(409).json({ error: 'Only terminal jobs can be retried' });
    }

    // Don't clone a retry if another active job already exists for this kind.
    const activeCheck = await pool.query(
      `SELECT id FROM movie_download_jobs
       WHERE movie_id = $1 AND file_kind = $2 AND status IN ('pending', 'running')`,
      [old.movie_id, old.file_kind]
    );
    if (activeCheck.rows.length > 0) {
      return res
        .status(409)
        .json({ error: 'A download job is already active for this file kind' });
    }

    const insert = await pool.query(
      `INSERT INTO movie_download_jobs
         (movie_id, file_kind, source_type, source_url, status, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [old.movie_id, old.file_kind, old.source_type, old.source_url, req.user?.email || null]
    );
    const job = insert.rows[0];
    movieDownloader.enqueue(job.id);
    res.status(201).json({ job: redactJob(job) });
  } catch (error) {
    logError(error, req, { operation: 'retry_download_job' });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
