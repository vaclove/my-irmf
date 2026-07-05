/**
 * Movie worker — runs as an Azure Container Apps Job triggered by a
 * storage-queue message. One execution drains the queue, then exits so the
 * platform scales to zero. Three job types share the queue, discriminated by
 * the message's `type` field (absent = transcode, for back-compat):
 *
 *   transcode      streams the master from Drive, transcodes a 720p H.264/AAC
 *                  proxy with ffmpeg, uploads it back to the movie's folder
 *   subtitle_sync  extracts mono audio from the proxy/master, re-times a
 *                  subtitle track to it with alass, uploads the synced SRT as
 *                  a new file next to the untouched original
 *   db_backup      runs pg_dump against DATABASE_URL, uploads the dump to the
 *                  shared drive's Backups folder, prunes to the newest N
 *
 * Reuses the app's Drive service and chunked-upload sink (shared server modules)
 * so naming, auth, and upload behavior stay identical to the in-app paths.
 *
 * Env: DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY (or _PATH), GOOGLE_SHARED_DRIVE_ID,
 *      AZURE_STORAGE_CONNECTION_STRING, TRANSCODE_QUEUE_NAME,
 *      MOVIE_TRANSCODE_HEIGHT/CRF/PRESET, FFMPEG_PATH/FFPROBE_PATH (optional),
 *      ALASS_PATH, ALASS_NO_SPLIT, ALASS_SPLIT_PENALTY (optional),
 *      PG_DUMP_PATH, DB_BACKUP_FOLDER_NAME (optional).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { QueueServiceClient } = require('@azure/storage-queue');

const { pool } = require('../server/models/database');
const googleDrive = require('../server/services/googleDrive');
const { proxyDriveMedia } = require('../server/services/driveMediaProxy');
const { uploadStreamToDrive } = require('../server/services/driveChunkedUpload');
const { conventionFileName } = require('../server/utils/movieFileNaming');
const { decodeSubtitleBuffer, parseSubtitles, serializeSrt } = require('../server/utils/subtitles');

const QUEUE_NAME = process.env.TRANSCODE_QUEUE_NAME || 'movie-transcodes';
const VISIBILITY_TIMEOUT_S = 8 * 60 * 60; // 8h — matches the job replica timeout
const MAX_DEQUEUE = 3; // poison-message guard
const CANCEL_POLL_MS = 5000;

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const ALASS = process.env.ALASS_PATH || 'alass';
const PG_DUMP = process.env.PG_DUMP_PATH || 'pg_dump';
const BACKUP_FOLDER_NAME = process.env.DB_BACKUP_FOLDER_NAME || 'Backups';
const BACKUP_NAME_RE = /^festival_db_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.dump$/;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const HEIGHT = parseInt(process.env.MOVIE_TRANSCODE_HEIGHT || '720', 10);
const CRF = process.env.MOVIE_TRANSCODE_CRF || '23';
const PRESET = process.env.MOVIE_TRANSCODE_PRESET || 'veryfast';
const MAX_THREADS = process.env.MOVIE_TRANSCODE_MAX_THREADS || null;

function log(msg, extra) {
  // Plain stdout — Container Apps captures it as execution logs.
  console.log(`[transcode-worker] ${msg}`, extra ? JSON.stringify(extra) : '');
}

/** Refresh/insert a movie_files pointer row from Drive metadata. */
async function upsertFileKindRow(movieId, fileKind, meta, defaultMime) {
  const size = meta.size != null ? parseInt(meta.size, 10) : null;
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
      meta.id,
      meta.name,
      size,
      meta.mimeType || defaultMime,
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
 * Spawn ffmpeg with the given args (must end with '-progress pipe:1' and the
 * output path). Reports progress via onProgress (0–99, from out_time_us vs
 * durationSeconds). Resolves when done, rejects on nonzero exit. Exposes the
 * child via onSpawn so the caller can kill it on cancel.
 */
function spawnFfmpegWithProgress({ args, durationSeconds, onProgress, onSpawn }) {
  return new Promise((resolve, reject) => {
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

/** Run ffmpeg to produce the proxy at tempPath. */
function runFfmpeg({ inputUrl, tempPath, durationSeconds, onProgress, onSpawn }) {
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
  return spawnFfmpegWithProgress({ args, durationSeconds, onProgress, onSpawn });
}

/** Run ffmpeg to extract mono 16 kHz PCM audio (what alass's VAD wants). */
function extractAudio({ inputUrl, tempPath, durationSeconds, onProgress, onSpawn }) {
  const args = [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30',
    '-i', inputUrl,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    '-progress', 'pipe:1', tempPath,
  ];
  return spawnFfmpegWithProgress({ args, durationSeconds, onProgress, onSpawn });
}

/**
 * Run alass to align inSrtPath against the audio at wavPath, writing
 * outSrtPath. No parseable progress output — the phase is indeterminate.
 */
function runAlass({ wavPath, inSrtPath, outSrtPath, onSpawn }) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (process.env.ALASS_NO_SPLIT === 'true') args.push('--no-split');
    if (process.env.ALASS_SPLIT_PENALTY) {
      args.push('--split-penalty', String(process.env.ALASS_SPLIT_PENALTY));
    }
    args.push(wavPath, inSrtPath, outSrtPath);

    const child = spawn(ALASS, args, {
      env: {
        ...process.env,
        // alass shells out to ffmpeg for audio decoding.
        ALASS_FFMPEG_PATH: process.env.ALASS_FFMPEG_PATH || FFMPEG,
        ALASS_FFPROBE_PATH: process.env.ALASS_FFPROBE_PATH || FFPROBE,
      },
    });
    if (onSpawn) onSpawn(child);

    let outputTail = '';
    const capture = (d) => {
      outputTail = (outputTail + d.toString()).slice(-2000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('alass binary not found — set ALASS_PATH or install alass-cli'));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(outputTail.trim() || `alass exited with code ${code}`));
    });
  });
}

