import { useState, useEffect, useRef, useCallback } from 'react'
import { movieFileApi, subtitleBurnApi } from '../../utils/api'
import { detectBurnedInSubtitles, pictureInCanvas } from '../../utils/burnedInDetect'

// Mirrors the export look (server/utils/subtitleBurn.js): sizes are fractions
// of the 16:9 canvas height; EN is smaller and light grey, CS white.
const STYLE = {
  cs: { size: 0.059, color: '#FFFFFF' },
  en: { size: 0.0502, color: '#D9D9D9' },
}
const LINE_HEIGHT = 1.2
const OUTLINE = 0.0014
const SIDE_MARGIN = 0.07
const MARGIN = 0.035 // the export's usual distance from the top/bottom edge
const MIN_BAND_MARGIN = 0.01
const MIN_EDGE = 0.01
const MAX_EDGE = 0.99
const GAP_ABOVE_BURNED_IN = 0.03
// A detected band shorter than this is one line of text; a second line of
// burned-in subtitles would then reach about this many line heights higher.
const SINGLE_LINE_MAX = 0.06
const SECOND_LINE = 1.7

// Subtitle file kind -> the cues API language.
const CUES_LANG = {
  subtitles_cs: 'cs',
  subtitles_cs_synced: 'cs_synced',
  subtitles_en: 'en',
  subtitles_en_synced: 'en_synced',
}
const SAMPLE_TEXT = {
  cs: 'Ukázka přidaných titulků\nna dva řádky',
  en: 'A sample of the added subtitles\non two lines',
}

const clamp = (v) => Math.min(MAX_EDGE, Math.max(MIN_EDGE, v))

/** Default placement of the added language: EN at the top, CS at the bottom. */
export function defaultPlacement(lang) {
  return lang === 'en' ? { align: 'top', edge: MARGIN } : { align: 'bottom', edge: 1 - MARGIN }
}

