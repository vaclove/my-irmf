import { useState, useRef, useEffect } from 'react'
import Modal from '../Modal'
import { tvApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'
import { formatBytes } from '../../utils/fileSize'

/**
 * Upload a video for the TV player: straight from the browser to Azure Blob
 * Storage (a SAS URL for one blob, like movie masters), then the worker
 * transcodes it to 1080p H.264 for the TV box.
 */
function TvVideoUploadModal({ file, movies, onClose, onUploaded }) {
  const { success, error: showError } = useToast()
  const [title, setTitle] = useState('')
  const [movieId, setMovieId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const abortRef = useRef(null)

  useEffect(() => {
    setTitle(file ? file.name.replace(/\.[^.]+$/, '') : '')
    setMovieId('')
    setProgress(0)
  }, [file])

  // Warn before leaving the tab while an upload is in flight.
  useEffect(() => {
    if (!uploading) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [uploading])

  const close = () => {
    if (uploading) abortRef.current?.abort()
    onClose()
  }

  const start = async () => {
    setUploading(true)
    setProgress(0)
    let slideId = null
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const created = await tvApi.createVideo({
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        title: title.trim(),
        movie_id: movieId || null,
      })
      slideId = created.data.slide.id
      // Loaded on demand: the SDK is only needed while uploading.
      const { BlockBlobClient } = await import('@azure/storage-blob')
      await new BlockBlobClient(created.data.upload_url).uploadData(file, {
        blockSize: 8 * 1024 * 1024,
        concurrency: 4,
        tier: created.data.tier,
        blobHTTPHeaders: { blobContentType: created.data.content_type },
        abortSignal: abort.signal,
        onProgress: ({ loadedBytes }) => setProgress(Math.round((loadedBytes / file.size) * 100)),
      })
      await tvApi.completeVideo(slideId)
      slideId = null // uploaded: from here on a failure must not delete it
      success('Video uploaded — it is being prepared for the TV')
      onClose()
      await onUploaded().catch(() => {})
    } catch (error) {
      if (slideId) await tvApi.deleteSlide(slideId).catch(() => {})
      if (abort.signal.aborted) {
        showError('Upload cancelled')
      } else {
        console.error('Video upload failed:', error)
        showError('Upload failed: ' + (error.response?.data?.error || error.message))
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal isOpen={!!file} onClose={close} title="Upload video" size="medium">
      {file && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {file.name} · {formatBytes(file.size)}
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Partner — Plzeňský Prazdroj"
            />
            <p className="text-xs text-gray-500 mt-1">Only for this list; the screen does not show it.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trailer of (optional)</label>
            <select
              value={movieId}
              onChange={(e) => setMovieId(e.target.value)}
              disabled={uploading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Not a trailer —</option>
              {movies.map((movie) => (
                <option key={movie.id} value={movie.id}>{movie.name_cs || movie.name_en}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">The screen shows the film's next screening over its trailer.</p>
          </div>

          {uploading && (
            <div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">Uploading… {progress}%</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={start}
              disabled={uploading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default TvVideoUploadModal
