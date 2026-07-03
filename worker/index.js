/**
 * Movie transcode worker — runs as an Azure Container Apps Job triggered by a
 * storage-queue message. One execution drains the queue: for each {job_id}
 * message it streams the master from Drive, transcodes a 720p H.264/AAC proxy
 * with ffmpeg, uploads it back to the movie's Drive folder, and records the
 * pointer row. Then it exits so the platform scales to zero.
 *
 * Reuses the app's Drive service and chunked-upload sink (shared server modules)
 * so naming, auth, and upload behavior stay identical to the in-app paths.
 *
 * Env: DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY (or _PATH), GOOGLE_SHARED_DRIVE_ID,
 *      AZURE_STORAGE_CONNECTION_STRING, TRANSCODE_QUEUE_NAME,
 *      MOVIE_TRANSCODE_HEIGHT/CRF/PRESET, FFMPEG_PATH/FFPROBE_PATH (optional).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { QueueClient } = require('@azure/storage-queue');

const { pool } = require('../server/models/database');
const googleDrive = require('../server/services/googleDrive');
const { proxyDriveMedia } = require('../server/services/driveMediaProxy');
const { uploadStreamToDrive } = require('../server/services/driveChunkedUpload');
const { conventionFileName } = require('../server/utils/movieFileNaming');

const QUEUE_NAME = process.env.TRANSCODE_QUEUE_NAME || 'movie-transcodes';
const VISIBILITY_TIMEOUT_S = 8 * 60 * 60; // 8h — matches the job replica timeout
const MAX_DEQUEUE = 3; // poison-message guard
const CANCEL_POLL_MS = 5000;

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const HEIGHT = parseInt(process.env.MOVIE_TRANSCODE_HEIGHT || '720', 10);
const CRF = process.env.MOVIE_TRANSCODE_CRF || '23';
const PRESET = process.env.MOVIE_TRANSCODE_PRESET || 'veryfast';
const MAX_THREADS = process.env.MOVIE_TRANSCODE_MAX_THREADS || null;

function log(msg, extra) {
  // Plain stdout — Container Apps captures it as execution logs.
  console.log(`[transcode-worker] ${msg}`, extra ? JSON.stringify(extra) : '');
}

/** Refresh/insert the movie_proxy pointer row from Drive metadata. */
async function upsertProxyRow(movieId, meta) {
  const size = meta.size != null ? parseInt(meta.size, 10) : null;
  await pool.query(
    `INSERT INTO movie_files
       (movie_id, file_kind, drive_file_id, file_name, file_size, mime_type,
        md5_checksum, drive_modified_at, last_synced_at)
     VALUES ($1, 'movie_proxy', $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
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
      meta.id,
      meta.name,
      size,
      meta.mimeType || 'video/mp4',
      meta.md5Checksum || null,
      meta.modifiedTime || null,
    ]
  );
}

/** Start a loopback HTTP proxy that ffmpeg reads the master through. */
function startInputProxy() {
  return new Promise((resolve) => {
    const app = express();
    app.get('/:fileId', (req, res) =>
      proxyDriveMedia(req, res, req.params.fileId, 'application/octet-stream')
    );
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** ffprobe the input URL and return its duration in seconds (or null). */
function probeDuration(inputUrl) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      inputUrl,
    ];
    const child = spawn(FFPROBE, args);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const d = JSON.parse(out)?.format?.duration;
        resolve(d ? Number(d) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Run ffmpeg to produce the proxy at tempPath. Reports progress via onProgress
 * (0–99). Resolves when done, rejects on nonzero exit. Exposes the child via
 * onSpawn so the caller can kill it on cancel.
 */
function runFfmpeg({ inputUrl, tempPath, durationSeconds, onProgress, onSpawn }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30',
      '-i', inputUrl,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale=-2:'min(${HEIGHT},ih)'`,
      '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', '+faststart',
    ];
    if (MAX_THREADS) args.push('-threads', String(MAX_THREADS));
    args.push('-progress', 'pipe:1', tempPath);

    const child = spawn(FFMPEG, args);
    if (onSpawn) onSpawn(child);

    let stderrTail = '';
    let progressBuf = '';

    child.stdout.on('data', (d) => {
      progressBuf += d.toString();
      const lines = progressBuf.split('\n');
      progressBuf = lines.pop(); // keep the partial line
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_us' && durationSeconds) {
          const outSec = Number(value) / 1e6;
          if (Number.isFinite(outSec)) {
            const pct = Math.min(99, Math.round((outSec / durationSeconds) * 100));
            onProgress(pct);
          }
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const err = new Error(stderrTail.trim() || `ffmpeg exited with code ${code}`);
        err.ffmpegCode = code;
        reject(err);
      }
    });
  });
}

