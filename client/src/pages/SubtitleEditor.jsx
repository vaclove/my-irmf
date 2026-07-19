import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { movieApi, movieFileApi, subtitleQualityApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import { notifyMovieFilesChanged } from '../utils/movieFilesBus'
import { alignCues } from '../utils/cueAlignment'
import SubtitleVideoPanel from '../components/subtitle-editor/SubtitleVideoPanel'
import CueTable from '../components/subtitle-editor/CueTable'

const LANGS = ['en', 'cs']
const LANG_LABELS = { en: 'English', cs: 'Czech' }

const emptyTrack = { status: 'loading', file: null, baseMd5: null, origCues: null, cues: null, saving: false, conflict: false, message: null, flags: [] }

/**
 * Visual subtitle editor: the 720p preview on top, both language tracks in an
 * editable time-aligned table below. Text-only editing — timings are shown but
 * never changed here. Saves overwrite the Drive file in place, guarded by the
 * md5 captured at load time (409 -> reload banner).
 */
function SubtitleEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Which movie-detail tab the user came from, so Back returns them there.
  // Defaults to 'preview' (covers direct URL visits with no origin state).
  const backTab = location.state?.from === 'files' ? 'files' : 'preview'
  const { success, error: showError } = useToast()
  const [movie, setMovie] = useState(null)
  const [hasProxy, setHasProxy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tracks, setTracks] = useState({ en: emptyTrack, cs: emptyTrack })
  // "Review issues" entry point: which lang's flags to jump to after load.
  const reviewLang = location.state?.reviewLang || null
  // Per-language subtitle variant: the original upload or the alass-synced copy.
  // A reviewLang like 'cs_synced' opens that variant directly.
  const [variants, setVariants] = useState({
    en: reviewLang === 'en_synced' ? 'synced' : 'original',
    cs: reviewLang === 'cs_synced' ? 'synced' : 'original',
  })
  const [syncedAvailable, setSyncedAvailable] = useState({ en: false, cs: false })
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [flagBusy, setFlagBusy] = useState(false)
  const videoRef = useRef(null)
  const variantsRef = useRef(variants)
  variantsRef.current = variants
  const reviewScrolled = useRef(false)

  // Open quality flags for a track, reconciled against the loaded cues: a
  // flag whose snapshot no longer matches the current text is hidden (the
  // file drifted; the save handler will mark it stale server-side).
  const loadFlags = useCallback(async (langKey, cues) => {
    try {
      const res = await subtitleQualityApi.getFlags(id, langKey)
      return (res.data.flags || []).filter(
        (f) => cues[f.cue_index] && cues[f.cue_index].text === f.target_text
      )
    } catch {
      return [] // quality data is optional; never block the editor
    }
  }, [id])

  const loadTrack = useCallback(async (lang, variantArg) => {
    const variant = variantArg || variantsRef.current[lang]
    const langKey = variant === 'synced' ? `${lang}_synced` : lang
    setTracks((t) => ({ ...t, [lang]: { ...emptyTrack } }))
    try {
      const res = await movieFileApi.getSubtitleCues(id, langKey)
      const { file, cues } = res.data
      const flags = await loadFlags(langKey, cues)
      setTracks((t) => ({
        ...t,
        [lang]: { ...emptyTrack, status: 'ready', file, baseMd5: file.md5_checksum, origCues: cues, cues, flags },
      }))
    } catch (error) {
      const status = error.response?.status
      setTracks((t) => ({
        ...t,
        [lang]: {
          ...emptyTrack,
          status: status === 404 ? 'missing' : 'error',
          message: error.response?.data?.error || error.message,
        },
      }))
    }
  }, [id, loadFlags])

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [movieRes, filesRes] = await Promise.all([
          movieApi.getById(id),
          movieFileApi.getFiles(id).catch(() => null),
        ])
        setMovie(movieRes.data)
        const files = filesRes?.data?.files || []
        setHasProxy(!!files.find((f) => f.file_kind === 'movie_proxy'))
        setSyncedAvailable({
          en: !!files.find((f) => f.file_kind === 'subtitles_en_synced'),
          cs: !!files.find((f) => f.file_kind === 'subtitles_cs_synced'),
        })
      } catch (error) {
        showError('Failed to load movie: ' + (error.response?.data?.error || error.message))
      } finally {
        setLoading(false)
      }
    }
    loadAll()
    LANGS.forEach(loadTrack)
  }, [id, loadTrack, showError])

  const updateCue = useCallback((lang, index, text) => {
    setTracks((t) => {
      const tr = t[lang]
      if (!tr || tr.status !== 'ready') return t
      const cues = tr.cues.slice()
      cues[index] = { ...cues[index], text }
      return { ...t, [lang]: { ...tr, cues } }
    })
  }, [])

  // Per-track flag lookup: cue index -> flags[]. Stable references so the
  // memoized cue rows only re-render when their own flags change.
  const flagsByIndex = useMemo(() => {
    const build = (tr) => {
      const map = new Map()
      for (const f of tr.flags || []) {
        if (!map.has(f.cue_index)) map.set(f.cue_index, [])
        map.get(f.cue_index).push(f)
      }
      return map
    }
    return { en: build(tracks.en), cs: build(tracks.cs) }
  }, [tracks.en.flags, tracks.cs.flags]) // eslint-disable-line react-hooks/exhaustive-deps

  // Accept = fill the cell with the suggestion (a normal dirty edit). The
  // flag flips to 'accepted' in the DB when the file is saved.
  const acceptSuggestion = useCallback(
    (lang, index) => {
      const flags = flagsByIndex[lang].get(index) || []
      const suggestion = flags.find((f) => f.suggestion)?.suggestion
      if (suggestion) updateCue(lang, index, suggestion)
    },
    [flagsByIndex, updateCue]
  )

  // Dismiss is an immediate human judgement, independent of file content.
  const dismissFlags = useCallback(
    async (lang, index) => {
      const flags = flagsByIndex[lang].get(index) || []
      if (flags.length === 0) return
      setFlagBusy(true)
      try {
        await subtitleQualityApi.resolveFlags(flags.map((f) => f.id), 'dismissed')
        setTracks((t) => ({
          ...t,
          [lang]: { ...t[lang], flags: (t[lang].flags || []).filter((f) => f.cue_index !== index) },
        }))
      } catch (error) {
        showError('Dismiss failed: ' + (error.response?.data?.error || error.message))
      } finally {
        setFlagBusy(false)
      }
    },
    [flagsByIndex, showError]
  )

  const isDirty = (tr) =>
    tr.status === 'ready' &&
    tr.cues !== tr.origCues &&
    tr.cues.some((c, i) => c.text !== tr.origCues[i].text)

  const dirtyEn = isDirty(tracks.en)
  const dirtyCs = isDirty(tracks.cs)
  const anyDirty = dirtyEn || dirtyCs

  // Native prompt when closing/reloading the tab with unsaved edits.
  useEffect(() => {
    if (!anyDirty) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [anyDirty])

  const switchVariant = (lang, variant) => {
    if (variants[lang] === variant) return
    if (
      isDirty(tracks[lang]) &&
      !window.confirm('You have unsaved edits in this track. Discard them and switch?')
    ) {
      return
    }
    setVariants((v) => ({ ...v, [lang]: variant }))
    loadTrack(lang, variant)
  }

  const save = async (lang) => {
    const tr = tracks[lang]
    if (tr.status !== 'ready' || tr.saving) return
    const langKey = variants[lang] === 'synced' ? `${lang}_synced` : lang
    setTracks((t) => ({ ...t, [lang]: { ...t[lang], saving: true } }))
    try {
      const res = await movieFileApi.saveSubtitleCues(id, langKey, {
        cues: tr.cues.map(({ timing, text }) => ({ timing, text: text.trim() })),
        base_md5: tr.baseMd5,
      })
      const savedCues = tr.cues.map((c) => ({ ...c, text: c.text.trim() }))
      // The save endpoint reconciled flag statuses (accepted/stale) — refetch.
      const freshFlags = await loadFlags(langKey, savedCues)
      setTracks((t) => ({
        ...t,
        [lang]: {
          ...t[lang],
          cues: savedCues,
          origCues: savedCues,
          baseMd5: res.data.file.md5_checksum,
          file: res.data.file,
          saving: false,
          conflict: false,
          flags: freshFlags,
        },
      }))
      success(`${LANG_LABELS[lang]} subtitles saved`)
      notifyMovieFilesChanged(id)
    } catch (error) {
      const status = error.response?.status
      setTracks((t) => ({ ...t, [lang]: { ...t[lang], saving: false, conflict: status === 409 } }))
      showError(
        `Saving ${LANG_LABELS[lang]} subtitles failed: ` +
          (error.response?.data?.error || error.message)
      )
    }
  }

  const seekTo = useCallback((ms) => {
    const video = videoRef.current
    if (video && ms != null) video.currentTime = ms / 1000
  }, [])

  const goBack = useCallback(() => {
    if (anyDirty && !window.confirm('You have unsaved subtitle changes. Leave anyway?')) return
    navigate(`/movies/${id}?tab=${backTab}`)
  }, [anyDirty, id, navigate, backTab])

  // Esc leaves the fullscreen editor — the quick way back to the movie. Ignore
  // it while typing in a cue so it can't yank the user out mid-edit.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return
      const tag = e.target?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      goBack()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goBack])

  const en = tracks.en.status === 'ready' ? tracks.en : null
  const cs = tracks.cs.status === 'ready' ? tracks.cs : null

  const rows = useMemo(
    () => alignCues(en ? en.cues : [], cs ? cs.cues : []),
    // Alignment depends only on timings, which never change here, so keying on
    // cue-array identity per language is enough.
    [en?.cues, cs?.cues] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const activeRowIndex = useMemo(() => {
    const contains = (cues, idx) =>
      idx != null && cues[idx].startMs != null && cues[idx].startMs <= currentTimeMs && currentTimeMs <= cues[idx].endMs
    return rows.findIndex((r) => (en && contains(en.cues, r.en)) || (cs && contains(cs.cues, r.cs)))
  }, [rows, en, cs, currentTimeMs])

  // When the playhead sits in a gap (no active row), the boundary index where
  // it falls — count of rows already started — so the list can draw a line
  // between the previous and next cue. -1 while a row is active.
  const gapIndex = useMemo(() => {
    if (activeRowIndex >= 0) return -1
    let count = 0
    for (const r of rows) {
      if (r.startMs <= currentTimeMs) count++
      else break
    }
    return count
  }, [rows, activeRowIndex, currentTimeMs])

  // Arriving via "Review issues": scroll to the first flagged row once the
  // track is ready.
  useEffect(() => {
    if (!reviewLang || reviewScrolled.current) return
    const lang = reviewLang.startsWith('cs') ? 'cs' : 'en'
    const tr = tracks[lang]
    if (tr.status !== 'ready' || rows.length === 0) return
    reviewScrolled.current = true
    const flagged = new Set((tr.flags || []).map((f) => f.cue_index))
    if (flagged.size === 0) return
    const rowIndex = rows.findIndex((r) => flagged.has(lang === 'cs' ? r.cs : r.en))
    if (rowIndex < 0) return
    // The rows render right after this effect; defer one frame.
    requestAnimationFrame(() => {
      document.querySelector(`[data-row-index="${rowIndex}"]`)?.scrollIntoView({ block: 'center' })
    })
  }, [reviewLang, tracks, rows])

  if (loading) {
    return <div className="text-sm text-gray-500">Loading subtitle editor…</div>
  }

  if (!movie) {
    return (
      <div className="text-sm text-gray-500">
        Movie not found. <Link to="/movies" className="text-blue-600 hover:text-blue-800">Back to movies</Link>
      </div>
    )
  }

  const bothMissing = tracks.en.status === 'missing' && tracks.cs.status === 'missing'

  // Fullscreen, chrome-free layout: the editor owns the whole viewport (rendered
  // outside the app's Layout/navbar). Header, banners and video stay fixed while
  // only the cue list scrolls, so the movie is visible at all times.
  return (
    <div className="fixed inset-0 flex flex-col bg-white">
      {/* Header: back, title, dirty state, saves */}
      <div className="shrink-0 px-4 py-2 bg-white border-b border-gray-200 flex flex-wrap items-center gap-3">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400"
        >
          ← Back to movie
          <kbd className="hidden sm:inline text-xs font-normal text-gray-400 border border-gray-200 rounded px-1">Esc</kbd>
        </button>
        <h1 className="text-lg font-semibold text-gray-900 truncate">
          {movie.name_cs || movie.name_en}
          <span className="ml-2 text-sm font-normal text-gray-500">subtitle editor</span>
        </h1>
        <div className="flex-1" />
        {LANGS.map((lang) => {
          const tr = tracks[lang]
          const dirty = lang === 'en' ? dirtyEn : dirtyCs
          if (tr.status !== 'ready' && !syncedAvailable[lang]) return null
          const openFlags = (tr.flags || []).length
          return (
            <div key={lang} className="flex items-center gap-1.5">
              {openFlags > 0 && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                    (tr.flags || []).some((f) => f.severity === 'error')
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                  title="Open quality findings in this track — click the ⚑ badges in the list"
                >
                  ⚑ {openFlags}
                </span>
              )}
              {syncedAvailable[lang] && (
                <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs">
                  {['original', 'synced'].map((variant) => (
                    <button
                      key={variant}
                      onClick={() => switchVariant(lang, variant)}
                      title={`Edit the ${variant} ${LANG_LABELS[lang]} subtitles`}
                      className={`px-2 py-1 ${
                        variants[lang] === variant
                          ? 'bg-gray-700 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {variant}
                    </button>
                  ))}
                </div>
              )}
              {tr.status === 'ready' && (
                <button
                  onClick={() => save(lang)}
                  disabled={!dirty || tr.saving}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {tr.saving ? 'Saving…' : `Save ${LANG_LABELS[lang]}`}
                  {dirty && !tr.saving && ' *'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Per-language error / conflict banners */}
      <div className="shrink-0 space-y-2 empty:hidden pt-3">
        {LANGS.map((lang) => {
          const tr = tracks[lang]
          if (tr.status === 'error' || tr.conflict) {
            return (
              <div
                key={lang}
                className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800 flex items-center gap-3"
              >
                <span className="flex-1">
                  {LANG_LABELS[lang]}: {tr.conflict
                    ? 'the file changed on Drive since you loaded it — reload to continue (your unsaved edits will be lost).'
                    : tr.message}
                </span>
                <button
                  onClick={() => loadTrack(lang)}
                  className="text-blue-700 hover:text-blue-900 font-medium"
                >
                  Reload
                </button>
              </div>
            )
          }
          return null
        })}
      </div>

      {bothMissing ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="rounded-md border border-gray-200 p-6 text-sm text-gray-500 text-center">
            This movie has no subtitles yet. Upload or translate them on the{' '}
            <Link to={`/movies/${id}?tab=files`} className="text-blue-600 hover:text-blue-800">movie page</Link>.
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3 pt-3">
          <div className="shrink-0">
            <SubtitleVideoPanel
              movieId={id}
              hasProxy={hasProxy}
              videoRef={videoRef}
              currentTimeMs={currentTimeMs}
              enCues={en ? en.cues : null}
              csCues={cs ? cs.cues : null}
              onTimeUpdate={setCurrentTimeMs}
            />
          </div>
          {(en || cs) ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <CueTable
                rows={rows}
                en={en}
                cs={cs}
                enFlagsByIndex={flagsByIndex.en}
                csFlagsByIndex={flagsByIndex.cs}
                activeRowIndex={activeRowIndex}
                gapIndex={gapIndex}
                canSeek={hasProxy}
                flagBusy={flagBusy}
                onSeek={seekTo}
                onEdit={updateCue}
                onAcceptSuggestion={acceptSuggestion}
                onDismissFlags={dismissFlags}
              />
            </div>
          ) : (
            <div className="text-sm text-gray-500">Loading subtitles…</div>
          )}
        </div>
      )}
    </div>
  )
}

export default SubtitleEditor
