/**
 * In-process subtitle translation job runner: downloads a movie's subtitle
 * file (.srt or .vtt) from Drive, machine-translates it between Czech and
 * English with the Anthropic API, and uploads the result back to the movie's
 * Drive folder as a convention-named .srt.
 *
 * Timings are never touched: cue timing lines are copied from the source
 * verbatim, only the text is translated. Cues are sent in batches split at
 * the largest temporal gap (scene changes), with the tail of the previous
 * batch passed along as context for continuity.
 *
 * Every model call carries the complete source subtitle text as a cached
 * system block (prompt caching: written once by the brief pre-pass, read by
 * every batch), plus the movie synopsis from the DB where available. A
 * one-shot pre-pass produces a translation brief (names, register,
 * tykání/vykání, terminology) injected into each batch's prompt; if it
 * fails, the job continues without it. An optional user-provided context
 * note (job.context_note — e.g. who addresses whom formally, character
 * genders, terminology) is treated as authoritative and fed to both the
 * pre-pass and every batch prompt.
 *
 * Replies are constrained by structured outputs to a JSON object
 * {"cues": [{"n", "text"}, ...]} and validated against the expected cue
 * numbers; semantically invalid replies get one corrective retry. Output
 * truncated at max_tokens causes the batch to be split in half and retried.
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
const MAX_OUTPUT_TOKENS = 16000; // headroom for adaptive thinking + translated cues
const BRIEF_MAX_TOKENS = 8000;
const BRIEF_MAX_CHARS = 4000; // cap on the pre-pass translation brief
const SYNOPSIS_MAX_CHARS = 2000;

const DIRECTIONS = {
  cs_to_en: { sourceKind: 'subtitles_cs', targetKind: 'subtitles_en', sourceLang: 'Czech', targetLang: 'English' },
  en_to_cs: { sourceKind: 'subtitles_en', targetKind: 'subtitles_cs', sourceLang: 'English', targetLang: 'Czech' },
};

class TranslationFormatError extends Error {}
class TranslationTruncatedError extends Error {}

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

/**
 * The full source subtitle text as a cache-controlled system block. It comes
 * FIRST in every call's system array and must stay byte-identical within a
 * job: the brief pre-pass writes the cache entry, every batch call reads it.
 */
function buildSourceReferenceBlock(sourceText) {
  return {
    type: 'text',
    text:
      'Reference — the complete source subtitle text of the film, for context only:\n\n' +
      sourceText,
    cache_control: { type: 'ephemeral' },
  };
}

function movieHeading(movie) {
  const title = movie?.name_en || movie?.name_cs || 'Unknown';
  const year = movie?.edition_year ? ` (${movie.edition_year})` : '';
  const parts = [`Movie: ${title}${year}`];
  const synopsis = (movie?.synopsis_cs || movie?.synopsis_en || '').trim();
  if (synopsis) parts.push(`Synopsis:\n${synopsis.slice(0, SYNOPSIS_MAX_CHARS)}`);
  return parts.join('\n\n');
}

/** The user-provided context note as an authoritative prompt section. */
function contextNoteSection(contextNote) {
  return `Notes from the festival team — authoritative; where they conflict with the brief or your own inference, the notes win:\n${contextNote}`;
}

/**
 * @returns {Array} system content blocks: [cached source reference?, instructions]
 */
