/**
 * Per-movie Drive file management: /api/movies/:movieId/files
 *
 * Mounted with mergeParams so :movieId is available. Drive-dependent endpoints
 * return 503 when Google Drive is not configured; GET degrades to DB rows with
 * a drive_error flag so the UI always renders known status.
 */

const express = require('express');
const { pool } = require('../models/database');
const { logError } = require('../utils/logger');
const googleDrive = require('../services/googleDrive');
const { proxyDriveMedia } = require('../services/driveMediaProxy');
const transcodeQueue = require('../services/transcodeQueue');
const { convertSrtToVtt, decodeSubtitleBuffer } = require('../utils/subtitles');
const { scanMovie, upsertFileRow } = require('../services/movieFileScanner');
const {
  conventionFileName,
  extensionOf,
  isVideoFile,
  SUBTITLE_EXTENSIONS,
  FILE_KINDS,
} = require('../utils/movieFileNaming');

const router = express.Router({ mergeParams: true });

const SUBTITLE_KINDS = ['subtitles_cs', 'subtitles_en'];
// File kinds that are playable video and can be streamed to the browser.
const STREAMABLE_KINDS = ['movie', 'movie_proxy'];

function notConfigured(res) {
  return res.status(503).json({ error: 'Google Drive is not configured' });
}

/**
 * Ensure a file's type matches the kind slot it will occupy:
 * subtitle kinds require .srt/.vtt; the movie kind requires a video file.
 * Returns an error string, or null if valid.
 */
function validateKindForFile(fileKind, fileName, mimeType) {
  const ext = extensionOf(fileName);
  if (SUBTITLE_KINDS.includes(fileKind) && !SUBTITLE_EXTENSIONS.includes(ext)) {
    return 'Subtitles must be .srt or .vtt';
  }
  if (fileKind === 'movie' && !isVideoFile(fileName, mimeType)) {
    return 'Movie asset must be a video file';
  }
  if (fileKind === 'movie_proxy' && ext !== 'mp4') {
    return 'Preview proxy must be an .mp4';
  }
  return null;
}

/** Load a movie row with edition_year, or null. */
async function loadMovie(movieId) {
  const res = await pool.query(
    `SELECT m.id, m.name_cs, m.name_en, m.drive_folder_id, e.year AS edition_year
     FROM movies m JOIN editions e ON m.edition_id = e.id
     WHERE m.id = $1`,
    [movieId]
  );
  return res.rows[0] || null;
}

function subtitleMime(ext) {
  return ext === 'vtt' ? 'text/vtt' : 'application/x-subrip';
}

// GET / — DB rows always; live folder listing + unclassified when Drive is up.
router.get('/', async (req, res) => {
  const { movieId } = req.params;
  try {
    const movie = await loadMovie(movieId);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });

    if (!googleDrive.isConfigured()) {
      const dbRows = await pool.query(
        'SELECT * FROM movie_files WHERE movie_id = $1 ORDER BY file_kind',
        [movieId]
      );
      return res.json({
        files: dbRows.rows,
        folder: movie.drive_folder_id ? { id: movie.drive_folder_id } : null,
        unclassified: [],
        drive_configured: false,
      });
    }

    // Live scan reconciles rows and surfaces unclassified files.
    try {
      const result = await scanMovie(movieId);
      return res.json({ ...result, drive_configured: true });
    } catch (driveError) {
      logError(driveError, req, { operation: 'movie_files_scan', movieId });
      const dbRows = await pool.query(
        'SELECT * FROM movie_files WHERE movie_id = $1 ORDER BY file_kind',
        [movieId]
      );
      return res.json({
        files: dbRows.rows,
        folder: movie.drive_folder_id ? { id: movie.drive_folder_id } : null,
        unclassified: [],
        drive_configured: true,
        drive_error: driveError.message,
      });
    }
  } catch (error) {
    logError(error, req, { operation: 'get_movie_files', movieId });
    res.status(500).json({ error: error.message });
  }
});

// POST /folder — ensure the Drive folder exists for this movie.
router.post('/folder', async (req, res) => {
  const { movieId } = req.params;
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const movie = await loadMovie(movieId);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    const folderId = await googleDrive.ensureMovieFolder(movie);
    res.json({ folder: { id: folderId } });
  } catch (error) {
    logError(error, req, { operation: 'ensure_movie_folder', movieId });
    res.status(500).json({ error: error.message });
  }
});

