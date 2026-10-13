import { useState, useEffect, useRef, useCallback } from 'react'
import { movieFileApi, subtitleBurnApi } from '../../utils/api'
import { detectBurnedInSubtitles, pictureInCanvas } from '../../utils/burnedInDetect'

// Mirrors the export look (server/utils/subtitleBurn.js): sizes are fractions
// of the 16:9 canvas height, the added language is yellow at the CS size.
const FONT_SIZE = 0.048
const LINE_HEIGHT = 1.2
const OUTLINE = 0.0028
const SIDE_MARGIN = 0.07
const MIN_POSITION = 0.12 // low enough for a letterbox bar at the top
const MAX_POSITION = 0.965 // the export's bottom margin
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

const clamp = (v) => Math.min(MAX_POSITION, Math.max(MIN_POSITION, v))

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
 * over it at `position` (their bottom edge, as a fraction of the frame
 * height). Drag the subtitles to move them; "Detect" finds the burned-in ones
 * in the preview and puts the added ones just above them.
 */
function BurnedInPositioner({ movieId, subtitleKind, position, onChange, autoDetect }) {
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
      const band = await detectBurnedInSubtitles(source.url, {
        cueTimes: cues.filter((c) => c.startMs != null).map((c) => (c.startMs + c.endMs) / 2000),
        onProgress: (done, total) => setDetecting(done / total),
      })
      if (!band) {
        setDetected(null)
        setMessage('No burned-in subtitles found in the preview. Place the subtitles by hand.')
        return
      }
      const pic = pictureInCanvas(band.videoWidth, band.videoHeight)
      let top = pic.top + band.top * pic.height
      const bottom = pic.top + band.bottom * pic.height
      // Only one line found: leave room for a second one above it.
      const lineHeight = bottom - top
      if (lineHeight < SINGLE_LINE_MAX) top -= lineHeight * SECOND_LINE
      setDetected({ top, bottom })
      // Below the picture when the black band there holds two lines,
      // otherwise just above the burned-in subtitles.
      const bandBelow = 1 - (pic.top + pic.height)
      const twoLines = 2 * FONT_SIZE * LINE_HEIGHT + (1 - MAX_POSITION)
      onChange(clamp(bandBelow >= twoLines && bottom <= pic.top + pic.height ? MAX_POSITION : top - GAP_ABOVE_BURNED_IN))
      setMessage(
        `Burned-in subtitles found in ${band.frames} of ${band.samples} sampled frames (marked red). ` +
          'Check a few moments with two-line subtitles and drag to adjust.'
      )
    } catch (error) {
      setMessage('Detection failed: ' + error.message)
    } finally {
      setDetecting(null)
    }
  }, [source, cues, onChange])

  useEffect(() => {
    if (autoDetect && source?.direct && cuesLoaded && !autoRan.current) {
      autoRan.current = true
      detect()
    }
  }, [autoDetect, source, cuesLoaded, detect])

  const onPointerDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, position }
  }
  const onPointerMove = (e) => {
    if (!drag.current || !boxHeight) return
    onChange(clamp(drag.current.position + (e.clientY - drag.current.y) / boxHeight))
  }
  const onPointerUp = () => {
    drag.current = null
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
  const fontPx = boxHeight * FONT_SIZE
  const o = Math.max(1, Math.round(boxHeight * OUTLINE))
  const outline = [
    [-o, -o], [0, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [0, o], [o, o],
  ]
    .map(([x, y]) => `${x}px ${y}px 0 #000`)
    .join(', ')

  return (
    <div className="space-y-2">
      <div ref={boxRef} className="relative w-full bg-black overflow-hidden select-none" style={{ aspectRatio: '16 / 9' }}>
        {source && (
          <video
            ref={videoRef}
            key={source.url}
            src={source.url}
            crossOrigin={source.direct ? 'anonymous' : undefined}
            muted
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
            bottom: `${(1 - position) * 100}%`,
            fontSize: `${fontPx}px`,
            lineHeight: LINE_HEIGHT,
            fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
            fontWeight: 500,
            color: '#FFE680',
            textShadow: outline,
            borderBottom: '1px dashed rgba(255, 230, 128, 0.7)',
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
        Drag the yellow subtitles above (or below) the burned-in ones. Bottom edge at{' '}
        {Math.round(position * 100)} % of the frame height.
        {message && <span className="block mt-1 text-gray-700">{message}</span>}
      </div>
    </div>
  )
}

export default BurnedInPositioner
