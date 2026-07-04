import { memo, useEffect, useRef } from 'react'
import { formatCueTime } from '../../utils/cueAlignment'

/**
 * Side-by-side editable cue list: timecode | EN | CS. Rows come from
 * alignCues() and hold indexes into the per-language cue arrays, so a row can
 * be missing one side. Rows are memoized — during playback only the rows whose
 * `active` flag flips re-render.
 */
function CueCell({ lang, index, text, dirty, onEdit }) {
  return (
    <textarea
      value={text}
      onChange={(e) => onEdit(lang, index, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      rows={Math.max(1, text.split('\n').length)}
      spellCheck={false}
      className={`w-full resize-none rounded border px-2 py-1 text-sm leading-snug focus:outline-none focus:ring-1 focus:ring-blue-400 ${
        dirty ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50' : 'border-gray-200'
      }`}
    />
  )
}

const CueRow = memo(function CueRow({
  index,
  startMs,
  active,
  gapAbove,
  gapBelow,
  canSeek,
  showEn,
  showCs,
  enIndex,
  enText,
  enDirty,
  csIndex,
  csText,
  csDirty,
  onSeek,
  onEdit,
}) {
  // The playhead-in-a-gap marker is drawn as an inset box-shadow line on the
  // row's top (or bottom) edge, so it takes no layout space and never shifts
  // the surrounding rows.
  const gapShadow = gapAbove
    ? 'shadow-[inset_0_2px_0_0_#3b82f6]'
    : gapBelow
    ? 'shadow-[inset_0_-2px_0_0_#3b82f6]'
    : ''
  return (
    <div
      data-row-index={index}
      onClick={() => canSeek && onSeek(startMs)}
      className={`flex items-start gap-2 px-2 py-1 rounded border-l-4 ${
        active
          ? 'bg-blue-100 ring-2 ring-blue-400 border-blue-500 shadow-sm'
          : `border-transparent hover:bg-gray-50 ${gapShadow}`
      } ${canSeek ? 'cursor-pointer' : ''}`}
    >
      <div
        className={`w-14 shrink-0 pt-1.5 text-xs tabular-nums ${
          active ? 'font-semibold text-blue-700' : 'text-gray-500'
        }`}
      >
        {formatCueTime(startMs)}
      </div>
      {showEn && (
        <div className="flex-1 min-w-0">
          {enIndex != null ? (
            <CueCell lang="en" index={enIndex} text={enText} dirty={enDirty} onEdit={onEdit} />
          ) : (
            <div className="text-xs text-gray-300 italic pt-1.5">—</div>
          )}
        </div>
      )}
      {showCs && (
        <div className="flex-1 min-w-0">
          {csIndex != null ? (
            <CueCell lang="cs" index={csIndex} text={csText} dirty={csDirty} onEdit={onEdit} />
          ) : (
            <div className="text-xs text-gray-300 italic pt-1.5">—</div>
          )}
        </div>
      )}
    </div>
  )
})

function CueTable({ rows, en, cs, activeRowIndex, gapIndex, canSeek, onSeek, onEdit }) {
  const containerRef = useRef(null)
  const editingRef = useRef(false)

  // Follow playback, but never yank the view while the user is typing. Center
  // the active row — or, when the playhead sits in a gap, the row on the near
  // side of the boundary marker — so at least one row above and below stays
  // visible.
  useEffect(() => {
    if (editingRef.current) return
    let idx = activeRowIndex
    if (idx < 0 && gapIndex >= 0) idx = Math.min(gapIndex, rows.length - 1)
    if (idx < 0) return
    const el = containerRef.current?.querySelector(`[data-row-index="${idx}"]`)
    if (el) el.scrollIntoView({ block: 'center' })
  }, [activeRowIndex, gapIndex, rows.length])

  const showEn = !!en
  const showCs = !!cs
  const lastIndex = rows.length - 1

  return (
    <div
      ref={containerRef}
      onFocusCapture={(e) => {
        if (e.target.tagName === 'TEXTAREA') editingRef.current = true
      }}
      onBlurCapture={(e) => {
        if (e.target.tagName === 'TEXTAREA') editingRef.current = false
      }}
      className="space-y-0.5"
    >
      {/* Sticks to the top of the cue list's own scroll container. */}
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-gray-500 uppercase sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="w-14 shrink-0">Time</div>
        {showEn && <div className="flex-1">English</div>}
        {showCs && <div className="flex-1">Čeština</div>}
      </div>
      {rows.map((row, index) => {
        const enCue = showEn && row.en != null ? en.cues[row.en] : null
        const csCue = showCs && row.cs != null ? cs.cues[row.cs] : null
        return (
          <CueRow
            key={index}
            index={index}
            startMs={row.startMs}
            active={index === activeRowIndex}
            gapAbove={gapIndex === index}
            gapBelow={gapIndex === rows.length && index === lastIndex}
            canSeek={canSeek}
            showEn={showEn}
            showCs={showCs}
            enIndex={row.en}
            enText={enCue ? enCue.text : ''}
            enDirty={!!enCue && enCue.text !== en.origCues[row.en].text}
            csIndex={row.cs}
            csText={csCue ? csCue.text : ''}
            csDirty={!!csCue && csCue.text !== cs.origCues[row.cs].text}
            onSeek={onSeek}
            onEdit={onEdit}
          />
        )
      })}
    </div>
  )
}

export default CueTable
