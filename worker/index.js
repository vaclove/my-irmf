/**
 * Movie worker — runs as an Azure Container Apps Job triggered by a
 * storage-queue message. One execution drains the queue, then exits so the
 * platform scales to zero. Five job types share the queue, discriminated by
 * the message's `type` field (absent = transcode, for back-compat):
 *
 *   transcode      reads the master (Azure Blob via a read URL, or Drive for
 *                  legacy rows), transcodes a 720p H.264/AAC proxy with
 *                  ffmpeg, uploads it to Azure (Hot)
 *   subtitle_sync  extracts mono audio from the proxy/master, re-times a
 *                  subtitle track to it with alass, saves the synced SRT as a
 *                  separate file (Azure + Drive mirror) next to the original
 *   file_transfer  copies a file Drive -> Azure (import) or an Azure master
 *                  -> Drive (backup); see movie_file_transfer_jobs
 *   subtitle_burn  renders the master (or a ~60 s preview clip of it) with
 *                  CS/EN subtitles burned in onto a scratch volume, uploads
 *                  the MP4 to the temporary 'exports' container; see
 *                  subtitle_burn_jobs
 *   db_backup      runs pg_dump against DATABASE_URL, uploads the dump to the
 *                  shared drive's Backups folder, prunes to the newest N
 *
 * Reuses the app's Drive service and chunked-upload sink (shared server modules)
 * so naming, auth, and upload behavior stay identical to the in-app paths.
 *
 * Env: DATABASE_URL, GOOGLE_SERVICE_ACCOUNT_KEY (or _PATH), GOOGLE_SHARED_DRIVE_ID,
 *      AZURE_STORAGE_CONNECTION_STRING, TRANSCODE_QUEUE_NAME,
 *      MOVIE_STORAGE_CONNECTION_STRING, MOVIE_STORAGE_CONTAINER,
 *      MOVIE_EXPORT_CONTAINER, MOVIE_TRANSCODE_HEIGHT/CRF/PRESET,
 *      SUBTITLE_BURN_PRESET/CRF, SUBTITLE_BURN_UHD_PRESET/CRF, SUBTITLE_BURN_TMPDIR,
 *      FFMPEG_PATH/FFPROBE_PATH (optional),
 *      ALASS_PATH, ALASS_NO_SPLIT, ALASS_SPLIT_PENALTY (optional),
 *      PG_DUMP_PATH, DB_BACKUP_FOLDER_NAME (optional).
 */

const os = require('os');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { QueueServiceClient } = require('@azure/storage-queue');

const { pool } = require('../server/models/database');
const googleDrive = require('../server/services/googleDrive');
const { proxyDriveMedia } = require('../server/services/driveMediaProxy');
const { uploadStreamToDrive } = require('../server/services/driveChunkedUpload');
const { conventionFileName, extensionOf } = require('../server/utils/movieFileNaming');
const { parseSubtitles, serializeSrt } = require('../server/utils/subtitles');
const movieStorage = require('../server/services/movieStorage');
const exportStorage = require('../server/services/exportStorage');
const {
  computeLayout,
  parseCropdetect,
  letterboxCrop,
  parseCues,
  densestWindowStart,
  buildAss,
} = require('../server/utils/subtitleBurn');

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
const HEIGHT = parseInt(process.env.MOVIE_TRANSCODE_HEIGHT || '720', 10);
const CRF = process.env.MOVIE_TRANSCODE_CRF || '23';
const PRESET = process.env.MOVIE_TRANSCODE_PRESET || 'veryfast';
const MAX_THREADS = process.env.MOVIE_TRANSCODE_MAX_THREADS || null;
// Burned-in exports are screening copies: near-transparent quality. UHD uses a
// faster preset so a feature film stays well inside the 8 h replica timeout.
const BURN_PRESET = process.env.SUBTITLE_BURN_PRESET || 'medium';
const BURN_CRF = process.env.SUBTITLE_BURN_CRF || '18';
const BURN_UHD_PRESET = process.env.SUBTITLE_BURN_UHD_PRESET || 'faster';
const BURN_UHD_CRF = process.env.SUBTITLE_BURN_UHD_CRF || '18';
// Audio codecs that go into the MP4 untouched; anything else becomes AAC.
const BURN_COPY_AUDIO = ['aac', 'ac3', 'eac3', 'mp3'];
// Where burns render before upload: an Azure Files volume in production — a
// feature film doesn't fit the replica's ephemeral disk (~8 GB).
const BURN_TMPDIR = process.env.SUBTITLE_BURN_TMPDIR || process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir();
// The volume is shared by all executions: sweep only files older than any run.
const BURN_STALE_MS = 12 * 60 * 60 * 1000;
const CROP_SAMPLES = 8;
const CROP_SAMPLE_TIMEOUT_MS = 2 * 60 * 1000;
const RECONNECT_ARGS = [
  '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1',
  '-reconnect_on_http_error', '5xx', '-reconnect_delay_max', '30',
];
// An output shorter than its source by more than this is treated as truncated
// (ffmpeg ends "successfully" when its input stream dies mid-way).
const DURATION_TOLERANCE_S = 10;
const DURATION_TOLERANCE_RATIO = 0.02;

function log(msg, extra) {
  // Plain stdout — Container Apps captures it as execution logs.
  console.log(`[transcode-worker] ${msg}`, extra ? JSON.stringify(extra) : '');
}

/** Drive API errors carry the JSON body as their message; make it readable. */
function driveErrorText(error) {
  try {
    const body = JSON.parse(error.message);
    const reason = body?.error?.errors?.[0]?.reason;
    return `Drive ${body?.error?.code || ''}${reason ? ` (${reason})` : ''}: ${body?.error?.message || error.message}`;
  } catch {
    return error.message;
  }
}

/** Hide SAS signatures (ffmpeg echoes its input URL in errors). */
function redact(message) {
  return String(message || '').replace(/([?&]sig=)[^&\s]+/g, '$1REDACTED');
}

