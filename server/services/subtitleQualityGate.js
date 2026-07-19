/**
 * Deterministic subtitle quality linter — no LLM, no I/O. Checks one cue
 * array (optionally against the counterpart-language file and a glossary
 * extracted from the translation brief) and returns per-cue flags.
 *
 * Reference-comparative checks (TAG/GLOS/UNTR/LEN/NUM) run only when
 * refCues is provided — the caller passes it only when the counterpart file
 * exists AND its cue count matches (guaranteed for translation outputs,
 * not for manual uploads).
 *
 * Severities: 'error' (broken output: missing tags, unreadable speed,
 * untranslated), 'warn' (needs a human look), 'info' (auto-fixable or
 * cosmetic — e.g. a line-break reflow, tags the model added on purpose).
 */

const DEFAULTS = {
  maxLine: 42,
  maxLines: 2,
  cpsSoft: 17,
  cpsHard: 20,
};

const TAG_RE = /<\/?[a-z][^>]*>|\{\\[^}]*\}/gi;
const stripTags = (s) => String(s || '').replace(TAG_RE, '');
const tagMultiset = (s) =>
  (String(s || '').match(TAG_RE) || []).map((t) => t.toLowerCase().replace(/\s+/g, ' ')).sort();
const visibleChars = (s) => stripTags(s).replace(/\n/g, '').length;

// Czech register signals. Only SINGULAR informal forms are unambiguous
// tykání; vy/váš/2pl verbs are ambiguous (formal singular OR plural).
// NOTE: \b is ASCII-only in JS, so words ending in diacritics (víš, máš)
// never match a trailing \b — use Unicode letter lookarounds instead.
const T_SG =
  /(?<![\p{L}\p{N}])(ty|tě|ti|tebe|tobě|tvůj|tvoje|tvá|tvé|tvého|tvému|tvým|tvými|tvou|jsi|seš|víš|chceš|máš|musíš|můžeš|budeš|uděláš|řekneš|myslíš|věříš|znáš|vidíš|slyšíš|půjdeš|přijdeš|podívej|počkej|poslouchej|pojď|řekni|udělej|přestaň|nezapomeň|pamatuj|nech|dej|vezmi|běž|jdi|nechoď)(?![\p{L}\p{N}])/iu;
const V_PRON =
  /(?<![\p{L}\p{N}])(vy|vás|vám|vámi|váš|vaše|vaši|vašeho|vašemu|vaším|vašich|vašim)(?![\p{L}\p{N}])/iu;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const normalizeForCompare = (s) =>
  stripTags(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Untranslated-check skip heuristic: cues made of proper nouns, Latin, songs
 * or other deliberately-untranslated material. Skip when >=60% of words are
 * capitalized or numeric, or the whole cue is italicized.
 */
function looksLikeProperNounsOrForeign(text) {
  const stripped = stripTags(text).trim();
  if (/^<i>[\s\S]*<\/i>$/.test(String(text).trim())) return true;
  const words = stripped.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return true;
  const properish = words.filter((w) => /^[\p{Lu}\d]/u.test(w)).length;
  return properish / words.length >= 0.6;
}

/** Can the text be reflowed to <= maxLines lines of <= maxLine chars? */
function reflowFits(text, { maxLine, maxLines } = DEFAULTS) {
  return reflowText(text, { maxLine, maxLines }) !== null;
}

/**
 * Deterministic line-break fix: rejoin all words and split into 1 or 2
 * balanced lines within the limits. Returns the reflowed text, or null when
 * it cannot fit. Only whitespace changes — never words. Cues with inline
 * tags are left alone (tag-safe reflow is not worth the complexity).
 */
function reflowText(text, { maxLine, maxLines } = DEFAULTS) {
  if (TAG_RE.test(text)) {
    TAG_RE.lastIndex = 0;
    return null;
  }
  TAG_RE.lastIndex = 0;
  const words = String(text).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  const full = words.join(' ');
  if (full.length <= maxLine) return full;
  if (maxLines < 2) return null;
  let best = null;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length <= maxLine && b.length <= maxLine) {
      const score = Math.max(a.length, b.length);
      if (score < bestScore) {
        bestScore = score;
        best = `${a}\n${b}`;
      }
    }
  }
  return best;
}

const cps = (text, durS) => (durS > 0 ? visibleChars(text) / durS : 0);

/**
 * Lint one cue. Returns flags without cueIndex/cueN (the caller adds them).
 * @param {{text:string, startMs:number|null, endMs:number|null}} cue
 * @param {{text:string}|null} refCue counterpart-language cue or null
 * @param {string} lang 'cs'|'en'|'cs_synced'|'en_synced'
 * @param {Array<{en:string, cs:string, note?:string}>|null} glossary
 */
