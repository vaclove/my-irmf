/**
 * Render subtitle cue text with the inline markup SRT/VTT players understand
 * (<i>, <b>, <u>, <font color>) as styled spans, the way the native <track>
 * renderer does. Unknown tags and ASS override blocks like {\an8} are dropped
 * rather than shown literally. Unbalanced tags are tolerated: an unclosed tag
 * runs to the end of the cue, a stray closing tag is ignored. Newlines are
 * kept; the container should use `whitespace-pre-line`.
 */
const TOKEN_RE = /<(\/?)([a-z]+)\b([^>]*)>|\{\\[^}]*\}/gi
const COLOR_RE = /color\s*=\s*["']?([^"'\s>]+)/i

export function renderSubtitleMarkup(input) {
  const text = String(input || '')
  const parts = []
  const open = { i: 0, b: 0, u: 0 }
  const colors = []
  let last = 0
  let key = 0

  const pushText = (chunk) => {
    if (!chunk) return
    const style = {}
    if (open.i > 0) style.fontStyle = 'italic'
    if (open.b > 0) style.fontWeight = 'bold'
    if (open.u > 0) style.textDecoration = 'underline'
    const color = colors[colors.length - 1]
    if (color) style.color = color
    parts.push(
      Object.keys(style).length > 0 ? (
        <span key={key++} style={style}>
          {chunk}
        </span>
      ) : (
        chunk
      )
    )
  }

  for (const match of text.matchAll(TOKEN_RE)) {
    pushText(text.slice(last, match.index))
    last = match.index + match[0].length
    const [, closing, rawTag, attrs] = match
    const tag = (rawTag || '').toLowerCase()
    if (Object.hasOwn(open, tag)) {
      open[tag] = closing ? Math.max(0, open[tag] - 1) : open[tag] + 1
    } else if (tag === 'font') {
      if (closing) colors.pop()
      else colors.push(COLOR_RE.exec(attrs || '')?.[1] || colors[colors.length - 1] || null)
    }
  }
  pushText(text.slice(last))
  return parts
}
