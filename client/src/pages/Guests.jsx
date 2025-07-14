import { useState, useEffect } from 'react'
import { guestApi, tagApi } from '../utils/api'
import TagCard from '../components/TagCard'

function Guests() {
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingGuest, setEditingGuest] = useState(null)
  const [allTags, setAllTags] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [editingGuestTags, setEditingGuestTags] = useState(null)
  const [newTagName, setNewTagName] = useState('')
  const [formData, setFormData] = useState({ 
    first_name: '', 
    last_name: '',
    email: '', 
    phone: '', 
    language: 'english', 
    company: '', 
    notes: '' 
  })

  useEffect(() => {
    fetchGuests()
    fetchTags()
  }, [])

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingGuest) {
        await guestApi.update(editingGuest.id, formData)
      } else {
        await guestApi.create(formData)
      }
      await fetchGuests()
      resetForm()
    } catch (error) {
      console.error('Error saving guest:', error)
    }
  }

  const handleEdit = (guest) => {
    setEditingGuest(guest)
    setFormData({ 
      first_name: guest.first_name || '', 
      last_name: guest.last_name || '',
      email: guest.email, 
      phone: guest.phone || '',
      language: guest.language || 'english',
      company: guest.company || '',
      notes: guest.notes || ''
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this guest?')) {
      try {
        await guestApi.delete(id)
        await fetchGuests()
      } catch (error) {
        console.error('Error deleting guest:', error)
      }
    }
  }

  const handleAddTag = async (guestId, tagId) => {
    try {
      await tagApi.assignToGuest(guestId, tagId)
      await fetchGuests()
    } catch (error) {
      console.error('Error adding tag:', error)
      alert('Failed to add tag: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleRemoveTag = async (guestId, tagId) => {
    try {
      await tagApi.removeFromGuest(guestId, tagId)
      await fetchGuests()
    } catch (error) {
      console.error('Error removing tag:', error)
      alert('Failed to remove tag: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    
    try {
      await tagApi.create({ name: newTagName.trim() })
      await fetchTags()
      setNewTagName('')
    } catch (error) {
      console.error('Error creating tag:', error)
      alert('Failed to create tag: ' + (error.response?.data?.error || error.message))
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
      notes: '' 
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
          <button
            onClick={() => setShowForm(true)}
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
                onKeyPress={(e) => e.key === 'Enter' && handleCreateTag()}
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

      {showForm && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium mb-4">
            {editingGuest ? 'Edit Guest' : 'Add New Guest'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">First Name</label>
                <input
                  type="text"
                  required
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last Name</label>
                <input
                  type="text"
                  required
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Language</label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="english">English</option>
                <option value="czech">Czech</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Company (optional)</label>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows="3"
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="Additional notes about the guest..."
              />
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                {editingGuest ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Language</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tags</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {getFilteredGuests().map((guest) => (
                <tr key={guest.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {guest.first_name} {guest.last_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {guest.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {guest.phone || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                      guest.language === 'czech' 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {guest.language === 'czech' ? 'Czech' : 'English'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {guest.company || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {guest.tags && guest.tags.length > 0 ? (
                        guest.tags.map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-white cursor-pointer group"
                            style={{ backgroundColor: tag.color }}
                            title={`Remove ${tag.name} tag`}
                            onClick={() => handleRemoveTag(guest.id, tag.id)}
                          >
                            {tag.name}
                            <span className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity">×</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400 text-xs">No tags</span>
                      )}
                      <button
                        onClick={() => setEditingGuestTags(editingGuestTags === guest.id ? null : guest.id)}
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                        title="Add tag"
                      >
                        +
                      </button>
                    </div>
                    {editingGuestTags === guest.id && (
                      <div className="mt-2 p-2 bg-gray-50 rounded-md">
                        <p className="text-xs text-gray-600 mb-2">Add tags:</p>
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
                                className="px-2 py-1 rounded-full text-xs font-medium text-white hover:opacity-80"
                                style={{ backgroundColor: tag.color }}
                              >
                                {tag.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                    <div className="truncate" title={guest.notes}>
                      {guest.notes || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(guest.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button
                      onClick={() => handleEdit(guest)}
                      className="text-blue-600 hover:text-blue-900 mr-3"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(guest.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </td>
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