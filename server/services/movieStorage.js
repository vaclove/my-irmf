/**
 * Movie file storage: Azure Blob (primary) with Google Drive as the
 * human-facing backup. See migration 059 for the data model.
 *
 *   masters        Azure Cold  + Drive backup (written by the worker)
 *   movie_proxy    Azure Hot   only
 *   subtitles_*    Azure Hot   + Drive mirror (rewritten on every app write)
 *
 * Rows with storage = 'drive' are legacy files that never moved (older
 * editions); they keep working through the Drive code paths.
 *
 * A "file ref" names one stored file in job tables: 'blob:<blob name>' or a
 * bare Drive file id.
 *
 * Shared with the movie worker (copied into its image).
 *
 * Configuration:
 *   MOVIE_STORAGE_CONNECTION_STRING  connection string of the irmfmovies account
 *   MOVIE_STORAGE_CONTAINER          container name (default 'movies')
 *   MOVIE_STORAGE_MIN_YEAR           Drive files of editions from this year on
 *                                    are imported into Azure (default 2026)
 */

const crypto = require('crypto');
const { Transform, pipeline } = require('stream');
const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');
const { pool } = require('../models/database');
const googleDrive = require('./googleDrive');
const { readSubtitleText } = require('./subtitleCache');
const { decodeSubtitleBuffer } = require('../utils/subtitles');
const { conventionFileName, extensionOf } = require('../utils/movieFileNaming');

const BLOB_PREFIX = 'blob:';
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const STREAM_BLOCK_SIZE = 8 * 1024 * 1024;
const STREAM_CONCURRENCY = 4;

let containerClient = null;

function connectionString() {
  return process.env.MOVIE_STORAGE_CONNECTION_STRING || null;
}

function isConfigured() {
  return !!connectionString();
}

function containerName() {
  return process.env.MOVIE_STORAGE_CONTAINER || 'movies';
}

function minYear() {
  return parseInt(process.env.MOVIE_STORAGE_MIN_YEAR || '2026', 10);
}

function getContainer() {
  if (!containerClient) {
    containerClient = BlobServiceClient.fromConnectionString(connectionString()).getContainerClient(
      containerName()
    );
  }
  return containerClient;
}

function blockBlob(blobName) {
  return getContainer().getBlockBlobClient(blobName);
}

/** Masters are read rarely after the preview exists: Cold. Everything else: Hot. */
function tierFor(fileKind) {
  return fileKind === 'movie' ? 'Cold' : 'Hot';
}

/** Should this movie's Drive files be imported into Azure? */
function importsToAzure(movie) {
  return isConfigured() && Number(movie.edition_year) >= minYear();
}

/**
 * Where a new or rewritten file of this movie goes: Azure, except legacy Drive
 * rows of editions that stay on Drive.
 */
function targetStorage(movie, existingRow) {
  if (!isConfigured()) return 'drive';
  if (existingRow?.storage === 'drive' && !importsToAzure(movie)) return 'drive';
  return 'azure';
}

/** {year}/{movieId}/{UTC stamp}-{convention name}: unique per upload. */
function blobNameFor(movie, fileKind, ext) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${movie.edition_year || 'unknown'}/${movie.id}/${stamp}-${conventionFileName(movie, fileKind, ext)}`;
}

/** Does a blob name belong to this movie (guards client-supplied names)? */
function blobBelongsTo(movie, blobName) {
  return (
    typeof blobName === 'string' &&
    blobName.startsWith(`${movie.edition_year || 'unknown'}/${movie.id}/`) &&
    !blobName.includes('..')
  );
}

function fileRef(row) {
  return row.storage === 'azure' ? BLOB_PREFIX + row.blob_name : row.drive_file_id;
}

function parseRef(ref) {
  return String(ref).startsWith(BLOB_PREFIX)
    ? { type: 'blob', name: String(ref).slice(BLOB_PREFIX.length) }
    : { type: 'drive', id: String(ref) };
}

/** The file name a blob was stored under, without the upload stamp. */
function displayName(blobName) {
  return blobName.split('/').pop().replace(/^\d{14}-/, '');
}

const md5Hex = (buffer) => crypto.createHash('md5').update(buffer).digest('hex');
const base64ToHex = (b) => (b ? Buffer.from(b).toString('hex') : null);

// ---------------------------------------------------------------------------
// Blob primitives
// ---------------------------------------------------------------------------

/** Read-only SAS URL for one blob (player, ffmpeg, downloads). */
async function readUrl(blobName, { expiresInSec = 6 * 3600, downloadName } = {}) {
  return blockBlob(blobName).generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(Date.now() - 5 * 60 * 1000),
    expiresOn: new Date(Date.now() + expiresInSec * 1000),
    contentDisposition: downloadName
      ? `attachment; filename="${downloadName.replace(/["\\]/g, '_')}"`
      : undefined,
  });
}

