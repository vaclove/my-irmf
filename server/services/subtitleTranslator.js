/**
 * In-process subtitle translation job runner: downloads a movie's subtitle
 * file (.srt or .vtt) from Drive, machine-translates it between Czech and
 * English with the Anthropic API, and uploads the result back to the movie's
 * Drive folder as a convention-named .srt.
 *
 * Timings are never touched: cue timing lines are copied from the source
 * verbatim, only the text is translated. Cues are sent in batches split at
 * the largest temporal gap (scene changes), with the tail of the previous
 * batch passed along as context for continuity. The model must echo each
 * cue's "#N" marker; responses failing validation get one corrective retry.
 *
 * At most SUBTITLE_TRANSLATION_MAX_CONCURRENT jobs run at once (default 1).
 * Cancellation is checked between batches. On boot, any pending/running jobs
 * left over from a crash are marked 'interrupted' (retryable).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const { conventionFileName, extensionOf } = require('../utils/movieFileNaming');
const { upsertFileRow } = require('./movieFileScanner');
const {
  msFromTimestamp,
  parseSrt,
  parseVtt,
  parseSubtitles,
  serializeSrt,
} = require('../utils/subtitles');

const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.SUBTITLE_TRANSLATION_MAX_CONCURRENT || '1', 10) || 1
);
const MAX_BATCH_SIZE = 80;
const MIN_BATCH_SIZE = 10;
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024; // same cap as the subtitle serving route
const CONTEXT_CUES = 3; // trailing cues of the previous batch passed as context

const DIRECTIONS = {
  cs_to_en: { sourceKind: 'subtitles_cs', targetKind: 'subtitles_en', sourceLang: 'Czech', targetLang: 'English' },
  en_to_cs: { sourceKind: 'subtitles_en', targetKind: 'subtitles_cs', sourceLang: 'English', targetLang: 'Czech' },
};

class TranslationFormatError extends Error {}

// Parsing / serialization helpers live in ../utils/subtitles (shared with the
// subtitle editor routes); they are re-exported below for existing consumers.

// ---------------------------------------------------------------------------
// Batching (recursive split at the largest temporal gap)
// ---------------------------------------------------------------------------

function batchCues(cues, maxSize = MAX_BATCH_SIZE) {
  if (cues.length <= maxSize) return [cues];

  let splitIndex = -1;
  let longestGap = -1;
  const lo = Math.min(MIN_BATCH_SIZE, Math.floor(cues.length / 2));
  for (let i = lo; i <= cues.length - lo; i++) {
    const prev = cues[i - 1];
    const next = cues[i];
    const gap =
      prev && next && prev.endMs != null && next.startMs != null
        ? next.startMs - prev.endMs
        : 0;
    if (gap > longestGap) {
      longestGap = gap;
      splitIndex = i;
    }
  }
  if (splitIndex <= 0 || splitIndex >= cues.length) splitIndex = Math.ceil(cues.length / 2);

  return [
    ...batchCues(cues.slice(0, splitIndex), maxSize),
    ...batchCues(cues.slice(splitIndex), maxSize),
  ];
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildSystemPrompt(direction, movie) {
  const { sourceLang, targetLang } = DIRECTIONS[direction];
  const title = movie?.name_en || movie?.name_cs || 'Unknown';
  const year = movie?.edition_year ? ` (${movie.edition_year})` : '';
  return `You are a professional subtitle translator working for an international film festival.
Translate movie subtitle cues from ${sourceLang} to ${targetLang}.

Movie: ${title}${year}

You will receive numbered cues. Each cue starts with a marker line "#N" followed by the cue text, which may span multiple lines.

Rules:
1. Reply with the SAME cues: for each input cue output its "#N" marker on its own line, then the translated text. Same numbers, same order, one output cue per input cue. Never merge, split, drop, add, or reorder cues.
2. Translate meaning, register, and tone faithfully. Slang, insults, and profanity must be translated with equivalent strength — do not censor, soften, or embellish.
3. Preserve inline formatting tags exactly as positioned in the source (<i>, </i>, <b>, <font ...>, {\\an8} etc.), wrapping the corresponding words.
4. Keep subtitles readable: prefer at most 42 characters per line and at most 2 lines per cue; keep a cue's internal line break if the translation also needs two lines.
5. A cue may be a fragment of a sentence continuing into the next cue — translate so consecutive cues read naturally in sequence.
6. Output ONLY the numbered cues. No commentary, no headers, no code fences, no notes.`;
}

/**
 * @param {Array} batch cues to translate
 * @param {Array<{n:number, source:string, translation:string}>} previousContext
 */