/** Run pg_dump in custom format (compressed, pg_restore-able) to outPath. */
function runPgDump({ dbUrl, outPath }) {
  return new Promise((resolve, reject) => {
    const args = [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file', outPath,
      '--dbname', dbUrl,
    ];
    const child = spawn(PG_DUMP, args);
    let stderrTail = '';
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('pg_dump binary not found — is postgresql-client installed in the image?'));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrTail.trim() || `pg_dump exited with code ${code}`));
    });
  });
}

/**
 * Keep only the newest `retain` backups in the Backups folder. Matching is
 * restricted to the festival_db_<stamp>.dump naming so anything else living in
 * the folder (manual exports, subfolders) is never touched. Timestamped names
 * sort chronologically, so lexicographic desc = newest first. Deletes are
 * PERMANENT (no trash) per backup-rotation policy; per-file failures are
 * logged but don't fail the run (a concurrent execution may already have
 * deleted the same file).
 */
async function pruneOldBackups(folderId, retain) {
  const children = await googleDrive.listFolderChildren(folderId);
  const backups = children
    .filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && BACKUP_NAME_RE.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const stale of backups.slice(retain)) {
    try {
      await googleDrive.deleteFile(stale.id);
      log('pruned old backup', { id: stale.id, name: stale.name });
    } catch (e) {
      log('failed to prune backup', { id: stale.id, name: stale.name, error: e.message });
    }
  }
}

/**
 * db_backup message: pg_dump the whole database, upload the dump to the
 * shared drive's Backups folder, prune to the newest `retain`. Returns true
 * when the message should be deleted from the queue.
 */