function buildSystemPrompt(direction, movie, { sourceText, brief, contextNote } = {}) {
  const { sourceLang, targetLang } = DIRECTIONS[direction];
  const sections = [];
  sections.push(`You are a professional subtitle translator working for an international film festival.
Translate movie subtitle cues from ${sourceLang} to ${targetLang}.`);
  sections.push(movieHeading(movie));
  if (contextNote) {
    sections.push(contextNoteSection(contextNote));
  }
  if (brief) {
    sections.push(`Translation brief — follow it for names, register, and terminology:\n${brief}`);
  }
  sections.push(`You will receive numbered cues. Each cue starts with a marker line "#N" followed by the cue text, which may span multiple lines.

Rules:
1. Reply with a JSON object {"cues": [{"n": <cue number>, "text": "<translation>"}, ...]} containing exactly one entry per input cue: same numbers, same order. Never merge, split, drop, add, or reorder cues.
2. Translate meaning, register, and tone faithfully. Slang, insults, and profanity must be translated with equivalent strength — do not censor, soften, or embellish.
3. Preserve inline formatting tags exactly as positioned in the source (<i>, </i>, <b>, <font ...>, {\\an8} etc.), wrapping the corresponding words.
4. Keep subtitles readable: prefer at most 42 characters per line and at most 2 lines per cue; use "\\n" inside "text" for a line break, and keep a cue's internal line break if the translation also needs two lines.
5. A cue may be a fragment of a sentence continuing into the next cue — translate so consecutive cues read naturally in sequence.
6. Use the reference subtitles, synopsis, and brief to keep names, terminology, and register consistent across the whole film. Where the target language distinguishes formality (tykání/vykání) or gendered forms (e.g. Czech past-tense verbs), keep them consistent for each character and each pair of characters.
7. The "cues" array is your entire reply. No commentary, no notes.`);

  const blocks = [];
  if (sourceText) blocks.push(buildSourceReferenceBlock(sourceText));
  blocks.push({ type: 'text', text: sections.join('\n\n') });
  return blocks;
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

// Structured-outputs schema for batch replies: {"cues": [{"n", "text"}, ...]}.
const TRANSLATION_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      cues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer' },
            text: { type: 'string' },
          },
          required: ['n', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['cues'],
    additionalProperties: false,
  },
};

function logModelUsage(stage, response, extra = {}) {
  const usage = response.usage || {};
  logger.debug('[SubtitleTranslator] model call', {
    stage,
    stopReason: response.stop_reason,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    ...extra,
  });
}

/**
 * Parse a structured-outputs JSON reply and validate against the expected
 * cue numbers: every expected number present exactly once, none unexpected,
 * no empty translations.
 * @returns {Map<number, string>} n -> translated text
 */
