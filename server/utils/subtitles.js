/**
 * Decode a subtitle file buffer to a string, tolerating legacy encodings.
 *
 * Order of preference:
 *   1. UTF-16 LE/BE when a BOM says so
 *   2. strict UTF-8 (the common case — passes through unchanged)
 *   3. Windows-1250, the de-facto legacy encoding for Czech .srt files
 *
 * Without the fallback, CP1250 bytes like 0xED (í) / 0x9E (ž) are invalid
 * UTF-8 and every diacritic renders as the U+FFFD � replacement character.
 */
function decodeSubtitleBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le').replace(/^\uFEFF/, '');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1250').decode(buf);
  }
}

/**
 * Convert SubRip (.srt) subtitle text to WebVTT (.vtt), which is what the
 * HTML5 <track> element requires. Pure, no I/O.
 *
 * The transform is deliberately minimal:
 *   - strip a leading UTF-8 BOM
 *   - normalize CRLF / CR line endings to LF
 *   - turn the millisecond comma into a period, but ONLY on timing lines
 *     (those containing '-->'), so commas inside cue text are left alone
 *   - prepend the mandatory WEBVTT header
 *
 * Numeric cue identifiers from SRT are valid in VTT, so they are kept as-is.
 * If the input already looks like VTT (starts with WEBVTT), it is returned
 * unchanged (idempotent).
 */
function convertSrtToVtt(srtText) {
  let text = String(srtText == null ? '' : srtText);

  // Strip UTF-8 BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Normalize line endings.
  text = text.replace(/\r\n?/g, '\n');

  if (/^\s*WEBVTT/.test(text)) {
    return text; // already VTT
  }

  // Comma -> period only on timing lines.
  text = text
    .split('\n')
    .map((line) =>
      line.includes('-->')
        ? line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
        : line
    )
    .join('\n');

  return 'WEBVTT\n\n' + text.replace(/^\n+/, '');
}

// ---------------------------------------------------------------------------
// Parsing / serialization (pure)
// ---------------------------------------------------------------------------

/** "01:02:03,456" / "01:02:03.456" / "02:03.456" (VTT, optional hours) -> ms */
function msFromTimestamp(ts) {
  const m = String(ts).match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    (parseInt(h || '0', 10) * 3600 + parseInt(min, 10) * 60 + parseInt(s, 10)) * 1000 +
    parseInt(ms.padEnd(3, '0'), 10)
  );
}

function normalize(text) {
  let t = String(text == null ? '' : text);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // strip BOM
  return t.replace(/\r\n?/g, '\n');
}

const TIMING_RE = /^(\S+)\s+-->\s+(\S+)(.*)$/;

/**
 * Parse SRT text into cues. Timing lines are kept verbatim so serialization
 * never perturbs timestamps; startMs/endMs are parsed only for gap analysis.
 * @returns {Array<{n:number, timing:string, startMs:number|null, endMs:number|null, text:string}>}
 */
function parseSrt(text) {
  const blocks = normalize(text).split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i) => !(i === 0 && l.trim() === ''));
    if (lines.length === 0) continue;
    let idx = 0;
    // Optional numeric counter line.
    if (/^\d+\s*$/.test(lines[0]) && lines[1] && lines[1].includes('-->')) idx = 1;
    const timingLine = lines[idx];
    if (!timingLine || !timingLine.includes('-->')) continue;
    const m = timingLine.trim().match(TIMING_RE);
    cues.push({
      n: cues.length + 1,
      timing: timingLine.trim(),
      startMs: m ? msFromTimestamp(m[1]) : null,
      endMs: m ? msFromTimestamp(m[2]) : null,
      text: lines.slice(idx + 1).join('\n').trim(),
    });
  }
  if (cues.length === 0) throw new Error('No subtitle cues found in file');
  return cues;
}

/**
 * Parse WebVTT into the same cue shape, converting timings to SRT form
 * (comma millis, always with hours, cue settings after the arrow dropped).
 */
function parseVtt(text) {
  const normalized = normalize(text).replace(/^\s*WEBVTT[^\n]*\n?/, '');
  const blocks = normalized.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i) => !(i === 0 && l.trim() === ''));
    if (lines.length === 0) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0].trim())) continue;
    // Optional cue identifier line before the timing line.
    let idx = lines[0].includes('-->') ? 0 : 1;
    const timingLine = lines[idx];
    if (!timingLine || !timingLine.includes('-->')) continue;
    const m = timingLine.trim().match(TIMING_RE);
    if (!m) continue;
    const toSrtTs = (ts) => {
      const ms = msFromTimestamp(ts);
      if (ms == null) return null;
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const min = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      const mil = String(ms % 1000).padStart(3, '0');
      return `${h}:${min}:${s},${mil}`;
    };
    const start = toSrtTs(m[1]);
    const end = toSrtTs(m[2]);
    if (start == null || end == null) continue;
    cues.push({
      n: cues.length + 1,
      timing: `${start} --> ${end}`,
      startMs: msFromTimestamp(m[1]),
      endMs: msFromTimestamp(m[2]),
      text: lines.slice(idx + 1).join('\n').trim(),
    });
  }
  if (cues.length === 0) throw new Error('No subtitle cues found in file');
  return cues;
}

function parseSubtitles(text, ext) {
  if (ext === 'vtt' || /^\s*(﻿)?WEBVTT/.test(String(text))) return parseVtt(text);
  return parseSrt(text);
}

/** Serialize cues back to SRT (renumbered 1..N, LF endings, trailing newline). */
function serializeSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${c.timing}\n${c.text}\n`).join('\n') + '\n';
}

/** Serialize cues to WebVTT (SRT form piped through the SRT->VTT converter). */
function serializeVtt(cues) {
  return convertSrtToVtt(serializeSrt(cues));
}

module.exports = {
  convertSrtToVtt,
  decodeSubtitleBuffer,
  msFromTimestamp,
  normalize,
  parseSrt,
  parseVtt,
  parseSubtitles,
  serializeSrt,
  serializeVtt,
};