/** Process a single job. Returns true if the message should be deleted. */
async function processJob(jobId, dequeueCount) {
  if (dequeueCount > MAX_DEQUEUE) {
    await pool.query(
      `UPDATE movie_transcode_jobs SET status = 'failed',
         error_message = 'Transcode crashed repeatedly and was abandoned',
         finished_at = CURRENT_TIMESTAMP WHERE id = $1 AND status <> 'completed'`,
      [jobId]
    );
    log('poison message abandoned', { jobId, dequeueCount });
    return true;
  }

  const jobRes = await pool.query('SELECT * FROM movie_transcode_jobs WHERE id = $1', [jobId]);
  if (jobRes.rows.length === 0) return true; // row gone (movie deleted) — drop message
  const job = jobRes.rows[0];
  if (!['pending', 'running'].includes(job.status)) {
    log('job not runnable, skipping', { jobId, status: job.status });
    return true;
  }
  if (!googleDrive.isConfigured()) {
    // Misconfiguration — don't burn dequeues; let it redeliver after we exit.
    log('Drive not configured; leaving message for redelivery', { jobId });
    return false;
  }

  await pool.query(
    `UPDATE movie_transcode_jobs SET status = 'running', phase = 'probing',
       attempt_count = attempt_count + 1, started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
       cancel_requested = false, error_message = NULL, progress_percent = 0
     WHERE id = $1`,
    [jobId]
  );

  const tempPath = path.join(
    process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir(),
    `irmf-proxy-${jobId}.mp4`
  );
  let proxyServer = null;
  let ffmpegChild = null;
  let cancelled = false;

  const cancelTimer = setInterval(async () => {
    try {
      const r = await pool.query(
        'SELECT cancel_requested FROM movie_transcode_jobs WHERE id = $1',
        [jobId]
      );
      if (r.rows[0]?.cancel_requested) {
        cancelled = true;
        if (ffmpegChild) ffmpegChild.kill('SIGKILL');
      }
    } catch {
      // transient; try again next tick
    }
  }, CANCEL_POLL_MS);

  try {
    // Resolve movie + master.
    const movieRes = await pool.query(
      `SELECT m.id, m.name_cs, m.name_en, m.drive_folder_id, e.year AS edition_year
       FROM movies m JOIN editions e ON m.edition_id = e.id WHERE m.id = $1`,
      [job.movie_id]
    );
    if (movieRes.rows.length === 0) throw new Error('Movie not found');
    const movie = movieRes.rows[0];

    const { server, port } = await startInputProxy();
    proxyServer = server;
    const inputUrl = `http://127.0.0.1:${port}/${encodeURIComponent(job.source_drive_file_id)}`;

    // Probe.
    const durationSeconds = await probeDuration(inputUrl);
    if (durationSeconds != null) {
      await pool.query('UPDATE movie_transcode_jobs SET duration_seconds = $2 WHERE id = $1', [
        jobId,
        durationSeconds,
      ]);
    }

    // Transcode.
    await pool.query("UPDATE movie_transcode_jobs SET phase = 'transcoding' WHERE id = $1", [jobId]);
    let lastPctWrite = 0;
    await runFfmpeg({
      inputUrl,
      tempPath,
      durationSeconds,
      onSpawn: (c) => (ffmpegChild = c),
      onProgress: (pct) => {
        const now = Date.now();
        if (now - lastPctWrite > 2000) {
          lastPctWrite = now;
          pool
            .query('UPDATE movie_transcode_jobs SET progress_percent = $2 WHERE id = $1', [jobId, pct])
            .catch(() => {});
        }
      },
    });
    if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });

    // Upload the proxy.
    await pool.query("UPDATE movie_transcode_jobs SET phase = 'uploading', progress_percent = 99 WHERE id = $1", [jobId]);
    const stat = fs.statSync(tempPath);
    const targetName = conventionFileName(movie, 'movie_proxy', 'mp4');
    const folderId = await googleDrive.ensureMovieFolder(movie);
    const sessionUrl = await googleDrive.createResumableSession({
      folderId,
      name: targetName,
      mimeType: 'video/mp4',
      size: stat.size,
    });
    await pool.query('UPDATE movie_transcode_jobs SET bytes_total = $2, target_file_name = $3 WHERE id = $1', [
      jobId,
      stat.size,
      targetName,
    ]);

    const driveFileId = await uploadStreamToDrive({
      readable: fs.createReadStream(tempPath),
      sessionUrl,
      total: stat.size,
      onProgress: (n) =>
        pool.query('UPDATE movie_transcode_jobs SET bytes_transferred = $2 WHERE id = $1', [jobId, n]),
      shouldCancel: () => cancelled,
    });

    // Dedup: trash any prior proxy pointing at a different Drive file.
    const prior = await pool.query(
      "SELECT drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = 'movie_proxy'",
      [job.movie_id]
    );
    if (prior.rows[0] && prior.rows[0].drive_file_id !== driveFileId) {
      await googleDrive.trashFile(prior.rows[0].drive_file_id).catch(() => {});
    }

    const meta = await googleDrive.getFileMetadata(driveFileId);
    await upsertProxyRow(job.movie_id, meta);

    await pool.query(
      `UPDATE movie_transcode_jobs SET status = 'completed', phase = NULL,
         progress_percent = 100, drive_file_id = $2, finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId, driveFileId]
    );
    log('job completed', { jobId, driveFileId });
    return true;
  } catch (error) {
    if (cancelled || error.cancelled) {
      await pool.query(
        `UPDATE movie_transcode_jobs SET status = 'cancelled', phase = NULL,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId]
      );
      log('job cancelled', { jobId });
    } else {
      await pool.query(
        `UPDATE movie_transcode_jobs SET status = 'failed', phase = NULL,
           error_message = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId, (error.message || 'Unknown error').slice(0, 1000)]
      );
      log('job failed', { jobId, error: error.message });
    }
    return true; // terminal — drop the message (retry is user-driven)
  } finally {
    clearInterval(cancelTimer);
    if (proxyServer) proxyServer.close();
    fs.promises.unlink(tempPath).catch(() => {});
  }
}

/** Remove any orphaned temp proxy files from crashed prior executions. */
function sweepTempFiles() {
  const dir = process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/^irmf-proxy-.*\.mp4$/.test(name)) {
        fs.promises.unlink(path.join(dir, name)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

async function main() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) {
    log('AZURE_STORAGE_CONNECTION_STRING not set — nothing to do');
    return;
  }
  sweepTempFiles();

  const queue = QueueClient.fromConnectionString(conn, QUEUE_NAME);
  await queue.createIfNotExists();

  // Drain: process messages until the queue is empty, then exit (scale to zero).
  for (;;) {
    const received = await queue.receiveMessages({
      numberOfMessages: 1,
      visibilityTimeout: VISIBILITY_TIMEOUT_S,
    });
    const msg = received.receivedMessageItems[0];
    if (!msg) {
      log('queue empty — exiting');
      break;
    }

    let jobId = null;
    try {
      const decoded = Buffer.from(msg.messageText, 'base64').toString('utf8');
      jobId = JSON.parse(decoded).job_id;
    } catch (e) {
      log('undecodable message dropped', { error: e.message });
      await queue.deleteMessage(msg.messageId, msg.popReceipt);
      continue;
    }

    let deleteMessage = true;
    try {
      deleteMessage = await processJob(jobId, msg.dequeueCount);
    } catch (e) {
      // Unexpected crash: leave the message so it redelivers (dequeueCount rises).
      log('unexpected job error; leaving message', { jobId, error: e.message });
      deleteMessage = false;
    }
    if (deleteMessage) {
      await queue.deleteMessage(msg.messageId, msg.popReceipt);
    }
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    log('fatal', { error: err.message });
    process.exit(1);
  });
