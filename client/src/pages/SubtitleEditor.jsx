import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { movieApi, movieFileApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import { notifyMovieFilesChanged } from '../utils/movieFilesBus'
import { alignCues } from '../utils/cueAlignment'
import SubtitleVideoPanel from '../components/subtitle-editor/SubtitleVideoPanel'
import CueTable from '../components/subtitle-editor/CueTable'

const LANGS = ['en', 'cs']
const LANG_LABELS = { en: 'English', cs: 'Czech' }

const emptyTrack = { status: 'loading', file: null, baseMd5: null, origCues: null, cues: null, saving: false, conflict: false, message: null }

/**
 * Visual subtitle editor: the 720p preview on top, both language tracks in an
 * editable time-aligned table below. Text-only editing — timings are shown but
 * never changed here. Saves overwrite the Drive file in place, guarded by the
 * md5 captured at load time (409 -> reload banner).
 */
function SubtitleEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()
  const [movie, setMovie] = useState(null)
  const [hasProxy, setHasProxy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tracks, setTracks] = useState({ en: emptyTrack, cs: emptyTrack })
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const videoRef = useRef(null)

  const loadTrack = useCallback(async (lang) => {
    setTracks((t) => ({ ...t, [lang]: { ...emptyTrack } }))
    try {
      const res = await movieFileApi.getSubtitleCues(id, lang)
      const { file, cues } = res.data
      setTracks((t) => ({
        ...t,
        [lang]: { ...emptyTrack, status: 'ready', file, baseMd5: file.md5_checksum, origCues: cues, cues },
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
  }, [id])

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [movieRes, filesRes] = await Promise.all([
          movieApi.getById(id),
          movieFileApi.getFiles(id).catch(() => null),
        ])
        setMovie(movieRes.data)
        setHasProxy(!!(filesRes?.data?.files || []).find((f) => f.file_kind === 'movie_proxy'))
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

  const save = async (lang) => {
    const tr = tracks[lang]
    if (tr.status !== 'ready' || tr.saving) return
    setTracks((t) => ({ ...t, [lang]: { ...t[lang], saving: true } }))
    try {
      const res = await movieFileApi.saveSubtitleCues(id, lang, {
        cues: tr.cues.map(({ timing, text }) => ({ timing, text: text.trim() })),
        base_md5: tr.baseMd5,
      })
      const savedCues = tr.cues.map((c) => ({ ...c, text: c.text.trim() }))
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

  const goBack = () => {
    if (anyDirty && !window.confirm('You have unsaved subtitle changes. Leave anyway?')) return
    navigate(`/movies/${id}?tab=preview`)
  }

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

  // Viewport-locked layout: the header, banners and video stay fixed while only
  // the cue list scrolls, so the movie is visible at all times. The negative
  // margins cancel Layout's <main> py-6 so the column can fill the viewport
  // below the h-16 navbar.
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -mt-6 -mb-6">
      {/* Header: title, dirty state, saves */}
      <div className="shrink-0 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 bg-white border-b border-gray-200 flex flex-wrap items-center gap-3">
        <button onClick={goBack} className="text-blue-600 hover:text-blue-800 text-sm">
          ← Back to movie
        </button>
        <h1 className="text-lg font-semibold text-gray-900 truncate">
          {movie.name_cs || movie.name_en}
          <span className="ml-2 text-sm font-normal text-gray-500">subtitle editor</span>
        </h1>
        <div className="flex-1" />
        {LANGS.map((lang) => {
          const tr = tracks[lang]
          if (tr.status !== 'ready') return null
          const dirty = lang === 'en' ? dirtyEn : dirtyCs
          return (
            <button
              key={lang}
              onClick={() => save(lang)}
              disabled={!dirty || tr.saving}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {tr.saving ? 'Saving…' : `Save ${LANG_LABELS[lang]}`}
              {dirty && !tr.saving && ' *'}
            </button>
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
                activeRowIndex={activeRowIndex}
                gapIndex={gapIndex}
                canSeek={hasProxy}
                onSeek={seekTo}
                onEdit={updateCue}
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
