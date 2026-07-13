/**
 * In-process subtitle quality-gate runner. A run lints one subtitle file
 * (deterministic checks in services/subtitleQualityGate), stores per-cue
 * flags, then asks the LLM for fix suggestions for the flagged cues and
 * re-verifies each suggestion with the same linter. Runs are created
 * automatically after every translation job and on demand from the UI.
 *
 * Mirrors the SubtitleTranslator job pattern: DB row + in-memory queue,
 * SUBTITLE_QUALITY_MAX_CONCURRENT parallel runs (default 1), cancellation
 * checked between phases and suggestion batches, orphaned runs marked
 * 'interrupted' on boot.
 *
 * Reference-comparative checks need the counterpart-language ORIGINAL file
 * (cs* <-> en) with a matching cue count — guaranteed for translation
 * outputs, often false for manual uploads; then only single-file checks run
 * (formatting, reading speed, register mix).
 */

const { pool } = require('../models/database');
const { logger } = require('../utils/logger');
const googleDrive = require('./googleDrive');
const llmClient = require('./llmClient');
const gate = require('./subtitleQualityGate');
const { parseSubtitles } = require('../utils/subtitles');
const { extensionOf } = require('../utils/movieFileNaming');

const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.SUBTITLE_QUALITY_MAX_CONCURRENT || '1', 10) || 1
);
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
const SUGGEST_BATCH_SIZE = 20;
const SUGGEST_MAX_TOKENS = 8000;
const SUGGEST_CONTEXT_NEIGHBORS = 2;

/** The original counterpart used as translation reference for a lang. */
const REF_LANG = { cs: 'en', cs_synced: 'en', en: 'cs', en_synced: 'cs' };

const SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
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
  required: ['suggestions'],
  additionalProperties: false,
};

function movieHeading(movie) {
  const title = movie?.name_en || movie?.name_cs || 'Unknown';
  const year = movie?.edition_year ? ` (${movie.edition_year})` : '';
  return `Movie: ${title}${year}`;
}

/** Per-flag-code targeted instruction for the FIX line of the prompt. */
function fixInstruction(flag, cue) {
  const durS =
    cue.startMs != null && cue.endMs != null ? (cue.endMs - cue.startMs) / 1000 : 0;
  switch (flag.code) {
    case 'CPS': {
      const budget = durS > 0 ? Math.floor(durS * gate.DEFAULTS.cpsSoft) : null;
      return budget
        ? `shorten to at most ${budget} visible characters while keeping the meaning (${flag.message})`
        : `shorten — the cue cannot be read in time (${flag.message})`;
    }
    case 'FMT':
      return `rewrap or shorten to at most 2 lines of 42 characters (${flag.message})`;
    case 'GLOS':
      return flag.message; // already names the canonical term
    case 'REG':
      return 'fix the mixed informal/formal address (tykání/vykání) — keep the form the brief prescribes for these characters';
    case 'TAG':
      return 'restore the formatting tags exactly as positioned in the source';
    case 'UNTR':
      return 'this cue was left untranslated — translate it';
    case 'NUM':
      return flag.message + ' — keep numbers from the source';
    case 'LEN':
      return 'the translation length is suspicious vs the source — check for omissions or additions';
    default:
      return flag.message;
  }
}

function buildSuggestionSystemBlocks({ movie, lang, brief }) {
  const target = lang.startsWith('cs') ? 'Czech' : 'English';
  const sections = [];
  sections.push(`You are a professional subtitle translator working for an international film festival.
You will fix specific problems in individual ${target} subtitle cues without changing their meaning.`);
  sections.push(movieHeading(movie));
  if (brief) {
    sections.push(`Translation brief — follow it for names, register, and terminology:\n${brief}`);
  }
  sections.push(`Rules:
1. Reply with a JSON object {"suggestions": [{"n": <cue number>, "text": "<fixed cue text>"}, ...]} with exactly one entry per requested cue.
2. Fix ONLY what the FIX line asks for; keep meaning, register, and tone. Use "\\n" for a line break; at most 2 lines of 42 characters per cue.
3. Preserve inline formatting tags (<i>, </i>, <b>, {\\an8} etc.) as positioned in the source.
4. If a cue is already correct, return its current text unchanged.
5. The "suggestions" array is your entire reply. No commentary.`);
  return [{ type: 'text', text: sections.join('\n\n') }];
}

