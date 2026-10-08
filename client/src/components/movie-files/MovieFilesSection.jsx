import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { movieFileApi, movieDownloadApi, subtitleTranslationApi, subtitleSyncApi, subtitleQualityApi } from '../../utils/api'
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

const QUALITY_LANG_LABELS = { cs: 'CS', en: 'EN', cs_synced: 'CS✓', en_synced: 'EN✓' }

const TRANSFER_LABELS = {
  drive_to_azure: 'Copy to Azure',
  azure_to_drive: 'Back up to Drive',
}
const KIND_SHORT = {
  movie: 'movie',
  movie_proxy: 'preview',
  subtitles_cs: 'CS subtitles',
  subtitles_en: 'EN subtitles',
  subtitles_cs_synced: 'CS synced',
  subtitles_en_synced: 'EN synced',
}

// Where a row's primary copy lives and how its Drive copy stands.
function StorageInfo({ row, onAdoptDrive, onBackup, busy }) {
  if (row.storage !== 'azure') {
    return <span className="text-gray-400">Drive</span>
  }
  const tier = row.file_kind === 'movie' ? 'Cold' : 'Hot'
  const isSubtitle = row.file_kind.startsWith('subtitles_')
  return (
    <>
      <span title={`Stored in Azure Blob Storage (${tier} tier)`}>Azure · {tier}</span>
      {row.drive_state === 'in_sync' && <span className="text-green-700"> · Drive copy ✓</span>}
      {row.drive_state === 'outdated' && (
        <span className="text-amber-700" title="The latest version hasn't reached the Drive copy yet">
          {' '}· Drive copy outdated
          {row.file_kind === 'movie' && (
            <button
              onClick={onBackup}
              disabled={busy}
              className="ml-1 underline hover:text-amber-900 disabled:opacity-50"
            >
              back up
            </button>
          )}
        </span>
      )}
      {row.drive_state === 'changed' && (
        <span className="text-red-700">
          {' '}· Drive copy edited outside the app
          {isSubtitle && (
            <button
              onClick={onAdoptDrive}
              disabled={busy}
              className="ml-1 underline hover:text-red-900 disabled:opacity-50"
              title="Replace the app's version with the edited Drive copy"
            >
              use Drive version
            </button>
          )}
        </span>
      )}
      {row.drive_state === 'none' && row.file_kind === 'movie' && (
        <span className="text-amber-700">
          {' '}· no Drive backup
          <button
            onClick={onBackup}
            disabled={busy}
            className="ml-1 underline hover:text-amber-900 disabled:opacity-50"
          >
            back up
          </button>
        </span>
      )}
    </>
  )
}
const QUALITY_PHASE_LABELS = { linting: 'Checking…', suggesting: 'Generating suggestions…' }

