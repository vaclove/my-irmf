import { useState, useCallback, useRef } from 'react'
import Cropper from 'react-easy-crop'
import { useToast } from '../contexts/ToastContext'
import { guestApi } from '../utils/api'

const PhotoUpload = ({ currentPhoto, onPhotoChange, disabled = false, guestId = null, guestData = null }) => {
  const { error: showError, success } = useToast()
  const [selectedFile, setSelectedFile] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [showCropper, setShowCropper] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(currentPhoto || null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

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

    // Convert to JPEG with 90% quality
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        0.9
      )
    })
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
      const croppedImage = await getCroppedImg(selectedFile, croppedAreaPixels)
      setPreviewUrl(croppedImage)
      onPhotoChange(croppedImage)
      
      // Auto-save photo if editing an existing guest
      if (guestId && guestData) {
        try {
          await guestApi.update(guestId, {
            ...guestData,
            photo: croppedImage
          })
          success(`Photo updated for ${guestData.first_name} ${guestData.last_name}!`)
        } catch (saveError) {
          console.error('Error saving photo:', saveError)
          showError('Photo cropped but failed to save. Please save manually.')
        }
      }
      
      setShowCropper(false)
      setSelectedFile(null)
    } catch (error) {
      console.error('Error cropping image:', error)
      showError('Error processing image. Please try again with a different photo.')
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

  const handleRemovePhoto = () => {
    setPreviewUrl(null)
    onPhotoChange(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">
        Profile Photo
      </label>
      
      {/* Photo Preview */}
      {previewUrl && !showCropper && (
        <div className="flex items-center space-x-4">
          <img
            src={previewUrl}
            alt="Profile preview"
            className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
          />
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
            >
              Change Photo
            </button>
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={disabled}
              className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
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
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-gray-400 transition-colors"
        >
          <div className="space-y-2">
            <div className="text-gray-400">
              <svg className="mx-auto h-12 w-12" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
            </div>
            <p className="text-xs text-gray-500">
              JPEG, PNG, WebP up to 10MB
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
        disabled={disabled}
      />

      {/* Cropper Modal */}
      {showCropper && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="text-lg font-medium">Crop Profile Photo</h3>
              <p className="text-sm text-gray-600 mt-1">
                Adjust the photo to create a 500x500px profile image
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
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCropConfirm}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PhotoUpload