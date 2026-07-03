/**
 * Reconciles a movie's Drive folder contents with the movie_files pointer rows.
 *
 * - Existing rows whose drive_file_id is still present get their metadata
 *   refreshed; rows whose file has disappeared are deleted.
 * - Unoccupied kinds are auto-filled from convention-named files (conservative:
 *   a lone video counts as the movie; *.cs / *.en subtitle files count).
 * - Anything else is returned as "unclassified" for the manual import UI.
 */

const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const { classifyByName, isVideoFile } = require('../utils/movieFileNaming');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Refresh/insert a movie_files row from Drive file metadata. */
async function upsertFileRow(movieId, fileKind, file) {
  const size = file.size != null ? parseInt(file.size, 10) : null;
  await pool.query(
    `INSERT INTO movie_files
       (movie_id, file_kind, drive_file_id, file_name, file_size, mime_type,
        md5_checksum, drive_modified_at, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (movie_id, file_kind) DO UPDATE SET
       drive_file_id = EXCLUDED.drive_file_id,
       file_name = EXCLUDED.file_name,
       file_size = EXCLUDED.file_size,
       mime_type = EXCLUDED.mime_type,
       md5_checksum = EXCLUDED.md5_checksum,
       drive_modified_at = EXCLUDED.drive_modified_at,
       last_synced_at = CURRENT_TIMESTAMP`,
    [
      movieId,
      fileKind,
      file.id,
      file.name,
      size,
      file.mimeType || null,
      file.md5Checksum || null,
      file.modifiedTime || null,
    ]
  );
}

/**
 * Scan a single movie's Drive folder and reconcile movie_files rows.
 * @returns {Promise<{skipped?:boolean, files:object[], unclassified:object[], folder:{id:string}|null}>}
 */
async function scanMovie(movieId) {
  const movieRes = await pool.query(
    `SELECT m.id, m.name_cs, m.name_en, m.drive_folder_id, e.year AS edition_year
     FROM movies m JOIN editions e ON m.edition_id = e.id
     WHERE m.id = $1`,
    [movieId]
  );
  if (movieRes.rows.length === 0) {
    const err = new Error('Movie not found');
    err.statusCode = 404;
    throw err;
  }
  const movie = movieRes.rows[0];

  if (!movie.drive_folder_id) {
    return { skipped: true, files: [], unclassified: [], folder: null };
  }

  const children = await googleDrive.listFolderChildren(movie.drive_folder_id);
  const childById = new Map(children.map((c) => [c.id, c]));

  const existingRes = await pool.query(
    'SELECT * FROM movie_files WHERE movie_id = $1',
    [movieId]
  );

  const occupiedKinds = new Set();
  const classifiedFileIds = new Set();

  // Reconcile existing rows against current Drive contents.
  for (const row of existingRes.rows) {
    const file = childById.get(row.drive_file_id);
    if (file) {
      await upsertFileRow(movieId, row.file_kind, file);
      occupiedKinds.add(row.file_kind);
      classifiedFileIds.add(file.id);
    } else {
      // File gone from Drive -> drop the stale pointer.
      await pool.query('DELETE FROM movie_files WHERE id = $1', [row.id]);
    }
  }

  // Auto-classify convention-named files into any still-unoccupied kind.
  const videoCount = children.filter((c) => isVideoFile(c.name, c.mimeType)).length;
  for (const file of children) {
    if (classifiedFileIds.has(file.id)) continue;
    const kind = classifyByName(file.name, file.mimeType, {
      videoCountInFolder: videoCount,
    });
    if (kind && !occupiedKinds.has(kind)) {
      await upsertFileRow(movieId, kind, file);
      occupiedKinds.add(kind);
      classifiedFileIds.add(file.id);
    }
  }

  const filesRes = await pool.query(
    'SELECT * FROM movie_files WHERE movie_id = $1 ORDER BY file_kind',
    [movieId]
  );
  const unclassified = children
    .filter((c) => !classifiedFileIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      mimeType: c.mimeType,
      size: c.size != null ? parseInt(c.size, 10) : null,
      modifiedTime: c.modifiedTime,
    }));

  return {
    files: filesRes.rows,
    unclassified,
    folder: { id: movie.drive_folder_id },
  };
}

/**
 * Scan every movie that has a Drive folder, sequentially, with a small delay
 * and backoff on rate-limit responses. Logs a summary.
 */
async function scanAll() {
  if (!googleDrive.isConfigured()) {
    logger.info('[MovieScan] Skipped: Google Drive not configured');
    return { scanned: 0, errors: 0 };
  }

  const res = await pool.query(
    'SELECT id, name_cs FROM movies WHERE drive_folder_id IS NOT NULL ORDER BY updated_at DESC'
  );
  let scanned = 0;
  let errors = 0;

  for (const movie of res.rows) {
    try {
      await scanMovie(movie.id);
      scanned += 1;
    } catch (error) {
      errors += 1;
      const status = error.code || error.response?.status;
      logger.error('[MovieScan] Failed to scan movie', {
        movieId: movie.id,
        name: movie.name_cs,
        error: error.message,
        status,
      });
      if (status === 403 || status === 429) {
        await sleep(5000); // back off on rate limiting
      }
    }
    await sleep(150);
  }

  logger.info('[MovieScan] Completed', {
    total: res.rows.length,
    scanned,
    errors,
  });
  return { scanned, errors };
}

module.exports = { scanMovie, scanAll, upsertFileRow };
