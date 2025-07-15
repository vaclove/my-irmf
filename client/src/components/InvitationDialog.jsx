import { useState, useEffect } from 'react'
import { invitationApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'

function InvitationDialog({ isOpen, onClose, guest, edition, onInvitationSent }) {
  const { success, error: showError } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    language: 'english',
    accommodation: false,
    covered_nights: 0
  })

  // Update form data when guest changes
  useEffect(() => {
    if (guest) {
      setFormData(prev => ({
        ...prev,
        language: guest.language || 'english'
      }))
    }
  }, [guest])

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (formData.accommodation && formData.covered_nights <= 0) {
      showError('Please specify number of covered nights when accommodation is included')
      return
    }

    try {
      setLoading(true)
      
      const invitationData = {
        guest_id: guest.id,
        edition_id: edition.id,
        language: formData.language,
        accommodation: formData.accommodation,
        covered_nights: formData.accommodation ? formData.covered_nights : 0
      }

      await invitationApi.send(invitationData)
      
      if (onInvitationSent) {
        onInvitationSent()
      }
      
      onClose()
      success(`Invitation sent to ${guest.first_name} ${guest.last_name}!`)
    } catch (error) {
      console.error('Error sending invitation:', error)
      showError('Failed to send invitation: ' + (error.response?.data?.error || error.message))
    } finally {
      setLoading(false)
    }
  }

  const handleAccommodationChange = (checked) => {
    setFormData({
      ...formData,
      accommodation: checked,
      covered_nights: checked ? formData.covered_nights : 0
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-900">Send Invitation</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="mb-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium text-gray-900 mb-2">Invitation Details</h3>
            <p className="text-sm text-gray-600">
              <strong>Guest:</strong> {guest?.first_name} {guest?.last_name} ({guest?.email})
            </p>
            <p className="text-sm text-gray-600">
              <strong>Edition:</strong> {edition?.name} ({edition?.year})
            </p>
            <p className="text-sm text-gray-600">
              <strong>Category:</strong> {guest?.category}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Language Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Language
              </label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="english">English</option>
                <option value="czech">Czech</option>
              </select>
            </div>

            {/* Accommodation Section */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="accommodation"
                  checked={formData.accommodation}
                  onChange={(e) => handleAccommodationChange(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="accommodation" className="ml-2 text-sm font-medium text-gray-700">
                  🏨 Include accommodation provided by festival
                </label>
              </div>

              {formData.accommodation && (
                <div className="ml-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Number of covered nights
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.covered_nights}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      covered_nights: parseInt(e.target.value) || 0 
                    })}
                    className="w-24 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0"
                    required={formData.accommodation}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter 0 if no accommodation nights are covered
                  </p>
                </div>
              )}
              
              <div className="mt-3 p-3 bg-blue-50 rounded-md">
                <p className="text-xs text-blue-800">
                  <strong>Note:</strong> If accommodation is not provided or 0 nights are covered, 
                  no accommodation information will be included in the invitation email.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default InvitationDialog