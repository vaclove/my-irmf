/**
 * In-process download-job runner: pulls a file from a public Google Drive link
 * or an FTP URL and streams it into Azure Blob (editions stored there; masters
 * then get their Drive backup from the worker) or the movie's Drive folder
 * (legacy editions), without ever touching local disk.
 *
 * At most 2 jobs run concurrently. Cancellation is checked between chunks.
 * On boot, any pending/running jobs left over from a crash are marked
 * 'interrupted' (retryable).
 */

const { PassThrough } = require('stream');
const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const { conventionFileName, extensionOf } = require('../utils/movieFileNaming');
const { upsertFileRow } = require('./movieFileScanner');
const { uploadStreamToDrive } = require('./driveChunkedUpload');
const transcodeQueue = require('./transcodeQueue');
const movieStorage = require('./movieStorage');
const fileTransferQueue = require('./fileTransferQueue');

const MAX_CONCURRENT = 2;

class MovieDownloader {
  constructor() {
    this.queue = [];
    this.running = new Set();
    this.cancelFlags = new Set();
  }

  /** Mark orphaned jobs from a previous process as interrupted. */
  async markInterruptedJobs() {
    try {
      const res = await pool.query(
        `UPDATE movie_download_jobs SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'running') RETURNING id`
      );
      if (res.rowCount > 0) {
        logger.info('[MovieDownloader] Marked stale jobs interrupted', {
          count: res.rowCount,
        });
      }
    } catch (error) {
      logger.error('[MovieDownloader] markInterruptedJobs failed', {
        error: error.message,
      });
    }
  }

  enqueue(jobId) {
    this.queue.push(jobId);
    this.pump();
  }

  cancel(jobId) {
    this.cancelFlags.add(jobId);
  }

  pump() {
    while (this.running.size < MAX_CONCURRENT && this.queue.length > 0) {
      const jobId = this.queue.shift();
      this.running.add(jobId);
      this.runJob(jobId)
        .catch((error) => {
          logger.error('[MovieDownloader] job crashed', {
            jobId,
            error: error.message,
          });
        })
        .finally(() => {
          this.running.delete(jobId);
          this.cancelFlags.delete(jobId);
          this.pump();
        });
    }
  }

  isCancelled(jobId) {
    return this.cancelFlags.has(jobId);
  }

  async runJob(jobId) {
    const jobRes = await pool.query('SELECT * FROM movie_download_jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) return;
    const job = jobRes.rows[0];

    if (!googleDrive.isConfigured()) {
      await this.fail(jobId, 'Google Drive is not configured');
      return;
    }

    await pool.query(
      `UPDATE movie_download_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP,
         bytes_transferred = 0, error_message = NULL WHERE id = $1`,
      [jobId]
    );

    try {
      const movieRes = await pool.query(
        `SELECT m.id, m.name_cs, m.name_en, m.drive_folder_id, e.year AS edition_year
         FROM movies m JOIN editions e ON m.edition_id = e.id WHERE m.id = $1`,
        [job.movie_id]
      );
      if (movieRes.rows.length === 0) throw new Error('Movie not found');
      const movie = movieRes.rows[0];

      // Resolve the source stream + metadata.
      const source =
        job.source_type === 'gdrive'
          ? await this.openDriveSource(job.source_url)
          : await this.openFtpSource(job.source_url);

      const ext = extensionOf(source.name) || 'bin';
      const targetName = conventionFileName(movie, job.file_kind, ext);
      const total = source.size != null ? Number(source.size) : null;

      const existing = await movieStorage.loadRow(job.movie_id, job.file_kind);
      if (movieStorage.targetStorage(movie, existing) === 'azure') {
        await this.runAzureJob(job, { movie, source, ext, targetName, total, existing });
        return;
      }

      const folderId = await googleDrive.ensureMovieFolder(movie);
      const sessionUrl = await googleDrive.createResumableSession({
        folderId,
        name: targetName,
        mimeType: source.mimeType || 'application/octet-stream',
        size: total,
      });

      await pool.query(
        'UPDATE movie_download_jobs SET bytes_total = $2, target_file_name = $3 WHERE id = $1',
        [jobId, total, targetName]
      );

      const driveFileId = await uploadStreamToDrive({
        readable: source.stream,
        sessionUrl,
        total,
        onProgress: async (n) => {
          try {
            await pool.query(
              'UPDATE movie_download_jobs SET bytes_transferred = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
              [jobId, n]
            );
          } catch (progressError) {
            logger.warn('[MovieDownloader] progress update failed', {
              jobId,
              error: progressError.message,
            });
          }
        },
        shouldCancel: () => this.isCancelled(jobId),
      });

      // Record the resulting pointer row.
      const meta = await googleDrive.getFileMetadata(driveFileId);
      await upsertFileRow(job.movie_id, job.file_kind, meta);

      await pool.query(
        `UPDATE movie_download_jobs SET status = 'completed', drive_file_id = $2,
           bytes_transferred = COALESCE($3, bytes_transferred), finished_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [jobId, driveFileId, total]
      );
      logger.info('[MovieDownloader] job completed', { jobId, driveFileId });

      // A freshly-downloaded master gets a preview proxy generated automatically.
      if (job.file_kind === 'movie') {
        transcodeQueue.enqueueForMovie(job.movie_id, job.created_by);
      }
    } catch (error) {
      if (error.cancelled) {
        await pool.query(
          `UPDATE movie_download_jobs SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [jobId]
        );
        logger.info('[MovieDownloader] job cancelled', { jobId });
      } else {
        await this.fail(jobId, error.message);
        logger.error('[MovieDownloader] job failed', { jobId, error: error.message });
      }
    }
  }