function parseTranslatedCues(text, expectedNs) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (parseError) {
    throw new TranslationFormatError(`reply is not valid JSON: ${parseError.message}`);
  }
  if (!parsed || !Array.isArray(parsed.cues)) {
    throw new TranslationFormatError('reply JSON has no "cues" array');
  }
  const result = new Map();
  for (const cue of parsed.cues) {
    if (!cue || !Number.isInteger(cue.n) || typeof cue.text !== 'string') {
      throw new TranslationFormatError('cue entry missing integer "n" or string "text"');
    }
    if (result.has(cue.n)) {
      throw new TranslationFormatError(`duplicate cue #${cue.n}`);
    }
    result.set(cue.n, cue.text.trim());
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
 * One-shot pre-pass: have the model read the full source subtitles and write
 * a translation brief (names, formality per character pair, genders,
 * terminology, tone) that is then injected into every batch's prompt. Also
 * writes the prompt-cache entry for the source reference block that all
 * batch calls read. A user context note is passed in as authoritative facts
 * the brief must incorporate.
 * @returns {Promise<string|null>}
 */
async function buildTranslationBrief({ direction, movie, sourceText, contextNote }) {
  const { sourceLang, targetLang } = DIRECTIONS[direction];
  const system = [
    buildSourceReferenceBlock(sourceText),
    {
      type: 'text',
      text: `You are preparing a brief for translating a film's subtitles from ${sourceLang} to ${targetLang}.

${movieHeading(movie)}`,
    },
  ];
  const response = await getClient().messages.create({
    model: getModel(),
    max_tokens: BRIEF_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system,
    messages: [
      {
        role: 'user',
        content: `${contextNote ? contextNoteSection(contextNote) + '\n\n' : ''}Read the full source subtitles above and write a concise translation brief:
1. Character names and how to render them in ${targetLang}.
2. Who addresses whom formally vs informally (tykání/vykání), per character pair.
3. Speaker genders where inferable (matters for gendered verb/adjective forms).
4. Recurring terms, phrases, or wordplay, with the translation to use consistently.
5. Overall tone and register of the film.

Plain text, at most 40 lines, no preamble.`,
      },
    ],
  });
  logModelUsage('brief', response);
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text ? text.slice(0, BRIEF_MAX_CHARS) : null;
}

/**
 * Translate one batch. On a semantically invalid reply, retries once in the
 * same conversation with the validation error as feedback, then throws.
 * Output truncated at max_tokens throws TranslationTruncatedError.
 * @returns {Promise<Map<number, string>>}
 */
async function translateBatch({ batch, direction, movie, sourceText, brief, contextNote, previousContext }) {
  const system = buildSystemPrompt(direction, movie, { sourceText, brief, contextNote });
  const messages = [{ role: 'user', content: buildBatchUserMessage(batch, previousContext) }];
  const expectedNs = batch.map((c) => c.n);

  for (let attempt = 1; ; attempt++) {
    const response = await getClient().messages.create({
      model: getModel(),
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { format: TRANSLATION_OUTPUT_FORMAT },
      system,
      messages,
      // No temperature/top_p/top_k: rejected with 400 on current Opus models.
    });
    logModelUsage('batch', response, { cues: batch.length, attempt });
    if (response.stop_reason === 'max_tokens') {
      throw new TranslationTruncatedError(
        `output truncated at max_tokens for cues #${expectedNs[0]}–#${expectedNs[expectedNs.length - 1]}`
      );
    }
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    try {
      return parseTranslatedCues(text, expectedNs);
    } catch (formatError) {
      if (!(formatError instanceof TranslationFormatError) || attempt >= 2) throw formatError;
      // Corrective retry: mid-conversation assistant messages are allowed
      // (only a trailing assistant prefill would be rejected).
      messages.push({ role: 'assistant', content: text || '(empty reply)' });
      messages.push({
        role: 'user',
        content:
          `Your reply was invalid: ${formatError.message}. ` +
          `Reply again with a JSON object whose "cues" array contains exactly cues ` +
          `#${expectedNs[0]}–#${expectedNs[expectedNs.length - 1]}, nothing else.`,
      });
    }
  }
}

/**
 * translateBatch, but when the output is truncated at max_tokens the batch
 * is split in half and each half translated separately (recursively), with
 * cross-half context re-derived so continuity is kept.
 */
async function translateBatchWithSplit(args) {
  try {
    return await translateBatch(args);
  } catch (error) {
    if (!(error instanceof TranslationTruncatedError) || args.batch.length < 2) throw error;
    const mid = Math.ceil(args.batch.length / 2);
    const first = args.batch.slice(0, mid);
    const second = args.batch.slice(mid);
    logger.warn('[SubtitleTranslator] batch output truncated; splitting in half', {
      cues: args.batch.length,
    });
    const firstResult = await translateBatchWithSplit({ ...args, batch: first });
    const secondContext = first.slice(-CONTEXT_CUES).map((c) => ({
      n: c.n,
      source: c.text,
      translation: firstResult.get(c.n) || '',
    }));
    const secondResult = await translateBatchWithSplit({
      ...args,
      batch: second,
      previousContext: secondContext,
    });
    return new Map([...firstResult, ...secondResult]);
  }
}

/** Map an error from the batch loop to a user-facing message. */
function describeError(error) {
  if (error instanceof TranslationFormatError) {
    return `Model produced invalid output after retry: ${error.message}`;
  }
  if (error instanceof TranslationTruncatedError) {
    return `Model output was truncated: ${error.message}`;
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
        `SELECT m.id, m.name_cs, m.name_en, m.synopsis_cs, m.synopsis_en, m.drive_folder_id,
           e.year AS edition_year
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

      // Pre-pass: translation brief for cross-film consistency. Optional —
      // the job carries on without one. Also warms the prompt cache for the
      // source reference block the batch calls reuse.
      let brief = null;
      if (!(await this.checkCancelled(jobId))) {
        try {
          brief = await buildTranslationBrief({
            direction: job.direction,
            movie,
            sourceText,
            contextNote: job.context_note,
          });
        } catch (briefError) {
          logger.warn('[SubtitleTranslator] translation brief pre-pass failed; continuing without it', {
            jobId,
            error: briefError.message,
          });
        }
      }

      const translations = new Map();
      let previousContext = [];
      let done = 0;
      for (const batch of batches) {
        if (await this.checkCancelled(jobId)) {
          const err = new Error('Cancelled');
          err.cancelled = true;
          throw err;
        }

        const batchResult = await translateBatchWithSplit({
          batch,
          direction: job.direction,
          movie,
          sourceText,
          brief,
          contextNote: job.context_note,
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
module.exports.TranslationTruncatedError = TranslationTruncatedError;
// Pure helpers exported for unit tests.
module.exports.parseSrt = parseSrt;
module.exports.parseVtt = parseVtt;
module.exports.parseSubtitles = parseSubtitles;
module.exports.serializeSrt = serializeSrt;
module.exports.msFromTimestamp = msFromTimestamp;
module.exports.batchCues = batchCues;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.buildBatchUserMessage = buildBatchUserMessage;
module.exports.parseTranslatedCues = parseTranslatedCues;
