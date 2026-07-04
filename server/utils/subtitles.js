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

module.exports = { convertSrtToVtt, decodeSubtitleBuffer };