function buildSuggestionUserMessage({ items, cues, refCues }) {
  const parts = [`Fix the following cues:`, ''];
  for (const { cue, flags } of items) {
    const durS =
      cue.startMs != null && cue.endMs != null ? (cue.endMs - cue.startMs) / 1000 : 0;
    const budget = durS > 0 ? Math.floor(durS * gate.DEFAULTS.cpsSoft) : null;
    parts.push(`#${cue.n}${durS ? ` (${durS.toFixed(1)}s${budget ? `, aim ≤${budget} visible chars` : ''})` : ''}`);
    const ref = refCues ? refCues[cue.index] : null;
    if (ref && ref.text) parts.push(`SOURCE: ${ref.text.replace(/\n/g, ' ')}`);
    parts.push(`CURRENT: ${cue.text.replace(/\n/g, ' ')}`);
    const neighbors = [];
    for (
      let i = Math.max(0, cue.index - SUGGEST_CONTEXT_NEIGHBORS);
      i <= Math.min(cues.length - 1, cue.index + SUGGEST_CONTEXT_NEIGHBORS);
      i++
    ) {
      if (i !== cue.index && cues[i].text) {
        neighbors.push(`#${cues[i].n} ${cues[i].text.replace(/\n/g, ' ')}`);
      }
    }
    if (neighbors.length) parts.push(`CONTEXT: ${neighbors.join(' | ')}`);
    parts.push(`FIX: ${[...new Set(flags.map((f) => fixInstruction(f, cue)))].join('; ')}`);
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

class SubtitleQualityRunner {
  constructor() {
    this.queue = [];
    this.running = new Set();
    this.cancelFlags = new Set();
  }

  /** Mark orphaned runs from a previous process as interrupted. */
  async markInterruptedJobs() {
    try {
      const res = await pool.query(
        `UPDATE subtitle_quality_runs SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'running') RETURNING id`
      );
      if (res.rowCount > 0) {
        logger.info('[SubtitleQuality] Marked stale runs interrupted', { count: res.rowCount });
      }
    } catch (error) {
      logger.error('[SubtitleQuality] markInterruptedJobs failed', { error: error.message });
    }
  }

  /**
   * Create + enqueue a run for a just-finished translation job. Replaces any
   * still-active run for the same (movie, lang) so the fresh translation
   * always gets checked (the partial unique index would otherwise reject).
   */
  async createRunForTranslation({ movieId, lang, fileDriveId, translationJobId, createdBy }) {
    await pool.query(
      `UPDATE subtitle_quality_runs SET cancel_requested = true
       WHERE movie_id = $1 AND lang = $2 AND status IN ('pending', 'running')`,
      [movieId, lang]
    );
    // Cancel in-memory too so the slot frees up quickly.
    const active = await pool.query(
      `SELECT id FROM subtitle_quality_runs
       WHERE movie_id = $1 AND lang = $2 AND status IN ('pending', 'running')`,
      [movieId, lang]
    );
    for (const row of active.rows) this.cancel(row.id);
    // Wait is not needed: the unique index only blocks while the old run is
    // still pending/running; retry the insert briefly if it races.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const insert = await pool.query(
          `INSERT INTO subtitle_quality_runs (movie_id, lang, file_drive_id, translation_job_id, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [movieId, lang, fileDriveId, translationJobId, createdBy || null]
        );
        this.enqueue(insert.rows[0].id);
        return insert.rows[0];
      } catch (error) {
        if (error.code !== '23505' || attempt === 4) throw error;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return null;
  }

  enqueue(runId) {
    this.queue.push(runId);
    this.pump();
  }

  cancel(runId) {
    this.cancelFlags.add(runId);
  }

  pump() {
    while (this.running.size < MAX_CONCURRENT && this.queue.length > 0) {
      const runId = this.queue.shift();
      this.running.add(runId);
      this.runRun(runId)
        .catch((error) => {
          logger.error('[SubtitleQuality] run crashed', { runId, error: error.message });
        })
        .finally(() => {
          this.running.delete(runId);
          this.cancelFlags.delete(runId);
          this.pump();
        });
    }
  }

  async checkCancelled(runId) {
    if (this.cancelFlags.has(runId)) return true;
    const res = await pool.query(
      'SELECT cancel_requested FROM subtitle_quality_runs WHERE id = $1',
      [runId]
    );
    return res.rows[0]?.cancel_requested === true;
  }

  async runRun(runId) {
    const runRes = await pool.query('SELECT * FROM subtitle_quality_runs WHERE id = $1', [runId]);
    if (runRes.rows.length === 0) return;
    const run = runRes.rows[0];
    if (!googleDrive.isConfigured()) {
      await this.fail(runId, 'Google Drive is not configured');
      return;
    }

    await pool.query(
      `UPDATE subtitle_quality_runs SET status = 'running', phase = 'linting',
         started_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = $1`,
      [runId]
    );

    try {
      const movieRes = await pool.query(
        `SELECT m.id, m.name_cs, m.name_en, e.year AS edition_year
         FROM movies m JOIN editions e ON m.edition_id = e.id WHERE m.id = $1`,
        [run.movie_id]
      );
      if (movieRes.rows.length === 0) throw new Error('Movie not found');
      const movie = movieRes.rows[0];

      // Target file: current movie_files row (the file may have been
      // replaced since the run was created — same fallback as the translator).
      const fileRow = await pool.query(
        'SELECT drive_file_id, file_name, md5_checksum FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
        [run.movie_id, `subtitles_${run.lang}`]
      );
      if (fileRow.rows.length === 0) throw new Error('Subtitle file not found');
      const file = fileRow.rows[0];
      const ext = extensionOf(file.file_name) || 'srt';
      const text = await this.downloadText(file.drive_file_id);
      const cues = parseSubtitles(text, ext);

      // Reference: counterpart-language ORIGINAL file, used only when the
      // cue counts match (translation outputs preserve counts 1:1).
      let refCues = null;
      let refAvailable = false;
      let refCountMatch = false;
      const refRow = await pool.query(
        'SELECT drive_file_id, file_name FROM movie_files WHERE movie_id = $1 AND file_kind = $2',
        [run.movie_id, `subtitles_${REF_LANG[run.lang]}`]
      );
      if (refRow.rows.length > 0) {
        refAvailable = true;
        try {
          const refText = await this.downloadText(refRow.rows[0].drive_file_id);
          const parsed = parseSubtitles(refText, extensionOf(refRow.rows[0].file_name) || 'srt');
          if (parsed.length === cues.length) {
            refCountMatch = true;
            refCues = parsed;
          }
        } catch (refError) {
          logger.warn('[SubtitleQuality] reference file unusable; running single-file checks', {
            runId,
            error: refError.message,
          });
          refAvailable = false;
        }
      }

      // Glossary + brief text from the originating translation job, falling
      // back to the movie's newest completed job for this target language.
      let brief = null;
      let glossary = null;
      const jobQuery = run.translation_job_id
        ? pool.query('SELECT brief, brief_json FROM subtitle_translation_jobs WHERE id = $1', [
            run.translation_job_id,
          ])
        : pool.query(
            `SELECT brief, brief_json FROM subtitle_translation_jobs
             WHERE movie_id = $1 AND direction = $2 AND status = 'completed' AND brief IS NOT NULL
             ORDER BY created_at DESC LIMIT 1`,
            [run.movie_id, run.lang.startsWith('cs') ? 'en_to_cs' : 'cs_to_en']
          );
      const jobRes = await jobQuery;
      if (jobRes.rows.length > 0) {
        brief = jobRes.rows[0].brief || null;
        const briefJson = jobRes.rows[0].brief_json;
        if (briefJson && Array.isArray(briefJson.glossary) && briefJson.glossary.length > 0) {
          glossary = briefJson.glossary;
        }
      }

      // ---- Phase 1: lint -------------------------------------------------
      const flags = gate.lintCues({ cues, refCues, lang: run.lang, glossary });
      const counts = { error: 0, warn: 0, info: 0 };
      for (const f of flags) counts[f.severity]++;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE subtitle_quality_flags SET status = 'stale', updated_at = CURRENT_TIMESTAMP
           WHERE movie_id = $1 AND lang = $2 AND status = 'open'`,
          [run.movie_id, run.lang]
        );
        for (const f of flags) {
          const cue = cues[f.cueIndex];
          const refCue = refCues ? refCues[f.cueIndex] : null;
          // Deterministic reflow suggestion for pure formatting flags.
          let suggestion = null;
          let verified = null;
          if (f.code === 'FMT' && f.severity === 'info') {
            suggestion = gate.reflowText(cue.text);
            verified = suggestion !== null;
            if (suggestion === cue.text) suggestion = null;
          }
          await client.query(
            `INSERT INTO subtitle_quality_flags
               (run_id, movie_id, lang, file_drive_id, file_md5, cue_index, cue_n, cue_start_ms,
                code, severity, message, ref_text, target_text, suggestion, suggestion_verified)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              runId,
              run.movie_id,
              run.lang,
              file.drive_file_id,
              file.md5_checksum || null,
              f.cueIndex,
              f.cueN,
              cues[f.cueIndex].startMs ?? null,
              f.code,
              f.severity,
              f.message,
              refCue ? refCue.text : null,
              cue.text,
              suggestion,
              verified,
            ]
          );
        }
        await client.query(
          `UPDATE subtitle_quality_runs SET file_drive_id = $2, file_md5 = $3, total_cues = $4,
             flag_count = $5, error_count = $6, warn_count = $7, info_count = $8,
             ref_available = $9, ref_cue_count_match = $10
           WHERE id = $1`,
          [
            runId,
            file.drive_file_id,
            file.md5_checksum || null,
            cues.length,
            flags.length,
            counts.error,
            counts.warn,
            counts.info,
            refAvailable,
            refCountMatch,
          ]
        );
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      // ---- Phase 2: LLM suggestions (best-effort) ------------------------
      if (await this.checkCancelled(runId)) {
        const err = new Error('Cancelled');
        err.cancelled = true;
        throw err;
      }

      // One suggestion per cue with at least one error/warn flag.
      const flaggedByIndex = new Map();
      for (const f of flags) {
        if (f.severity === 'info') continue;
        if (!flaggedByIndex.has(f.cueIndex)) flaggedByIndex.set(f.cueIndex, []);
        flaggedByIndex.get(f.cueIndex).push(f);
      }
      const targets = [...flaggedByIndex.entries()].map(([index, cueFlags]) => ({
        cue: { ...cues[index], index },
        flags: cueFlags,
      }));

      if (targets.length > 0 && llmClient.isConfigured()) {
        await pool.query(
          `UPDATE subtitle_quality_runs SET phase = 'suggesting', suggest_total = $2 WHERE id = $1`,
          [runId, targets.length]
        );
        const systemBlocks = buildSuggestionSystemBlocks({ movie, lang: run.lang, brief });
        let done = 0;
        for (let i = 0; i < targets.length; i += SUGGEST_BATCH_SIZE) {
          if (await this.checkCancelled(runId)) {
            const err = new Error('Cancelled');
            err.cancelled = true;
            throw err;
          }
          const batch = targets.slice(i, i + SUGGEST_BATCH_SIZE);
          try {
            const suggestions = await this.suggestBatch({ systemBlocks, batch, cues, refCues });
            for (const { cue, flags: cueFlags } of batch) {
              const proposed = suggestions.get(cue.n);
              if (proposed === undefined) continue;
              let suggestion = proposed.trim();
              if (!suggestion || suggestion === cue.text) continue;
              // Re-verify: the original codes must no longer fire and no new
              // error may appear.
              const refCue = refCues ? refCues[cue.index] : null;
              const recheck = gate.lintSingleCue(
                { ...cue, text: suggestion },
                refCue,
                run.lang,
                glossary
              );
              const originalCodes = new Set(cueFlags.map((f) => f.code));
              const verified =
                !recheck.some((f) => originalCodes.has(f.code) && f.severity !== 'info') &&
                !recheck.some((f) => f.severity === 'error');
              await pool.query(
                `UPDATE subtitle_quality_flags SET suggestion = $2, suggestion_verified = $3
                 WHERE run_id = $1 AND cue_index = $4 AND status = 'open'`,
                [runId, suggestion, verified, cue.index]
              );
            }
          } catch (batchError) {
            logger.warn('[SubtitleQuality] suggestion batch failed; skipping', {
              runId,
              cues: batch.length,
              error: llmClient.describeError(batchError) || batchError.message,
            });
          }
          done += batch.length;
          await pool.query('UPDATE subtitle_quality_runs SET suggest_done = $2 WHERE id = $1', [
            runId,
            done,
          ]);
        }
      } else if (targets.length > 0) {
        logger.warn('[SubtitleQuality] no LLM provider configured; run completes without suggestions', {
          runId,
        });
      }

      await pool.query(
        `UPDATE subtitle_quality_runs SET status = 'completed', phase = NULL,
           finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [runId]
      );
      logger.info('[SubtitleQuality] run completed', {
        runId,
        flags: flags.length,
        suggested: targets.length,
      });
    } catch (error) {
      if (error.cancelled) {
        await pool.query(
          `UPDATE subtitle_quality_runs SET status = 'cancelled', phase = NULL,
             finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [runId]
        );
        logger.info('[SubtitleQuality] run cancelled', { runId });
      } else {
        await this.fail(runId, llmClient.describeError(error) || error.message);
        logger.error('[SubtitleQuality] run failed', { runId, error: error.message });
      }
    }
  }

  /** One suggestion call; a single corrective retry on an invalid reply. */
  async suggestBatch({ systemBlocks, batch, cues, refCues }) {
    const expected = new Set(batch.map(({ cue }) => cue.n));
    const messages = [
      { role: 'user', content: buildSuggestionUserMessage({ items: batch, cues, refCues }) },
    ];
    for (let attempt = 1; ; attempt++) {
      const response = await llmClient.complete({
        systemBlocks,
        messages,
        maxTokens: SUGGEST_MAX_TOKENS,
        jsonSchema: SUGGESTIONS_SCHEMA,
        schemaName: 'cue_suggestions',
        stage: 'quality_suggest',
      });
      if (response.refusal) throw new Error(`model refused: ${response.refusal}`);
      try {
        const parsed = JSON.parse(response.text);
        if (!parsed || !Array.isArray(parsed.suggestions)) throw new Error('no "suggestions" array');
        const result = new Map();
        for (const s of parsed.suggestions) {
          if (s && Number.isInteger(s.n) && typeof s.text === 'string' && expected.has(s.n)) {
            result.set(s.n, s.text);
          }
        }
        if (result.size === 0) throw new Error('no usable suggestions in reply');
        return result;
      } catch (parseError) {
        if (attempt >= 2) throw parseError;
        messages.push({ role: 'assistant', content: response.text || '(empty reply)' });
        messages.push({
          role: 'user',
          content: `Your reply was invalid: ${parseError.message}. Reply again with a JSON object whose "suggestions" array contains exactly one entry per requested cue.`,
        });
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
        throw new Error('Subtitle file is too large to check (over 2 MiB)');
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async fail(runId, message) {
    await pool.query(
      `UPDATE subtitle_quality_runs SET status = 'failed', phase = NULL, error_message = $2,
         finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [runId, (message || 'Unknown error').slice(0, 1000)]
    );
  }
}

module.exports = new SubtitleQualityRunner();
// Pure helpers exported for unit tests.
module.exports.buildSuggestionSystemBlocks = buildSuggestionSystemBlocks;
module.exports.buildSuggestionUserMessage = buildSuggestionUserMessage;
module.exports.fixInstruction = fixInstruction;
module.exports.REF_LANG = REF_LANG;