// POST /rescan — reconcile rows against Drive on demand.
router.post('/rescan', async (req, res) => {
  const { movieId } = req.params;
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const result = await scanMovie(movieId);
    res.json({ ...result, drive_configured: true });
  } catch (error) {
    logError(error, req, { operation: 'rescan_movie_files', movieId });
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// POST /upload-session — create a resumable session for a big file upload.
router.post('/upload-session', async (req, res) => {
  const { movieId } = req.params;
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const { file_kind, file_name, file_size, mime_type } = req.body;
    if (!FILE_KINDS.includes(file_kind)) {
      return res.status(400).json({ error: 'Invalid file_kind' });
    }
    const kindError = validateKindForFile(file_kind, file_name, mime_type);
    if (kindError) return res.status(400).json({ error: kindError });

    const movie = await loadMovie(movieId);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });

    const folderId = await googleDrive.ensureMovieFolder(movie);
    const ext = extensionOf(file_name) || 'bin';
    const targetName = conventionFileName(movie, file_kind, ext);
    const origin = req.get('origin') || process.env.APP_URL;

    const uploadUrl = await googleDrive.createResumableSession({
      folderId,
      name: targetName,
      mimeType: mime_type,
      size: file_size,
      origin,
    });
    res.json({ upload_url: uploadUrl, target_name: targetName });
  } catch (error) {
    logError(error, req, { operation: 'create_upload_session', movieId });
    res.status(500).json({ error: error.message });
  }
});

// POST /upload-complete — verify the uploaded file and record the pointer row.
router.post('/upload-complete', async (req, res) => {
  const { movieId } = req.params;
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const { file_kind, drive_file_id } = req.body;
    if (!FILE_KINDS.includes(file_kind)) {
      return res.status(400).json({ error: 'Invalid file_kind' });
    }
    if (!drive_file_id) {
      return res.status(400).json({ error: 'drive_file_id is required' });
    }
    const movie = await loadMovie(movieId);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    if (!movie.drive_folder_id) {
      return res.status(400).json({ error: 'Movie has no Drive folder' });
    }

    const meta = await googleDrive.getFileMetadata(drive_file_id);
    // Only record files that actually live in this movie's folder.
    if (!meta.parents || !meta.parents.includes(movie.drive_folder_id)) {
      return res.status(400).json({ error: 'File is not in this movie folder' });
    }
    const kindError = validateKindForFile(file_kind, meta.name, meta.mimeType);
    if (kindError) return res.status(400).json({ error: kindError });

    await upsertFileRow(movieId, file_kind, meta);
    // A newly-uploaded master gets a preview proxy generated automatically.
    // Awaited so the job row exists before we respond (the client reloads the
    // player right after and needs to see the pending job to start polling).
    if (file_kind === 'movie') {
      await transcodeQueue.enqueueForMovie(movieId, req.user?.email);
    }
    const row = await pool.query(
      'SELECT * FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, file_kind]
    );
    res.json({ file: row.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'upload_complete', movieId });
    res.status(500).json({ error: error.message });
  }
});

// POST /subtitles — small subtitle upload through the backend (base64).
router.post('/subtitles', async (req, res) => {
  const { movieId } = req.params;
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const { file_kind, file_name, content_base64 } = req.body;
    if (!SUBTITLE_KINDS.includes(file_kind)) {
      return res.status(400).json({ error: 'file_kind must be a subtitle kind' });
    }
    const ext = extensionOf(file_name);
    if (!SUBTITLE_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: 'Subtitles must be .srt or .vtt' });
    }
    if (!content_base64) {
      return res.status(400).json({ error: 'content_base64 is required' });
    }

    const movie = await loadMovie(movieId);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });

    const folderId = await googleDrive.ensureMovieFolder(movie);
    const targetName = conventionFileName(movie, file_kind, ext);
    const body = Buffer.from(content_base64, 'base64');

    const created = await googleDrive.uploadSmallFile({
      folderId,
      name: targetName,
      mimeType: subtitleMime(ext),
      body,
    });
    await upsertFileRow(movieId, file_kind, created);
    const row = await pool.query(
      'SELECT * FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, file_kind]
    );
    res.json({ file: row.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'upload_subtitles', movieId });
    res.status(500).json({ error: error.message });
  }
});

