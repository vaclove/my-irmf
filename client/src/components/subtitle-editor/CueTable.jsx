import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { formatCueTime } from '../../utils/cueAlignment'
import CueFlagPanel from './CueFlagPanel'

// After a keystroke, hold auto-scroll for this long so the line being typed
// isn't yanked out from under the cursor. Focus alone no longer pauses it, so
// clicking a cue to seek still lets the list follow playback.
const TYPING_PAUSE_MS = 2500

/**
 * Side-by-side editable cue list: timecode | EN | CS. Rows come from
 * alignCues() and hold indexes into the per-language cue arrays, so a row can
 * be missing one side. Rows are memoized — during playback only the rows whose
 * `active` flag flips re-render.
 *
 * Quality-gate flags: a flagged cell shows a severity-colored ⚑ badge that
 * toggles a detail panel (findings + LLM suggestion with Accept/Dismiss).
 * Style precedence on the cell: dirty (amber) > error (red) > warn (yellow).
 */
function worstSeverity(flags) {
  if (!flags || flags.length === 0) return null
  if (flags.some((f) => f.severity === 'error')) return 'error'
  if (flags.some((f) => f.severity === 'warn')) return 'warn'
  return 'info'
}

function CueCell({ lang, index, text, dirty, flagSeverity, onEdit, onFocusSeek }) {
  const flagClass =
    flagSeverity === 'error'
      ? 'border-red-400 ring-1 ring-red-300 bg-red-50'
      : flagSeverity === 'warn'
      ? 'border-yellow-400 ring-1 ring-yellow-300 bg-yellow-50'
      : 'border-gray-200'
  return (
    <textarea
      value={text}
      onChange={(e) => onEdit(lang, index, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onFocus={onFocusSeek}
      rows={Math.max(1, text.split('\n').length)}
      spellCheck={false}
      className={`w-full resize-none rounded border px-2 py-1 text-sm leading-snug focus:outline-none focus:ring-1 focus:ring-blue-400 ${
        dirty ? 'border-amber-400 ring-1 ring-amber-300 bg-amber-50' : flagClass
      }`}
    />
  )
}

function FlagBadge({ flags, expanded, onToggle }) {
  const severity = worstSeverity(flags)
  if (!severity) return null
  const codes = [...new Set(flags.map((f) => f.code))].join(' ')
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      title={`${flags.length} quality finding${flags.length === 1 ? '' : 's'} — click for details`}
      className={`shrink-0 self-start mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        severity === 'error'
          ? 'bg-red-100 text-red-800 hover:bg-red-200'
          : severity === 'warn'
          ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
          : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
      } ${expanded ? 'ring-1 ring-current' : ''}`}
    >
      ⚑ {codes}
    </button>
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
  enFlags,
  csIndex,
  csText,
  csDirty,
  csFlags,
  expandedLang,
  flagBusy,
  onSeek,
  onEdit,
  onToggleFlags,
  onAcceptSuggestion,
  onDismissFlags,
}) {
  // The playhead-in-a-gap marker is drawn as an inset box-shadow line on the
  // row's top (or bottom) edge, so it takes no layout space and never shifts
  // the surrounding rows.
  const gapShadow = gapAbove
    ? 'shadow-[inset_0_2px_0_0_#3b82f6]'
    : gapBelow
    ? 'shadow-[inset_0_-2px_0_0_#3b82f6]'
    : ''
  // Focusing a cue's textarea jumps the movie to that cue's start time.
  const seekToCue = () => canSeek && onSeek(startMs)
  const expandedFlags = expandedLang === 'en' ? enFlags : expandedLang === 'cs' ? csFlags : null
  const expandedIndex = expandedLang === 'en' ? enIndex : csIndex
  return (
    <div data-row-index={index}>
      <div
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
          <div className="flex-1 min-w-0 flex items-start gap-1">
            {enIndex != null ? (
              <>
                <div className="flex-1 min-w-0">
                  <CueCell
                    lang="en"
                    index={enIndex}
                    text={enText}
                    dirty={enDirty}
                    flagSeverity={worstSeverity(enFlags)}
                    onEdit={onEdit}
                    onFocusSeek={seekToCue}
                  />
                </div>
                <FlagBadge
                  flags={enFlags}
                  expanded={expandedLang === 'en'}
                  onToggle={() => onToggleFlags('en', enIndex)}
                />
              </>
            ) : (
              <div className="text-xs text-gray-300 italic pt-1.5">—</div>
            )}
          </div>
        )}
        {showCs && (
          <div className="flex-1 min-w-0 flex items-start gap-1">
            {csIndex != null ? (
              <>
                <div className="flex-1 min-w-0">
                  <CueCell
                    lang="cs"
                    index={csIndex}
                    text={csText}
                    dirty={csDirty}
                    flagSeverity={worstSeverity(csFlags)}
                    onEdit={onEdit}
                    onFocusSeek={seekToCue}
                  />
                </div>
                <FlagBadge
                  flags={csFlags}
                  expanded={expandedLang === 'cs'}
                  onToggle={() => onToggleFlags('cs', csIndex)}
                />
              </>
            ) : (
              <div className="text-xs text-gray-300 italic pt-1.5">—</div>
            )}
          </div>
        )}
      </div>
      {expandedFlags && expandedFlags.length > 0 && (
        <CueFlagPanel
          flags={expandedFlags}
          busy={flagBusy}
          onAccept={() => onAcceptSuggestion(expandedLang, expandedIndex)}
          onDismiss={() => onDismissFlags(expandedLang, expandedIndex)}
        />
      )}
    </div>
  )
})

