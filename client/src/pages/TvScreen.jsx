import React, { useState, useEffect, useCallback, useRef } from 'react'
import { tvApi, movieApi } from '../utils/api'
import { useEdition } from '../contexts/EditionContext'
import { useToast } from '../contexts/ToastContext'
import { formatBytes } from '../utils/fileSize'
import TvSlideList from '../components/tv/TvSlideList'
import TvVideoUploadModal from '../components/tv/TvVideoUploadModal'

// The looping showcase on the TV in the venue (client/public/tv/). The player
// re-reads the slides and settings every minute.
const PROGRAMME_DAYS_OPTIONS = [
  {
    value: 'today',
    label: "Today's programme only",
    description: "Before the festival its first day; once today's programme is over, the next day.",
  },
  {
    value: 'upcoming',
    label: 'Today and the following days',
    description: 'The same day first, then every later festival day, each with its programme (and screening slides, if on).',
  },
]
// Photos travel as base64 JSON (server limit 50 MB) and are scaled down on the server
const MAX_PHOTO_BYTES = 35 * 1024 * 1024
const POLL_MS = 3000
// The Mi Box S keeps about 2 GB free for the player's offline cache
const CACHE_WARNING_BYTES = 1.5 * 1024 * 1024 * 1024

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const TvScreen = () => {
  const { selectedEdition } = useEdition()
  const { success, error: showError } = useToast()
  const [settings, setSettings] = useState(null)
  const [slides, setSlides] = useState([])
  const [config, setConfig] = useState({ storage_configured: true, transcode_configured: true })
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [photoProgress, setPhotoProgress] = useState(null) // { done, total }
  const [videoFile, setVideoFile] = useState(null)
  const photoInput = useRef(null)
  const videoInput = useRef(null)

  const fetchSlides = useCallback(async () => {
    const response = await tvApi.getSlides()
    setSlides(response.data.slides)
    setConfig({
      storage_configured: response.data.storage_configured,
      transcode_configured: response.data.transcode_configured,
    })
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [settingsResponse] = await Promise.all([tvApi.getSettings(), fetchSlides()])
        setSettings(settingsResponse.data)
      } catch (error) {
        console.error('Error loading the TV screen:', error)
        showError('Failed to load the TV screen')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [fetchSlides])

  useEffect(() => {
    if (!selectedEdition) return
    movieApi.getAll(selectedEdition.id)
      .then((response) => setMovies([...response.data].sort((a, b) => (a.name_cs || '').localeCompare(b.name_cs || '', 'cs'))))
      .catch(() => setMovies([]))
  }, [selectedEdition])

  // Follow the worker while videos are being prepared
  const processing = slides.some((slide) => slide.status === 'processing')
  useEffect(() => {
    if (!processing) return undefined
    const timer = setInterval(() => fetchSlides().catch(() => {}), POLL_MS)
    return () => clearInterval(timer)
  }, [processing, fetchSlides])

  const saveSettings = async (changes) => {
    if (savingSettings) return
    setSavingSettings(true)
    try {
      const response = await tvApi.updateSettings(changes)
      setSettings(response.data)
      success('Saved — the screen picks it up within a minute')
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to save TV settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleProgrammeDaysChange = (value) => {
    if (value === settings?.programme_days) return
    saveSettings({ programme_days: value })
  }

  const handleReloadScreens = async () => {
    if (!window.confirm('Reload every TV screen? They load the player again from scratch (new styles included) within a minute; cached photos and videos stay.')) return
    try {
      const response = await tvApi.reloadScreens()
      setSettings(response.data)
      success('Screens will reload within a minute')
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to reload the screens')
    }
  }

  const handlePhotosChosen = async (fileList) => {
    const files = Array.from(fileList || [])
    if (photoInput.current) photoInput.current.value = ''
    if (!files.length) return
    setPhotoProgress({ done: 0, total: files.length })
    let failed = 0
    for (const file of files) {
      try {
        if (file.size > MAX_PHOTO_BYTES) throw new Error(`larger than ${formatBytes(MAX_PHOTO_BYTES)}`)
        await tvApi.uploadPhoto({ file_name: file.name, content_base64: await readAsBase64(file) })
      } catch (error) {
        failed++
        showError(`${file.name}: ${error.response?.data?.error || error.message}`)
      }
      setPhotoProgress((p) => ({ ...p, done: p.done + 1 }))
    }
    setPhotoProgress(null)
    await fetchSlides().catch(() => {})
    if (failed < files.length) success(`${files.length - failed} photo${files.length - failed === 1 ? '' : 's'} added`)
  }

  const handleVideoChosen = (fileList) => {
    const file = fileList?.[0]
    if (videoInput.current) videoInput.current.value = ''
    if (file) setVideoFile(file)
  }

  const handleUpdate = async (slide, patch) => {
    setSlides((list) => list.map((s) => (s.id === slide.id ? { ...s, ...patch } : s)))
    try {
      const response = await tvApi.updateSlide(slide.id, patch)
      setSlides((list) => list.map((s) => (s.id === slide.id ? response.data : s)))
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to update the slide')
      fetchSlides().catch(() => {})
    }
  }

  const handleReorder = async (ordered) => {
    setSlides(ordered)
    try {
      const response = await tvApi.reorderSlides(ordered.map((s) => s.id))
      setSlides(response.data.slides)
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to save the order')
      fetchSlides().catch(() => {})
    }
  }

  const handleDelete = async (slide) => {
    const name = slide.title || slide.file_name || (slide.kind === 'photo' ? 'this photo' : 'this video')
    if (!window.confirm(`Delete "${name}"? Use Hide to just skip it for a while.`)) return
    try {
      await tvApi.deleteSlide(slide.id)
      setSlides((list) => list.filter((s) => s.id !== slide.id))
      success('Deleted')
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to delete the slide')
    }
  }

  const handleRetry = async (slide) => {
    try {
      const response = await tvApi.retryVideo(slide.id)
      setSlides((list) => list.map((s) => (s.id === slide.id ? response.data : s)))
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to retry')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const playerUrl = `${window.location.origin}/tv/`
  // Hidden ones count too: screens keep them cached so they can come back without a download
  const cachedMedia = slides.filter((s) => s.kind !== 'programme' && s.status === 'ready')
  const cachedBytes = cachedMedia.reduce((sum, s) => sum + (s.size || 0), 0)
  const programmeLabel = PROGRAMME_DAYS_OPTIONS.find((o) => o.value === settings?.programme_days)?.label || ''

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">TV Screen</h1>
          <p className="text-sm text-gray-600 mt-1">
            The loop on the TV in the venue:{' '}
            <a href={playerUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {playerUrl}
            </a>
            . It always shows the running or next edition.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleReloadScreens}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
            title="Make every screen load the player again, e.g. after a design change"
          >
            🔄 Reload screens
          </button>
          <a
            href={playerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors duration-200"
          >
            Open player
          </a>
        </div>
      </div>

      {!config.storage_configured && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-md">
          Movie storage (Azure Blob) is not configured on this server, so photos and videos cannot be uploaded.
        </div>
      )}

      {/* Slides */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Slides</h2>
            <p className="text-sm text-gray-600">
              Played top to bottom, then again. Drag ⋮⋮ to reorder; hidden slides are skipped.
            </p>
          </div>
          <div className="flex gap-2">
            <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotosChosen(e.target.files)} />
            <input ref={videoInput} type="file" accept="video/*" className="hidden" onChange={(e) => handleVideoChosen(e.target.files)} />
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              disabled={!config.storage_configured || !!photoProgress}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 font-medium"
            >
              {photoProgress ? `Uploading ${photoProgress.done}/${photoProgress.total}…` : '🖼️ Add photos'}
            </button>
            <button
              type="button"
              onClick={() => videoInput.current?.click()}
              disabled={!config.storage_configured}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              🎬 Add video
            </button>
          </div>
        </div>

        <TvSlideList
          slides={slides}
          movies={movies}
          programmeLabel={programmeLabel}
          onReorder={handleReorder}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onRetry={handleRetry}
        />

        <p className={`text-xs mt-4 ${cachedBytes > CACHE_WARNING_BYTES ? 'text-red-700' : 'text-gray-500'}`}>
          Photos and videos: {cachedMedia.length} · {formatBytes(cachedBytes)}. Screens keep them all offline,
          hidden ones included (delete what is no longer needed); the Mi Box has room for about 1.5 GB.
          {!config.transcode_configured && ' Video transcoding is not configured here: upload ready-made MP4 (H.264, 1080p).'}
        </p>
      </div>

      {/* Programme */}
      {settings && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Programme slides</h2>
          <fieldset className="space-y-3" disabled={savingSettings}>
            {PROGRAMME_DAYS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-start p-4 border rounded-md cursor-pointer ${
                  settings.programme_days === option.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="programme_days"
                  value={option.value}
                  checked={settings.programme_days === option.value}
                  onChange={() => handleProgrammeDaysChange(option.value)}
                  className="mt-1 h-4 w-4 text-blue-600"
                />
                <span className="ml-3">
                  <span className="block font-medium text-gray-900">{option.label}</span>
                  <span className="block text-sm text-gray-600 mt-1">{option.description}</span>
                </span>
              </label>
            ))}
            <label className="flex items-start p-4 border border-gray-200 rounded-md cursor-pointer hover:border-gray-300">
              <input
                type="checkbox"
                checked={settings.screening_slides !== false}
                onChange={(e) => saveSettings({ screening_slides: e.target.checked })}
                className="mt-1 h-4 w-4 text-blue-600 rounded"
              />
              <span className="ml-3">
                <span className="block font-medium text-gray-900">A slide for every screening</span>
                <span className="block text-sm text-gray-600 mt-1">
                  After the day's programme, each screening full screen with its photo. Turn off to show the
                  programme alone, e.g. when the films are announced by photo slides.
                </span>
              </span>
            </label>
          </fieldset>
          {settings.updated_by && (
            <p className="text-xs text-gray-500 mt-4">
              Last changed by {settings.updated_by} on {new Date(settings.updated_at).toLocaleString()}
            </p>
          )}
        </div>
      )}

      <TvVideoUploadModal
        file={videoFile}
        movies={movies}
        onClose={() => setVideoFile(null)}
        onUploaded={fetchSlides}
      />
    </div>
  )
}

export default TvScreen
