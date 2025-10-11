import { useState, useCallback, useRef, useEffect } from 'react'
import Cropper from 'react-easy-crop'
import { useToast } from '../contexts/ToastContext'
import { editionApi } from '../utils/api'

const EditionPlaceholderUpload = ({ edition, onPhotoUpdate }) => {
  const { error: showError, success } = useToast()
  const [selectedFile, setSelectedFile] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [showCropper, setShowCropper] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(edition?.placeholder_photo || null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // Update preview when edition changes
  useEffect(() => {
    if (edition?.placeholder_photo) {
      // Use proxy URL
      setPreviewUrl(`/api/editions/${edition.id}/placeholder-photo`)
    } else {
      setPreviewUrl(null)
    }
  }, [edition])

  // Handle Escape key for cropper modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showCropper) {
        handleCropCancel()
      }
    }

    if (showCropper) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showCropper])

  const onCropComplete = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const createImage = (url) =>
    new Promise((resolve, reject) => {
      const image = new Image()
      image.addEventListener('load', () => resolve(image))
      image.addEventListener('error', (error) => reject(error))
      image.setAttribute('crossOrigin', 'anonymous')
      image.src = url
    })

  const getCroppedImg = async (imageSrc, pixelCrop) => {
    const image = await createImage(imageSrc)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    // Set canvas size to 500x500
    canvas.width = 500
    canvas.height = 500

    // Draw the cropped image scaled to 500x500
    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      500,
      500
    )

    // Convert to base64 for upload
    return canvas.toDataURL('image/jpeg', 0.9)
  }

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (!file) return

    // Supported file types
    const supportedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

    // Validate file type
    if (!supportedTypes.includes(file.type.toLowerCase())) {
      showError(`Unsupported file type: ${file.type || 'unknown'}. Please use JPEG, PNG, or WebP format.`)
      return
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      showError(`File size too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum size is 10MB.`)
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setSelectedFile(e.target.result)
      setShowCropper(true)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
    }
    reader.readAsDataURL(file)
  }

  const handleCropConfirm = async () => {
    if (!selectedFile || !croppedAreaPixels) return

    try {
      setSaving(true)

      // Get cropped image as base64
      const croppedImage = await getCroppedImg(selectedFile, croppedAreaPixels)

      // Update edition with placeholder photo (backend will handle S3 upload)
      await editionApi.update(edition.id, {
        ...edition,
        placeholder_photo: croppedImage
      })

      // Update local preview with proxy URL
      setPreviewUrl(`/api/editions/${edition.id}/placeholder-photo?t=${Date.now()}`)

      // Notify parent
      if (onPhotoUpdate) {
        onPhotoUpdate(croppedImage)
      }

      success('Placeholder photo updated!')
      setShowCropper(false)
      setSelectedFile(null)
    } catch (error) {
      console.error('Error saving placeholder photo:', error)
      showError('Failed to save placeholder photo. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleCropCancel = () => {
    setShowCropper(false)
    setSelectedFile(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemovePhoto = async () => {
    try {
      setSaving(true)

      // Update edition to remove placeholder photo
      await editionApi.update(edition.id, {
        ...edition,
        placeholder_photo: null
      })

      setPreviewUrl(null)

      // Notify parent
      if (onPhotoUpdate) {
        onPhotoUpdate(null)
      }

      success('Placeholder photo removed')
    } catch (error) {
      console.error('Error removing placeholder photo:', error)
      showError('Failed to remove placeholder photo')
    } finally {
      setSaving(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Placeholder Photo
      </label>
      <p className="text-xs text-gray-500 mb-2">
        This photo will be used for guests who don't have their own photo
      </p>

      {/* Photo Preview */}
      {previewUrl && !showCropper && (
        <div className="flex flex-col items-center space-y-2">
          <img
            src={previewUrl}
            alt="Placeholder preview"
            className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
          />
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 px-2 py-1 bg-blue-50 rounded"
            >
              Change
            </button>
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={saving}
              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-2 py-1 bg-red-50 rounded"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Upload Button */}
      {!previewUrl && !showCropper && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-gray-400 transition-colors w-24"
        >
          <div className="space-y-1">
            <div className="text-gray-400">
              <svg className="mx-auto h-8 w-8" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="text-xs text-gray-600">
              <span className="font-medium text-blue-600">Upload</span>
            </div>
            <p className="text-xs text-gray-500">
              JPEG, PNG, WebP
            </p>
          </div>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
        disabled={saving}
      />

      {/* Cropper Modal */}
      {showCropper && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="text-lg font-medium">Crop Placeholder Photo</h3>
              <p className="text-sm text-gray-600 mt-1">
                Adjust the photo to create a 500x500px placeholder image
              </p>
            </div>

            <div className="relative h-96 bg-gray-100">
              <Cropper
                image={selectedFile}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                cropShape="round"
                showGrid={false}
              />
            </div>

            <div className="p-4 border-t">
              <div className="flex items-center space-x-4 mb-4">
                <label className="text-sm text-gray-700 min-w-0">Zoom:</label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm text-gray-500 min-w-0">{Math.round(zoom * 100)}%</span>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={handleCropCancel}
                  disabled={saving}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCropConfirm}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EditionPlaceholderUpload
