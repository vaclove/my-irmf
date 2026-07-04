/**
 * Pair EN and CS subtitle cues into display rows for the side-by-side editor.
 *
 * Cue counts and timings may differ between languages (independently authored
 * files), so rows are matched by time overlap, never by index: a two-pointer
 * sweep pairs cues whose [startMs, endMs] intervals overlap (each cue used at
 * most once); a cue with no overlapping counterpart gets a half-empty row.
 *
 * Rows hold INDEXES into the original cue arrays, not cue objects, so edits
 * stay in the per-language arrays and alignment is purely presentational.
 *
 * @returns {Array<{startMs:number, en:number|null, cs:number|null}>}
 */
export function alignCues(enCues, csCues) {
  const en = enCues || []
  const cs = csCues || []
  const rows = []
  let i = 0
  let j = 0
  while (i < en.length && j < cs.length) {
    const aStart = en[i].startMs ?? 0
    const aEnd = en[i].endMs ?? aStart
    const bStart = cs[j].startMs ?? 0
    const bEnd = cs[j].endMs ?? bStart
    if (aStart <= bEnd && bStart <= aEnd) {
      rows.push({ startMs: Math.min(aStart, bStart), en: i, cs: j })
      i++
      j++
    } else if (aStart < bStart) {
      rows.push({ startMs: aStart, en: i, cs: null })
      i++
    } else {
      rows.push({ startMs: bStart, en: null, cs: j })
      j++
    }
  }
  for (; i < en.length; i++) rows.push({ startMs: en[i].startMs ?? 0, en: i, cs: null })
  for (; j < cs.length; j++) rows.push({ startMs: cs[j].startMs ?? 0, en: null, cs: j })
  return rows
}

/** 3723456 ms -> "1:02:03" (hours omitted when zero). */
export function formatCueTime(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}