/**
 * Start a loopback HTTP proxy that ffmpeg reads the master through. ffmpeg
 * only sees "5XX" when Drive refuses a request, so Drive's actual reason is
 * handed to onUpstreamError for the job's error message.
 */
function startInputProxy(onUpstreamError) {
  return new Promise((resolve) => {
    const app = express();
    // ffmpeg reads the whole master in one long request; the app's 30-minute
    // upstream deadline would cut a slow transcode off mid-file.
    app.get('/:fileId', (req, res) =>
      proxyDriveMedia(req, res, req.params.fileId, 'application/octet-stream', {
        timeoutMs: VISIBILITY_TIMEOUT_S * 1000,
        onError: (detail) => {
          log('drive upstream error', { fileId: req.params.fileId, detail });
          if (onUpstreamError) onUpstreamError(detail);
        },
      })
    );
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/**
 * Turn a file ref into a URL ffmpeg can read: a read SAS URL for blobs (Blob
 * Storage serves Range requests itself), the loopback Drive proxy otherwise.
 * Returns {inputUrl, server} — close `server` when done.
 */
async function resolveInput(ref, onUpstreamError) {
  const parsed = movieStorage.parseRef(ref);
  if (parsed.type === 'blob') {
    const inputUrl = await movieStorage.readUrl(parsed.name, { expiresInSec: VISIBILITY_TIMEOUT_S });
    return { inputUrl, server: null };
  }
  const { server, port } = await startInputProxy(onUpstreamError);
  return { inputUrl: `http://127.0.0.1:${port}/${encodeURIComponent(parsed.id)}`, server };
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
 * Guard against a truncated ffmpeg output. ffmpeg treats an input read error
 * as end of input and still exits 0, so a Drive hiccup mid-stream yields a
 * valid but short file (e.g. a 1-minute proxy of a feature film). Probe the
 * output and throw when it is clearly shorter than the source (callers
 * refuse to run without a source duration).
 */
async function assertCompleteOutput({ outputPath, expectedSeconds, label, stderrTail }) {
  const actual = await probeDuration(outputPath);
  const detail = stderrTail ? ` ffmpeg: ${stderrTail.slice(-500)}` : '';
  if (!actual || actual <= 0) {
    throw new Error(`${label} is unreadable or empty.${detail}`);
  }
  if (!expectedSeconds) return;
  const tolerance = Math.max(DURATION_TOLERANCE_S, expectedSeconds * DURATION_TOLERANCE_RATIO);
  if (expectedSeconds - actual > tolerance) {
    const fmt = (sec) => {
      const t = Math.round(sec);
      const h = Math.floor(t / 3600);
      const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
      const ss = String(t % 60).padStart(2, '0');
      return `${h}:${m}:${ss}`;
    };
    throw new Error(
      `${label} is incomplete: ${fmt(actual)} of ${fmt(expectedSeconds)} — the source stream ` +
        `was probably interrupted. Retry.${detail}`
    );
  }
}

/**
 * Data handler for ffmpeg's `-progress` output: reports 0–99 (out_time_us vs
 * durationSeconds) via onProgress.
 */
function progressParser(durationSeconds, onProgress) {
  let progressBuf = '';
  return (d) => {
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
  };
}

/**
 * Spawn ffmpeg with the given args (must end with '-progress pipe:1' and the
 * output path). Reports progress via onProgress (0–99, from out_time_us vs
 * durationSeconds). Resolves with the stderr tail when done (non-fatal input
 * errors end up there), rejects on nonzero exit. Exposes the child via onSpawn
 * so the caller can kill it on cancel.
 */
function spawnFfmpegWithProgress({ args, durationSeconds, onProgress, onSpawn }) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args);
    if (onSpawn) onSpawn(child);

    let stderrTail = '';
    child.stdout.on('data', progressParser(durationSeconds, onProgress));
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve(stderrTail.trim());
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
  const reconnect = [
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '5xx', '-reconnect_delay_max', '30',
  ];
  // The source is opened twice — one input for video, one for audio — so each
  // demuxer reads its track front to back. With a single HTTP input the MP4
  // demuxer jumps between the audio and video samples and every jump is a
  // new range request: measured 0.1x realtime vs 1.7x with two inputs.
  const args = [
    '-hide_banner', '-nostdin', '-y', '-loglevel', 'error',
    ...reconnect, '-i', inputUrl,
    ...reconnect, '-i', inputUrl,
    '-map', '0:v:0', '-map', '1:a:0?',
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
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '5xx', '-reconnect_delay_max', '30',
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
  let upstreamError = null;
  const uploadAbort = new AbortController();

  const cancelTimer = setInterval(async () => {
    try {
      const r = await pool.query(
        'SELECT cancel_requested FROM movie_transcode_jobs WHERE id = $1',
        [jobId]
      );
      if (r.rows[0]?.cancel_requested) {
        cancelled = true;
        if (ffmpegChild) ffmpegChild.kill('SIGKILL');
        uploadAbort.abort();
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

    const input = await resolveInput(job.source_drive_file_id, (d) => (upstreamError = d));
    proxyServer = input.server;
    const { inputUrl } = input;

    // Probe.
    const durationSeconds = await probeDuration(inputUrl);
    // No duration means the source couldn't be read (typically Drive refusing
    // it, e.g. downloadQuotaExceeded) — and without it the output can't be
    // checked for truncation, so stop here rather than publish a broken file.
    if (!durationSeconds) throw new Error('Could not read the source video');
    await pool.query('UPDATE movie_transcode_jobs SET duration_seconds = $2 WHERE id = $1', [
      jobId,
      durationSeconds,
    ]);

    // Transcode.
    await pool.query("UPDATE movie_transcode_jobs SET phase = 'transcoding' WHERE id = $1", [jobId]);
    let lastPctWrite = 0;
    const transcodeLog = await runFfmpeg({
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
    await assertCompleteOutput({
      outputPath: tempPath,
      expectedSeconds: durationSeconds,
      label: 'Preview',
      stderrTail: transcodeLog,
    });

    // Upload the proxy.
    await pool.query("UPDATE movie_transcode_jobs SET phase = 'uploading', progress_percent = 99 WHERE id = $1", [jobId]);
    const stat = fs.statSync(tempPath);
    const targetName = conventionFileName(movie, 'movie_proxy', 'mp4');
    await pool.query('UPDATE movie_transcode_jobs SET bytes_total = $2, target_file_name = $3 WHERE id = $1', [
      jobId,
      stat.size,
      targetName,
    ]);
    const prior = await movieStorage.loadRow(job.movie_id, 'movie_proxy');
    let driveFileId; // the job's result as a file ref

    if (movieStorage.isConfigured()) {
      const blobName = movieStorage.blobNameFor(movie, 'movie_proxy', 'mp4');
      let lastWrite = 0;
      let written;
      try {
        written = await movieStorage.uploadStream(blobName, fs.createReadStream(tempPath), {
          fileKind: 'movie_proxy',
          contentType: 'video/mp4',
          abortSignal: uploadAbort.signal,
          onProgress: (n) => {
            const now = Date.now();
            if (now - lastWrite < 2000) return;
            lastWrite = now;
            pool
              .query('UPDATE movie_transcode_jobs SET bytes_transferred = $2 WHERE id = $1', [jobId, n])
              .catch(() => {});
          },
        });
      } catch (uploadError) {
        await movieStorage.deleteBlob(blobName).catch(() => {});
        if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
        throw uploadError;
      }
      // Previews live only in Azure: no Drive copy.
      try {
        await movieStorage.upsertAzureRow(job.movie_id, 'movie_proxy', {
          blobName,
          fileName: targetName,
          size: written.size,
          mimeType: 'video/mp4',
          md5: written.md5,
          etag: written.etag,
          drive: null,
        });
      } catch (rowError) {
        await movieStorage.deleteBlob(blobName).catch(() => {});
        throw rowError;
      }
      if (prior?.storage === 'azure' && prior.blob_name !== blobName) {
        await movieStorage.deleteBlob(prior.blob_name).catch(() => {});
      }
      if (prior?.drive_file_id) await googleDrive.trashFile(prior.drive_file_id).catch(() => {});
      driveFileId = movieStorage.fileRef({ storage: 'azure', blob_name: blobName });
    } else {
      const folderId = await googleDrive.ensureMovieFolder(movie);
      const sessionUrl = await googleDrive.createResumableSession({
        folderId,
        name: targetName,
        mimeType: 'video/mp4',
        size: stat.size,
      });
      driveFileId = await uploadStreamToDrive({
        readable: fs.createReadStream(tempPath),
        sessionUrl,
        total: stat.size,
        onProgress: (n) =>
          pool.query('UPDATE movie_transcode_jobs SET bytes_transferred = $2 WHERE id = $1', [jobId, n]),
        shouldCancel: () => cancelled,
      });
      // Dedup: trash any prior proxy pointing at a different Drive file.
      if (prior?.drive_file_id && prior.drive_file_id !== driveFileId) {
        await googleDrive.trashFile(prior.drive_file_id).catch(() => {});
      }
      const meta = await googleDrive.getFileMetadata(driveFileId);
      await movieStorage.upsertDriveRow(job.movie_id, 'movie_proxy', { ...meta, mimeType: meta.mimeType || 'video/mp4' });
    }

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
      const message = redact(
        (error.message || 'Unknown error') + (upstreamError ? ` — ${upstreamError}` : '')
      );
      await pool.query(
        `UPDATE movie_transcode_jobs SET status = 'failed', phase = NULL,
           error_message = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId, message.slice(0, 1000)]
      );
      log('job failed', { jobId, error: message });
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
  let upstreamError = null;

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

    const input = await resolveInput(job.reference_drive_file_id, (d) => (upstreamError = d));
    proxyServer = input.server;
    const { inputUrl } = input;

    // Probe the reference video.
    const durationSeconds = await probeDuration(inputUrl);
    // No duration means the source couldn't be read (typically Drive refusing
    // it, e.g. downloadQuotaExceeded) — and without it the output can't be
    // checked for truncation, so stop here rather than publish a broken file.
    if (!durationSeconds) throw new Error('Could not read the source video');
    await pool.query('UPDATE subtitle_sync_jobs SET duration_seconds = $2 WHERE id = $1', [
      jobId,
      durationSeconds,
    ]);

    // Extract mono audio (the bulk of the wall time — streams the whole video).
    await pool.query(
      "UPDATE subtitle_sync_jobs SET phase = 'extracting_audio' WHERE id = $1",
      [jobId]
    );
    let lastPctWrite = 0;
    const extractLog = await extractAudio({
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
    // Aligning against truncated audio would silently mis-time the tail.
    await assertCompleteOutput({
      outputPath: wavPath,
      expectedSeconds: durationSeconds,
      label: 'Extracted audio',
      stderrTail: extractLog,
    });

    // Fetch + normalize the subtitle to SRT (parseSubtitles converts VTT
    // timings to SRT form; serializeSrt renumbers and enforces LF endings).
    const { text: sourceText } = await movieStorage.readSubtitleRef(job.source_drive_file_id);
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

    // Save the synced SRT as its own file next to the original (Azure + Drive
    // mirror; replaces a previous synced copy).
    const syncedKind = `${job.subtitle_kind}_synced`;
    const targetName = conventionFileName(movie, syncedKind, 'srt');
    await pool.query(
      `UPDATE subtitle_sync_jobs SET phase = 'uploading', progress_percent = 99,
         target_file_name = $2 WHERE id = $1`,
      [jobId, targetName]
    );
    const saved = await movieStorage.writeSubtitleFile(movie, syncedKind, body, {
      ext: 'srt',
      onMirrorError: (e) => log('failed to mirror synced subtitles to Drive', { jobId, error: e.message }),
    });
    const resultRef = movieStorage.fileRef(saved);

    await pool.query(
      `UPDATE subtitle_sync_jobs SET status = 'completed', phase = NULL,
         progress_percent = 100, drive_file_id = $2, finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId, resultRef]
    );
    log('sync job completed', { jobId, file: resultRef });
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
      const message = redact(
        (error.message || 'Unknown error') + (upstreamError ? ` — ${upstreamError}` : '')
      );
      await pool.query(
        `UPDATE subtitle_sync_jobs SET status = 'failed', phase = NULL,
           error_message = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId, message.slice(0, 1000)]
      );
      log('sync job failed', { jobId, error: message });
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

/** ffprobe the input: duration, first video stream geometry, first audio stream. */
function probeMedia(inputUrl) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,sample_aspect_ratio,channels',
      '-of', 'json',
      inputUrl,
    ];
    const child = spawn(FFPROBE, args);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        const streams = parsed.streams || [];
        const v = streams.find((s) => s.codec_type === 'video');
        const a = streams.find((s) => s.codec_type === 'audio');
        const [sarNum, sarDen] = String(v?.sample_aspect_ratio || '').split(':').map(Number);
        resolve({
          duration: parsed.format?.duration ? Number(parsed.format.duration) : null,
          video: v?.width && v?.height
            ? { width: v.width, height: v.height, sar: sarNum > 0 && sarDen > 0 ? sarNum / sarDen : 1 }
            : null,
          audio: a ? { codec: a.codec_name, channels: a.channels || 2 } : null,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/** Run cropdetect over one second of video at `at` seconds; {y1, y2} or null. */
function cropdetectAt(inputUrl, at, onSpawn) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-nostdin',
      ...RECONNECT_ARGS, '-ss', String(Math.floor(at)), '-i', inputUrl,
      '-map', '0:v:0', '-frames:v', '24', '-an',
      '-vf', 'cropdetect=limit=0.094:round=2:reset=0',
      '-f', 'null', '-',
    ];
    const child = spawn(FFMPEG, args);
    if (onSpawn) onSpawn(child);
    let stderrTail = '';
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), CROP_SAMPLE_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseCropdetect(stderrTail));
    });
  });
}

/** Sample the movie for a letterbox baked into the master; crop or null. */
async function detectLetterbox({ inputUrl, durationSeconds, width, height, onSpawn, isCancelled }) {
  const samples = [];
  for (let i = 1; i <= CROP_SAMPLES; i++) {
    if (isCancelled()) return null;
    samples.push(await cropdetectAt(inputUrl, (durationSeconds * i) / (CROP_SAMPLES + 1), onSpawn));
  }
  return letterboxCrop(samples, width, height);
}

/** ffmpeg args for a burn: a regular MP4 at outputPath, progress on stdout. */
function burnArgs({ inputUrl, media, layout, assPath, outputPath, startSeconds, lengthSeconds }) {
  const { canvas, picture, crop } = layout;
  const seek = startSeconds > 0 ? ['-ss', startSeconds.toFixed(3)] : [];
  const uhd = canvas.height > 1080;
  // Video and audio over separate inputs, as in runFfmpeg.
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...RECONNECT_ARGS, ...seek, '-i', inputUrl];
  if (media.audio) args.push(...RECONNECT_ARGS, ...seek, '-i', inputUrl);
  args.push('-map', '0:v:0');
  if (media.audio) args.push('-map', '1:a:0');
  const vf = [
    crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null,
    `scale=${picture.width}:${picture.height}:flags=lanczos`,
    'format=yuv420p',
    'setsar=1',
    `pad=${canvas.width}:${canvas.height}:${picture.x}:${picture.y}:color=black`,
    `subtitles=filename='${assPath}'`,
  ].filter(Boolean);
  args.push(
    '-vf', vf.join(','),
    '-c:v', 'libx264',
    '-preset', uhd ? BURN_UHD_PRESET : BURN_PRESET,
    '-crf', String(uhd ? BURN_UHD_CRF : BURN_CRF),
    '-profile:v', 'high', '-tune', 'film', '-pix_fmt', 'yuv420p'
  );
  if (media.audio) {
    if (BURN_COPY_AUDIO.includes(media.audio.codec)) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', media.audio.channels > 2 ? '640k' : '320k');
  }
  if (lengthSeconds) args.push('-t', lengthSeconds.toFixed(3));
  if (MAX_THREADS) args.push('-threads', String(MAX_THREADS));
  args.push('-max_muxing_queue_size', '4096');
  // A regular (not fragmented) MP4: VLC seeks fragmented ones badly — a few
  // seconds of grey smear after every jump. Previews get the index up front
  // for in-browser playback; full exports are played from local disk, where
  // rewriting tens of GB for it isn't worth it.
  if (lengthSeconds) args.push('-movflags', '+faststart');
  args.push('-progress', 'pipe:1', outputPath);
  return args;
}

/** File name of an export: {slug}.cs-en.mp4 / {slug}.cs-en.preview.mp4. */
function burnFileName(movie, job) {
  const slug = conventionFileName(movie, 'movie', 'mp4').replace(/\.mp4$/, '');
  const langs = [job.subtitle_cs_ref && 'cs', job.subtitle_en_ref && 'en'].filter(Boolean).join('-');
  return `${slug}.${langs}${job.kind === 'preview' ? '.preview' : ''}.mp4`;
}

/** Process a subtitle burn job. Returns true if the message should be deleted. */
async function processBurnJob(jobId, dequeueCount) {
  if (dequeueCount > MAX_DEQUEUE) {
    await pool.query(
      `UPDATE subtitle_burn_jobs SET status = 'failed', phase = NULL,
         error_message = 'Export crashed repeatedly and was abandoned',
         finished_at = CURRENT_TIMESTAMP WHERE id = $1 AND status <> 'completed'`,
      [jobId]
    );
    log('poison burn message abandoned', { jobId, dequeueCount });
    return true;
  }

  const jobRes = await pool.query('SELECT * FROM subtitle_burn_jobs WHERE id = $1', [jobId]);
  if (jobRes.rows.length === 0) return true; // row gone (movie deleted) — drop message
  const job = jobRes.rows[0];
  if (!['pending', 'running'].includes(job.status)) {
    log('burn job not runnable, skipping', { jobId, status: job.status });
    return true;
  }
  if (!exportStorage.isConfigured()) {
    log('Export storage not configured; leaving burn message for redelivery', { jobId });
    return false;
  }

  // Restart from scratch on redelivery; keep cancel_requested (see processJob).
  await pool.query(
    `UPDATE subtitle_burn_jobs SET status = 'running', phase = 'probing',
       attempt_count = attempt_count + 1, started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
       error_message = NULL, progress_percent = 0, bytes_transferred = 0
     WHERE id = $1`,
    [jobId]
  );
  const preCancel = await pool.query('SELECT cancel_requested FROM subtitle_burn_jobs WHERE id = $1', [jobId]);
  if (preCancel.rows[0]?.cancel_requested) {
    await pool.query(
      `UPDATE subtitle_burn_jobs SET status = 'cancelled', phase = NULL,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId]
    );
    log('burn job cancelled before start', { jobId });
    return true;
  }

  const assPath = path.join(process.env.MOVIE_TRANSCODE_TMPDIR || os.tmpdir(), `irmf-burn-${jobId}.ass`);
  const outputPath = path.join(BURN_TMPDIR, `irmf-burn-${jobId}.mp4`);
  let proxyServer = null;
  let activeChild = null;
  let cancelled = false;
  let upstreamError = null;
  let blobName = null;
  const uploadAbort = new AbortController();
  const cancelledError = () => Object.assign(new Error('cancelled'), { cancelled: true });

  const cancelTimer = setInterval(async () => {
    try {
      const r = await pool.query('SELECT cancel_requested FROM subtitle_burn_jobs WHERE id = $1', [jobId]);
      if (r.rows[0]?.cancel_requested) {
        cancelled = true;
        if (activeChild) activeChild.kill('SIGKILL');
        uploadAbort.abort();
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

    // Subtitles first: cheap, and a broken file should fail before the master is touched.
    const readCues = async (ref, label) => {
      if (!ref) return [];
      try {
        return parseCues((await movieStorage.readSubtitleRef(ref)).text);
      } catch (e) {
        throw new Error(`${label} subtitles: ${e.message}`);
      }
    };
    const cs = await readCues(job.subtitle_cs_ref, 'CS');
    const en = await readCues(job.subtitle_en_ref, 'EN');

    const input = await resolveInput(job.source_ref, (d) => (upstreamError = d));
    proxyServer = input.server;
    const { inputUrl } = input;

    const media = await probeMedia(inputUrl);
    // Without a duration the output can't be checked for truncation.
    if (!media?.duration || !media.video) throw new Error('Could not read the source video');
    await pool.query('UPDATE subtitle_burn_jobs SET duration_seconds = $2 WHERE id = $1', [jobId, media.duration]);

    const crop = await detectLetterbox({
      inputUrl,
      durationSeconds: media.duration,
      width: media.video.width,
      height: media.video.height,
      onSpawn: (c) => (activeChild = c),
      isCancelled: () => cancelled,
    });
    activeChild = null;
    if (cancelled) throw cancelledError();
    const layout = computeLayout({ ...media.video, crop });

    const durationMs = media.duration * 1000;
    let startMs = 0;
    let lengthMs = null;
    if (job.kind === 'preview') {
      lengthMs = Math.min(Number(job.preview_length_seconds || 60) * 1000, durationMs);
      startMs =
        job.preview_start_seconds != null
          ? Math.max(0, Math.min(Number(job.preview_start_seconds) * 1000, durationMs - lengthMs))
          : densestWindowStart([cs, en], lengthMs, durationMs);
    }
    const ass = buildAss({ cs, en, layout, offsetMs: startMs, lengthMs, title: movie.name_cs || movie.name_en || '' });
    fs.writeFileSync(assPath, ass.script, 'utf8');

    const fileName = burnFileName(movie, job);
    blobName = exportStorage.blobNameFor(movie, job.kind, fileName);
    const renderInfo = {
      canvas: layout.canvas,
      picture: layout.picture,
      crop: layout.crop,
      layout: ass.mode,
      paired_ratio: ass.ratio,
      source: media.video,
      audio: media.audio
        ? { codec: media.audio.codec, channels: media.audio.channels, copied: BURN_COPY_AUDIO.includes(media.audio.codec) }
        : null,
      start_seconds: startMs / 1000,
      length_seconds: lengthMs != null ? lengthMs / 1000 : media.duration,
    };
    await pool.query(
      `UPDATE subtitle_burn_jobs SET phase = 'rendering', render_info = $2, file_name = $3 WHERE id = $1`,
      [jobId, JSON.stringify(renderInfo), fileName]
    );
    log('burn starting', { jobId, kind: job.kind, layout: ass.mode, canvas: layout.canvas, crop: layout.crop });

    const expectedSeconds = renderInfo.length_seconds;
    let lastPctWrite = 0;
    const renderLog = await spawnFfmpegWithProgress({
      args: burnArgs({
        inputUrl,
        media,
        layout,
        assPath,
        outputPath,
        startSeconds: startMs / 1000,
        lengthSeconds: lengthMs != null ? lengthMs / 1000 : null,
      }),
      durationSeconds: expectedSeconds,
      onSpawn: (c) => (activeChild = c),
      onProgress: (pct) => {
        const now = Date.now();
        if (now - lastPctWrite < 2000) return;
        lastPctWrite = now;
        pool
          .query('UPDATE subtitle_burn_jobs SET progress_percent = $2 WHERE id = $1', [jobId, Math.round(pct * 0.9)])
          .catch(() => {});
      },
    });
    activeChild = null;
    if (cancelled) throw cancelledError();

    await pool.query("UPDATE subtitle_burn_jobs SET phase = 'verifying', progress_percent = 90 WHERE id = $1", [jobId]);
    await assertCompleteOutput({ outputPath, expectedSeconds, label: 'Export', stderrTail: renderLog });

    // Upload (90–99 % of the bar).
    const total = fs.statSync(outputPath).size;
    await pool.query("UPDATE subtitle_burn_jobs SET phase = 'uploading', file_size = $2 WHERE id = $1", [jobId, total]);
    let lastBytesWrite = 0;
    const uploaded = await exportStorage.uploadStream(blobName, fs.createReadStream(outputPath), {
      abortSignal: uploadAbort.signal,
      onProgress: (n) => {
        const now = Date.now();
        if (now - lastBytesWrite < 2000) return;
        lastBytesWrite = now;
        pool
          .query('UPDATE subtitle_burn_jobs SET bytes_transferred = $2, progress_percent = $3 WHERE id = $1', [
            jobId,
            n,
            90 + Math.floor((n / total) * 9),
          ])
          .catch(() => {});
      },
    });
    if (cancelled) throw cancelledError();
    if (uploaded.size !== total) throw new Error(`Upload incomplete: ${uploaded.size} of ${total} bytes`);

    await pool.query(
      `UPDATE subtitle_burn_jobs SET status = 'completed', phase = NULL, progress_percent = 100,
         blob_name = $2, file_size = $3, bytes_transferred = $3,
         expires_at = CURRENT_TIMESTAMP + make_interval(days => $4),
         finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId, blobName, total, exportStorage.RETENTION_DAYS[job.kind]]
    );
    log('burn completed', { jobId, blobName, bytes: total });

    // A new export replaces the movie's previous one of the same kind.
    const older = await pool.query(
      `UPDATE subtitle_burn_jobs SET blob_deleted_at = CURRENT_TIMESTAMP
       WHERE movie_id = $1 AND kind = $2 AND id <> $3 AND blob_name IS NOT NULL AND blob_deleted_at IS NULL
       RETURNING blob_name`,
      [job.movie_id, job.kind, jobId]
    );
    for (const row of older.rows) {
      await exportStorage.deleteBlob(row.blob_name).catch((e) =>
        log('failed to delete replaced export', { jobId, blobName: row.blob_name, error: e.message })
      );
    }
    return true;
  } catch (error) {
    if (blobName) await exportStorage.deleteBlob(blobName).catch(() => {});
    if (cancelled || error.cancelled) {
      await pool.query(
        `UPDATE subtitle_burn_jobs SET status = 'cancelled', phase = NULL,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId]
      );
      log('burn job cancelled', { jobId });
    } else {
      const message = redact((error.message || 'Unknown error') + (upstreamError ? ` — ${upstreamError}` : ''));
      await pool.query(
        `UPDATE subtitle_burn_jobs SET status = 'failed', phase = NULL,
           error_message = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId, message.slice(0, 1000)]
      );
      log('burn job failed', { jobId, error: message });
    }
    return true; // terminal — drop the message (retry is user-driven)
  } finally {
    clearInterval(cancelTimer);
    if (proxyServer) proxyServer.close();
    fs.promises.unlink(assPath).catch(() => {});
    fs.promises.unlink(outputPath).catch(() => {});
  }
}

/**
 * Create + enqueue a preview transcode for a movie's current master (after an
 * import). Mirrors server/services/transcodeQueue.enqueueForMovie.
 */
async function enqueueTranscode(queue, movieId, createdBy) {
  const master = await movieStorage.loadRow(movieId, 'movie');
  if (!master) return;
  const active = await pool.query(
    "SELECT id FROM movie_transcode_jobs WHERE movie_id = $1 AND status IN ('pending', 'running')",
    [movieId]
  );
  if (active.rows.length > 0) return;
  const insert = await pool.query(
    `INSERT INTO movie_transcode_jobs (movie_id, source_drive_file_id, status, created_by)
     VALUES ($1, $2, 'pending', $3) RETURNING id`,
    [movieId, movieStorage.fileRef(master), createdBy || null]
  );
  const body = Buffer.from(JSON.stringify({ job_id: insert.rows[0].id }), 'utf8').toString('base64');
  await queue.sendMessage(body);
  log('transcode enqueued after import', { movieId, jobId: insert.rows[0].id });
}

/** Queue a Drive backup of the row's current Azure blob (unless one is active). */
async function enqueueBackup(queue, movieId, fileKind, createdBy) {
  const row = await movieStorage.loadRow(movieId, fileKind);
  if (!row || row.storage !== 'azure') return;
  const insert = await pool.query(
    `INSERT INTO movie_file_transfer_jobs (movie_id, file_kind, direction, source_ref, created_by)
     SELECT $1, $2, 'azure_to_drive', $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM movie_file_transfer_jobs WHERE movie_id = $1 AND file_kind = $2
         AND direction = 'azure_to_drive' AND status IN ('pending', 'running'))
     RETURNING id`,
    [movieId, fileKind, movieStorage.fileRef(row), createdBy || null]
  );
  if (insert.rows.length === 0) return;
  const body = Buffer.from(JSON.stringify({ job_id: insert.rows[0].id, type: 'file_transfer' }), 'utf8').toString(
    'base64'
  );
  await queue.sendMessage(body);
  log('backup re-queued for the current file', { movieId, jobId: insert.rows[0].id });
}

/** Pass-through that hashes (md5) and counts the bytes flowing through it. */
function hashingTap(readable) {
  const hash = crypto.createHash('md5');
  let size = 0;
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
  return { tap, result: () => ({ md5: hash.digest('hex'), size }) };
}

/**
 * drive_to_azure: copy a Drive file into a blob and point the row at it.
 * Automatic imports apply only while the row still is the legacy Drive row
 * they were queued for (checked and switched in one UPDATE, so an upload or
 * save that happened meanwhile wins); explicit imports (replace_existing)
 * take the slot regardless.
 */
async function transferDriveToAzure(job, movie, onProgress) {
  const driveId = job.source_ref;
  const meta = await googleDrive.getFileMetadata(driveId);
  const total = meta.size != null ? Number(meta.size) : null;
  await pool.query('UPDATE movie_file_transfer_jobs SET bytes_total = $2 WHERE id = $1', [job.id, total]);

  const kind = job.file_kind;
  const ext = extensionOf(meta.name) || 'bin';
  const blobName = movieStorage.blobNameFor(movie, kind, ext);
  let written;
  try {
    written = await movieStorage.uploadStream(blobName, await googleDrive.downloadFileStream(driveId), {
      fileKind: kind,
      contentType: meta.mimeType,
      onProgress,
    });
    // A Drive stream that dies mid-way (e.g. downloadQuotaExceeded) must not
    // produce a short copy.
    if ((total != null && written.size !== total) || (meta.md5Checksum && written.md5 !== meta.md5Checksum)) {
      throw new Error(
        `Copy incomplete: got ${written.size} of ${total ?? '?'} bytes (md5 ${written.md5} vs ${meta.md5Checksum || '?'})`
      );
    }
  } catch (error) {
    await movieStorage.deleteBlob(blobName).catch(() => {});
    throw error;
  }

  // Previews live only in Azure; masters and subtitles keep the Drive file as
  // their backup/mirror.
  const keepDrive = kind !== 'movie_proxy';
  const fields = {
    blobName,
    fileName: conventionFileName(movie, kind, ext),
    size: written.size,
    mimeType: meta.mimeType,
    md5: written.md5,
    etag: written.etag,
    drive: keepDrive ? { id: driveId, md5: meta.md5Checksum || written.md5 } : null,
  };

  let row;
  try {
    row = await movieStorage.loadRow(job.movie_id, kind);
    if (job.replace_existing || !row) {
      await movieStorage.upsertAzureRow(job.movie_id, kind, fields);
    } else {
      const switched = await pool.query(
        `UPDATE movie_files SET storage = 'azure', blob_name = $4, blob_etag = $5, file_name = $6,
           file_size = $7, mime_type = $8, md5_checksum = $9, drive_file_id = $10,
           drive_md5_checksum = $11, last_synced_at = CURRENT_TIMESTAMP
         WHERE movie_id = $1 AND file_kind = $2 AND storage = 'drive' AND drive_file_id = $3
         RETURNING id`,
        [
          job.movie_id, kind, driveId, blobName, fields.etag, fields.fileName, fields.size,
          fields.mimeType || null, fields.md5, fields.drive?.id || null, fields.drive?.md5 || null,
        ]
      );
      if (switched.rows.length === 0) {
        await movieStorage.deleteBlob(blobName).catch(() => {});
        return { superseded: true };
      }
    }
  } catch (error) {
    await movieStorage.deleteBlob(blobName).catch(() => {});
    throw error;
  }

  if (row?.storage === 'azure' && row.blob_name !== blobName) {
    await movieStorage.deleteBlob(row.blob_name).catch(() => {});
  }
  if (row?.drive_file_id && row.drive_file_id !== driveId) {
    await googleDrive.trashFile(row.drive_file_id).catch(() => {});
  }
  if (!keepDrive) await googleDrive.trashFile(driveId).catch(() => {});
  return { targetRef: movieStorage.fileRef({ storage: 'azure', blob_name: blobName }) };
}

/**
 * Backup shortcut: if the movie's Drive folder already holds a file of the
 * blob's size, hash the blob and, on an md5 match, point the row's Drive copy
 * at that file. Returns the transfer outcome, or null to upload normally.
 * Costs one read of the blob (Cold: ~$0.03/GB) instead of a full upload.
 */
async function linkExistingDriveCopy(job, movie, { blobName, folderId, total, current, onProgress }) {
  const candidates = (await googleDrive.listFolderChildren(folderId)).filter(
    (f) => f.md5Checksum && Number(f.size) === Number(total)
  );
  if (candidates.length === 0) return null;

  const { tap, result } = hashingTap(await movieStorage.openBlobStream(blobName));
  let read = 0;
  for await (const chunk of tap) {
    read += chunk.length;
    onProgress(read);
  }
  const { md5 } = result();
  const match = candidates.find((f) => f.md5Checksum === md5);
  if (!match) return null;

  const updated = await pool.query(
    `UPDATE movie_files SET drive_file_id = $3, drive_md5_checksum = $4,
       md5_checksum = COALESCE(md5_checksum, $4)
     WHERE movie_id = $1 AND file_kind = $2 AND blob_name = $5
     RETURNING id`,
    [job.movie_id, job.file_kind, match.id, md5, blobName]
  );
  if (updated.rows.length === 0) return { superseded: true };

  const conventionName = conventionFileName(movie, job.file_kind, extensionOf(blobName) || 'bin');
  if (match.name !== conventionName) {
    await googleDrive.renameFile(match.id, conventionName).catch(() => {});
  }
  // The previous Drive copy belonged to an older version of the file.
  if (current.drive_file_id && current.drive_file_id !== match.id) {
    await googleDrive.trashFile(current.drive_file_id).catch(() => {});
  }
  log('backup linked to an identical Drive file', { jobId: job.id, driveId: match.id });
  return { targetRef: match.id };
}

/** azure_to_drive: write the Drive backup of an Azure master. */
async function transferAzureToDrive(job, movie, onProgress) {
  const { name: blobName } = movieStorage.parseRef(job.source_ref);
  const current = await movieStorage.loadRow(job.movie_id, job.file_kind);
  if (!current || current.blob_name !== blobName) return { superseded: true };

  const props = await movieStorage.getProperties(blobName);
  const total = props.contentLength;
  await pool.query('UPDATE movie_file_transfer_jobs SET bytes_total = $2 WHERE id = $1', [job.id, total]);

  const ext = extensionOf(blobName) || 'bin';
  const folderId = await googleDrive.ensureMovieFolder(movie);

  // Already on Drive? (Typically: downloaded from Drive and re-uploaded by
  // hand.) Hash the blob and link an identical file instead of uploading a
  // second copy.
  const linked = await linkExistingDriveCopy(job, movie, { blobName, folderId, total, current, onProgress });
  if (linked) return linked;

  const sessionUrl = await googleDrive.createResumableSession({
    folderId,
    name: conventionFileName(movie, job.file_kind, ext),
    mimeType: props.contentType || 'application/octet-stream',
    size: total,
  });
  const { tap, result } = hashingTap(await movieStorage.openBlobStream(blobName));
  const driveId = await uploadStreamToDrive({ readable: tap, sessionUrl, total, onProgress });
  const { md5 } = result();
  const meta = await googleDrive.getFileMetadata(driveId);
  if (meta.md5Checksum && meta.md5Checksum !== md5) {
    await googleDrive.trashFile(driveId).catch(() => {});
    throw new Error('Drive backup does not match the Azure file (md5 mismatch)');
  }

  // The master may have been replaced while we copied.
  const updated = await pool.query(
    `UPDATE movie_files SET drive_file_id = $3, drive_md5_checksum = $4,
       md5_checksum = COALESCE(md5_checksum, $5)
     WHERE movie_id = $1 AND file_kind = $2 AND blob_name = $6
     RETURNING id`,
    [job.movie_id, job.file_kind, driveId, meta.md5Checksum || md5, md5, blobName]
  );
  if (updated.rows.length === 0) {
    await googleDrive.trashFile(driveId).catch(() => {});
    return { superseded: true };
  }
  if (current.drive_file_id && current.drive_file_id !== driveId) {
    await googleDrive.trashFile(current.drive_file_id).catch(() => {});
  }
  return { targetRef: driveId };
}

/** Process a file transfer job. Returns true if the message should be deleted. */
async function processTransferJob(jobId, dequeueCount, queue) {
  if (dequeueCount > MAX_DEQUEUE) {
    await pool.query(
      `UPDATE movie_file_transfer_jobs SET status = 'failed',
         error_message = 'Transfer crashed repeatedly and was abandoned',
         finished_at = CURRENT_TIMESTAMP WHERE id = $1 AND status <> 'completed'`,
      [jobId]
    );
    log('poison transfer message abandoned', { jobId, dequeueCount });
    return true;
  }
  const jobRes = await pool.query('SELECT * FROM movie_file_transfer_jobs WHERE id = $1', [jobId]);
  if (jobRes.rows.length === 0) return true;
  const job = jobRes.rows[0];
  if (!['pending', 'running'].includes(job.status)) {
    log('transfer not runnable, skipping', { jobId, status: job.status });
    return true;
  }
  if (!googleDrive.isConfigured() || !movieStorage.isConfigured()) {
    log('Drive or movie storage not configured; leaving transfer for redelivery', { jobId });
    return false;
  }

  await pool.query(
    `UPDATE movie_file_transfer_jobs SET status = 'running', attempt_count = attempt_count + 1,
       started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error_message = NULL,
       bytes_transferred = 0
     WHERE id = $1`,
    [jobId]
  );

  let lastWrite = 0;
  const onProgress = (n) => {
    const now = Date.now();
    if (now - lastWrite < 2000) return;
    lastWrite = now;
    pool
      .query('UPDATE movie_file_transfer_jobs SET bytes_transferred = $2 WHERE id = $1', [jobId, n])
      .catch(() => {});
  };

  try {
    const movieRes = await pool.query(
      `SELECT m.id, m.name_cs, m.name_en, m.drive_folder_id, e.year AS edition_year
       FROM movies m JOIN editions e ON m.edition_id = e.id WHERE m.id = $1`,
      [job.movie_id]
    );
    if (movieRes.rows.length === 0) throw new Error('Movie not found');
    const movie = movieRes.rows[0];

    const outcome =
      job.direction === 'drive_to_azure'
        ? await transferDriveToAzure(job, movie, onProgress)
        : await transferAzureToDrive(job, movie, onProgress);

    if (outcome.superseded) {
      await pool.query(
        `UPDATE movie_file_transfer_jobs SET status = 'cancelled',
           error_message = 'Superseded: the file was replaced while copying',
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId]
      );
      log('transfer superseded', { jobId });
      // The replacement's own backup couldn't be queued while this one was
      // active; queue it now.
      if (job.direction === 'azure_to_drive') {
        await enqueueBackup(queue, job.movie_id, job.file_kind, job.created_by).catch((e) =>
          log('failed to re-queue backup', { jobId, error: e.message })
        );
      }
      return true;
    }

    await pool.query(
      `UPDATE movie_file_transfer_jobs SET status = 'completed', target_ref = $2,
         bytes_transferred = COALESCE(bytes_total, bytes_transferred),
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId, outcome.targetRef]
    );
    log('transfer completed', { jobId, direction: job.direction, target: outcome.targetRef });

    if (job.transcode_after) {
      await enqueueTranscode(queue, job.movie_id, job.created_by).catch((e) =>
        log('failed to enqueue transcode after import', { jobId, error: e.message })
      );
    }
    return true;
  } catch (error) {
    const message = redact(driveErrorText(error) || 'Unknown error');
    await pool.query(
      `UPDATE movie_file_transfer_jobs SET status = 'failed', error_message = $2,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId, message.slice(0, 1000)]
    );
    log('transfer failed', { jobId, error: message });
    return true; // terminal — retry is user- or scan-driven
  }
}

/** Remove renders orphaned by crashed executions from the shared burn volume. */
function sweepBurnFiles() {
  try {
    for (const name of fs.readdirSync(BURN_TMPDIR)) {
      if (!/^irmf-burn-.*\.mp4$/.test(name)) continue;
      const file = path.join(BURN_TMPDIR, name);
      if (Date.now() - fs.statSync(file).mtimeMs > BURN_STALE_MS) {
        fs.promises.unlink(file).catch(() => {});
      }
    }
  } catch {
    // ignore
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
        /^irmf-burn-.*\.ass$/.test(name) ||
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
  sweepBurnFiles();

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
            : jobType === 'file_transfer'
              ? await processTransferJob(jobId, msg.dequeueCount, queue)
              : jobType === 'subtitle_burn'
                ? await processBurnJob(jobId, msg.dequeueCount)
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

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      log('fatal', { error: err.message });
      process.exit(1);
    });
}

// For local render checks (node -e "require('./worker')...").
module.exports = { probeMedia, detectLetterbox, burnArgs, spawnFfmpegWithProgress };
