/**
 * Temporary export storage: movies with burned-in subtitles, kept only long
 * enough to be downloaded to the screening laptop. A private container in the
 * movie storage account (irmfmovies); an account lifecycle rule deletes the
 * blobs (see docs/TRANSCODER_SETUP.md), and RETENTION_DAYS must match it.
 *
 *   {container}/full/{year}/{movieId}/{stamp}-{name}      deleted after 20 days
 *   {container}/preview/{year}/{movieId}/{stamp}-{name}   deleted after 3 days
 *
 * Shared with the movie worker (copied into its image).
 *
 * Configuration:
 *   MOVIE_STORAGE_CONNECTION_STRING  connection string of the irmfmovies account
 *   MOVIE_EXPORT_CONTAINER           container name (default 'exports')
 */

const { BlobServiceClient, BlobSASPermissions } = require('@azure/storage-blob');

const RETENTION_DAYS = { full: 20, preview: 3 };
const STREAM_BLOCK_SIZE = 8 * 1024 * 1024;
const STREAM_CONCURRENCY = 4;

let containerClient = null;
let ensured = false;

function connectionString() {
  return process.env.MOVIE_STORAGE_CONNECTION_STRING || null;
}

function isConfigured() {
  return !!connectionString();
}

function getContainer() {
  if (!containerClient) {
    containerClient = BlobServiceClient.fromConnectionString(connectionString()).getContainerClient(
      process.env.MOVIE_EXPORT_CONTAINER || 'exports'
    );
  }
  return containerClient;
}

async function ensureContainer() {
  if (ensured) return;
  await getContainer().createIfNotExists(); // private: no public access
  ensured = true;
}

function blobNameFor(movie, kind, fileName) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${kind}/${movie.edition_year || 'unknown'}/${movie.id}/${stamp}-${fileName}`;
}

/**
 * Read-only SAS URL. `downloadName` makes it a download (attachment) with
 * that file name; without it the browser may play it inline.
 */
async function readUrl(blobName, { expiresInSec = 24 * 3600, downloadName } = {}) {
  let contentDisposition;
  if (downloadName) {
    const ascii = downloadName.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_');
    contentDisposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  }
  return getContainer()
    .getBlockBlobClient(blobName)
    .generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(Date.now() - 5 * 60 * 1000),
      expiresOn: new Date(Date.now() + expiresInSec * 1000),
      contentDisposition,
    });
}

/** Stream into a Hot blob in blocks; returns {size}. */
async function uploadStream(blobName, readable, { contentType = 'video/mp4', onProgress, abortSignal } = {}) {
  await ensureContainer();
  let size = 0;
  await getContainer()
    .getBlockBlobClient(blobName)
    .uploadStream(readable, STREAM_BLOCK_SIZE, STREAM_CONCURRENCY, {
      tier: 'Hot',
      blobHTTPHeaders: { blobContentType: contentType },
      onProgress: (ev) => {
        size = ev.loadedBytes;
        if (onProgress) onProgress(ev.loadedBytes);
      },
      abortSignal,
    });
  return { size };
}

async function deleteBlob(blobName) {
  if (!blobName) return;
  await getContainer().getBlockBlobClient(blobName).deleteIfExists({ deleteSnapshots: 'include' });
}

module.exports = {
  RETENTION_DAYS,
  isConfigured,
  blobNameFor,
  readUrl,
  uploadStream,
  deleteBlob,
};