function lintSingleCue(cue, refCue, lang, glossary, thresholds = DEFAULTS) {
  const t = { ...DEFAULTS, ...thresholds };
  const flags = [];
  const text = cue.text;
  if (text === '') return flags;

  // TAG — compare tag multisets against the reference. Additions only
  // (e.g. the model italicizing Latin) are cosmetic; losses are errors.
  if (refCue && refCue.text !== '') {
    const refTags = tagMultiset(refCue.text);
    const gotTags = tagMultiset(text);
    if (JSON.stringify(refTags) !== JSON.stringify(gotTags)) {
      const missing = refTags.filter((tag) => {
        const i = gotTags.indexOf(tag);
        if (i === -1) return true;
        gotTags.splice(i, 1);
        return false;
      });
      if (missing.length === 0) {
        flags.push({
          code: 'TAG',
          severity: 'info',
          message: `formatting tags added beyond the source (${tagMultiset(text).join(', ')})`,
        });
      } else {
        flags.push({
          code: 'TAG',
          severity: 'error',
          message: `formatting tags lost or altered (source has ${refTags.join(', ') || 'none'})`,
        });
      }
    }
  }

  // FMT — line count / line length, with deterministic reflow when possible.
  const lines = text.split('\n');
  const tooManyLines = lines.length > t.maxLines;
  const longLines = lines.filter((l) => l.length > t.maxLine);
  if (tooManyLines || longLines.length > 0) {
    const fits = reflowFits(text, t);
    const what = tooManyLines
      ? `${lines.length} lines (max ${t.maxLines})`
      : `line of ${Math.max(...longLines.map((l) => l.length))} chars (max ${t.maxLine})`;
    flags.push({
      code: 'FMT',
      severity: fits ? 'info' : 'warn',
      message: fits ? `${what} — can be reflowed automatically` : `${what} — does not fit ${t.maxLines}×${t.maxLine}, needs shortening`,
    });
  }

  // CPS — reading speed from the cue's own timing.
  const durS = cue.startMs != null && cue.endMs != null ? (cue.endMs - cue.startMs) / 1000 : 0;
  if (durS > 0) {
    const v = cps(text, durS);
    const budget = Math.floor(durS * t.cpsSoft);
    if (v > t.cpsHard) {
      flags.push({
        code: 'CPS',
        severity: 'error',
        message: `reading speed ${v.toFixed(1)} CPS exceeds ${t.cpsHard} (${visibleChars(text)} chars in ${durS.toFixed(1)}s; aim for ≤${budget} chars)`,
      });
    } else if (v > t.cpsSoft) {
      flags.push({
        code: 'CPS',
        severity: 'warn',
        message: `reading speed ${v.toFixed(1)} CPS exceeds ${t.cpsSoft} (aim for ≤${budget} chars)`,
      });
    }
  }

  // REG — Czech only: unambiguous tykání signal + formal pronoun in one cue.
  if (lang.startsWith('cs') && T_SG.test(stripTags(text)) && V_PRON.test(stripTags(text))) {
    flags.push({
      code: 'REG',
      severity: 'warn',
      message: 'mixes informal (tykání) and formal (vykání) address in one cue',
    });
  }

  if (refCue && refCue.text !== '') {
    const refText = refCue.text;

    // GLOS — canonical terms from the brief. The flagged file may be either
    // language, so match whichever side appears in the reference and demand
    // the other side in the target. Plain-phrase match, metachars escaped.
    if (glossary) {
      for (const g of glossary) {
        if (!g || !g.en || !g.cs) continue;
        const pairs =
          lang.startsWith('cs')
            ? [{ find: g.en, want: g.cs }]
            : [{ find: g.cs, want: g.en }];
        for (const { find, want } of pairs) {
          // Unicode-safe left boundary (ASCII \b breaks on Czech diacritics);
          // every word allows a suffix so declined forms still match
          // (Společnost/Společnosti, básníků/básnícím...).
          const phraseRe = (phrase) =>
            new RegExp(
              '(?<![\\p{L}\\p{N}])' +
                String(phrase).trim().split(/\s+/).map(escapeRegExp).join('\\S*\\s+') +
                '\\S*',
              'iu'
            );
          if (phraseRe(find).test(stripTags(refText)) && !phraseRe(want).test(stripTags(text))) {
            flags.push({
              code: 'GLOS',
              severity: 'warn',
              message: `"${find}" should use the canonical translation "${want}"${g.note ? ` (${g.note})` : ''}`,
            });
          }
        }
      }
    }

    // UNTR — target identical to source (proper-noun/foreign cues skipped).
    const refWords = stripTags(refText).split(/\s+/).filter(Boolean);
    if (
      refWords.length >= 3 &&
      normalizeForCompare(text) === normalizeForCompare(refText) &&
      !looksLikeProperNounsOrForeign(refText)
    ) {
      flags.push({
        code: 'UNTR',
        severity: 'error',
        message: 'looks untranslated (identical to the source text)',
      });
    }

    // LEN — suspicious length ratio.
    const refC = visibleChars(refText);
    const gotC = visibleChars(text);
    if (refC >= 12 && (gotC < refC * 0.4 || gotC > refC * 2.5)) {
      flags.push({
        code: 'LEN',
        severity: 'warn',
        message: `length anomaly: source ${refC} chars vs translation ${gotC} chars`,
      });
    }

    // NUM — digit groups from the source must survive.
    const refDigits = stripTags(refText).match(/\d+/g) || [];
    const gotDigits = new Set(stripTags(text).match(/\d+/g) || []);
    for (const d of refDigits) {
      if (!gotDigits.has(d)) {
        flags.push({
          code: 'NUM',
          severity: 'warn',
          message: `number "${d}" from the source is missing`,
        });
      }
    }
  }

  return flags;
}

/**
 * Lint a whole cue array.
 * @returns {Array<{cueIndex:number, cueN:number, code:string, severity:string, message:string}>}
 */
function lintCues({ cues, refCues = null, lang, glossary = null, thresholds = DEFAULTS }) {
  const flags = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const refCue = refCues ? refCues[i] || null : null;
    for (const f of lintSingleCue(cue, refCue, lang, glossary, thresholds)) {
      flags.push({ cueIndex: i, cueN: cue.n ?? i + 1, ...f });
    }
  }
  return flags;
}

module.exports = {
  DEFAULTS,
  lintCues,
  lintSingleCue,
  reflowText,
  reflowFits,
  stripTags,
  visibleChars,
  cps,
  escapeRegExp,
};