// subtitles_cs -> cs, subtitles_en_synced -> en_synced (the quality-gate lang key)
const qualityLangForKind = (kind) => kind.replace('subtitles_', '')

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
  const [qualityRuns, setQualityRuns] = useState([])
  const [qualitySummary, setQualitySummary] = useState({ counts: {} })
  const [transfers, setTransfers] = useState([])
  const subtitleInputs = useRef({})
  const wasPolling = useRef(false)
  const wasPollingTranslations = useRef(false)
  const wasPollingSyncs = useRef(false)
  const wasPollingQuality = useRef(false)
  const wasPollingTransfers = useRef(false)

  const load = useCallback(async () => {
    try {
      const [filesRes, jobsRes, translationRes, syncRes, qualityRes, summaryRes, transfersRes] = await Promise.all([
        movieFileApi.getFiles(movieId),
        movieDownloadApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
        subtitleTranslationApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
        subtitleSyncApi.getForMovie(movieId).catch(() => ({ data: { jobs: [] } })),
        subtitleQualityApi.getRunsForMovie(movieId).catch(() => ({ data: { runs: [] } })),
        subtitleQualityApi.getFlagSummary(movieId).catch(() => ({ data: { counts: {} } })),
        movieFileApi.getTransfers(movieId).catch(() => ({ data: { jobs: [] } })),
      ])
      setData(filesRes.data)
      setJobs(jobsRes.data.jobs || [])
      setTranslationJobs(translationRes.data.jobs || [])
      setSyncJobs(syncRes.data.jobs || [])
      setQualityRuns(qualityRes.data.runs || [])
      setQualitySummary(summaryRes.data || { counts: {} })
      setTransfers(transfersRes.data.jobs || [])
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

  // Poll quality runs while any is active; toast + refresh on completion.
  useEffect(() => {
    const hasActive = qualityRuns.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPollingQuality.current) {
        wasPollingQuality.current = false
        const last = qualityRuns[0]
        if (last?.status === 'completed') {
          const issues = (last.error_count || 0) + (last.warn_count || 0)
          success(
            issues > 0
              ? `Quality check finished — ${issues} issue${issues === 1 ? '' : 's'} found`
              : 'Quality check finished — no issues'
          )
        } else if (last?.status === 'failed') {
          showError('Quality check failed: ' + (last.error_message || 'unknown error'))
        }
        load()
      }
      return undefined
    }
    wasPollingQuality.current = true
    const timer = setInterval(async () => {
      try {
        const res = await subtitleQualityApi.getRunsForMovie(movieId)
        setQualityRuns(res.data.runs || [])
      } catch {
        // transient; keep polling
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [qualityRuns, movieId, load, success, showError])

  // Poll Drive <-> Azure transfers while any is active; refresh files after.
  useEffect(() => {
    const hasActive = transfers.some((j) => ACTIVE_STATUSES.includes(j.status))
    if (!hasActive) {
      if (wasPollingTransfers.current) {
        wasPollingTransfers.current = false
        load().then(() => notifyMovieFilesChanged(movieId))
      }
      return undefined
    }
    wasPollingTransfers.current = true
    const timer = setInterval(async () => {
      try {
        const res = await movieFileApi.getTransfers(movieId)
        setTransfers(res.data.jobs || [])
      } catch {
        // transient; keep polling
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [transfers, movieId, load])

  const fileForKind = (kind) => (data?.files || []).find((f) => f.file_kind === kind)
  const hasActiveTranslation = translationJobs.some((j) => ACTIVE_STATUSES.includes(j.status))
  const hasActiveQualityFor = (lang) =>
    qualityRuns.some((j) => j.lang === lang && ACTIVE_STATUSES.includes(j.status))
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
    const row = fileForKind(kind)
    const notes = []
    if (row?.storage === 'azure') notes.push('The Azure copy is deleted (recoverable for 14 days).')
    if (row?.drive_file_id) {
      notes.push(
        trashOnRemove
          ? 'The Drive copy will be moved to Drive trash.'
          : 'The Drive copy stays, renamed to *.removed.*, so it is not picked up again.'
      )
    }
    if (!window.confirm(`Remove this asset from the app?\n\n${notes.join('\n')}`)) return
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

  // Replace the original subtitles with the synced copy (overwrites the
  // original Drive file in place; the synced copy goes to Drive trash).
  const promoteSynced = async (syncedKind) => {
    const lang = syncedKind.startsWith('subtitles_cs') ? 'cs' : 'en'
    const label = lang === 'cs' ? 'Czech' : 'English'
    if (
      !window.confirm(
        `Replace the original ${label} subtitles with the synced version?\n\n` +
          'The original file is overwritten (its old version stays in Drive version history) ' +
          'and the synced copy is removed.'
      )
    ) {
      return
    }
    setBusy(true)
    try {
      try {
        await movieFileApi.promoteSyncedSubtitles(movieId, lang)
      } catch (error) {
        if (error.response?.data?.code !== 'drive_changed') throw error
        if (
          !window.confirm(
            `${error.response.data.error}\n\nOverwrite the edited Drive copy with the synced version?`
          )
        ) {
          return
        }
        await movieFileApi.promoteSyncedSubtitles(movieId, lang, { overwrite_drive: true })
      }
      success(`${label} subtitles replaced with the synced version`)
      await load()
      notifyMovieFilesChanged(movieId)
    } catch (error) {
      showError('Replace failed: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const adoptDrive = async (kind) => {
    const lang = kind.replace('subtitles_', '')
    if (
      !window.confirm(
        "Replace the app's version of these subtitles with the copy edited on Drive?"
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await movieFileApi.adoptDriveSubtitles(movieId, lang)
      success('Drive version is now the app version')
      await load()
      notifyMovieFilesChanged(movieId)
    } catch (error) {
      showError('Failed: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const backupToDrive = async () => {
    setBusy(true)
    try {
      await movieFileApi.backupToDrive(movieId)
      info('Backup to Drive started')
      const res = await movieFileApi.getTransfers(movieId)
      setTransfers(res.data.jobs || [])
    } catch (error) {
      showError('Backup failed to start: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const retryTransfer = async (jobId) => {
    try {
      await movieFileApi.retryTransfer(movieId, jobId)
      const res = await movieFileApi.getTransfers(movieId)
      setTransfers(res.data.jobs || [])
    } catch (error) {
      showError('Retry failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const dismissTransfer = async (jobId) => {
    try {
      await movieFileApi.dismissTransfer(movieId, jobId)
      setTransfers((list) => list.filter((j) => j.id !== jobId))
    } catch (error) {
      showError('Hide failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const toggleReady = async () => {
    const ready = !data?.ready
    setBusy(true)
    try {
      const res = await movieFileApi.setReady(movieId, ready)
      setData((d) => ({ ...d, ready: res.data.ready }))
      success(ready ? 'Marked as ready' : 'Ready mark removed')
    } catch (error) {
      showError('Update failed: ' + (error.response?.data?.error || error.message))
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

  const startQualityCheck = async (lang) => {
    setBusy(true)
    try {
      await subtitleQualityApi.createRun({ movie_id: movieId, lang })
      info('Quality check started')
      const res = await subtitleQualityApi.getRunsForMovie(movieId)
      setQualityRuns(res.data.runs || [])
    } catch (error) {
      showError('Quality check failed to start: ' + (error.response?.data?.error || error.message))
    } finally {
      setBusy(false)
    }
  }

  const cancelQualityRun = async (runId) => {
    try {
      await subtitleQualityApi.cancelRun(runId)
      const res = await subtitleQualityApi.getRunsForMovie(movieId)
      setQualityRuns(res.data.runs || [])
    } catch (error) {
      showError('Cancel failed: ' + (error.response?.data?.error || error.message))
    }
  }

  const dismissQualityRun = async (runId) => {
    try {
      await subtitleQualityApi.dismissRun(runId)
      const res = await subtitleQualityApi.getRunsForMovie(movieId)
      setQualityRuns(res.data.runs || [])
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
        {folder && (
          <a
            href={`https://drive.google.com/drive/folders/${folder.id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this movie's folder in Google Drive"
            className="inline-flex items-center gap-1 border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-50 text-sm"
          >
            Open in Drive
            <span aria-hidden="true">↗</span>
          </a>
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
        <div className="flex-1" />
        {data?.ready ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center rounded-md bg-green-100 text-green-800 px-2 py-1 font-medium">
              ✓ Ready
            </span>
            <span className="text-xs text-gray-500">
              {data.ready.by && `${data.ready.by} · `}
              {new Date(data.ready.at).toLocaleString()}
            </span>
            <button
              onClick={toggleReady}
              disabled={busy}
              className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Unmark
            </button>
          </div>
        ) : (
          <button
            onClick={toggleReady}
            disabled={busy}
            title="Mark the movie file, preview and subtitles as checked and ready"
            className="border border-green-600 text-green-700 px-3 py-1.5 rounded-md hover:bg-green-50 text-sm disabled:opacity-50"
          >
            Mark as ready
          </button>
        )}
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

      {/* Drive <-> Azure transfers */}
      {transfers.filter((j) => j.status !== 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">File transfers</h4>
          {transfers
            .filter((j) => j.status !== 'completed')
            .map((job) => {
              const total = job.bytes_total != null ? Number(job.bytes_total) : null
              const transferred = Number(job.bytes_transferred || 0)
              const pct = total ? Math.min(100, Math.round((transferred / total) * 100)) : null
              const active = ACTIVE_STATUSES.includes(job.status)
              return (
                <div key={job.id} className="border border-gray-200 rounded-md p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      {TRANSFER_LABELS[job.direction] || job.direction} · {KIND_SHORT[job.file_kind] || job.file_kind} ·{' '}
                      <span className="font-medium">{job.status}</span>
                    </span>
                    <div className="space-x-3 shrink-0">
                      {job.status === 'failed' && (
                        <button onClick={() => retryTransfer(job.id)} className="text-blue-600 hover:text-blue-800">
                          Retry
                        </button>
                      )}
                      {!active && (
                        <button
                          onClick={() => dismissTransfer(job.id)}
                          className="text-gray-500 hover:text-gray-700"
                          title="Hide this transfer"
                        >
                          Hide
                        </button>
                      )}
                    </div>
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
                        {formatBytes(transferred)}
                        {total != null && ` / ${formatBytes(total)}`}
                        {pct != null && ` (${pct}%)`}
                      </div>
                    </div>
                  )}
                  {job.status === 'pending' && (
                    <div className="text-xs text-gray-500 mt-1">Queued — the worker picks it up shortly</div>
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

      {/* Quality runs */}
      {qualityRuns.filter((j) => j.status !== 'completed').length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Quality checks</h4>
          {qualityRuns
            .filter((j) => j.status !== 'completed')
            .map((run) => {
              const active = ACTIVE_STATUSES.includes(run.status)
              const pct =
                run.suggest_total > 0
                  ? Math.min(100, Math.round((Number(run.suggest_done || 0) / Number(run.suggest_total)) * 100))
                  : null
              const timestamp = run.finished_at || run.created_at
              return (
                <div key={run.id} className="border border-gray-200 rounded-md p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      Quality check {QUALITY_LANG_LABELS[run.lang] || run.lang} ·{' '}
                      <span className="font-medium">{run.status}</span>
                      {active && run.phase && (
                        <span className="text-gray-500"> · {QUALITY_PHASE_LABELS[run.phase] || run.phase}</span>
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
                          onClick={() => cancelQualityRun(run.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Cancel
                        </button>
                      )}
                      {!active && (
                        <button
                          onClick={() => dismissQualityRun(run.id)}
                          className="text-gray-500 hover:text-gray-700"
                          title="Hide this run"
                        >
                          Hide
                        </button>
                      )}
                    </div>
                  </div>
                  {active && run.phase === 'suggesting' && pct != null && (
                    <div className="mt-2">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {run.suggest_done || 0}/{run.suggest_total} suggestions ({pct}%)
                      </div>
                    </div>
                  )}
                  {run.error_message && (
                    <div className="text-xs text-red-600 mt-1">{run.error_message}</div>
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
                      {' · '}
                      <StorageInfo
                        row={row}
                        busy={busy}
                        onAdoptDrive={() => adoptDrive(asset.key)}
                        onBackup={backupToDrive}
                      />
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
                      <button
                        onClick={() => startQualityCheck(qualityLangForKind(asset.key))}
                        disabled={busy || hasActiveQualityFor(qualityLangForKind(asset.key))}
                        title="Lint these subtitles and generate LLM fix suggestions"
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        Check quality
                      </button>
                    )}
                    {row && (qualitySummary.counts?.[qualityLangForKind(asset.key)]?.open || 0) > 0 && (
                      <Link
                        to={`/movies/${movieId}/subtitles`}
                        state={{ from: 'files', reviewLang: qualityLangForKind(asset.key) }}
                        title="Review flagged cues in the subtitle editor"
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          (qualitySummary.counts[qualityLangForKind(asset.key)].error || 0) > 0
                            ? 'bg-red-100 text-red-800 hover:bg-red-200'
                            : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                        }`}
                      >
                        ⚑ {qualitySummary.counts[qualityLangForKind(asset.key)].open} issue
                        {qualitySummary.counts[qualityLangForKind(asset.key)].open === 1 ? '' : 's'}
                      </Link>
                    )}
                    {row && asset.synced && (
                      <button
                        onClick={() => promoteSynced(asset.key)}
                        disabled={busy || hasActiveSyncFor(asset.key.replace('_synced', ''))}
                        title="Overwrite the original subtitles with this synced version"
                        className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        Use as original
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
                  <a
                    href={movieFileApi.downloadUrl(movieId, asset.key)}
                    title={row.storage === 'azure' ? 'Download the file' : 'Open the file in Google Drive'}
                    className="text-sm text-blue-600 hover:text-blue-800"
                    target={row.storage === 'azure' ? undefined : '_blank'}
                    rel="noopener noreferrer"
                  >
                    {row.storage === 'azure' ? 'Download' : 'Open'}
                  </a>
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
                    const res = await movieFileApi.importFile(movieId, {
                      drive_file_id: f.id,
                      file_kind: fileKind,
                      rename,
                      replace,
                    })
                    if (res.status === 202) {
                      info('Copying the file into Azure — it appears here when done')
                    } else {
                      success('File imported')
                    }
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