function buildBatchUserMessage(batch, previousContext) {
  const parts = [];
  if (previousContext && previousContext.length > 0) {
    parts.push(
      'Context — final cues of the previous batch (source → your translation), for continuity only, do NOT re-output them:'
    );
    for (const c of previousContext) {
      parts.push(`#${c.n} ${c.source.replace(/\n/g, ' ')} → ${c.translation.replace(/\n/g, ' ')}`);
    }
    parts.push('');
  }
  parts.push(`Translate cues #${batch[0].n}–#${batch[batch.length - 1].n}:`);
  parts.push('');
  for (const cue of batch) {
    parts.push(`#${cue.n}`);
    parts.push(cue.text);
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Anthropic call + response parsing
// ---------------------------------------------------------------------------

let cachedClient = null;

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  if (!cachedClient) cachedClient = new Anthropic({ maxRetries: 4 });
  return cachedClient;
}

function getModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
}

/**
 * Split a model reply on "#N" marker lines and validate against the expected
 * cue numbers: every expected number present exactly once, none unexpected,
 * no empty translations.
 * @returns {Map<number, string>} n -> translated text
 */
function parseNumberedResponse(text, expectedNs) {
  const result = new Map();
  const re = /^#(\d+)\s*$/gm;
  const markers = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    markers.push({ n: parseInt(m[1], 10), start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < markers.length; i++) {
    const chunkEnd = i + 1 < markers.length ? markers[i + 1].start : text.length;
    const body = text.slice(markers[i].end, chunkEnd).trim();
    if (result.has(markers[i].n)) {
      throw new TranslationFormatError(`duplicate cue #${markers[i].n}`);
    }
    result.set(markers[i].n, body);
  }

  const expected = new Set(expectedNs);
  const missing = expectedNs.filter((n) => !result.has(n));
  const unexpected = [...result.keys()].filter((n) => !expected.has(n));
  const empty = expectedNs.filter((n) => result.has(n) && result.get(n) === '');
  const problems = [];
  if (missing.length) problems.push(`missing ${missing.slice(0, 5).map((n) => '#' + n).join(', ')}${missing.length > 5 ? '…' : ''}`);
  if (unexpected.length) problems.push(`unexpected ${unexpected.slice(0, 5).map((n) => '#' + n).join(', ')}${unexpected.length > 5 ? '…' : ''}`);
  if (empty.length) problems.push(`empty ${empty.slice(0, 5).map((n) => '#' + n).join(', ')}${empty.length > 5 ? '…' : ''}`);
  if (problems.length) throw new TranslationFormatError(problems.join('; '));

  return result;
}

/**
 * Translate one batch. On a malformed reply, retries once in the same
 * conversation with the validation error as feedback, then throws.
 * @returns {Promise<Map<number, string>>}
 */
async function translateBatch({ batch, direction, movie, previousContext }) {
  const system = buildSystemPrompt(direction, movie);
  const messages = [{ role: 'user', content: buildBatchUserMessage(batch, previousContext) }];
  const expectedNs = batch.map((c) => c.n);

  for (let attempt = 1; ; attempt++) {
    const response = await getClient().messages.create({
      model: getModel(),
      max_tokens: 8192,
      system,
      messages,
      // No temperature/top_p/top_k: rejected with 400 on current Opus models.
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return parseNumberedResponse(text, expectedNs);
    } catch (formatError) {
      if (!(formatError instanceof TranslationFormatError) || attempt >= 2) throw formatError;
      // Corrective retry: mid-conversation assistant messages are allowed
      // (only a trailing assistant prefill would be rejected).
      messages.push({ role: 'assistant', content: text || '(empty reply)' });
      messages.push({
        role: 'user',
        content:
          `Your reply was invalid: ${formatError.message}. ` +
          `Reply again with exactly cues #${expectedNs[0]}–#${expectedNs[expectedNs.length - 1]}, ` +
          `each as a "#N" line followed by its translation, nothing else.`,
      });
    }
  }
}

/** Map an error from the batch loop to a user-facing message. */
function describeError(error) {
  if (error instanceof TranslationFormatError) {
    return `Model produced invalid output after retry: ${error.message}`;
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Anthropic API key is invalid';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit exceeded — try again later';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status ?? 'network'}): ${error.message}`;
  }
  return error.message || 'Unknown error';
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

class SubtitleTranslator {
  constructor() {
    this.queue = [];
    this.running = new Set();
    this.cancelFlags = new Set();
  }

  isConfigured() {
    return isConfigured();
  }

  getModel() {
    return getModel();
  }

  /** Mark orphaned jobs from a previous process as interrupted. */
  async markInterruptedJobs() {
    try {
      const res = await pool.query(
        `UPDATE subtitle_translation_jobs SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'running') RETURNING id`
      );
      if (res.rowCount > 0) {
        logger.info('[SubtitleTranslator] Marked stale jobs interrupted', {
          count: res.rowCount,
        });
      }
    } catch (error) {
      logger.error('[SubtitleTranslator] markInterruptedJobs failed', {
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
          logger.error('[SubtitleTranslator] job crashed', {
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

  async checkCancelled(jobId) {
    if (this.isCancelled(jobId)) return true;
    const res = await pool.query(
      'SELECT cancel_requested FROM subtitle_translation_jobs WHERE id = $1',
      [jobId]
    );
    return res.rows[0]?.cancel_requested === true;
  }

  async runJob(jobId) {
    const jobRes = await pool.query('SELECT * FROM subtitle_translation_jobs WHERE id = $1', [
      jobId,
    ]);
    if (jobRes.rows.length === 0) return;
    const job = jobRes.rows[0];
    const dir = DIRECTIONS[job.direction];
    if (!dir) {
      await this.fail(jobId, `Unknown direction: ${job.direction}`);
      return;
    }
    if (!isConfigured()) {
      await this.fail(jobId, 'Subtitle translation is not configured (ANTHROPIC_API_KEY missing)');
      return;
    }
    if (!googleDrive.isConfigured()) {
      await this.fail(jobId, 'Google Drive is not configured');
      return;
    }

    await pool.query(
      `UPDATE subtitle_translation_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP,
         error_message = NULL WHERE id = $1`,
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

      // Source file name (for extension detection); the row may have been
      // replaced since job creation, so fall back to Drive metadata.
      const sourceRow = await pool.query(
        'SELECT file_name FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
        [job.movie_id, dir.sourceKind]
      );
      const sourceName =
        sourceRow.rows[0]?.file_name ||
        (await googleDrive.getFileMetadata(job.source_drive_file_id)).name;
      const ext = extensionOf(sourceName) || 'srt';

      const sourceText = await this.downloadText(job.source_drive_file_id);
      const cues = parseSubtitles(sourceText, ext);

      // Cues with no text bypass the LLM and are copied through unchanged.
      const translatable = cues.filter((c) => c.text !== '');
      const batches = batchCues(translatable);

      await pool.query(
        'UPDATE subtitle_translation_jobs SET total_cues = $2, batch_count = $3 WHERE id = $1',
        [jobId, cues.length, batches.length]
      );

      const translations = new Map();
      let previousContext = [];
      let done = 0;
      for (const batch of batches) {
        if (await this.checkCancelled(jobId)) {
          const err = new Error('Cancelled');
          err.cancelled = true;
          throw err;
        }

        const batchResult = await translateBatch({
          batch,
          direction: job.direction,
          movie,
          previousContext,
        });
        for (const [n, text] of batchResult) translations.set(n, text);
        previousContext = batch.slice(-CONTEXT_CUES).map((c) => ({
          n: c.n,
          source: c.text,
          translation: batchResult.get(c.n) || '',
        }));

        done += 1;
        await pool.query(
          `UPDATE subtitle_translation_jobs SET batches_done = $2, translated_cues = $3,
             progress_percent = $4 WHERE id = $1`,
          [
            jobId,
            done,
            Math.min(translations.size, cues.length),
            Math.round((done / batches.length) * 95),
          ]
        );
      }

      const outputCues = cues.map((c) => ({
        ...c,
        text: c.text === '' ? c.text : translations.get(c.n) ?? c.text,
      }));
      const srtText = serializeSrt(outputCues);

      const targetName = conventionFileName(movie, dir.targetKind, 'srt');
      const folderId = await googleDrive.ensureMovieFolder(movie);

      // Remember any pre-existing target file so we can trash it after the
      // replacement upload succeeds (Drive allows duplicate names).
      const oldTarget = await pool.query(
        'SELECT drive_file_id FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
        [job.movie_id, dir.targetKind]
      );
      const oldDriveFileId = oldTarget.rows[0]?.drive_file_id || null;

      const created = await googleDrive.uploadSmallFile({
        folderId,
        name: targetName,
        mimeType: 'application/x-subrip',
        body: Buffer.from(srtText, 'utf8'),
      });

      if (oldDriveFileId && oldDriveFileId !== created.id) {
        try {
          await googleDrive.trashFile(oldDriveFileId);
        } catch (trashError) {
          logger.warn('[SubtitleTranslator] failed to trash replaced subtitle file', {
            jobId,
            oldDriveFileId,
            error: trashError.message,
          });
        }
      }
      await upsertFileRow(job.movie_id, dir.targetKind, created);

      await pool.query(
        `UPDATE subtitle_translation_jobs SET status = 'completed', drive_file_id = $2,
           target_file_name = $3, translated_cues = $4, progress_percent = 100,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId, created.id, targetName, cues.length]
      );
      logger.info('[SubtitleTranslator] job completed', {
        jobId,
        driveFileId: created.id,
        cues: cues.length,
        batches: batches.length,
      });
    } catch (error) {
      if (error.cancelled) {
        await pool.query(
          `UPDATE subtitle_translation_jobs SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [jobId]
        );
        logger.info('[SubtitleTranslator] job cancelled', { jobId });
      } else {
        await this.fail(jobId, describeError(error));
        logger.error('[SubtitleTranslator] job failed', { jobId, error: error.message });
      }
    }
  }

  /** Download a Drive file into a utf8 string, capped at MAX_SUBTITLE_BYTES. */
  async downloadText(driveFileId) {
    const stream = await googleDrive.downloadFileStream(driveFileId);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      if (bytes > MAX_SUBTITLE_BYTES) {
        if (typeof stream.destroy === 'function') stream.destroy();
        throw new Error('Subtitle file is too large to translate (over 2 MiB)');
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async fail(jobId, message) {
    await pool.query(
      `UPDATE subtitle_translation_jobs SET status = 'failed', error_message = $2,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId, (message || 'Unknown error').slice(0, 1000)]
    );
  }
}

module.exports = new SubtitleTranslator();
module.exports.DIRECTIONS = DIRECTIONS;
module.exports.TranslationFormatError = TranslationFormatError;
// Pure helpers exported for unit tests.
module.exports.parseSrt = parseSrt;
module.exports.parseVtt = parseVtt;
module.exports.parseSubtitles = parseSubtitles;
module.exports.serializeSrt = serializeSrt;
module.exports.msFromTimestamp = msFromTimestamp;
module.exports.batchCues = batchCues;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.buildBatchUserMessage = buildBatchUserMessage;
module.exports.parseNumberedResponse = parseNumberedResponse;