/** Create/write SAS URL for one new blob (browser uploads). */
async function uploadUrl(blobName, { expiresInSec = 24 * 3600 } = {}) {
  return blockBlob(blobName).generateSasUrl({
    permissions: BlobSASPermissions.parse('cw'),
    startsOn: new Date(Date.now() - 5 * 60 * 1000),
    expiresOn: new Date(Date.now() + expiresInSec * 1000),
  });
}

async function getProperties(blobName) {
  return blockBlob(blobName).getProperties();
}

/** Upload a small buffer (subtitles); returns {etag, md5, size}. */
async function uploadBuffer(blobName, buffer, { fileKind, contentType, ifMatch } = {}) {
  const md5 = crypto.createHash('md5').update(buffer).digest();
  const res = await blockBlob(blobName).upload(buffer, buffer.length, {
    tier: tierFor(fileKind),
    blobHTTPHeaders: { blobContentType: contentType, blobContentMD5: md5 },
    conditions: ifMatch ? { ifMatch } : undefined,
  });
  return { etag: res.etag, md5: md5.toString('hex'), size: buffer.length };
}

/**
 * Stream into a blob in blocks (masters, proxies). Computes the md5 on the
 * way and stores it as the blob's Content-MD5. Returns {etag, md5, size}.
 */
async function uploadStream(blobName, readable, { fileKind, contentType, onProgress, abortSignal } = {}) {
  const hash = crypto.createHash('md5');
  let size = 0;
  // Hash in a pass-through so the SDK stays the stream's only consumer.
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
  });
  pipeline(readable, tap, (err) => {
    if (err) tap.destroy(err);
  });
  const client = blockBlob(blobName);
  await client.uploadStream(tap, STREAM_BLOCK_SIZE, STREAM_CONCURRENCY, {
    tier: tierFor(fileKind),
    blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' },
    onProgress: onProgress ? (ev) => onProgress(ev.loadedBytes) : undefined,
    abortSignal,
  });
  const md5 = hash.digest();
  const res = await client.setHTTPHeaders({
    blobContentType: contentType || 'application/octet-stream',
    blobContentMD5: md5,
  });
  return { etag: res.etag, md5: md5.toString('hex'), size };
}

async function openBlobStream(blobName) {
  const res = await blockBlob(blobName).download(0);
  return res.readableStreamBody;
}

/** Delete a blob (account soft delete keeps it recoverable for 14 days). */
async function deleteBlob(blobName) {
  if (!blobName) return;
  await blockBlob(blobName).deleteIfExists({ deleteSnapshots: 'include' });
}

// ---------------------------------------------------------------------------
// Reads by row / ref
// ---------------------------------------------------------------------------