async function processDbBackup(message, dequeueCount) {
  if (dequeueCount > MAX_DEQUEUE) {
    log('poison db_backup abandoned', { dequeueCount });
    return true;
  }
  if (!googleDrive.isConfigured()) {
    log('Drive not configured; leaving db_backup for redelivery');
    return false;
  }
  if (!process.env.DATABASE_URL) {
    log('DATABASE_URL not set — dropping db_backup');
    return true;
  }

  const retain = Number.isInteger(message.retain) && message.retain > 0 ? message.retain : 7;
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  const fileName = `festival_db_${stamp}.dump`;
  const tempPath = path.join(
    process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir(),
    `irmf-dbbackup-${Date.now()}.dump`
  );

  try {
    log('db backup starting', { fileName, retain, requestedBy: message.requested_by || null });
    await runPgDump({ dbUrl: process.env.DATABASE_URL, outPath: tempPath });
    const stat = fs.statSync(tempPath);
    if (stat.size === 0) throw new Error('pg_dump produced an empty file');

    const folderId = await googleDrive.findOrCreateChildFolder(
      googleDrive.getDriveId(),
      BACKUP_FOLDER_NAME
    );
    const sessionUrl = await googleDrive.createResumableSession({
      folderId,
      name: fileName,
      mimeType: 'application/octet-stream',
      size: stat.size,
    });
    const driveFileId = await uploadStreamToDrive({
      readable: fs.createReadStream(tempPath),
      sessionUrl,
      total: stat.size,
    });
    log('db backup uploaded', { driveFileId, fileName, bytes: stat.size });

    try {
      await pruneOldBackups(folderId, retain);
    } catch (e) {
      // Backup itself already succeeded; don't fail/redeliver the whole job
      // over a pruning hiccup — the next scheduled run will retry pruning.
      log('prune step failed after successful backup', { error: e.message });
    }
    return true;
  } catch (error) {
    // Leave for redelivery; MAX_DEQUEUE bounds retries and the next scheduled
    // run tries again anyway. Errors land in Container Apps execution logs.
    log('db backup failed', { error: error.message, dequeueCount });
    return false;
  } finally {
    fs.promises.unlink(tempPath).catch(() => {});
  }
}

