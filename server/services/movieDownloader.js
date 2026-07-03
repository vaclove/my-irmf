/**
 * In-process download-job runner: pulls a file from a public Google Drive link
 * or an FTP URL and streams it into the movie's Drive folder without ever
 * touching local disk (bounded memory: 32 MiB chunks, source paused while a
 * chunk PUTs into a server-created resumable session).
 *
 * At most 2 jobs run concurrently. Cancellation is checked between chunks.
 * On boot, any pending/running jobs left over from a crash are marked
 * 'interrupted' (retryable).
 */

const axios = require('axios');
const { PassThrough } = require('stream');
const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const { conventionFileName, extensionOf } = require('../utils/movieFileNaming');
const { upsertFileRow } = require('./movieFileScanner');

const CHUNK_SIZE = 32 * 1024 * 1024; // 32 MiB (multiple of 256 KiB)
const MAX_CONCURRENT = 2;

// Bare axios for raw chunk PUTs into the resumable session.
const rawPut = axios.create({
  maxRedirects: 0,
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
  transformRequest: [(d) => d],
  validateStatus: (s) => s === 200 || s === 201 || s === 308,
});

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

      const driveFileId = await this.streamToDrive(job.id, source.stream, sessionUrl, total);

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

  /**
   * Consume a readable stream and PUT it into the resumable session in
   * 32 MiB chunks, applying backpressure (we await each PUT before pulling
   * more). Updates bytes_transferred per chunk; checks the cancel flag.
   * @returns {Promise<string>} the Drive file id
   */
  async streamToDrive(jobId, readable, sessionUrl, total) {
    const pending = [];
    let pendingLen = 0;
    let offset = 0;
    let fileId = null;

    const putChunk = async (buf, isLast) => {
      const start = offset;
      const endInclusive = offset + buf.length - 1;
      const rangeTotal = total != null ? total : isLast ? String(offset + buf.length) : '*';
      const res = await rawPut.put(sessionUrl, buf, {
        headers: {
          'Content-Range': `bytes ${start}-${endInclusive}/${rangeTotal}`,
          'Content-Length': String(buf.length),
        },
      });
      offset += buf.length;
      await pool.query(
        'UPDATE movie_download_jobs SET bytes_transferred = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [jobId, offset]
      );
      if (res.status === 200 || res.status === 201) {
        fileId = res.data && res.data.id;
      }
    };

    const flush = async (finalize) => {
      while (pendingLen >= CHUNK_SIZE || (finalize && pendingLen > 0)) {
        if (this.isCancelled(jobId)) {
          const err = new Error('cancelled');
          err.cancelled = true;
          throw err;
        }
        const take = Math.min(CHUNK_SIZE, pendingLen);
        const buf = takeBytes(pending, take);
        pendingLen -= take;
        const isLast = finalize && pendingLen === 0;
        await putChunk(buf, isLast);
      }
    };

    for await (const chunk of readable) {
      if (this.isCancelled(jobId)) {
        const err = new Error('cancelled');
        err.cancelled = true;
        throw err;
      }
      pending.push(chunk);
      pendingLen += chunk.length;
      await flush(false);
    }
    await flush(true);

    if (!fileId) {
      throw new Error('Upload to Drive did not return a file id');
    }
    return fileId;
  }
}

/** Pull exactly `take` bytes from the head of a buffer array. */
function takeBytes(pending, take) {
  const out = Buffer.allocUnsafe(take);
  let filled = 0;
  while (filled < take) {
    const head = pending[0];
    const need = take - filled;
    if (head.length <= need) {
      head.copy(out, filled);
      filled += head.length;
      pending.shift();
    } else {
      head.copy(out, filled, 0, need);
      pending[0] = head.subarray(need);
      filled += need;
    }
  }
  return out;
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
