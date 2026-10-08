/**
 * Subtitle file cache (table subtitle_file_cache, see migration 058).
 *
 * Every subtitle read goes through readSubtitleText(): a cached copy whose md5
 * matches the movie_files row (kept current by the folder scan and by every
 * write) is returned without touching Drive. Otherwise the file is downloaded,
 * decoded and cached. If Drive refuses the download (quota, outage) the last
 * cached copy is returned anyway, flagged stale — its md5 is then the md5 the
 * caller's text corresponds to, so a later save guarded by that md5 detects
 * an edit made on Drive in the meantime.
 *
 * Writers call cacheSubtitleText() with the bytes they uploaded and the md5
 * Drive reported back, so the next read is a hit.
 *
 * Shared with the transcode worker (copied into its image).
 */

const crypto = require('crypto');
const { pool } = require('../models/database');
const googleDrive = require('./googleDrive');
const { decodeSubtitleBuffer } = require('../utils/subtitles');

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

const md5Of = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');

/** Download a Drive file into a bounded buffer (413-style error over the cap). */
async function downloadBuffer(driveFileId) {
  const stream = await googleDrive.downloadFileStream(driveFileId);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > MAX_SUBTITLE_BYTES) {
      if (typeof stream.destroy === 'function') stream.destroy();
      const err = new Error('Subtitles file is too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Store decoded text for a Drive file. md5 should be Drive's md5Checksum of
 * the uploaded bytes; when missing it is computed from `bytes`.
 */
async function cacheSubtitleText(driveFileId, { text, bytes, md5 }) {
  const body = bytes || Buffer.from(text, 'utf8');
  await pool.query(
    `INSERT INTO subtitle_file_cache (drive_file_id, md5_checksum, content, byte_size, cached_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (drive_file_id) DO UPDATE SET
       md5_checksum = EXCLUDED.md5_checksum,
       content = EXCLUDED.content,
       byte_size = EXCLUDED.byte_size,
       cached_at = CURRENT_TIMESTAMP`,
    [driveFileId, md5 || md5Of(body), text != null ? text : decodeSubtitleBuffer(body), body.length]
  );
}

/** Same as cacheSubtitleText but never throws (cache writes are best-effort). */
async function cacheSubtitleTextSafe(driveFileId, entry, onError) {
  try {
    await cacheSubtitleText(driveFileId, entry);
  } catch (error) {
    if (onError) onError(error);
  }
}

/**
 * Read a subtitle file's decoded text.
 * @param {string} driveFileId
 * @param {object} [opts]
 * @param {string|null} [opts.expectedMd5] md5 the caller believes is current;
 *   defaults to the movie_files row's md5 for this Drive file
 * @returns {Promise<{text: string, md5: string, source: 'cache'|'drive'|'stale-cache', driveError?: string}>}
 */
async function readSubtitleText(driveFileId, opts = {}) {
  let expectedMd5 = opts.expectedMd5;
  if (expectedMd5 === undefined) {
    const row = await pool.query(
      'SELECT md5_checksum FROM movie_files WHERE drive_file_id = $1 LIMIT 1',
      [driveFileId]
    );
    expectedMd5 = row.rows[0]?.md5_checksum || null;
  }

  const cachedRes = await pool.query(
    'SELECT md5_checksum, content FROM subtitle_file_cache WHERE drive_file_id = $1',
    [driveFileId]
  );
  const cached = cachedRes.rows[0] || null;
  if (cached && expectedMd5 && cached.md5_checksum === expectedMd5) {
    return { text: cached.content, md5: cached.md5_checksum, source: 'cache' };
  }

  let bytes;
  try {
    bytes = await downloadBuffer(driveFileId);
  } catch (error) {
    if (cached && error.statusCode !== 413) {
      return {
        text: cached.content,
        md5: cached.md5_checksum,
        source: 'stale-cache',
        driveError: error.message,
      };
    }
    throw error;
  }

  const text = decodeSubtitleBuffer(bytes);
  const md5 = md5Of(bytes);
  await cacheSubtitleTextSafe(driveFileId, { text, bytes, md5 });
  return { text, md5, source: 'drive' };
}

module.exports = {
  MAX_SUBTITLE_BYTES,
  readSubtitleText,
  cacheSubtitleText,
  cacheSubtitleTextSafe,
};
