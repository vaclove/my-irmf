const express = require('express');
const crypto = require('crypto');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const { auditMiddleware } = require('../utils/auditLogger');
const movieStorage = require('../services/movieStorage');
const tvSlides = require('../services/tvSlides');

// TV player on the venue screen (/tv/): settings and slides, see migration
// 067_create_tv_screen.sql. The admin router needs @irmf.cz, the public one
// is what the player reads.

const PROGRAMME_DAYS = ['today', 'upcoming'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLIDE_COLUMNS = `id, kind, title, movie_id, sort_order, hidden, display_seconds, status,
  progress_percent, error_message, blob_name, source_blob_name, file_name, size, width, height,
  media_seconds, created_by, created_at, updated_at`;

const SETTINGS_COLUMNS = `programme_days, screening_slides, default_photo_seconds, programme_seconds,
  screening_seconds, reload_requested_at, updated_by, updated_at`;
// Slide times in seconds, see migrations 072 and 074
const SECONDS_SETTINGS = ['default_photo_seconds', 'programme_seconds', 'screening_seconds'];

async function readSettings() {
  const result = await pool.query(`SELECT ${SETTINGS_COLUMNS} FROM tv_settings WHERE id = 1`);
  return result.rows[0] || {
    programme_days: 'today', screening_slides: true, default_photo_seconds: 8, programme_seconds: 15,
    screening_seconds: 12, reload_requested_at: null,
  };
}

async function readSlides() {
  const result = await pool.query(`SELECT ${SLIDE_COLUMNS} FROM tv_slides ORDER BY sort_order, created_at`);
  return result.rows;
}

/** Slide as the admin sees it; storage names stay on the server. */
function adminSlide(slide) {
  const { blob_name, source_blob_name, ...rest } = slide;
  return {
    ...rest,
    size: slide.size === null ? null : Number(slide.size),
    media_seconds: slide.media_seconds === null ? null : Number(slide.media_seconds),
    url: tvSlides.mediaUrl(slide),
  };
}

async function loadSlide(id) {
  if (!UUID_RE.test(id)) return null;
  const result = await pool.query(`SELECT ${SLIDE_COLUMNS} FROM tv_slides WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

// A video stuck this long in 'processing' without progress may be retried
// (e.g. its queue message reached a worker that didn't know 'tv_video' yet)
const STUCK_PROCESSING_MINUTES = 10;

/** 400 response unless movie_id is empty or an existing film. */
async function invalidMovie(movieId, res) {
  if (!movieId) return false;
  const exists = UUID_RE.test(movieId) && (await pool.query('SELECT 1 FROM movies WHERE id = $1', [movieId])).rows.length > 0;
  if (exists) return false;
  res.status(400).json({ error: 'Unknown film' });
  return true;
}

async function nextSortOrder() {
  const result = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM tv_slides');
  return result.rows[0].next;
}

function requireStorage(res) {
  if (movieStorage.isConfigured()) return true;
  res.status(503).json({ error: 'Movie storage (Azure Blob) is not configured' });
  return false;
}

// ---------------------------------------------------------------------------
// Admin: /api/tv
// ---------------------------------------------------------------------------

const adminRouter = express.Router();
const audit = auditMiddleware('tv_screen');

adminRouter.get('/settings', async (req, res) => {
  try {
    res.json(await readSettings());
  } catch (error) {
    logError(error, req, { operation: 'get_tv_settings' });
    res.status(500).json({ error: 'Failed to load TV settings' });
  }
});

adminRouter.put('/settings', audit, async (req, res) => {
  // Any setting alone may be sent; the others stay. reset_photo_seconds also
  // drops every photo's own time, so the default applies to all of them.
  const { programme_days, screening_slides, reset_photo_seconds } = req.body;
  if (programme_days !== undefined && !PROGRAMME_DAYS.includes(programme_days)) {
    return res.status(400).json({ error: `programme_days must be one of: ${PROGRAMME_DAYS.join(', ')}` });
  }
  if (screening_slides !== undefined && typeof screening_slides !== 'boolean') {
    return res.status(400).json({ error: 'screening_slides must be true or false' });
  }
  const invalidSeconds = SECONDS_SETTINGS.find((name) => req.body[name] !== undefined
    && !(Number.isInteger(req.body[name]) && req.body[name] >= 2 && req.body[name] <= 120));
  if (invalidSeconds) {
    return res.status(400).json({ error: `${invalidSeconds} must be a whole number between 2 and 120` });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE tv_settings SET programme_days = COALESCE($1, programme_days),
        screening_slides = COALESCE($2, screening_slides),
        default_photo_seconds = COALESCE($3, default_photo_seconds),
        programme_seconds = COALESCE($4, programme_seconds),
        screening_seconds = COALESCE($5, screening_seconds), updated_by = $6, updated_at = now()
      WHERE id = 1
      RETURNING ${SETTINGS_COLUMNS}
    `, [programme_days ?? null, screening_slides ?? null, ...SECONDS_SETTINGS.map((name) => req.body[name] ?? null),
      req.user?.email || null]);
    if (reset_photo_seconds === true) {
      await client.query(`
        UPDATE tv_slides SET display_seconds = NULL, updated_at = now()
        WHERE kind = 'photo' AND display_seconds IS NOT NULL
      `);
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logError(error, req, { operation: 'update_tv_settings' });
    res.status(500).json({ error: 'Failed to save TV settings' });
  } finally {
    client.release();
  }
});