function CueTable({
  rows,
  en,
  cs,
  enFlagsByIndex,
  csFlagsByIndex,
  activeRowIndex,
  gapIndex,
  canSeek,
  flagBusy,
  onSeek,
  onEdit,
  onAcceptSuggestion,
  onDismissFlags,
}) {
  const containerRef = useRef(null)
  const lastTypedRef = useRef(0)
  // "lang:index" of the cue whose flag panel is open, or null.
  const [expandedKey, setExpandedKey] = useState(null)

  // Stamp the last keystroke so the effect below can hold off briefly.
  const handleEdit = useCallback(
    (lang, index, text) => {
      lastTypedRef.current = Date.now()
      onEdit(lang, index, text)
    },
    [onEdit]
  )

  const handleToggleFlags = useCallback((lang, index) => {
    setExpandedKey((k) => (k === `${lang}:${index}` ? null : `${lang}:${index}`))
  }, [])

  // Follow playback, centering the active row — or, when the playhead sits in a
  // gap, the row on the near side of the boundary marker — so at least one row
  // above and below stays visible. Paused only right after a keystroke; because
  // playback fires this effect a few times a second, it resumes on its own once
  // typing stops.
  useEffect(() => {
    if (Date.now() - lastTypedRef.current < TYPING_PAUSE_MS) return
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
    <div ref={containerRef} className="space-y-0.5">
      {/* Sticks to the top of the cue list's own scroll container. */}
      <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-gray-500 uppercase sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="w-14 shrink-0">Time</div>
        {showEn && <div className="flex-1">English</div>}
        {showCs && <div className="flex-1">Čeština</div>}
      </div>
      {rows.map((row, index) => {
        const enCue = showEn && row.en != null ? en.cues[row.en] : null
        const csCue = showCs && row.cs != null ? cs.cues[row.cs] : null
        const enFlags = enFlagsByIndex && row.en != null ? enFlagsByIndex.get(row.en) || null : null
        const csFlags = csFlagsByIndex && row.cs != null ? csFlagsByIndex.get(row.cs) || null : null
        const expandedLang =
          expandedKey === `en:${row.en}` ? 'en' : expandedKey === `cs:${row.cs}` ? 'cs' : null
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
            enFlags={enFlags}
            csIndex={row.cs}
            csText={csCue ? csCue.text : ''}
            csDirty={!!csCue && csCue.text !== cs.origCues[row.cs].text}
            csFlags={csFlags}
            expandedLang={expandedLang}
            flagBusy={flagBusy}
            onSeek={onSeek}
            onEdit={handleEdit}
            onToggleFlags={handleToggleFlags}
            onAcceptSuggestion={onAcceptSuggestion}
            onDismissFlags={onDismissFlags}
          />
        )
      })}
    </div>
  )
}

export default CueTable
