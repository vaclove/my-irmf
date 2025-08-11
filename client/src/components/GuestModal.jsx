import React, { useState, useCallback } from 'react'
import { guestApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import Modal from './Modal'
import PhotoUpload from './PhotoUpload'
import GuestRelationships from './GuestRelationships'
import MovieDelegations from './MovieDelegations'

function GuestModal({ 
  isOpen, 
  onClose, 
  guest, 
  onUpdate, 
  onDelete 
}) {
  const { success, error } = useToast()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const [generatingGreeting, setGeneratingGreeting] = useState(false)
  const [formData, setFormData] = useState(() => ({
    first_name: guest?.first_name || '', 
    last_name: guest?.last_name || '',
    email: guest?.email || '', 
    phone: guest?.phone || '', 
    language: guest?.language || 'english', 
    company: guest?.company || '', 
    notes: guest?.notes || '',
    greeting: guest?.greeting || '',
    greeting_auto_generated: guest?.greeting_auto_generated ?? true,
    photo: guest?.photo || null
  }))

  // Update form data when guest prop changes
  React.useEffect(() => {
    if (guest) {
      setFormData({
        first_name: guest.first_name || '', 
        last_name: guest.last_name || '',
        email: guest.email || '', 
        phone: guest.phone || '', 
        language: guest.language || 'english', 
        company: guest.company || '', 
        notes: guest.notes || '',
        greeting: guest.greeting || '',
        greeting_auto_generated: guest.greeting_auto_generated ?? true,
        photo: guest.photo || null
      })
    } else {
      // Reset form for new guest
      setFormData({
        first_name: '', 
        last_name: '',
        email: '', 
        phone: '', 
        language: 'english', 
        company: '', 
        notes: '',
        greeting: '',
        greeting_auto_generated: true,
        photo: null
      })
    }
    setActiveTab('details')
  }, [guest])

  const generateGreeting = useCallback(async (firstName, lastName, language) => {
    try {
      setGeneratingGreeting(true)
      const response = await guestApi.generateGreeting({ firstName, lastName, language })
      if (response.data.primary) {
        setFormData(prev => ({ 
          ...prev, 
          greeting: response.data.primary.greeting,
          greeting_auto_generated: true
        }))
      }
    } catch (err) {
      error('Failed to generate greeting: ' + err.message)
    } finally {
      setGeneratingGreeting(false)
    }
  }, [error])

  // Debounced greeting generation trigger
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (formData.first_name && formData.last_name && formData.greeting_auto_generated) {
        generateGreeting(formData.first_name, formData.last_name, formData.language)
      }
    }, 300) // 300ms debounce

    return () => clearTimeout(timeoutId)
  }, [formData.first_name, formData.last_name, formData.language, formData.greeting_auto_generated, generateGreeting])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return

    try {
      setLoading(true)
      let result
      
      if (guest) {
        result = await guestApi.update(guest.id, formData)
        success('Guest updated successfully!')
      } else {
        result = await guestApi.create(formData)
        success('Guest created successfully!')
      }
      
      if (onUpdate) {
        onUpdate(result.data)
      }
      
      if (!guest) {
        // Reset form for new guest
        handleClose()
      }
    } catch (err) {
      error(guest ? 'Failed to update guest' : 'Failed to create guest')
      console.error('Error saving guest:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!guest || !confirm(`Are you sure you want to delete ${guest.first_name} ${guest.last_name}?`)) {
      return
    }

    try {
      setLoading(true)
      await guestApi.delete(guest.id)
      success('Guest deleted successfully!')
      if (onDelete) {
        onDelete(guest.id)
      }
      handleClose()
    } catch (err) {
      error('Failed to delete guest')
      console.error('Error deleting guest:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setActiveTab('details')
    onClose()
  }

  const modalTitle = guest ? `${guest.first_name} ${guest.last_name}` : 'Add New Guest'

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={modalTitle}
      size="large"
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'details'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Details
            </button>
            {guest && (
              <>
                <button
                  onClick={() => setActiveTab('relationships')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'relationships'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Relationships
                </button>
                <button
                  onClick={() => setActiveTab('movies')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'movies'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Movies
                </button>
              </>
            )}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'details' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-6">
              {/* Left Column - Photo */}
              <div className="flex-shrink-0">
                <PhotoUpload
                  currentPhoto={formData.photo}
                  image_urls={guest?.image_urls}
                  onPhotoChange={(photo) => setFormData({ ...formData, photo })}
                  guestId={guest?.id}
                  guestData={guest}
                />
              </div>
              
              {/* Right Column - Form Fields */}
              <div className="flex-1 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input
                      type="text"
                      required
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input
                      type="text"
                      required
                      value={formData.last_name}
                      onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                    <select
                      value={formData.language}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="english">English</option>
                      <option value="czech">Czech</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                    <input
                      type="text"
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder="Optional"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Greeting
                    {generatingGreeting && (
                      <span className="ml-2 text-xs text-blue-600">Generating...</span>
                    )}
                    {formData.greeting_auto_generated && (
                      <span className="ml-2 text-xs text-green-600">Auto-generated</span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.greeting}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        greeting: e.target.value,
                        greeting_auto_generated: false 
                      })}
                      className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder="e.g., Dear Mr. Smith"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (formData.first_name && formData.last_name) {
                          setFormData(prev => ({ ...prev, greeting_auto_generated: true }))
                          generateGreeting(formData.first_name, formData.last_name, formData.language)
                        }
                      }}
                      disabled={!formData.first_name || !formData.last_name || generatingGreeting}
                      className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 flex-shrink-0"
                      title="Regenerate greeting"
                    >
                      ↻
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows="2"
                    className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    placeholder="Optional notes about the guest..."
                  />
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-4 border-t">
              <div className="flex space-x-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                >
                  {loading ? 'Saving...' : (guest ? 'Update Guest' : 'Create Guest')}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
              {guest && onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm font-medium disabled:opacity-50"
                >
                  Delete Guest
                </button>
              )}
            </div>
          </form>
        )}

        {activeTab === 'relationships' && guest && (
          <GuestRelationships 
            selectedGuest={guest}
            onUpdate={() => {
              if (onUpdate) onUpdate(guest)
            }}
          />
        )}

        {activeTab === 'movies' && guest && (
          <MovieDelegations 
            selectedGuest={guest}
            onUpdate={() => {
              if (onUpdate) onUpdate(guest)
            }}
          />
        )}
      </div>
    </Modal>
  )
}

export default GuestModal