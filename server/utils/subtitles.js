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

module.exports = { convertSrtToVtt };