// "Reload screens": players drop their cached page and load it again
adminRouter.post('/reload', audit, async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE tv_settings SET reload_requested_at = now(), updated_by = $1, updated_at = now()
      WHERE id = 1
      RETURNING ${SETTINGS_COLUMNS}
    `, [req.user?.email || null]);
    res.json(result.rows[0]);
  } catch (error) {
    logError(error, req, { operation: 'reload_tv_screens' });
    res.status(500).json({ error: 'Failed to request a reload' });
  }
});

adminRouter.get('/slides', async (req, res) => {
  try {
    res.json({
      slides: (await readSlides()).map(adminSlide),
      storage_configured: movieStorage.isConfigured(),
      transcode_configured: tvSlides.canTranscode(),
    });
  } catch (error) {
    logError(error, req, { operation: 'list_tv_slides' });
    res.status(500).json({ error: 'Failed to load slides' });
  }
});

// Photo: sent as base64, scaled to fit 1920×1080 and stored as a JPEG
adminRouter.post('/slides/photos', audit, async (req, res) => {
  const { file_name, content_base64, title } = req.body;
  if (!content_base64) return res.status(400).json({ error: 'content_base64 is required' });
  if (!requireStorage(res)) return;

  const id = crypto.randomUUID();
  let photo;
  try {
    photo = await tvSlides.processPhoto(Buffer.from(content_base64, 'base64'));
  } catch (error) {
    return res.status(400).json({ error: `Not a readable image: ${error.message}` });
  }
  const name = tvSlides.blobName(id, 'photo', 'jpg');
  try {
    const written = await movieStorage.uploadBuffer(name, photo.data, { fileKind: 'tv', contentType: 'image/jpeg' });
    const result = await pool.query(`
      INSERT INTO tv_slides (id, kind, title, sort_order, status, blob_name, file_name, size, width, height, created_by)
      VALUES ($1, 'photo', $2, $3, 'ready', $4, $5, $6, $7, $8, $9)
      RETURNING ${SLIDE_COLUMNS}
    `, [id, (title || '').slice(0, 255) || null, await nextSortOrder(), name, (file_name || '').slice(0, 255) || null,
      written.size, photo.width, photo.height, req.user?.email || null]);
    res.status(201).json(adminSlide(result.rows[0]));
  } catch (error) {
    await movieStorage.deleteBlob(name).catch(() => {});
    logError(error, req, { operation: 'upload_tv_photo' });
    res.status(500).json({ error: 'Failed to save the photo' });
  }
});

// Video, step 1: a slide in 'uploading' and a SAS URL the browser uploads the source to
adminRouter.post('/slides/videos', audit, async (req, res) => {
  const { file_name, file_size, title, movie_id } = req.body;
  const ext = tvSlides.extensionOf(file_name);
  if (!tvSlides.VIDEO_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ error: `Unsupported video type. Use one of: ${tvSlides.VIDEO_EXTENSIONS.join(', ')}` });
  }
  if (!(Number(file_size) > 0) || Number(file_size) > tvSlides.MAX_VIDEO_BYTES) {
    return res.status(400).json({ error: 'The video must be smaller than 4 GB' });
  }
  if (!requireStorage(res)) return;

  try {
    if (await invalidMovie(movie_id, res)) return;
    const id = crypto.randomUUID();
    const sourceName = tvSlides.blobName(id, 'source', ext);
    const result = await pool.query(`
      INSERT INTO tv_slides (id, kind, title, movie_id, sort_order, status, source_blob_name, file_name, size, created_by)
      VALUES ($1, 'video', $2, $3, $4, 'uploading', $5, $6, $7, $8)
      RETURNING ${SLIDE_COLUMNS}
    `, [id, (title || '').slice(0, 255) || null, movie_id || null, await nextSortOrder(), sourceName,
      String(file_name).slice(0, 255), Number(file_size), req.user?.email || null]);
    res.status(201).json({
      slide: adminSlide(result.rows[0]),
      upload_url: await movieStorage.uploadUrl(sourceName),
      tier: movieStorage.tierFor('tv'),
      content_type: req.body.mime_type || 'application/octet-stream',
    });
  } catch (error) {
    logError(error, req, { operation: 'create_tv_video' });
    res.status(500).json({ error: 'Failed to start the upload' });
  }
});

// Video, step 2: the source is in storage — transcode it
adminRouter.post('/slides/:id/upload-complete', audit, async (req, res) => {
  try {
    const slide = await loadSlide(req.params.id);
    if (!slide || slide.kind !== 'video') return res.status(404).json({ error: 'Video slide not found' });
    if (slide.status !== 'uploading') return res.status(409).json({ error: `The video is already ${slide.status}` });
    const props = await movieStorage.getProperties(slide.source_blob_name).catch(() => null);
    if (!props || !props.contentLength) return res.status(400).json({ error: 'The upload did not arrive in storage' });
    if (props.contentLength > tvSlides.MAX_VIDEO_BYTES) {
      await pool.query('DELETE FROM tv_slides WHERE id = $1', [slide.id]);
      await movieStorage.deleteBlob(slide.source_blob_name).catch(() => {});
      return res.status(400).json({ error: 'The video must be smaller than 4 GB' });
    }
    const started = await startProcessing(slide, 'uploading', props.contentLength);
    if (!started) return res.status(409).json({ error: 'The video is already being processed' });
    res.json(adminSlide(started));
  } catch (error) {
    logError(error, req, { operation: 'complete_tv_video' });
    res.status(500).json({ error: 'Failed to process the video' });
  }
});

// Transcode a failed (or stuck) video again
adminRouter.post('/slides/:id/retry', audit, async (req, res) => {
  try {
    const slide = await loadSlide(req.params.id);
    if (!slide || slide.kind !== 'video') return res.status(404).json({ error: 'Video slide not found' });
    if (!slide.source_blob_name || !['failed', 'processing'].includes(slide.status)) {
      return res.status(409).json({ error: 'Only a failed or stuck video with its source file can be retried' });
    }
    const started = await startProcessing(slide, slide.status, slide.size);
    if (!started) return res.status(409).json({ error: 'The video is already being processed' });
    res.json(adminSlide(started));
  } catch (error) {
    logError(error, req, { operation: 'retry_tv_video' });
    res.status(500).json({ error: 'Failed to retry the video' });
  }
});

/**
 * Hand the uploaded source to the worker. Without a worker (local
 * development) an MP4 is played as uploaded. The status moves from
 * `fromStatus` in one statement, so a double submit queues one job only;
 * returns null when another request got there first. From 'processing'
 * only once the job has made no progress for STUCK_PROCESSING_MINUTES (the
 * worker touches updated_at with every progress report).
 */
async function startProcessing(slide, fromStatus, size) {
  if (!tvSlides.canTranscode()) {
    const playable = tvSlides.extensionOf(slide.source_blob_name) === 'mp4';
    const result = await pool.query(`
      UPDATE tv_slides SET status = $3, blob_name = $4, size = $5, error_message = $6, updated_at = now()
      WHERE id = $1 AND status = $2 RETURNING ${SLIDE_COLUMNS}
    `, [slide.id, fromStatus, playable ? 'ready' : 'failed', playable ? slide.source_blob_name : null, size,
      playable ? null : 'Video transcoding is not configured; upload an MP4']);
    return result.rows[0] || null;
  }
  const result = await pool.query(`
    UPDATE tv_slides SET status = 'processing', progress_percent = 0, error_message = NULL, updated_at = now()
    WHERE id = $1 AND status = $2
      AND (status <> 'processing' OR updated_at < now() - make_interval(mins => $3))
    RETURNING ${SLIDE_COLUMNS}
  `, [slide.id, fromStatus, STUCK_PROCESSING_MINUTES]);
  if (!result.rows[0]) return null;
  try {
    await tvSlides.enqueueVideo(slide.id);
  } catch (queueError) {
    const failed = await pool.query(`
      UPDATE tv_slides SET status = 'failed', error_message = $2, updated_at = now()
      WHERE id = $1 RETURNING ${SLIDE_COLUMNS}
    `, [slide.id, `Failed to enqueue: ${queueError.message}`.slice(0, 1000)]);
    return failed.rows[0];
  }
  return result.rows[0];
}

adminRouter.patch('/slides/:id', audit, async (req, res) => {
  try {
    const slide = await loadSlide(req.params.id);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });

    const sets = [];
    const params = [slide.id];
    const set = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if ('hidden' in req.body) set('hidden', !!req.body.hidden);
    if ('title' in req.body && slide.kind !== 'programme') set('title', String(req.body.title || '').slice(0, 255) || null);
    if ('display_seconds' in req.body && slide.kind === 'photo') {
      const seconds = req.body.display_seconds === null ? null : parseInt(req.body.display_seconds, 10);
      if (seconds !== null && !(seconds >= 2 && seconds <= 120)) {
        return res.status(400).json({ error: 'display_seconds must be between 2 and 120' });
      }
      set('display_seconds', seconds);
    }
    if ('movie_id' in req.body && slide.kind === 'video') {
      if (await invalidMovie(req.body.movie_id, res)) return;
      set('movie_id', req.body.movie_id || null);
    }
    if (!sets.length) return res.json(adminSlide(slide));

    const result = await pool.query(
      `UPDATE tv_slides SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${SLIDE_COLUMNS}`,
      params
    );
    res.json(adminSlide(result.rows[0]));
  } catch (error) {
    logError(error, req, { operation: 'update_tv_slide' });
    res.status(500).json({ error: 'Failed to update the slide' });
  }
});

// New order: ids in the order to play them
adminRouter.put('/slides/order', audit, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.every((id) => UUID_RE.test(id))) {
    return res.status(400).json({ error: 'ids must be an array of slide ids' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // All slides, each once: a list from a stale tab would leave clashing sort orders
    const current = (await client.query('SELECT id FROM tv_slides FOR UPDATE')).rows.map((r) => r.id);
    if (new Set(ids).size !== ids.length || ids.length !== current.length || !current.every((id) => ids.includes(id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The slides changed meanwhile — reload the page and try again' });
    }
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE tv_slides SET sort_order = $2 WHERE id = $1', [ids[i], i + 1]);
    }
    await client.query('COMMIT');
    res.json({ slides: (await readSlides()).map(adminSlide) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logError(error, req, { operation: 'reorder_tv_slides' });
    res.status(500).json({ error: 'Failed to save the order' });
  } finally {
    client.release();
  }
});

adminRouter.delete('/slides/:id', audit, async (req, res) => {
  try {
    const slide = await loadSlide(req.params.id);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });
    if (slide.kind === 'programme') return res.status(400).json({ error: 'The programme cannot be deleted, only hidden' });
    await pool.query('DELETE FROM tv_slides WHERE id = $1', [slide.id]);
    // A worker still transcoding this video notices the missing row and drops its output
    for (const name of new Set([slide.blob_name, slide.source_blob_name].filter(Boolean))) {
      await movieStorage.deleteBlob(name).catch(() => {});
    }
    res.json({ deleted: true, id: slide.id });
  } catch (error) {
    logError(error, req, { operation: 'delete_tv_slide' });
    res.status(500).json({ error: 'Failed to delete the slide' });
  }
});

// ---------------------------------------------------------------------------
// Public: /api/public/tv (read by the player, no login)
// ---------------------------------------------------------------------------

const publicRouter = express.Router();

// Settings + the slides, in order. Unfinished videos are left out; hidden
// slides stay listed (the player skips them but keeps their files cached, so
// showing them again needs no download).
publicRouter.get('/manifest', async (req, res) => {
  try {
    const settings = await readSettings();
    const slides = (await readSlides())
      .filter((s) => s.kind === 'programme' || (s.status === 'ready' && s.blob_name))
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        hidden: s.hidden,
        title: s.title,
        movie_id: s.movie_id,
        display_seconds: s.display_seconds,
        width: s.width,
        height: s.height,
        media_seconds: s.media_seconds === null ? null : Number(s.media_seconds),
        size: s.size === null ? null : Number(s.size),
        url: tvSlides.mediaUrl(s),
      }));
    res.set('Cache-Control', 'no-store');
    res.json({
      settings: {
        programme_days: settings.programme_days,
        screening_slides: settings.screening_slides,
        default_photo_seconds: settings.default_photo_seconds,
        programme_seconds: settings.programme_seconds,
        screening_seconds: settings.screening_seconds,
        reload_requested_at: settings.reload_requested_at,
      },
      slides,
    });
  } catch (error) {
    logError(error, req, { operation: 'get_tv_manifest' });
    res.status(500).json({ error: 'Failed to load the TV manifest' });
  }
});

// A slide's file, with Range support (video seeking, the player's offline cache)
publicRouter.get('/media/:id', async (req, res) => {
  try {
    const slide = await loadSlide(req.params.id);
    if (!slide || slide.status !== 'ready' || !slide.blob_name) return res.status(404).json({ error: 'Not found' });
    if (!movieStorage.isConfigured()) return res.status(503).json({ error: 'Storage is not configured' });

    const size = Number(slide.size) || (await movieStorage.getProperties(slide.blob_name)).contentLength;
    let start = 0;
    let end = size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const partial = !!(range && (range[1] || range[2]));
    if (partial) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.set('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
    }

    const stream = await movieStorage.openBlobRange(slide.blob_name, start, end - start + 1);
    // Headers only now: a storage error above must not be cached for a year
    res.status(partial ? 206 : 200).set({
      'Content-Type': slide.kind === 'photo' ? 'image/jpeg' : 'video/mp4',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      // The URL carries the file version (?v=), so it never changes content
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    if (partial) res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    req.on('close', () => stream.destroy());
    stream.on('error', (error) => {
      logError(error, req, { operation: 'stream_tv_media' });
      res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    logError(error, req, { operation: 'stream_tv_media' });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to read the file' });
    else res.destroy(error);
  }
});

module.exports = { adminRouter, publicRouter };