/** Read a stored file into a bounded buffer. */
async function readBuffer(ref, { maxBytes = MAX_SUBTITLE_BYTES } = {}) {
  const parsed = parseRef(ref);
  if (parsed.type === 'blob') {
    const props = await getProperties(parsed.name);
    if (props.contentLength > maxBytes) {
      throw Object.assign(new Error('Subtitles file is too large'), { statusCode: 413 });
    }
    return blockBlob(parsed.name).downloadToBuffer();
  }
  const stream = await googleDrive.downloadFileStream(parsed.id);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > maxBytes) {
      if (typeof stream.destroy === 'function') stream.destroy();
      throw Object.assign(new Error('Subtitles file is too large'), { statusCode: 413 });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Decoded subtitle text of a stored file. Azure reads go straight to the blob
 * (reliable, no quotas); Drive reads go through the subtitle cache.
 * @returns {Promise<{text: string, md5: string, source: string, driveError?: string}>}
 */
async function readSubtitleRef(ref, { expectedMd5 } = {}) {
  const parsed = parseRef(ref);
  if (parsed.type === 'blob') {
    const buffer = await readBuffer(ref);
    return { text: decodeSubtitleBuffer(buffer), md5: md5Hex(buffer), source: 'azure' };
  }
  return readSubtitleText(parsed.id, expectedMd5 === undefined ? {} : { expectedMd5 });
}

function readSubtitleRow(row) {
  return readSubtitleRef(fileRef(row), { expectedMd5: row.md5_checksum || null });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * Point a movie_files row at a blob. `drive`: undefined keeps the current
 * Drive copy fields, null clears them, {id, md5} sets them.
 */
async function upsertAzureRow(movieId, fileKind, { blobName, fileName, size, mimeType, md5, etag, drive }) {
  const keepDrive = drive === undefined;
  await pool.query(
    `INSERT INTO movie_files
       (movie_id, file_kind, storage, blob_name, blob_etag, file_name, file_size, mime_type,
        md5_checksum, drive_file_id, drive_md5_checksum, drive_modified_at, last_synced_at)
     VALUES ($1, $2, 'azure', $3, $4, $5, $6, $7, $8, $9, $10, NULL, CURRENT_TIMESTAMP)
     ON CONFLICT (movie_id, file_kind) DO UPDATE SET
       storage = 'azure',
       blob_name = EXCLUDED.blob_name,
       blob_etag = EXCLUDED.blob_etag,
       file_name = EXCLUDED.file_name,
       file_size = EXCLUDED.file_size,
       mime_type = EXCLUDED.mime_type,
       md5_checksum = EXCLUDED.md5_checksum,
       drive_file_id = CASE WHEN $11::boolean THEN movie_files.drive_file_id ELSE EXCLUDED.drive_file_id END,
       drive_md5_checksum = CASE WHEN $11::boolean THEN movie_files.drive_md5_checksum ELSE EXCLUDED.drive_md5_checksum END,
       last_synced_at = CURRENT_TIMESTAMP`,
    [
      movieId,
      fileKind,
      blobName,
      etag || null,
      fileName,
      size != null ? Number(size) : null,
      mimeType || null,
      md5 || null,
      keepDrive ? null : drive?.id || null,
      keepDrive ? null : drive?.md5 || null,
      keepDrive,
    ]
  );
}

/**
 * Refresh/insert a movie_files row from Drive file metadata. Never touches
 * an Azure row (a scan working from an older snapshot, or a legacy write
 * racing an import, must not flip it back to Drive and leak its blob).
 */
async function upsertDriveRow(movieId, fileKind, file) {
  const size = file.size != null ? parseInt(file.size, 10) : null;
  await pool.query(
    `INSERT INTO movie_files
       (movie_id, file_kind, drive_file_id, file_name, file_size, mime_type,
        md5_checksum, drive_modified_at, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (movie_id, file_kind) DO UPDATE SET
       storage = 'drive',
       blob_name = NULL,
       blob_etag = NULL,
       drive_md5_checksum = NULL,
       drive_file_id = EXCLUDED.drive_file_id,
       file_name = EXCLUDED.file_name,
       file_size = EXCLUDED.file_size,
       mime_type = EXCLUDED.mime_type,
       md5_checksum = EXCLUDED.md5_checksum,
       drive_modified_at = EXCLUDED.drive_modified_at,
       last_synced_at = CURRENT_TIMESTAMP
     WHERE movie_files.storage = 'drive'`,
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

async function loadRow(movieId, fileKind) {
  const res = await pool.query('SELECT * FROM movie_files WHERE movie_id = $1 AND file_kind = $2', [
    movieId,
    fileKind,
  ]);
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Subtitle writes (shared by routes, translator and the sync worker)
// ---------------------------------------------------------------------------

function subtitleMime(ext) {
  return ext === 'vtt' ? 'text/vtt' : 'application/x-subrip';
}

/**
 * Write a subtitle file for a movie + kind and update its row.
 *
 * Azure: the blob is rewritten in place when the format is unchanged
 * (optionally guarded by ifMatch), otherwise a new blob replaces the old one;
 * the Drive mirror is then rewritten (same Drive file when one exists).
 * Mirror failures are reported via onMirrorError and leave the previous Drive
 * fields, so the row shows the Drive copy as outdated rather than lying.
 *
 * Legacy Drive rows of editions that stay on Drive are updated in place.
 *
 * @returns {Promise<object>} the fresh movie_files row
 */
async function writeSubtitleFile(movie, fileKind, body, { ext = 'srt', ifMatch, onMirrorError } = {}) {
  const existing = await loadRow(movie.id, fileKind);
  const mime = subtitleMime(ext);

  if (targetStorage(movie, existing) === 'drive') {
    let meta;
    if (existing?.storage === 'drive' && extensionOf(existing.file_name) === ext) {
      meta = await googleDrive.updateFileContent({ fileId: existing.drive_file_id, mimeType: mime, body });
    } else {
      const folderId = await googleDrive.ensureMovieFolder(movie);
      meta = await googleDrive.uploadSmallFile({
        folderId,
        name: conventionFileName(movie, fileKind, ext),
        mimeType: mime,
        body,
      });
      if (existing?.drive_file_id && existing.drive_file_id !== meta.id) {
        await googleDrive.trashFile(existing.drive_file_id).catch(() => {});
      }
    }
    await upsertDriveRow(movie.id, fileKind, meta);
    return loadRow(movie.id, fileKind);
  }

  const sameBlob =
    existing?.storage === 'azure' && extensionOf(existing.blob_name) === ext ? existing.blob_name : null;
  const blobName = sameBlob || blobNameFor(movie, fileKind, ext);
  const written = await uploadBuffer(blobName, body, {
    fileKind,
    contentType: `${mime}; charset=utf-8`,
    ifMatch: sameBlob ? ifMatch : undefined,
  });

  // Drive mirror: rewrite the existing copy, or create one.
  let drive;
  try {
    const driveId = existing?.drive_file_id || null;
    let meta;
    if (driveId && extensionOf(existing.storage === 'azure' ? existing.blob_name : existing.file_name) === ext) {
      meta = await googleDrive.updateFileContent({ fileId: driveId, mimeType: mime, body });
    } else {
      const folderId = await googleDrive.ensureMovieFolder(movie);
      meta = await googleDrive.uploadSmallFile({
        folderId,
        name: conventionFileName(movie, fileKind, ext),
        mimeType: mime,
        body,
      });
      if (driveId && driveId !== meta.id) await googleDrive.trashFile(driveId).catch(() => {});
    }
    drive = { id: meta.id, md5: meta.md5Checksum || written.md5 };
  } catch (mirrorError) {
    drive = undefined; // keep the previous Drive fields
    if (onMirrorError) onMirrorError(mirrorError);
  }

  await upsertAzureRow(movie.id, fileKind, {
    blobName,
    fileName: conventionFileName(movie, fileKind, ext),
    size: written.size,
    mimeType: mime,
    md5: written.md5,
    etag: written.etag,
    drive,
  });
  if (existing?.storage === 'azure' && existing.blob_name !== blobName) {
    await deleteBlob(existing.blob_name).catch(() => {});
  }
  return loadRow(movie.id, fileKind);
}

/**
 * State of an Azure row's Drive copy, given the current Drive listing entry
 * (or null when the row has none / it is gone):
 *   'none'      no Drive copy
 *   'changed'   the Drive copy was edited outside the app
 *   'outdated'  the app's latest version hasn't reached Drive yet
 *   'in_sync'
 */
function driveState(row, driveFile) {
  if (row.storage !== 'azure') return null;
  if (!row.drive_file_id || !driveFile) return 'none';
  if (driveFile.md5Checksum && row.drive_md5_checksum && driveFile.md5Checksum !== row.drive_md5_checksum) {
    return 'changed';
  }
  // Unknown md5 (a browser-uploaded master before its backup ran) can't be
  // proven to match the Drive copy.
  if (!row.md5_checksum || (row.drive_md5_checksum && row.md5_checksum !== row.drive_md5_checksum)) {
    return 'outdated';
  }
  return 'in_sync';
}

module.exports = {
  MAX_SUBTITLE_BYTES,
  isConfigured,
  minYear,
  tierFor,
  importsToAzure,
  targetStorage,
  blobNameFor,
  blobBelongsTo,
  fileRef,
  parseRef,
  displayName,
  base64ToHex,
  readUrl,
  uploadUrl,
  getProperties,
  uploadBuffer,
  uploadStream,
  openBlobStream,
  deleteBlob,
  readBuffer,
  readSubtitleRef,
  readSubtitleRow,
  upsertAzureRow,
  upsertDriveRow,
  loadRow,
  subtitleMime,
  writeSubtitleFile,
  driveState,
};
