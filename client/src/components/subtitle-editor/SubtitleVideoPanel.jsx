import { movieFileApi } from '../../utils/api'

/**
 * Player panel for the subtitle editor. Deliberately renders NO native
 * <track> children: the browser fetches those once, so edits would not show
 * until saved. Instead the current cue of each language is drawn in a custom
 * overlay straight from the in-memory editing state (EN above CS).
 */
function activeCueText(cues, timeMs) {
  if (!cues) return null
  const cue = cues.find((c) => c.startMs != null && c.startMs <= timeMs && timeMs <= c.endMs)
  return cue && cue.text.trim() !== '' ? cue.text : null
}

function SubtitleVideoPanel({ movieId, hasProxy, videoRef, currentTimeMs, enCues, csCues, onTimeUpdate }) {
  if (!hasProxy) {
    return (
      <div className="w-full bg-gray-100 border border-gray-200 rounded-md p-6 text-center text-sm text-gray-500">
        No preview video — editing works, seeking is disabled.
      </div>
    )
  }

  const enText = activeCueText(enCues, currentTimeMs)
  const csText = activeCueText(csCues, currentTimeMs)

  return (
    <div className="relative w-full bg-black rounded-md overflow-hidden">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        crossOrigin="use-credentials"
        className="w-full max-h-[40vh]"
        src={movieFileApi.streamUrl(movieId, 'movie_proxy')}
        onTimeUpdate={(e) => onTimeUpdate(Math.round(e.target.currentTime * 1000))}
      />
      {(enText || csText) && (
        // bottom-14 keeps the overlay clear of the native control bar.
        <div className="pointer-events-none absolute inset-x-0 bottom-14 flex flex-col items-center gap-1 px-4">
          {enText && (
            <div className="max-w-[90%] whitespace-pre-line text-center text-white text-base md:text-lg bg-black/70 rounded px-2 py-0.5">
              {enText}
            </div>
          )}
          {csText && (
            <div className="max-w-[90%] whitespace-pre-line text-center text-yellow-200 text-base md:text-lg bg-black/70 rounded px-2 py-0.5">
              {csText}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SubtitleVideoPanel