// POST /import — classify a file already sitting in the movie folder.
router.post('/import', async (req, res) => {
  const { movieId } = req.params;
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const { drive_file_id, file_kind, rename, replace } = req.body;
    if (!FILE_KINDS.includes(file_kind)) {
      return res.status(400).json({ error: 'Invalid file_kind' });
    }
    if (!drive_file_id) {
      return res.status(400).json({ error: 'drive_file_id is required' });
    }
    const movie = await loadMovie(movieId);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    if (!movie.drive_folder_id) {
      return res.status(400).json({ error: 'Movie has no Drive folder' });
    }

    let meta = await googleDrive.getFileMetadata(drive_file_id);
    if (!meta.parents || !meta.parents.includes(movie.drive_folder_id)) {
      return res
        .status(400)
        .json({ error: 'File is not in this movie folder' });
    }
    const kindError = validateKindForFile(file_kind, meta.name, meta.mimeType);
    if (kindError) return res.status(400).json({ error: kindError });

    // 409 if the kind is already occupied, unless replace is requested.
    const occupied = await pool.query(
      'SELECT id, drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, file_kind]
    );
    if (occupied.rows.length > 0 && occupied.rows[0].drive_file_id !== drive_file_id && !replace) {
      return res.status(409).json({ error: 'This asset kind is already set' });
    }

    if (rename) {
      const ext = extensionOf(meta.name) || 'bin';
      const targetName = conventionFileName(movie, file_kind, ext);
      if (targetName !== meta.name) {
        meta = await googleDrive.renameFile(drive_file_id, targetName);
        meta = await googleDrive.getFileMetadata(drive_file_id);
      }
    }

    await upsertFileRow(movieId, file_kind, meta);
    // Importing a master as the movie kicks off proxy generation. Awaited so the
    // job row exists before we respond (the client reloads the player right after
    // and needs to see the pending job to start polling).
    if (file_kind === 'movie') {
      await transcodeQueue.enqueueForMovie(movieId, req.user?.email);
    }
    const row = await pool.query(
      'SELECT * FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, file_kind]
    );
    res.json({ file: row.rows[0] });
  } catch (error) {
    logError(error, req, { operation: 'import_movie_file', movieId });
    res.status(500).json({ error: error.message });
  }
});

// GET /stream/:fileKind — proxy the movie/proxy file bytes with Range support.
router.get('/stream/:fileKind', async (req, res) => {
  const { movieId, fileKind } = req.params;
  if (!STREAMABLE_KINDS.includes(fileKind)) {
    return res.status(400).json({ error: 'Not a streamable file kind' });
  }
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const row = await pool.query(
      'SELECT drive_file_id, mime_type FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, fileKind]
    );
    if (row.rows.length === 0) return res.status(404).json({ error: 'File not found' });
    await proxyDriveMedia(req, res, row.rows[0].drive_file_id, row.rows[0].mime_type || 'video/mp4');
  } catch (error) {
    logError(error, req, { operation: 'stream_movie_file', movieId });
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// GET /subtitles/:lang — download the subtitle from Drive and serve it as VTT.
router.get('/subtitles/:lang', async (req, res) => {
  const { movieId, lang } = req.params;
  const cleanLang = String(lang).replace(/\.vtt$/i, '');
  if (!['cs', 'en'].includes(cleanLang)) {
    return res.status(400).json({ error: 'Unsupported subtitle language' });
  }
  if (!googleDrive.isConfigured()) return notConfigured(res);
  try {
    const row = await pool.query(
      'SELECT drive_file_id, file_name FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, `subtitles_${cleanLang}`]
    );
    if (row.rows.length === 0) return res.status(404).json({ error: 'Subtitles not found' });

    const stream = await googleDrive.downloadFileStream(row.rows[0].drive_file_id);
    const chunks = [];
    let bytes = 0;
    const maxSubtitleBytes = 2 * 1024 * 1024;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      if (bytes > maxSubtitleBytes) {
        if (typeof stream.destroy === 'function') stream.destroy();
        return res.status(413).json({ error: 'Subtitles file is too large' });
      }
      chunks.push(buf);
    }
    const text = decodeSubtitleBuffer(Buffer.concat(chunks));
    const vtt = extensionOf(row.rows[0].file_name) === 'vtt' ? text : convertSrtToVtt(text);

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.send(vtt);
  } catch (error) {
    logError(error, req, { operation: 'get_subtitles', movieId });
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// DELETE /:fileKind — drop the pointer row; optionally trash the Drive file.
router.delete('/:fileKind', async (req, res) => {
  const { movieId, fileKind } = req.params;
  const removeFromDrive = req.query.remove_from_drive === 'true';
  try {
    if (!FILE_KINDS.includes(fileKind)) {
      return res.status(400).json({ error: 'Invalid file kind' });
    }
    const existing = await pool.query(
      'SELECT * FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, fileKind]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (removeFromDrive) {
      if (!googleDrive.isConfigured()) return notConfigured(res);
      await googleDrive.trashFile(existing.rows[0].drive_file_id);
    }

    await pool.query(
      'DELETE FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [movieId, fileKind]
    );
    res.json({ message: 'File removed', trashed: removeFromDrive });
  } catch (error) {
    logError(error, req, { operation: 'delete_movie_file', movieId });
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
