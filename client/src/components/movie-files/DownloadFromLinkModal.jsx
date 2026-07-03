import { useState } from 'react'
import Modal from '../Modal'
import { movieDownloadApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'

const KIND_OPTIONS = [
  { value: 'movie', label: 'Movie file' },
  { value: 'subtitles_cs', label: 'Czech subtitles' },
  { value: 'subtitles_en', label: 'English subtitles' },
]

function detectType(url) {
  if (!url) return null
  if (/^ftp:\/\//i.test(url)) return 'FTP'
  if (/drive\.google\.com|docs\.google\.com/i.test(url)) return 'Google Drive'
  return null
}

/**
 * Create a server-side download job from a public Google Drive link or an
 * ftp:// URL. The server streams the file into the movie's Drive folder.
 */
function DownloadFromLinkModal({ isOpen, onClose, movieId, defaultFileKind = 'movie', onCreated }) {
  const { success, error: showError } = useToast()
  const [url, setUrl] = useState('')
  const [fileKind, setFileKind] = useState(defaultFileKind)
  const [submitting, setSubmitting] = useState(false)

  const detected = detectType(url)

  const close = () => {
    setUrl('')
    setSubmitting(false)
    onClose()
  }

  const submit = async () => {
    if (!url.trim()) return
    setSubmitting(true)
    try {
      await movieDownloadApi.create({ movie_id: movieId, file_kind: fileKind, source_url: url.trim() })
      success('Download job started')
      if (onCreated) await onCreated()
      close()
    } catch (error) {
      showError('Failed to start download: ' + (error.response?.data?.error || error.message))
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Download from link" size="medium">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Source URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/file/d/… or ftp://host/path"
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <div className="text-xs mt-1">
            {url && (detected
              ? <span className="text-green-600">Detected: {detected}</span>
              : <span className="text-red-600">Unrecognized — use a public Drive link or ftp:// URL</span>)}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Import as</label>
          <select
            value={fileKind}
            onChange={(e) => setFileKind(e.target.value)}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            onClick={close}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !detected}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            Start download
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default DownloadFromLinkModal