/** Download a Drive subtitle file into a bounded buffer and decode it. */
async function downloadSubtitleText(driveFileId) {
  const stream = await googleDrive.downloadFileStream(driveFileId);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    if (bytes > MAX_SUBTITLE_BYTES) {
      if (typeof stream.destroy === 'function') stream.destroy();
      throw new Error('Subtitles file is too large');
    }
    chunks.push(buf);
  }
  return decodeSubtitleBuffer(Buffer.concat(chunks));
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

  // Restart from scratch (fresh pending job, or a running job whose message got
  // redelivered after a crash). Clear stale progress/error, but DO NOT reset
  // cancel_requested — a cancel raised while the worker was down must survive the
  // restart and still stop the job. Fresh jobs default cancel_requested to false.
  await pool.query(
    `UPDATE movie_transcode_jobs SET status = 'running', phase = 'probing',
       attempt_count = attempt_count + 1, started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
       error_message = NULL, progress_percent = 0
     WHERE id = $1`,
    [jobId]
  );

  // Honor a cancellation that was requested before this (re)start began, so we
  // don't burn ffprobe/ffmpeg work on a job the user already cancelled.
  const preCancel = await pool.query(
    'SELECT cancel_requested FROM movie_transcode_jobs WHERE id = $1',
    [jobId]
  );
  if (preCancel.rows[0]?.cancel_requested) {
    await pool.query(
      `UPDATE movie_transcode_jobs SET status = 'cancelled', phase = NULL,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId]
    );
    log('job cancelled before start', { jobId });
    return true;
  }

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
    await upsertFileKindRow(job.movie_id, 'movie_proxy', meta, 'video/mp4');

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

/** Process a single subtitle sync job. Returns true if the message should be deleted. */
async function processSubtitleSyncJob(jobId, dequeueCount) {
  if (dequeueCount > MAX_DEQUEUE) {
    await pool.query(
      `UPDATE subtitle_sync_jobs SET status = 'failed',
         error_message = 'Subtitle sync crashed repeatedly and was abandoned',
         finished_at = CURRENT_TIMESTAMP WHERE id = $1 AND status <> 'completed'`,
      [jobId]
    );
    log('poison sync message abandoned', { jobId, dequeueCount });
    return true;
  }

  const jobRes = await pool.query('SELECT * FROM subtitle_sync_jobs WHERE id = $1', [jobId]);
  if (jobRes.rows.length === 0) return true; // row gone (movie deleted) — drop message
  const job = jobRes.rows[0];
  if (!['pending', 'running'].includes(job.status)) {
    log('sync job not runnable, skipping', { jobId, status: job.status });
    return true;
  }
  if (!googleDrive.isConfigured()) {
    log('Drive not configured; leaving sync message for redelivery', { jobId });
    return false;
  }

  // Restart from scratch on redelivery; keep cancel_requested (see processJob).
  await pool.query(
    `UPDATE subtitle_sync_jobs SET status = 'running', phase = 'probing',
       attempt_count = attempt_count + 1, started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
       error_message = NULL, progress_percent = 0
     WHERE id = $1`,
    [jobId]
  );
  const preCancel = await pool.query(
    'SELECT cancel_requested FROM subtitle_sync_jobs WHERE id = $1',
    [jobId]
  );
  if (preCancel.rows[0]?.cancel_requested) {
    await pool.query(
      `UPDATE subtitle_sync_jobs SET status = 'cancelled', phase = NULL,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId]
    );
    log('sync job cancelled before start', { jobId });
    return true;
  }

  const tmpDir = process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir();
  const wavPath = path.join(tmpDir, `irmf-sync-${jobId}.wav`);
  const inSrtPath = path.join(tmpDir, `irmf-sync-${jobId}.in.srt`);
  const outSrtPath = path.join(tmpDir, `irmf-sync-${jobId}.out.srt`);
  let proxyServer = null;
  let activeChild = null;
  let cancelled = false;

  const cancelTimer = setInterval(async () => {
    try {
      const r = await pool.query(
        'SELECT cancel_requested FROM subtitle_sync_jobs WHERE id = $1',
        [jobId]
      );
      if (r.rows[0]?.cancel_requested) {
        cancelled = true;
        if (activeChild) activeChild.kill('SIGKILL');
      }
    } catch {
      // transient; try again next tick
    }
  }, CANCEL_POLL_MS);

  try {
    const movieRes = await pool.query(
      `SELECT m.id, m.name_cs, m.name_en, m.drive_folder_id, e.year AS edition_year
       FROM movies m JOIN editions e ON m.edition_id = e.id WHERE m.id = $1`,
      [job.movie_id]
    );
    if (movieRes.rows.length === 0) throw new Error('Movie not found');
    const movie = movieRes.rows[0];

    const { server, port } = await startInputProxy();
    proxyServer = server;
    const inputUrl = `http://127.0.0.1:${port}/${encodeURIComponent(job.reference_drive_file_id)}`;

    // Probe the reference video.
    const durationSeconds = await probeDuration(inputUrl);
    if (durationSeconds != null) {
      await pool.query('UPDATE subtitle_sync_jobs SET duration_seconds = $2 WHERE id = $1', [
        jobId,
        durationSeconds,
      ]);
    }

    // Extract mono audio (the bulk of the wall time — streams the whole video).
    await pool.query(
      "UPDATE subtitle_sync_jobs SET phase = 'extracting_audio' WHERE id = $1",
      [jobId]
    );
    let lastPctWrite = 0;
    await extractAudio({
      inputUrl,
      tempPath: wavPath,
      durationSeconds,
      onSpawn: (c) => (activeChild = c),
      onProgress: (pct) => {
        const now = Date.now();
        if (now - lastPctWrite > 2000) {
          lastPctWrite = now;
          pool
            .query('UPDATE subtitle_sync_jobs SET progress_percent = $2 WHERE id = $1', [
              jobId,
              Math.round(pct * 0.7), // extraction owns 0–70 of the bar
            ])
            .catch(() => {});
        }
      },
    });
    activeChild = null;
    if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });

    // Fetch + normalize the subtitle to SRT (parseSubtitles converts VTT
    // timings to SRT form; serializeSrt renumbers and enforces LF endings).
    const sourceText = await downloadSubtitleText(job.source_drive_file_id);
    const sourceCues = parseSubtitles(sourceText);
    fs.writeFileSync(inSrtPath, serializeSrt(sourceCues), 'utf8');
    if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });

    // Align.
    await pool.query(
      "UPDATE subtitle_sync_jobs SET phase = 'aligning', progress_percent = 75 WHERE id = $1",
      [jobId]
    );
    await runAlass({
      wavPath,
      inSrtPath,
      outSrtPath,
      onSpawn: (c) => (activeChild = c),
    });
    activeChild = null;
    if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });

    // Sanity-check the output before uploading.
    const syncedText = fs.readFileSync(outSrtPath, 'utf8');
    const syncedCues = parseSubtitles(syncedText, 'srt'); // throws when no cues
    const body = Buffer.from(serializeSrt(syncedCues), 'utf8');

    // Upload the synced SRT as a new file next to the original.
    const syncedKind = `${job.subtitle_kind}_synced`;
    const targetName = conventionFileName(movie, syncedKind, 'srt');
    await pool.query(
      `UPDATE subtitle_sync_jobs SET phase = 'uploading', progress_percent = 99,
         target_file_name = $2 WHERE id = $1`,
      [jobId, targetName]
    );
    const folderId = await googleDrive.ensureMovieFolder(movie);
    const created = await googleDrive.uploadSmallFile({
      folderId,
      name: targetName,
      mimeType: 'application/x-subrip',
      body,
    });

    // Dedup: trash any prior synced file pointing at a different Drive file.
    const prior = await pool.query(
      'SELECT drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
      [job.movie_id, syncedKind]
    );
    if (prior.rows[0] && prior.rows[0].drive_file_id !== created.id) {
      await googleDrive.trashFile(prior.rows[0].drive_file_id).catch(() => {});
    }

    // uploadSmallFile already returns full metadata (id, name, size, md5, mtime).
    await upsertFileKindRow(job.movie_id, syncedKind, created, 'application/x-subrip');

    await pool.query(
      `UPDATE subtitle_sync_jobs SET status = 'completed', phase = NULL,
         progress_percent = 100, drive_file_id = $2, finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId, created.id]
    );
    log('sync job completed', { jobId, driveFileId: created.id });
    return true;
  } catch (error) {
    if (cancelled || error.cancelled) {
      await pool.query(
        `UPDATE subtitle_sync_jobs SET status = 'cancelled', phase = NULL,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId]
      );
      log('sync job cancelled', { jobId });
    } else {
      await pool.query(
        `UPDATE subtitle_sync_jobs SET status = 'failed', phase = NULL,
           error_message = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId, (error.message || 'Unknown error').slice(0, 1000)]
      );
      log('sync job failed', { jobId, error: error.message });
    }
    return true; // terminal — drop the message (retry is user-driven)
  } finally {
    clearInterval(cancelTimer);
    if (proxyServer) proxyServer.close();
    for (const p of [wavPath, inSrtPath, outSrtPath]) {
      fs.promises.unlink(p).catch(() => {});
    }
  }
}

/** Remove any orphaned temp files from crashed prior executions. */
function sweepTempFiles() {
  const dir = process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (
        /^irmf-proxy-.*\.mp4$/.test(name) ||
        /^irmf-sync-.*\.(wav|srt)$/.test(name) ||
        /^irmf-dbbackup-.*\.dump$/.test(name)
      ) {
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

  const queue = QueueServiceClient.fromConnectionString(conn).getQueueClient(QUEUE_NAME);
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
    let jobType = 'transcode';
    let parsed = null;
    try {
      const decoded = Buffer.from(msg.messageText, 'base64').toString('utf8');
      parsed = JSON.parse(decoded);
      jobId = parsed.job_id;
      jobType = parsed.type || 'transcode'; // absent type = transcode (back-compat)
    } catch (e) {
      log('undecodable message dropped', { error: e.message });
      await queue.deleteMessage(msg.messageId, msg.popReceipt);
      continue;
    }

    let deleteMessage = true;
    try {
      deleteMessage =
        jobType === 'db_backup'
          ? await processDbBackup(parsed, msg.dequeueCount)
          : jobType === 'subtitle_sync'
            ? await processSubtitleSyncJob(jobId, msg.dequeueCount)
            : await processJob(jobId, msg.dequeueCount);
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
