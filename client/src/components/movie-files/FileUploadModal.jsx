import { useState, useRef, useEffect } from 'react'
import Modal from '../Modal'
import { movieFileApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'
import { uploadToDriveSession } from '../../utils/driveUpload'
import { formatBytes } from '../../utils/fileSize'

const KIND_LABELS = {
  movie: 'movie file',
  subtitles_cs: 'Czech subtitles',
  subtitles_en: 'English subtitles',
}

/**
 * Chunked, resumable upload of a large file straight from the browser to
 * Google Drive. The backend only mints a resumable session; the bytes never
 * pass through our server.
 */
function FileUploadModal({ isOpen, onClose, movieId, fileKind = 'movie', onUploaded }) {
  const { success, error: showError } = useToast()
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const cancelRef = useRef(false)

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

  const reset = () => {
    setFile(null)
    setUploading(false)
    setProgress(0)
    cancelRef.current = false
  }

  const close = () => {
    if (uploading) {
      cancelRef.current = true
    }
    reset()
    onClose()
  }

  const start = async () => {
    if (!file) return
    setUploading(true)
    setProgress(0)
    cancelRef.current = false
    try {
      const sessionRes = await movieFileApi.createUploadSession(movieId, {
        file_kind: fileKind,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
      })
      const { upload_url } = sessionRes.data

      const driveFileId = await uploadToDriveSession(file, upload_url, {
        onProgress: ({ loaded, total }) => setProgress(Math.round((loaded / total) * 100)),
        shouldCancel: () => cancelRef.current,
      })

      if (!driveFileId) throw new Error('Upload did not complete')

      await movieFileApi.completeUpload(movieId, {
        file_kind: fileKind,
        drive_file_id: driveFileId,
      })

      success('Upload complete')
      if (onUploaded) await onUploaded()
      reset()
      onClose()
    } catch (error) {
      if (error.cancelled) {
        showError('Upload cancelled')
      } else {
        console.error('Upload failed:', error)
        showError('Upload failed: ' + (error.response?.data?.error || error.message))
      }
      setUploading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={`Upload ${KIND_LABELS[fileKind] || 'file'}`}
      size="medium"
    >
      <div className="space-y-4">
        {!uploading && (
          <input
            type="file"
            onChange={(e) => setFile(e.target.files[0] || null)}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        )}

        {file && (
          <div className="text-sm text-gray-600">
            {file.name} · {formatBytes(file.size)}
          </div>
        )}

        {uploading && (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {progress}% — keep this tab open until the upload finishes
            </div>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-2">
          <button
            onClick={close}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
          >
            {uploading ? 'Cancel' : 'Close'}
          </button>
          {!uploading && (
            <button
              onClick={start}
              disabled={!file}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
            >
              Start upload
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default FileUploadModal
