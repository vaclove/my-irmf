import { useState, useEffect, useCallback, useRef } from 'react'
import { subtitleBurnApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'
import { formatBytes } from '../../utils/fileSize'
import { onMovieFilesChanged } from '../../utils/movieFilesBus'
import SubtitleExportModal from './SubtitleExportModal'

const ACTIVE_STATUSES = ['pending', 'running']
const PHASE_LABELS = {
  probing: 'Analyzing…',
  rendering: 'Rendering',
  verifying: 'Checking the file…',
  uploading: 'Uploading',
}
const KIND_LABELS = { preview: 'Preview clip', full: 'Full export' }
const LAYOUT_LABELS = { paired: 'CS+EN paired', zones: 'CS+EN separate timings', single: 'one language' }

function languagesOf(job) {
  return [job.subtitle_cs_ref && 'CS', job.subtitle_en_ref && 'EN'].filter(Boolean).join(' + ')
}

/** "1080p · CS+EN paired · 2.4 GB" from what the worker recorded. */
function renderSummary(job) {
  const info = job.render_info || {}
  const parts = []
  if (info.canvas) parts.push(`${info.canvas.height}p`)
  if (info.layout) parts.push(LAYOUT_LABELS[info.layout] || info.layout)
  if (info.crop) parts.push('letterbox removed')
  if (job.file_size) parts.push(formatBytes(Number(job.file_size)))
  return parts.join(' · ')
}

/**
 * Screening copies with CS/EN subtitles burned into the picture, rendered by
 * the movie worker from the master. Files are temporary downloads (deleted
 * automatically after 20 days, previews after 3); a new export replaces the
 * previous one of the same kind.
 */
function SubtitleExportSection({ movieId }) {
  const { success, error: showError } = useToast()
  const [data, setData] = useState(null)
  const [modalKind, setModalKind] = useState(null)
  const [playingId, setPlayingId] = useState(null)
  const wasPolling = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await subtitleBurnApi.getForMovie(movieId)
      setData(res.data)
    } catch (error) {
      console.error('Error loading subtitle exports:', error)
    }
  }, [movieId])

  useEffect(() => {
    load()
  }, [load])

  // Subtitles or the master changed elsewhere on the page.
  useEffect(() => onMovieFilesChanged(movieId, load), [movieId, load])

  const jobs = data?.jobs || []

  // Poll while any job is active; toast when the last one finishes.
  useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPolling.current) {
        wasPolling.current = false
        const last = jobs[0]
        if (last?.status === 'completed') success(`${KIND_LABELS[last.kind]} is ready`)
        else if (last?.status === 'failed') showError('Export failed: ' + (last.error_message || 'unknown error'))
      }
      return undefined
    }
    wasPolling.current = true
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [jobs, load, success, showError])

  const act = async (fn, failMessage) => {
    try {
      await fn()
      await load()
    } catch (error) {
      showError(failMessage + ': ' + (error.response?.data?.error || error.message))
    }
  }

  if (!data) return null

  const sources = data.sources || {}
  const hasSubtitles = ['subtitles_cs', 'subtitles_cs_synced', 'subtitles_en', 'subtitles_en_synced'].some(
    (k) => sources[k]
  )
  const activeKinds = new Set(jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).map((j) => j.kind))
  const disabledReason = !data.configured
    ? 'Export storage is not configured'
    : !sources.movie
      ? 'Add the movie master first'
      : !hasSubtitles
        ? 'Add subtitles first'
        : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Screening export</h3>
          <p className="text-sm text-gray-500">
            MP4 with Czech and English subtitles burned in, for screening from a laptop. Files are deleted
            automatically after 20 days (preview clips after 3).
          </p>
        </div>
        <div className="flex shrink-0 space-x-2">
          {['preview', 'full'].map((kind) => (
            <button
              key={kind}
              onClick={() => setModalKind(kind)}
              disabled={!!disabledReason || activeKinds.has(kind)}
              title={disabledReason || (activeKinds.has(kind) ? 'Already running' : undefined)}
              className={`px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50 ${
                kind === 'full'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {kind === 'preview' ? 'Preview clip' : 'Export movie'}
            </button>
          ))}
        </div>
      </div>
      {disabledReason && <div className="text-sm text-gray-500">{disabledReason}.</div>}

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => {
            const active = ACTIVE_STATUSES.includes(job.status)
            const pct = Math.min(100, Math.round(Number(job.progress_percent || 0)))
            const retryable = ['failed', 'cancelled'].includes(job.status)
            const gone = job.status === 'completed' && !job.available
            const timestamp = job.finished_at || job.created_at
            return (
              <div key={job.id} className="border border-gray-200 rounded-md p-3">
                <div className="flex items-center justify-between text-sm gap-3">
                  <span className="truncate">
                    {KIND_LABELS[job.kind]} · {languagesOf(job)} ·{' '}
                    <span className="font-medium">
                      {gone ? (job.blob_deleted_at ? 'replaced' : 'expired') : job.status}
                    </span>
                    {active && job.phase && (
                      <span className="text-gray-500"> · {PHASE_LABELS[job.phase] || job.phase}</span>
                    )}
                    {renderSummary(job) && <span className="text-gray-500"> · {renderSummary(job)}</span>}
                    {timestamp && (
                      <span className="text-gray-500">
                        {' · '}
                        {new Date(timestamp).toLocaleString()}
                      </span>
                    )}
                  </span>
                  <div className="space-x-3 shrink-0">
                    {job.available && (
                      <>
                        {job.kind === 'preview' && (
                          <button
                            onClick={() => setPlayingId(playingId === job.id ? null : job.id)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {playingId === job.id ? 'Close' : 'Play'}
                          </button>
                        )}
                        <a href={subtitleBurnApi.downloadUrl(job.id)} className="text-blue-600 hover:text-blue-800">
                          Download
                        </a>
                      </>
                    )}
                    {active && (
                      <button
                        onClick={() => act(() => subtitleBurnApi.cancel(job.id), 'Cancel failed')}
                        className="text-red-600 hover:text-red-800"
                      >
                        Cancel
                      </button>
                    )}
                    {retryable && (
                      <button
                        onClick={() => act(() => subtitleBurnApi.retry(job.id), 'Retry failed')}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Retry
                      </button>
                    )}
                    {!active && (
                      <button
                        onClick={() => act(() => subtitleBurnApi.dismiss(job.id), 'Remove failed')}
                        className="text-gray-500 hover:text-gray-700"
                        title={job.available ? 'Delete the file and hide this export' : 'Hide this export'}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                {job.available && job.expires_at && (
                  <div className="text-xs text-gray-500 mt-1">
                    Available until {new Date(job.expires_at).toLocaleDateString()}
                  </div>
                )}
                {job.status === 'failed' && job.error_message && (
                  <div className="text-xs text-red-600 mt-1 break-words">{job.error_message}</div>
                )}
                {active && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {pct}%
                      {Number(job.bytes_transferred) > 0 && ` · ${formatBytes(Number(job.bytes_transferred))} uploaded`}
                    </div>
                  </div>
                )}
                {playingId === job.id && job.available && (
                  <video
                    src={subtitleBurnApi.playUrl(job.id)}
                    controls
                    autoPlay
                    className="mt-3 w-full rounded bg-black"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalKind && (
        <SubtitleExportModal
          onClose={() => setModalKind(null)}
          movieId={movieId}
          kind={modalKind}
          sources={sources}
          onCreated={load}
        />
      )}
    </div>
  )
}

export default SubtitleExportSection
