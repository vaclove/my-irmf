import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { guestApi, tagApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import TagCard from '../components/TagCard'
import PhotoUpload from '../components/PhotoUpload'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'

function Guests() {
  const { success, error: showError } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingGuest, setEditingGuest] = useState(null)
  const [allTags, setAllTags] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [editingGuestTags, setEditingGuestTags] = useState(null)
  const [newTagName, setNewTagName] = useState('')
  const [visibleColumns, setVisibleColumns] = useState({
    name: true,
    email: true,
    phone: false, // Hidden by default
    company: true,
    notes: true,
    tags: true
  })
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [formData, setFormData] = useState({ 
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
  const [generatingGreeting, setGeneratingGreeting] = useState(false)

  useEffect(() => {
    fetchGuests()
    fetchTags()
  }, [])


  // Handle edit query parameter
  useEffect(() => {
    const editGuestId = searchParams.get('edit')
    if (editGuestId && guests.length > 0) {
      const guestToEdit = guests.find(g => g.id === editGuestId)
      if (guestToEdit) {
        handleEdit(guestToEdit)
        // Clear the query parameter
        setSearchParams({})
      }
    }
  }, [searchParams, guests])

  const fetchGuests = async () => {
    try {
      const response = await guestApi.getAll()
      setGuests(response.data)
    } catch (error) {
      console.error('Error fetching guests:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTags = async () => {
    try {
      const response = await tagApi.getAll()
      setAllTags(response.data)
    } catch (error) {
      console.error('Error fetching tags:', error)
    }
  }

  // Debounced greeting generation
  const generateGreeting = useCallback(async (firstName, lastName, language) => {
    if (!firstName || !lastName) return
    
    setGeneratingGreeting(true)
    try {
      const response = await guestApi.generateGreeting({ firstName, lastName, language })
      if (response.data.primary) {
        setFormData(prev => {
          // Only update if still set to auto-generate
          if (prev.greeting_auto_generated) {
            return {
              ...prev,
              greeting: response.data.primary.greeting,
              greeting_auto_generated: true
            }
          }
          return prev
        })
      }
    } catch (error) {
      console.error('Error generating greeting:', error)
    } finally {
      setGeneratingGreeting(false)
    }
  }, [])

  // Debounced greeting generation trigger
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (formData.first_name && formData.last_name && formData.greeting_auto_generated) {
        generateGreeting(formData.first_name, formData.last_name, formData.language)
      }
    }, 300) // 300ms debounce

    return () => clearTimeout(timeoutId)
  }, [formData.first_name, formData.last_name, formData.language, formData.greeting_auto_generated, generateGreeting])

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingGuest) {
        await guestApi.update(editingGuest.id, formData)
        success(`Guest ${formData.first_name} ${formData.last_name} updated successfully!`)
      } else {
        await guestApi.create(formData)
        success(`Guest ${formData.first_name} ${formData.last_name} created successfully!`)
      }
      await fetchGuests()
      resetForm()
    } catch (error) {
      console.error('Error saving guest:', error)
      showError('Failed to save guest: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleEdit = (guest) => {
    setEditingGuest(guest)
    
    // Determine if we should auto-generate greeting
    const hasExistingGreeting = guest.greeting && guest.greeting.trim() !== ''
    const shouldAutoGenerate = !hasExistingGreeting || guest.greeting_auto_generated !== false
    
    setFormData({ 
      first_name: guest.first_name || '', 
      last_name: guest.last_name || '',
      email: guest.email, 
      phone: guest.phone || '',
      language: guest.language || 'english',
      company: guest.company || '',
      notes: guest.notes || '',
      greeting: guest.greeting || '',
      greeting_auto_generated: shouldAutoGenerate,
      photo: guest.photo || null
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    const guest = guests.find(g => g.id === id)
    if (window.confirm(`Are you sure you want to delete ${guest?.first_name} ${guest?.last_name}?`)) {
      try {
        await guestApi.delete(id)
        success(`Guest ${guest?.first_name} ${guest?.last_name} deleted successfully!`)
        await fetchGuests()
      } catch (error) {
        console.error('Error deleting guest:', error)
        showError('Failed to delete guest: ' + (error.response?.data?.error || error.message))
      }
    }
  }

  const handleAddTag = async (guestId, tagId) => {
    try {
      const guest = guests.find(g => g.id === guestId)
      const tag = allTags.find(t => t.id === tagId)
      await tagApi.assignToGuest(guestId, tagId)
      success(`Tag "${tag?.name}" added to ${guest?.first_name} ${guest?.last_name}`)
      await fetchGuests()
    } catch (error) {
      console.error('Error adding tag:', error)
      showError('Failed to add tag: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleRemoveTag = async (guestId, tagId) => {
    try {
      const guest = guests.find(g => g.id === guestId)
      const tag = allTags.find(t => t.id === tagId)
      await tagApi.removeFromGuest(guestId, tagId)
      success(`Tag "${tag?.name}" removed from ${guest?.first_name} ${guest?.last_name}`)
      await fetchGuests()
    } catch (error) {
      console.error('Error removing tag:', error)
      showError('Failed to remove tag: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    
    try {
      await tagApi.create({ name: newTagName.trim() })
      success(`Tag "${newTagName.trim()}" created successfully!`)
      await fetchTags()
      setNewTagName('')
    } catch (error) {
      console.error('Error creating tag:', error)
      showError('Failed to create tag: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleTagDeleted = async (deletedTagId) => {
    // Remove from selected tags if it was selected
    setSelectedTags(prev => prev.filter(id => id !== deletedTagId))
    // Refresh the tags list
    await fetchTags()
    // Refresh guests to update tag counts
    await fetchGuests()
  }

  const toggleColumnVisibility = (column) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }))
  }

  const getFilteredGuests = () => {
    if (selectedTags.length === 0) {
      return guests
    }
    
    return guests.filter(guest => {
      // Check if guest has ALL selected tags
      return selectedTags.every(selectedTagId => 
        guest.tags.some(guestTag => guestTag.id === selectedTagId)
      )
    })
  }

  const resetForm = () => {
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
    setEditingGuest(null)
    setShowForm(false)
  }

  if (loading) {
    return <div className="text-center py-8">Loading guests...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Guests</h1>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowTagFilter(!showTagFilter)}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
          >
            {showTagFilter ? 'Hide Filters' : 'Filter by Tags'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 002 2m0 0v10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2z" />
              </svg>
              <span>Columns</span>
            </button>
            {showColumnSettings && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                <div className="p-3">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Show Columns</h4>
                  <div className="space-y-2">
                    {[
                      { key: 'name', label: 'Name', disabled: true },
                      { key: 'email', label: 'Email' },
                      { key: 'phone', label: 'Phone' },
                      { key: 'company', label: 'Company' },
                      { key: 'notes', label: 'Notes' },
                      { key: 'tags', label: 'Tags' }
                    ].map(column => (
                      <label key={column.key} className={`flex items-center space-x-2 ${column.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={visibleColumns[column.key]}
                          onChange={() => !column.disabled && toggleColumnVisibility(column.key)}
                          disabled={column.disabled}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{column.label}</span>
                        {column.disabled && <span className="text-xs text-gray-400">(required)</span>}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setEditingGuest(null)
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
              setShowForm(true)
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Add Guest
          </button>
        </div>
      </div>

      {/* Tag Filter Panel */}
      {showTagFilter && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium">Filter by Tags</h3>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="New tag name"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
              <button
                onClick={handleCreateTag}
                className="bg-green-600 text-white px-3 py-2 rounded-md hover:bg-green-700 text-sm"
              >
                Create Tag
              </button>
            </div>
          </div>
          
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              Selected tags: {selectedTags.length} | Showing {getFilteredGuests().length} of {guests.length} guests
            </p>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <TagCard
                  key={tag.id}
                  tag={tag}
                  isSelected={selectedTags.includes(tag.id)}
                  onToggleSelect={() => {
                    setSelectedTags(prev => 
                      prev.includes(tag.id) 
                        ? prev.filter(id => id !== tag.id)
                        : [...prev, tag.id]
                    )
                  }}
                  onDeleteSuccess={handleTagDeleted}
                />
              ))}
            </div>
          </div>
          
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      <Modal
        isOpen={showForm}
        onClose={resetForm}
        title={editingGuest ? 'Edit Guest' : 'Add New Guest'}
        size="large"
      >
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-6">
            {/* Left Column - Photo */}
            <div className="flex-shrink-0">
              <PhotoUpload
                currentPhoto={formData.photo}
                onPhotoChange={(photo) => setFormData({ ...formData, photo })}
                guestId={editingGuest?.id}
                guestData={editingGuest}
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
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                {editingGuest ? 'Update Guest' : 'Create Guest'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
            {editingGuest && (
              <button
                type="button"
                onClick={() => handleDelete(editingGuest.id)}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm font-medium"
              >
                Delete Guest
              </button>
            )}
          </div>
        </form>
      </Modal>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium">
            {selectedTags.length > 0 ? `Filtered Guests (${getFilteredGuests().length}/${guests.length})` : `All Guests (${guests.length})`}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                {visibleColumns.email && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                )}
                {visibleColumns.phone && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                )}
                {visibleColumns.company && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                )}
                {visibleColumns.notes && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                )}
                {visibleColumns.tags && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tags</th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {getFilteredGuests().map((guest) => (
                <tr key={guest.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                    <button
                      onClick={() => handleEdit(guest)}
                      className="flex items-center space-x-2 text-left hover:text-blue-600 transition-colors"
                      title="Click to edit guest"
                    >
                      <Avatar
                        photo={guest.photo}
                        firstName={guest.first_name}
                        lastName={guest.last_name}
                        size="xs"
                      />
                      <span className="text-sm">{guest.first_name} {guest.last_name}</span>
                    </button>
                  </td>
                  {visibleColumns.email && (
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                      {guest.email}
                    </td>
                  )}
                  {visibleColumns.phone && (
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                      {guest.phone || '-'}
                    </td>
                  )}
                  {visibleColumns.company && (
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                      {guest.company || '-'}
                    </td>
                  )}
                  {visibleColumns.notes && (
                    <td className="px-3 py-2 text-sm text-gray-500 max-w-xs">
                      <div className="truncate" title={guest.notes}>
                        {guest.notes || '-'}
                      </div>
                    </td>
                  )}
                  {visibleColumns.tags && (
                    <td className="px-3 py-2 text-sm text-gray-500">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {guest.tags && guest.tags.length > 0 ? (
                          guest.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium text-white cursor-pointer group"
                              style={{ backgroundColor: tag.color }}
                              title={`Remove ${tag.name} tag`}
                              onClick={() => handleRemoveTag(guest.id, tag.id)}
                            >
                              {tag.name}
                              <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">×</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                        <button
                          onClick={() => setEditingGuestTags(editingGuestTags === guest.id ? null : guest.id)}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                          title="Add tag"
                        >
                          +
                        </button>
                      </div>
                      {editingGuestTags === guest.id && (
                        <div className="mt-1 p-2 bg-gray-50 rounded-md">
                          <p className="text-xs text-gray-600 mb-1">Add tags:</p>
                          <div className="flex flex-wrap gap-1">
                            {allTags
                              .filter(tag => !guest.tags.some(guestTag => guestTag.id === tag.id))
                              .map((tag) => (
                                <button
                                  key={tag.id}
                                  onClick={() => {
                                    handleAddTag(guest.id, tag.id)
                                    setEditingGuestTags(null)
                                  }}
                                  className="px-1.5 py-0.5 rounded text-xs font-medium text-white hover:opacity-80"
                                  style={{ backgroundColor: tag.color }}
                                >
                                  {tag.name}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Guests