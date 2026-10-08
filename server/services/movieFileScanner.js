/**
 * Reconciles a movie's Drive folder contents with the movie_files pointer rows.
 *
 * - Existing rows whose drive_file_id is still present get their metadata
 *   refreshed; rows whose file has disappeared are deleted.
 * - Unoccupied kinds are auto-filled from convention-named files (conservative:
 *   a lone video counts as the movie; *.cs / *.en subtitle files count).
 * - Anything else is returned as "unclassified" for the manual import UI.
 * - Subtitle files whose cached copy is missing or outdated are downloaded
 *   into the subtitle cache, so reads keep working when Drive refuses them.
 * - Azure rows (see movieStorage): Drive only holds their backup/mirror, so
 *   only the drive_file_id pointer is reconciled — the row itself stays.
 * - Drive rows of editions that live in Azure are queued for import.
 */

const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const { readSubtitleText } = require('./subtitleCache');
const movieStorage = require('./movieStorage');
const fileTransferQueue = require('./fileTransferQueue');
const { classifyByName, isDetachedFile, isVideoFile } = require('../utils/movieFileNaming');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { upsertDriveRow: upsertFileRow } = movieStorage;

/**
 * Download into the cache every Drive-stored subtitle file of a movie whose cached copy is
 * missing or doesn't match the row's md5. Per-file failures are logged only.
 */
async function warmSubtitleCache(movieId) {
  const res = await pool.query(
    `SELECT mf.drive_file_id, mf.md5_checksum, mf.file_kind
     FROM movie_files mf
     LEFT JOIN subtitle_file_cache c ON c.drive_file_id = mf.drive_file_id
     WHERE mf.movie_id = $1 AND mf.file_kind LIKE 'subtitles_%'
       AND mf.storage = 'drive' AND mf.md5_checksum IS NOT NULL
       AND c.md5_checksum IS DISTINCT FROM mf.md5_checksum`,
    [movieId]
  );
  for (const row of res.rows) {
    try {
      await readSubtitleText(row.drive_file_id, { expectedMd5: row.md5_checksum });
    } catch (error) {
      logger.warn('[MovieScan] Failed to cache subtitles', {
        movieId,
        fileKind: row.file_kind,
        error: error.message,
      });
    }
  }
}

/**
 * Scan a single movie's Drive folder and reconcile movie_files rows.
 * The subtitle cache is warmed in the background unless opts.awaitCacheWarm.
 * @returns {Promise<{skipped?:boolean, files:object[], unclassified:object[], folder:{id:string}|null}>}
 */
async function scanMovie(movieId, opts = {}) {
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
    const rows = await pool.query(
      'SELECT * FROM movie_files WHERE movie_id = $1 ORDER BY file_kind',
      [movieId]
    );
    return { skipped: true, files: rows.rows, unclassified: [], folder: null };
  }

  const children = await googleDrive.listFolderChildren(movie.drive_folder_id);
  const childById = new Map(children.map((c) => [c.id, c]));

  const existingRes = await pool.query(
    'SELECT * FROM movie_files WHERE movie_id = $1',
    [movieId]
  );

  const occupiedKinds = new Set();
  const classifiedFileIds = new Set();
  // Drive listing entry of each Azure row's Drive copy, for drive_state.
  const driveCopyByKind = new Map();

  // Reconcile existing rows against current Drive contents.
  for (const row of existingRes.rows) {
    if (row.storage === 'azure') {
      occupiedKinds.add(row.file_kind);
      if (!row.drive_file_id) continue;
      const copy = childById.get(row.drive_file_id);
      if (copy) {
        classifiedFileIds.add(copy.id);
        driveCopyByKind.set(row.file_kind, copy);
      } else {
        // Drive copy deleted by hand — the Azure file is still the asset.
        await pool.query(
          'UPDATE movie_files SET drive_file_id = NULL, drive_md5_checksum = NULL WHERE id = $1',
          [row.id]
        );
      }
      continue;
    }
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
  // Detached (*.removed.*) videos don't count against the sole-video rule.
  const videoCount = children.filter(
    (c) => isVideoFile(c.name, c.mimeType) && !isDetachedFile(c.name)
  ).length;
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

  const warming = warmSubtitleCache(movieId).catch((error) =>
    logger.warn('[MovieScan] Subtitle cache warm-up failed', { movieId, error: error.message })
  );
  if (opts.awaitCacheWarm) await warming;

  const filesRes = await pool.query(
    'SELECT * FROM movie_files WHERE movie_id = $1 ORDER BY file_kind',
    [movieId]
  );

  // Editions that live in Azure: import every remaining Drive row (migration,
  // and files dropped into the Drive folder by hand). Failed imports of the
  // same file are retried a day later at the earliest.
  if (movieStorage.importsToAzure(movie)) {
    const hasProxy = filesRes.rows.some((r) => r.file_kind === 'movie_proxy');
    for (const row of filesRes.rows.filter((r) => r.storage === 'drive')) {
      await fileTransferQueue.enqueueImport(row, {
        respectBackoff: true,
        transcodeAfter: row.file_kind === 'movie' && !hasProxy,
      });
    }
  }

  const files = filesRes.rows.map((row) => ({
    ...row,
    drive_state: movieStorage.driveState(row, driveCopyByKind.get(row.file_kind) || null),
  }));
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
    files,
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
      await scanMovie(movie.id, { awaitCacheWarm: true });
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