function formatTime(sec) {
  const t = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(t / 3600)
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0')
  const s = String(t % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

/** Cue text without SRT/ASS markup. */
function plainText(text) {
  return String(text || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
}

/**
 * Place subtitles added to a master that already has some burned in: the
 * movie's preview in the export's 16:9 frame, with the added subtitles drawn
 * over it. `placement` is {align: 'top'|'bottom', edge}: the block's top or
 * bottom edge as a fraction of the frame height (top-anchored blocks grow
 * down, bottom-anchored ones up). Drag the subtitles to move them. "Detect"
 * finds the burned-in ones and a black bar at the top in the preview: EN goes
 * to the top (inside the bar when two lines fit), CS just above the
 * burned-in subtitles.
 */
function BurnedInPositioner({ movieId, subtitleKind, placement, onChange, autoDetect }) {
  const boxRef = useRef(null)
  const videoRef = useRef(null)
  const drag = useRef(null)
  const [source, setSource] = useState(null) // {url, direct}
  const [boxHeight, setBoxHeight] = useState(0)
  const [cues, setCues] = useState([])
  const [cuesLoaded, setCuesLoaded] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [detecting, setDetecting] = useState(null) // progress 0–1 while running
  const [detected, setDetected] = useState(null) // {top, bottom} in canvas fractions
  const [message, setMessage] = useState(null)
  const autoRan = useRef(false)

  const lang = CUES_LANG[subtitleKind]?.slice(0, 2) || 'cs'
  const style = STYLE[lang]
  const block = 2 * style.size * LINE_HEIGHT // two lines, in canvas fractions

  // Preview source: a direct blob URL (pixels readable for detection), else
  // the app's stream URL (playable, no detection).
  useEffect(() => {
    let stale = false
    subtitleBurnApi
      .previewSource(movieId)
      .then((res) => {
        if (stale) return
        setSource(
          res.data.url
            ? { url: res.data.url, direct: true }
            : { url: movieFileApi.streamUrl(movieId, 'movie_proxy'), direct: false }
        )
      })
      .catch(() => {
        if (!stale) setSource({ url: movieFileApi.streamUrl(movieId, 'movie_proxy'), direct: false })
      })
    return () => {
      stale = true
    }
  }, [movieId])

  // The added language's cues, to show the real subtitle at the current time.
  useEffect(() => {
    const cuesLang = CUES_LANG[subtitleKind]
    if (!cuesLang) {
      setCuesLoaded(true)
      return undefined
    }
    let stale = false
    movieFileApi
      .getSubtitleCues(movieId, cuesLang)
      .then((res) => {
        if (!stale) setCues(res.data.cues || [])
      })
      .catch(() => {
        if (!stale) setCues([])
      })
      .finally(() => {
        if (!stale) setCuesLoaded(true)
      })
    return () => {
      stale = true
    }
  }, [movieId, subtitleKind])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return undefined
    const observer = new ResizeObserver(([entry]) => setBoxHeight(entry.contentRect.height))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const detect = useCallback(async () => {
    if (!source?.direct) return
    setMessage(null)
    setDetecting(0)
    try {
      const result = await detectBurnedInSubtitles(source.url, {
        cueTimes: cues.filter((c) => c.startMs != null).map((c) => (c.startMs + c.endMs) / 2000),
        onProgress: (done, total) => setDetecting(done / total),
      })
      const pic = pictureInCanvas(result.videoWidth, result.videoHeight)
      const { band } = result
      let found = null
      if (band) {
        let top = pic.top + band.top * pic.height
        const bottom = pic.top + band.bottom * pic.height
        // Only one line found: leave room for a second one above it.
        const lineHeight = bottom - top
        if (lineHeight < SINGLE_LINE_MAX) top -= lineHeight * SECOND_LINE
        found = { top, bottom }
      }
      setDetected(found)

      if (lang === 'en') {
        // Top; inside a black bar there (letterbox outside or inside the
        // master) when two lines fit, as the export does.
        const topBand = pic.top + result.topBar * pic.height
        const edge = topBand >= block + MIN_BAND_MARGIN ? Math.min(MARGIN, topBand - block) : MARGIN
        onChange({ align: 'top', edge: clamp(edge) })
      } else if (found) {
        onChange({ align: 'bottom', edge: clamp(found.top - GAP_ABOVE_BURNED_IN) })
      }
      setMessage(
        band
          ? `Burned-in subtitles found in ${band.frames} of ${result.samples} sampled frames (marked red). ` +
              'Check a few moments with two-line subtitles and drag to adjust.'
          : 'No burned-in subtitles found in the preview. Check the placement by hand.'
      )
    } catch (error) {
      setMessage('Detection failed: ' + error.message)
    } finally {
      setDetecting(null)
    }
  }, [source, cues, lang, block, onChange])

  useEffect(() => {
    if (autoDetect && source?.direct && cuesLoaded && !autoRan.current) {
      autoRan.current = true
      detect()
    }
  }, [autoDetect, source, cuesLoaded, detect])

  const onPointerDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, edge: placement.edge }
  }
  const onPointerMove = (e) => {
    if (!drag.current || !boxHeight) return
    onChange({ ...placement, edge: clamp(drag.current.edge + (e.clientY - drag.current.y) / boxHeight) })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const setAlign = (align) => {
    if (align !== placement.align) onChange({ align, edge: align === 'top' ? MARGIN : 1 - MARGIN })
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }
  const seek = (t) => {
    if (videoRef.current) videoRef.current.currentTime = t
  }

  const ms = time * 1000
  const active = cues.filter((c) => c.startMs != null && c.startMs <= ms && ms < c.endMs)
  const text = active.length ? active.map((c) => plainText(c.text)).join('\n') : SAMPLE_TEXT[lang]
  const o = Math.max(1, Math.round(boxHeight * OUTLINE))
  const outline = [
    [-o, -o], [0, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [0, o], [o, o],
  ]
    .map(([x, y]) => `${x}px ${y}px 0 #000`)
    .join(', ')
  const top = placement.align === 'top'

  return (
    <div className="space-y-2">
      <div ref={boxRef} className="relative w-full bg-black overflow-hidden select-none" style={{ aspectRatio: '16 / 9' }}>
        {source && (
          <video
            ref={videoRef}
            key={source.url}
            src={source.url}
            crossOrigin={source.direct ? 'anonymous' : undefined}
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-contain"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {detected && (
          <div
            className="absolute left-0 right-0 border-y-2 border-dashed border-red-500 bg-red-500/10 pointer-events-none"
            style={{ top: `${detected.top * 100}%`, height: `${(detected.bottom - detected.top) * 100}%` }}
          />
        )}
        <div
          className="absolute text-center whitespace-pre-line cursor-ns-resize touch-none"
          style={{
            left: `${SIDE_MARGIN * 100}%`,
            right: `${SIDE_MARGIN * 100}%`,
            ...(top ? { top: `${placement.edge * 100}%` } : { bottom: `${(1 - placement.edge) * 100}%` }),
            fontSize: `${boxHeight * style.size}px`,
            lineHeight: LINE_HEIGHT,
            fontFamily: '"Liberation Sans", Arial, Helvetica, sans-serif',
            fontWeight: 400,
            color: style.color,
            textShadow: outline,
            [top ? 'borderTop' : 'borderBottom']: '1px dashed rgba(255, 255, 255, 0.6)',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="Drag up or down"
        >
          {text}
        </div>
        {detecting != null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
            Looking for burned-in subtitles… {Math.round(detecting * 100)}%
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          onClick={togglePlay}
          className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.5}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1"
        />
        <span className="tabular-nums text-gray-600">{formatTime(time)}</span>
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
          {['top', 'bottom'].map((align) => (
            <button
              key={align}
              type="button"
              onClick={() => setAlign(align)}
              className={`px-2 py-1 ${placement.align === align ? 'bg-gray-200 font-medium' : 'hover:bg-gray-50'}`}
            >
              {align === 'top' ? 'Top' : 'Bottom'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={detect}
          disabled={!source?.direct || detecting != null}
          title={source && !source.direct ? 'Needs the preview stored in Azure' : undefined}
          className="px-2 py-1 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          Detect
        </button>
      </div>
      <div className="text-xs text-gray-500">
        Drag the added subtitles clear of the burned-in ones. {top ? 'Top' : 'Bottom'} edge at{' '}
        {Math.round(placement.edge * 100)} % of the frame height; {top ? 'longer subtitles grow downwards' : 'longer subtitles grow upwards'}.
        {message && <span className="block mt-1 text-gray-700">{message}</span>}
      </div>
    </div>
  )
}

export default BurnedInPositioner
