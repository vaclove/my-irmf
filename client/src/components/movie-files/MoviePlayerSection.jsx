import { useState, useEffect, useCallback, useRef } from 'react'
import { movieFileApi, movieTranscodeApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'
import { formatBytes } from '../../utils/fileSize'
import { onMovieFilesChanged } from '../../utils/movieFilesBus'

const ACTIVE_STATUSES = ['pending', 'running']
const PHASE_LABELS = {
  probing: 'Analyzing…',
  transcoding: 'Transcoding',
  uploading: 'Uploading proxy',
}
// A running job whose row hasn't updated in this long likely lost its worker.
const STALE_MS = 15 * 60 * 1000

/**
 * Preview player: streams the web-playable 720p proxy with CZ/EN subtitle
 * tracks. If no proxy exists yet, offers to generate one (a background worker
 * transcodes the master). Generation also auto-starts when a master is added.
 */
function MoviePlayerSection({ movieId }) {
  const { success, error: showError, info } = useToast()
  const [data, setData] = useState(null)
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const wasPolling = useRef(false)

  const load = useCallback(async () => {
    try {
      const [filesRes, jobsRes] = await Promise.all([
        movieFileApi.getFiles(movieId),
        movieTranscodeApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
      ])
      setData(filesRes.data)
      setJobs(jobsRes.data.jobs || [])
    } catch (error) {
      console.error('Error loading player:', error)
      showError('Failed to load preview: ' + (error.response?.data?.error || error.message))
    } finally {
      setLoading(false)
    }
  }, [movieId, showError])

  useEffect(() => {
    load()
  }, [load])

  // Reload when the Files section reports a change for this movie: adding a
  // master there enqueues a proxy transcode server-side, which we must pick up
  // (and start polling) without a manual page refresh.
  useEffect(() => onMovieFilesChanged(movieId, load), [movieId, load])

  // Poll while a job is active; refresh files (proxy row) when it finishes.
  useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPolling.current) {
        wasPolling.current = false
        load()
      }
      return undefined
    }
    wasPolling.current = true
    const timer = setInterval(async () => {
      try {
        const res = await movieTranscodeApi.getForMovie(movieId)
        setJobs(res.data.jobs || [])
      } catch {
        // transient; keep polling
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [jobs, movieId, load])

  const fileForKind = (kind) => (data?.files || []).find((f) => f.file_kind === kind)

  const generate = async () => {
    setBusy(true)
    try {
      await movieTranscodeApi.create({ movie_id: movieId })
      info('Preview generation started')
      const res = await movieTranscodeApi.getForMovie(movieId)
      setJobs(res.data.jobs || [])
    } catch (error) {
      showError('Could not start preview: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (jobId) => {
    try {
      await movieTranscodeApi.cancel(jobId)
      const res = await movieTranscodeApi.getForMovie(movieId)
      setJobs(res.data.jobs || [])
    } catch (error) {
      showError('Cancel failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const retry = async (jobId) => {
    try {
      await movieTranscodeApi.retry(jobId)
      const res = await movieTranscodeApi.getForMovie(movieId)
      setJobs(res.data.jobs || [])
    } catch (error) {
      showError('Retry failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const deleteProxy = async () => {
    if (jobs.some((j) => ACTIVE_STATUSES.includes(j.status))) return
    if (!window.confirm('Delete the preview proxy (also moves it to Drive trash)?')) return
    setBusy(true)
    try {
      await movieFileApi.deleteFile(movieId, 'movie_proxy', true)
      success('Preview deleted')
      await load()
    } catch (error) {
      showError('Delete failed: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading preview…</div>
  }

  if (data && data.drive_configured === false) {
    return (
      <div className="rounded-md bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
        Google Drive is not configured, so preview streaming is unavailable.
      </div>
    )
  }

  const proxy = fileForKind('movie_proxy')
  const master = fileForKind('movie')
  const hasCs = !!fileForKind('subtitles_cs')
  const hasEn = !!fileForKind('subtitles_en')
  const activeJob = jobs.find((j) => ACTIVE_STATUSES.includes(j.status))
  const latest = jobs[0]

  return (
    <div className="space-y-4">
      {proxy ? (
        <>
          {/* Cache-bust the <video> when the proxy id changes (regenerate). */}
          <video
            key={proxy.drive_file_id}
            controls
            preload="metadata"
            crossOrigin="use-credentials"
            className="w-full max-h-[70vh] bg-black rounded-md"
            src={movieFileApi.streamUrl(movieId, 'movie_proxy')}
          >
            {hasCs && (
              <track
                kind="subtitles"
                srcLang="cs"
                label="Čeština"
                src={movieFileApi.subtitleUrl(movieId, 'cs')}
              />
            )}
            {hasEn && (
              <track
                kind="subtitles"
                srcLang="en"
                label="English"
                src={movieFileApi.subtitleUrl(movieId, 'en')}
              />
            )}
          </video>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-500">
              720p preview{proxy.file_size != null && ` · ${formatBytes(Number(proxy.file_size))}`}
              {!hasCs && !hasEn && ' · no subtitles yet'}
            </span>
            <div className="flex-1" />
            <button
              onClick={generate}
              disabled={busy || !!activeJob}
              className="text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              onClick={deleteProxy}
              disabled={busy || !!activeJob}
              className="text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Delete preview
            </button>
          </div>
        </>
      ) : !activeJob ? (
        master ? (
          <div className="rounded-md border border-gray-200 p-4 text-sm text-gray-600">
            <p>No preview has been generated yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              A preview is normally created automatically when a movie file is added.
            </p>
            <button
              onClick={generate}
              disabled={busy}
              className="mt-3 bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Generate preview
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-gray-200 p-4 text-sm text-gray-500">
            Add a movie file in the Files section below to enable the preview.
          </div>
        )
      ) : null}

      {/* Active job progress */}
      {activeJob && (
        <TranscodeProgress job={activeJob} onCancel={() => cancel(activeJob.id)} />
      )}

      {/* Terminal failure on the latest job (when no active job / no proxy) */}
      {!activeJob && latest && ['failed', 'cancelled'].includes(latest.status) && !proxy && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          <div>
            Last preview attempt {latest.status}
            {latest.error_message ? `: ${latest.error_message}` : '.'}
          </div>
          <button
            onClick={() => retry(latest.id)}
            className="mt-2 text-blue-700 hover:text-blue-900 font-medium"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

function TranscodeProgress({ job, onCancel }) {
  const phaseLabel = PHASE_LABELS[job.phase] || (job.status === 'pending' ? 'Queued' : 'Working…')
  const isUploading = job.phase === 'uploading'
  const total = job.bytes_total != null ? Number(job.bytes_total) : null
  const transferred = Number(job.bytes_transferred || 0)
  const pct = isUploading
    ? total
      ? Math.min(100, Math.round((transferred / total) * 100))
      : null
    : Math.min(100, Math.round(Number(job.progress_percent || 0)))
  const stale =
    job.status === 'running' &&
    job.updated_at &&
    Date.now() - new Date(job.updated_at).getTime() > STALE_MS

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-800">
          {job.status === 'pending'
            ? 'Queued — a transcoder will start shortly'
            : phaseLabel}
        </span>
        <button onClick={onCancel} className="text-red-600 hover:text-red-800">
          Cancel
        </button>
      </div>
      {job.status === 'running' && (
        <div className="mt-2">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${pct != null ? pct : 0}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {isUploading
              ? `${formatBytes(transferred)}${total != null ? ` / ${formatBytes(total)}` : ''}`
              : `${pct != null ? pct : 0}%`}
          </div>
        </div>
      )}
      {stale && (
        <div className="text-xs text-yellow-700 mt-2">
          No progress recently — the worker may have restarted. It will resume from the queue.
        </div>
      )}
    </div>
  )
}

export default MoviePlayerSection
