import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { movieFileApi, movieDownloadApi, subtitleTranslationApi, subtitleSyncApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'
import { formatBytes } from '../../utils/fileSize'
import { notifyMovieFilesChanged } from '../../utils/movieFilesBus'
import FileUploadModal from './FileUploadModal'
import DownloadFromLinkModal from './DownloadFromLinkModal'
import TranslateSubtitlesModal from './TranslateSubtitlesModal'

const ACTIVE_STATUSES = ['pending', 'running']

// Maps a subtitle kind to the translation that produces the OTHER language.
const TRANSLATE_FROM_KIND = {
  subtitles_cs: { direction: 'cs_to_en', targetKind: 'subtitles_en', label: 'Translate → EN', targetLabel: 'English' },
  subtitles_en: { direction: 'en_to_cs', targetKind: 'subtitles_cs', label: 'Translate → CS', targetLabel: 'Czech' },
}

const DIRECTION_LABELS = { cs_to_en: 'CS → EN', en_to_cs: 'EN → CS' }

// Maps a subtitle kind to its alass-synced variant.
const SYNCED_KIND = {
  subtitles_cs: 'subtitles_cs_synced',
  subtitles_en: 'subtitles_en_synced',
}

const SYNC_KIND_LABELS = { subtitles_cs: 'CS', subtitles_en: 'EN' }
const SYNC_PHASE_LABELS = {
  probing: 'Analyzing…',
  extracting_audio: 'Extracting audio…',
  aligning: 'Aligning…',
  uploading: 'Uploading',
}

const ASSET_KINDS = [
  { key: 'movie', label: 'Movie file', badge: '🎬' },
  { key: 'subtitles_cs', label: 'Czech subtitles', badge: 'CS' },
  { key: 'subtitles_en', label: 'English subtitles', badge: 'EN' },
  // Synced variants are machine-generated; rows show only when present.
  { key: 'subtitles_cs_synced', label: 'Czech subtitles (synced)', badge: 'CS✓', synced: true },
  { key: 'subtitles_en_synced', label: 'English subtitles (synced)', badge: 'EN✓', synced: true },
]

const KIND_OPTIONS = [
  { value: 'movie', label: 'Movie file' },
  { value: 'movie_proxy', label: 'Preview proxy (mp4)' },
  { value: 'subtitles_cs', label: 'Czech subtitles' },
  { value: 'subtitles_en', label: 'English subtitles' },
  { value: 'subtitles_cs_synced', label: 'Czech subtitles (synced)' },
  { value: 'subtitles_en_synced', label: 'English subtitles (synced)' },
]

function StatusBadge({ present }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        present ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-400'
      }`}
    >
      {present ? 'Present' : 'Missing'}
    </span>
  )
}

/**
 * Movie files section for the movie detail page: shows the 3-asset status,
 * lets the user create the Drive folder, rescan, upload subtitles, import
 * unclassified files, and remove assets. Big-file upload and download-from-link
 * are wired in later.
 */
function MovieFilesSection({ movieId }) {
  const { success, error: showError, info } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [trashOnRemove, setTrashOnRemove] = useState(false)
  const [uploadKind, setUploadKind] = useState(null)
  const [showDownload, setShowDownload] = useState(false)
  const [translateKind, setTranslateKind] = useState(null)
  const [jobs, setJobs] = useState([])
  const [translationJobs, setTranslationJobs] = useState([])
  const [syncJobs, setSyncJobs] = useState([])
  const subtitleInputs = useRef({})
  const wasPolling = useRef(false)
  const wasPollingTranslations = useRef(false)
  const wasPollingSyncs = useRef(false)

  const load = useCallback(async () => {
    try {
      const [filesRes, jobsRes, translationRes, syncRes] = await Promise.all([
        movieFileApi.getFiles(movieId),
        movieDownloadApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
        subtitleTranslationApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
        subtitleSyncApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
      ])
      setData(filesRes.data)
      setJobs(jobsRes.data.jobs || [])
      setTranslationJobs(translationRes.data.jobs || [])
      setSyncJobs(syncRes.data.jobs || [])
    } catch (error) {
      console.error('Error loading movie files:', error)
      showError('Failed to load files: ' + (error.response?.data?.error || error.message))
    } finally {
      setLoading(false)
    }
  }, [movieId, showError])

  useEffect(() => {
    load()
  }, [load])

  // Poll while any job is active; when the last one finishes, refresh files.
  useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPolling.current) {
        wasPolling.current = false
        // A finished download may have enqueued a proxy transcode; let the
        // preview section pick it up.
        load().then(() => notifyMovieFilesChanged(movieId))
      }
      return undefined
    }
    wasPolling.current = true
    const timer = setInterval(async () => {
      try {
        const res = await movieDownloadApi.getForMovie(movieId)
        setJobs(res.data.jobs || [])
      } catch {
        // transient; keep polling
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [jobs, movieId, load])

  // Poll translation jobs while any is active; toast + refresh on completion.
  useEffect(() => {
    const hasActive = translationJobs.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPollingTranslations.current) {
        wasPollingTranslations.current = false
        const last = translationJobs[0]
        if (last?.status === 'completed') {
          success('Subtitles translated')
        } else if (last?.status === 'failed') {
          showError('Translation failed: ' + (last.error_message || 'unknown error'))
        }
        load().then(() => notifyMovieFilesChanged(movieId))
      }
      return undefined
    }
    wasPollingTranslations.current = true
    const timer = setInterval(async () => {
      try {
        const res = await subtitleTranslationApi.getForMovie(movieId)
        setTranslationJobs(res.data.jobs || [])
      } catch {
        // transient; keep polling
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [translationJobs, movieId, load, success, showError])

  // Poll sync jobs while any is active; toast + refresh on completion.
  useEffect(() => {
    const hasActive = syncJobs.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPollingSyncs.current) {
        wasPollingSyncs.current = false
        const last = syncJobs[0]
        if (last?.status === 'completed') {
          success('Subtitles synced')
        } else if (last?.status === 'failed') {
          showError('Subtitle sync failed: ' + (last.error_message || 'unknown error'))
        }
        load().then(() => notifyMovieFilesChanged(movieId))
      }
      return undefined
    }
    wasPollingSyncs.current = true
    const timer = setInterval(async () => {
      try {
        const res = await subtitleSyncApi.getForMovie(movieId)
        setSyncJobs(res.data.jobs || [])
      } catch {
        // transient; keep polling
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [syncJobs, movieId, load, success, showError])

  const fileForKind = (kind) => (data?.files || []).find((f) => f.file_kind === kind)
  const hasActiveTranslation = translationJobs.some((j) => ACTIVE_STATUSES.includes(j.status))
  const hasActiveSyncFor = (kind) =>
    syncJobs.some((j) => j.subtitle_kind === kind && ACTIVE_STATUSES.includes(j.status))
  const hasVideoFile = !!fileForKind('movie_proxy') || !!fileForKind('movie')

  const createFolder = async () => {
    setBusy(true)
    try {
      await movieFileApi.ensureFolder(movieId)
      success('Drive folder created')
      await load()
    } catch (error) {
      showError('Failed to create folder: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const rescan = async () => {
    setBusy(true)
    try {
      await movieFileApi.rescan(movieId)
      info('Rescan complete')
      await load()
    } catch (error) {
      showError('Rescan failed: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const uploadSubtitle = async (kind, file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = async () => {
      // reader.result is a data: URL; strip the prefix for base64 content.
      const base64 = String(reader.result).split(',')[1] || ''
      setBusy(true)
      try {
        await movieFileApi.uploadSubtitles(movieId, {
          file_kind: kind,
          file_name: file.name,
          content_base64: base64,
        })
        success('Subtitles uploaded')
        await load()
        notifyMovieFilesChanged(movieId)
      } catch (error) {
        showError('Subtitle upload failed: ' + (error.response?.data?.error || error.message))
      } finally {
        setBusy(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const removeAsset = async (kind) => {
    const trashNote = trashOnRemove ? ' and move it to Drive trash' : ''
    if (!window.confirm(`Remove this asset from the app${trashNote}?`)) return
    setBusy(true)
    try {
      await movieFileApi.deleteFile(movieId, kind, trashOnRemove)
      success('Asset removed')
      await load()
      notifyMovieFilesChanged(movieId)
    } catch (error) {
      showError('Remove failed: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const cancelJob = async (jobId) => {
    try {
      await movieDownloadApi.cancel(jobId)
      const res = await movieDownloadApi.getForMovie(movieId)
      setJobs(res.data.jobs || [])
    } catch (error) {
      showError('Cancel failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const retryJob = async (jobId) => {
    try {
      await movieDownloadApi.retry(jobId)
      const res = await movieDownloadApi.getForMovie(movieId)
      setJobs(res.data.jobs || [])
    } catch (error) {
      showError('Retry failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const refreshTranslationJobs = async () => {
    const res = await subtitleTranslationApi.getForMovie(movieId)
    setTranslationJobs(res.data.jobs || [])
  }

  const cancelTranslationJob = async (jobId) => {
    try {
      await subtitleTranslationApi.cancel(jobId)
      const res = await subtitleTranslationApi.getForMovie(movieId)
      setTranslationJobs(res.data.jobs || [])
    } catch (error) {
      showError('Cancel failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const retryTranslationJob = async (jobId) => {
    try {
      await subtitleTranslationApi.retry(jobId)
      const res = await subtitleTranslationApi.getForMovie(movieId)
      setTranslationJobs(res.data.jobs || [])
    } catch (error) {
      showError('Retry failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const dismissTranslationJob = async (jobId) => {
    try {
      await subtitleTranslationApi.dismiss(jobId)
      const res = await subtitleTranslationApi.getForMovie(movieId)
      setTranslationJobs(res.data.jobs || [])
    } catch (error) {
      showError('Hide failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const startSync = async (sourceKind) => {
    const syncedExists = !!fileForKind(SYNCED_KIND[sourceKind])
    if (
      syncedExists &&
      !window.confirm('A synced copy already exists. Replace it with a new sync run?')
    ) {
      return
    }
    setBusy(true)
    try {
      await subtitleSyncApi.create({ movie_id: movieId, subtitle_kind: sourceKind })
      info('Subtitle sync started')
      const res = await subtitleSyncApi.getForMovie(movieId)
      setSyncJobs(res.data.jobs || [])
    } catch (error) {
      showError('Sync failed to start: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const cancelSyncJob = async (jobId) => {
    try {
      await subtitleSyncApi.cancel(jobId)
      const res = await subtitleSyncApi.getForMovie(movieId)
      setSyncJobs(res.data.jobs || [])
    } catch (error) {
      showError('Cancel failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const retrySyncJob = async (jobId) => {
    try {
      await subtitleSyncApi.retry(jobId)
      const res = await subtitleSyncApi.getForMovie(movieId)
      setSyncJobs(res.data.jobs || [])
    } catch (error) {
      showError('Retry failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const dismissSyncJob = async (jobId) => {
    try {
      await subtitleSyncApi.dismiss(jobId)
      const res = await subtitleSyncApi.getForMovie(movieId)
      setSyncJobs(res.data.jobs || [])
    } catch (error) {
      showError('Hide failed: ' + (error.response?.data?.error || error.message))
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading files…</div>
  }

  if (data && data.drive_configured === false) {
    return (
      <div className="rounded-md bg-blue-50 border border-blue-200 p-4 text-sm text-blue-800">
        Google Drive is not configured. File management is unavailable until a
        service account is set up (see <code>docs/GOOGLE_DRIVE_SETUP.md</code>).
        {(data.files || []).length > 0 && (
          <div className="mt-2">Known assets: {(data.files || []).length}</div>
        )}
      </div>
    )
  }

  const folder = data?.folder
  const unclassified = data?.unclassified || []

  return (
    <div className="space-y-6">
      {data?.drive_error && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          Could not reach Drive: {data.drive_error}. Showing last-known status.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {!folder ? (
          <button
            onClick={createFolder}
            disabled={busy}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            Create Drive folder
          </button>
        ) : (
          <button
            onClick={rescan}
            disabled={busy}
            className="bg-gray-600 text-white px-3 py-1.5 rounded-md hover:bg-gray-700 text-sm disabled:opacity-50"
          >
            Rescan
          </button>
        )}
        {folder && (
          <button
            onClick={() => setShowDownload(true)}
            className="bg-gray-600 text-white px-3 py-1.5 rounded-md hover:bg-gray-700 text-sm"
          >
            Download from link
          </button>
        )}
        <label className="flex items-center space-x-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={trashOnRemove}
            onChange={(e) => setTrashOnRemove(e.target.checked)}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          <span>Also move to Drive trash when removing</span>
        </label>
      </div>

      {/* Download jobs */}
      {jobs.filter((j) => j.status !== 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Download jobs</h4>
          {jobs
            .filter((j) => j.status !== 'completed')
            .map((job) => {
              const total = job.bytes_total != null ? Number(job.bytes_total) : null
              const transferred = Number(job.bytes_transferred || 0)
              const pct = total ? Math.min(100, Math.round((transferred / total) * 100)) : null
              const active = ACTIVE_STATUSES.includes(job.status)
              const retryable = ['failed', 'cancelled', 'interrupted'].includes(job.status)
              return (
                <div key={job.id} className="border border-gray-200 rounded-md p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      {job.file_kind} · {job.source_type} · <span className="font-medium">{job.status}</span>
                    </span>
                    <div className="space-x-3 shrink-0">
                      {active && (
                        <button onClick={() => cancelJob(job.id)} className="text-red-600 hover:text-red-800">
                          Cancel
                        </button>
                      )}
                      {retryable && (
                        <button onClick={() => retryJob(job.id)} className="text-blue-600 hover:text-blue-800">
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                  {active && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${pct != null ? pct : 0}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {formatBytes(transferred)}{total != null && ` / ${formatBytes(total)}`}
                        {pct != null && ` (${pct}%)`}
                      </div>
                    </div>
                  )}
                  {job.error_message && (
                    <div className="text-xs text-red-600 mt-1">{job.error_message}</div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* Translation jobs */}
      {translationJobs.filter((j) => j.status !== 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Translation jobs</h4>
          {translationJobs
            .filter((j) => j.status !== 'completed')
            .map((job) => {
              const pct = Math.min(100, Math.round(Number(job.progress_percent || 0)))
              const active = ACTIVE_STATUSES.includes(job.status)
              const retryable = ['failed', 'cancelled', 'interrupted'].includes(job.status)
              const timestamp = job.finished_at || job.created_at
              return (
                <div key={job.id} className="border border-gray-200 rounded-md p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      {DIRECTION_LABELS[job.direction] || job.direction} ·{' '}
                      <span className="font-medium">{job.status}</span>
                      {timestamp && (
                        <span className="text-gray-500">
                          {' · '}
                          {new Date(timestamp).toLocaleString()}
                        </span>
                      )}
                    </span>
                    <div className="space-x-3 shrink-0">
                      {active && (
                        <button
                          onClick={() => cancelTranslationJob(job.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Cancel
                        </button>
                      )}
                      {retryable && (
                        <button
                          onClick={() => retryTranslationJob(job.id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Retry
                        </button>
                      )}
                      {!active && (
                        <button
                          onClick={() => dismissTranslationJob(job.id)}
                          className="text-gray-500 hover:text-gray-700"
                          title="Hide this job"
                        >
                          Hide
                        </button>
                      )}
                    </div>
                  </div>
                  {active && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {job.total_cues != null
                          ? `${job.translated_cues || 0}/${job.total_cues} cues (${pct}%)`
                          : `${pct}%`}
                      </div>
                    </div>
                  )}
                  {job.context_note && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2" title={job.context_note}>
                      Context: {job.context_note}
                    </div>
                  )}
                  {job.error_message && (
                    <div className="text-xs text-red-600 mt-1">{job.error_message}</div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* Sync jobs */}
      {syncJobs.filter((j) => j.status !== 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Sync jobs</h4>
          {syncJobs
            .filter((j) => j.status !== 'completed')
            .map((job) => {
              const pct = Math.min(100, Math.round(Number(job.progress_percent || 0)))
              const active = ACTIVE_STATUSES.includes(job.status)
              const retryable = ['failed', 'cancelled'].includes(job.status)
              const timestamp = job.finished_at || job.created_at
              return (
                <div key={job.id} className="border border-gray-200 rounded-md p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      Sync {SYNC_KIND_LABELS[job.subtitle_kind] || job.subtitle_kind} ·{' '}
                      <span className="font-medium">{job.status}</span>
                      {active && job.phase && (
                        <span className="text-gray-500"> · {SYNC_PHASE_LABELS[job.phase] || job.phase}</span>
                      )}
                      {timestamp && (
                        <span className="text-gray-500">
                          {' · '}
                          {new Date(timestamp).toLocaleString()}
                        </span>
                      )}
                    </span>
                    <div className="space-x-3 shrink-0">
                      {active && (
                        <button
                          onClick={() => cancelSyncJob(job.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Cancel
                        </button>
                      )}
                      {retryable && (
                        <button
                          onClick={() => retrySyncJob(job.id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Retry
                        </button>
                      )}
                      {!active && (
                        <button
                          onClick={() => dismissSyncJob(job.id)}
                          className="text-gray-500 hover:text-gray-700"
                          title="Hide this job"
                        >
                          Hide
                        </button>
                      )}
                    </div>
                  </div>
                  {active && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{pct}%</div>
                    </div>
                  )}
                  {job.error_message && (
                    <div className="text-xs text-red-600 mt-1">{job.error_message}</div>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* Asset rows */}
      <div className="divide-y divide-gray-200 border border-gray-200 rounded-md">
        {ASSET_KINDS.map((asset) => {
          const row = fileForKind(asset.key)
          const isSubtitle = asset.key !== 'movie'
          // Synced variants are machine-generated: hide the row until one exists.
          if (asset.synced && !row) return null
          return (
            <div key={asset.key} className="flex items-center justify-between p-3">
              <div className="flex items-center space-x-3 min-w-0">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded bg-gray-100 text-xs font-semibold text-gray-600">
                  {asset.badge}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-900">{asset.label}</span>
                    <StatusBadge present={!!row} />
                  </div>
                  {row && (
                    <div className="text-xs text-gray-500 truncate">
                      {row.file_name}
                      {row.file_size != null && ` · ${formatBytes(Number(row.file_size))}`}
                      {row.last_synced_at && ` · synced ${new Date(row.last_synced_at).toLocaleString()}`}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                {!isSubtitle && folder && (
                  <button
                    onClick={() => setUploadKind(asset.key)}
                    disabled={busy}
                    className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                  >
                    {row ? 'Replace' : 'Upload'}
                  </button>
                )}
                {isSubtitle && folder && (
                  <>
                    {!asset.synced && (
                      <>
                        <input
                          ref={(el) => (subtitleInputs.current[asset.key] = el)}
                          type="file"
                          accept=".srt,.vtt"
                          className="hidden"
                          onChange={(e) => {
                            uploadSubtitle(asset.key, e.target.files[0])
                            e.target.value = ''
                          }}
                        />
                        <button
                          onClick={() => subtitleInputs.current[asset.key]?.click()}
                          disabled={busy}
                          className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                        >
                          {row ? 'Replace' : 'Upload'}
                        </button>
                      </>
                    )}
                    {row && TRANSLATE_FROM_KIND[asset.key] && (
                      <button
                        onClick={() => setTranslateKind(asset.key)}
                        disabled={busy || hasActiveTranslation}
                        title="Machine-translate these subtitles with an LLM"
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        {TRANSLATE_FROM_KIND[asset.key].label}
                      </button>
                    )}
                    {row && SYNCED_KIND[asset.key] && (
                      <button
                        onClick={() => startSync(asset.key)}
                        disabled={busy || hasActiveSyncFor(asset.key) || !hasVideoFile}
                        title={
                          hasVideoFile
                            ? 'Align subtitle timings to the movie audio (alass)'
                            : 'Add a movie file or preview first'
                        }
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        Sync timing
                      </button>
                    )}
                    {row && (
                      <Link
                        to={`/movies/${movieId}/subtitles`}
                        state={{ from: 'files' }}
                        title="Edit subtitle text in the visual editor"
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </Link>
                    )}
                  </>
                )}
                {row && (
                  <button
                    onClick={() => removeAsset(asset.key)}
                    disabled={busy}
                    className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Unclassified files (present in Drive folder but not yet mapped) */}
      {unclassified.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-2">
            Unclassified files in folder ({unclassified.length})
          </h4>
          <div className="space-y-2">
            {unclassified.map((f) => (
              <UnclassifiedRow
                key={f.id}
                file={f}
                busy={busy}
                onImport={async (fileKind, rename, replace) => {
                  setBusy(true)
                  try {
                    await movieFileApi.importFile(movieId, {
                      drive_file_id: f.id,
                      file_kind: fileKind,
                      rename,
                      replace,
                    })
                    success('File imported')
                    await load()
                    notifyMovieFilesChanged(movieId)
                  } catch (error) {
                    if (error.response?.status === 409) {
                      showError('That asset kind is already set. Enable "replace" to overwrite.')
                    } else {
                      showError('Import failed: ' + (error.response?.data?.error || error.message))
                    }
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      <FileUploadModal
        isOpen={!!uploadKind}
        onClose={() => setUploadKind(null)}
        movieId={movieId}
        fileKind={uploadKind || 'movie'}
        onUploaded={async () => {
          // A completed master upload enqueues a proxy transcode server-side;
          // notify so the preview section starts polling it.
          await load()
          notifyMovieFilesChanged(movieId)
        }}
      />

      <DownloadFromLinkModal
        isOpen={showDownload}
        onClose={() => setShowDownload(false)}
        movieId={movieId}
        onCreated={async () => {
          await load()
          notifyMovieFilesChanged(movieId)
        }}
      />

      <TranslateSubtitlesModal
        isOpen={!!translateKind}
        onClose={() => setTranslateKind(null)}
        movieId={movieId}
        translation={translateKind ? TRANSLATE_FROM_KIND[translateKind] : null}
        targetExists={!!(translateKind && fileForKind(TRANSLATE_FROM_KIND[translateKind].targetKind))}
        onCreated={refreshTranslationJobs}
      />
    </div>
  )
}

function UnclassifiedRow({ file, busy, onImport }) {
  const [kind, setKind] = useState('movie')
  const [rename, setRename] = useState(true)
  const [replace, setReplace] = useState(false)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 border border-gray-200 rounded-md">
      <div className="min-w-0">
        <div className="text-sm text-gray-900 truncate">{file.name}</div>
        <div className="text-xs text-gray-500">
          {file.size != null ? formatBytes(Number(file.size)) : ''} {file.mimeType}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center space-x-1 text-xs text-gray-600">
          <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />
          <span>rename</span>
        </label>
        <label className="flex items-center space-x-1 text-xs text-gray-600">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>replace</span>
        </label>
        <button
          onClick={() => onImport(kind, rename, replace)}
          disabled={busy}
          className="bg-blue-600 text-white px-2 py-1 rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
        >
          Import
        </button>
      </div>
    </div>
  )
}

export default MovieFilesSection