  /** Azure branch of runJob: stream the source into a blob and point the row at it. */
  async runAzureJob(job, { movie, source, ext, targetName, total, existing }) {
    const jobId = job.id;
    await pool.query(
      'UPDATE movie_download_jobs SET bytes_total = $2, target_file_name = $3 WHERE id = $1',
      [jobId, total, targetName]
    );

    if (job.file_kind.startsWith('subtitles_')) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of source.stream) {
        bytes += chunk.length;
        if (bytes > movieStorage.MAX_SUBTITLE_BYTES) throw new Error('Subtitles file is too large');
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const fresh = await movieStorage.writeSubtitleFile(movie, job.file_kind, Buffer.concat(chunks), {
        ext,
        onMirrorError: (e) => logger.warn('[MovieDownloader] Drive mirror failed', { jobId, error: e.message }),
      });
      await this.complete(jobId, movieStorage.fileRef(fresh), bytes);
      return;
    }

    const blobName = movieStorage.blobNameFor(movie, job.file_kind, ext);
    const abort = new AbortController();
    const cancelTimer = setInterval(() => {
      if (this.isCancelled(jobId)) abort.abort();
    }, 2000);
    let lastWrite = 0;
    let written;
    try {
      written = await movieStorage.uploadStream(blobName, source.stream, {
        fileKind: job.file_kind,
        contentType: source.mimeType,
        abortSignal: abort.signal,
        onProgress: (n) => {
          const now = Date.now();
          if (now - lastWrite < 2000) return;
          lastWrite = now;
          pool
            .query(
              'UPDATE movie_download_jobs SET bytes_transferred = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
              [jobId, n]
            )
            .catch(() => {});
        },
      });
    } catch (error) {
      await movieStorage.deleteBlob(blobName).catch(() => {});
      if (abort.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      throw error;
    } finally {
      clearInterval(cancelTimer);
    }

    try {
      await movieStorage.upsertAzureRow(job.movie_id, job.file_kind, {
        blobName,
        fileName: targetName,
        size: written.size,
        mimeType: source.mimeType,
        md5: written.md5,
        etag: written.etag,
      });
    } catch (rowError) {
      await movieStorage.deleteBlob(blobName).catch(() => {});
      throw rowError;
    }
    if (existing?.storage === 'azure' && existing.blob_name !== blobName) {
      await movieStorage.deleteBlob(existing.blob_name).catch(() => {});
    }
    await this.complete(jobId, movieStorage.fileRef({ storage: 'azure', blob_name: blobName }), written.size);

    if (job.file_kind === 'movie') {
      const fresh = await movieStorage.loadRow(job.movie_id, 'movie');
      transcodeQueue.enqueueForMovie(job.movie_id, job.created_by);
      fileTransferQueue.enqueueBackup(fresh, { createdBy: job.created_by });
    }
  }

  async complete(jobId, targetRef, bytes) {
    await pool.query(
      `UPDATE movie_download_jobs SET status = 'completed', drive_file_id = $2,
         bytes_transferred = COALESCE($3, bytes_transferred), finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId, targetRef, bytes]
    );
    logger.info('[MovieDownloader] job completed', { jobId, target: targetRef });
  }

  async fail(jobId, message) {
    await pool.query(
      `UPDATE movie_download_jobs SET status = 'failed', error_message = $2,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId, (message || 'Unknown error').slice(0, 1000)]
    );
  }

  /** gdrive source: extract file id, read metadata via the SA, stream alt=media. */
  async openDriveSource(url) {
    const fileId = extractDriveFileId(url);
    if (!fileId) throw new Error('Could not parse a Google Drive file id from the URL');
    const meta = await googleDrive.getFileMetadata(fileId);
    const stream = await googleDrive.downloadFileStream(fileId);
    return { stream, name: meta.name, size: meta.size, mimeType: meta.mimeType };
  }

  /** ftp source: parse URL, get size, stream via a PassThrough. */
  async openFtpSource(url) {
    const ftp = require('basic-ftp');
    const parsed = parseFtpUrl(url);
    const client = new ftp.Client(30000);
    await client.access({
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      secure: false,
    });

    let size = null;
    try {
      size = await client.size(parsed.path);
    } catch {
      size = null; // some servers disallow SIZE
    }

    const pass = new PassThrough();
    // Kick off the download; close the client when it finishes or errors.
    client
      .downloadTo(pass, parsed.path)
      .then(() => client.close())
      .catch((err) => {
        pass.destroy(err);
        client.close();
      });

    const name = decodeURIComponent(parsed.path.split('/').pop() || 'download.bin');
    return { stream: pass, name, size, mimeType: 'application/octet-stream' };
  }
}

/** Extract a Drive file id from common share-link shapes. */
function extractDriveFileId(url) {
  if (!url) return null;
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // Bare id
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

/** Parse ftp://[user:pass@]host[:port]/path */
function parseFtpUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ftp:') throw new Error('Not an ftp:// URL');
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 21,
    user: parsed.username ? decodeURIComponent(parsed.username) : 'anonymous',
    password: parsed.password ? decodeURIComponent(parsed.password) : 'anonymous@',
    path: decodeURIComponent(parsed.pathname),
  };
}

module.exports = new MovieDownloader();
module.exports.extractDriveFileId = extractDriveFileId;
module.exports.parseFtpUrl = parseFtpUrl;
