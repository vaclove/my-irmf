import React, { useState, useEffect } from 'react'
import axios from 'axios'

const Venues = () => {
  const [venues, setVenues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editingVenue, setEditingVenue] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name_cs: '',
    name_en: '',
    capacity: '',
    sort_order: 0
  })

  useEffect(() => {
    fetchVenues()
  }, [])

  const fetchVenues = async () => {
    try {
      const response = await axios.get('/api/venues')
      setVenues(response.data)
    } catch (error) {
      console.error('Error fetching venues:', error)
      setError('Failed to load venues')
    } finally {
      setLoading(false)
    }
  }

  const showError = (message) => {
    setError(message)
    setTimeout(() => setError(''), 5000)
  }

  const showSuccess = (message) => {
    setSuccess(message)
    setTimeout(() => setSuccess(''), 3000)
  }

  const resetForm = () => {
    setFormData({
      name_cs: '',
      name_en: '',
      capacity: '',
      sort_order: 0
    })
    setEditingVenue(null)
    setShowForm(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.name_cs || !formData.name_en) {
      showError('Please fill in venue names in both languages')
      return
    }

    try {
      const venueData = {
        ...formData,
        capacity: formData.capacity ? parseInt(formData.capacity) : null,
        sort_order: parseInt(formData.sort_order) || 0
      }

      if (editingVenue) {
        await axios.put(`/api/venues/${editingVenue.id}`, venueData)
        showSuccess('Venue updated successfully')
      } else {
        await axios.post('/api/venues', venueData)
        showSuccess('Venue created successfully')
      }

      resetForm()
      fetchVenues()
    } catch (error) {
      console.error('Error saving venue:', error)
      showError(error.response?.data?.error || 'Failed to save venue')
    }
  }

  const handleEdit = (venue) => {
    setFormData({
      name_cs: venue.name_cs,
      name_en: venue.name_en,
      capacity: venue.capacity || '',
      sort_order: venue.sort_order || 0
    })
    setEditingVenue(venue)
    setShowForm(true)
  }

  const handleDelete = async (venue) => {
    if (!window.confirm(`Are you sure you want to delete venue "${venue.name_cs}"?`)) {
      return
    }

    try {
      await axios.delete(`/api/venues/${venue.id}`)
      showSuccess('Venue deleted successfully')
      fetchVenues()
    } catch (error) {
      console.error('Error deleting venue:', error)
      showError(error.response?.data?.error || 'Failed to delete venue')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Festival Venues</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors duration-200"
        >
          Add Venue
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
          {success}
        </div>
      )}

      {/* Venue Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">
              {editingVenue ? 'Edit Venue' : 'Add New Venue'}
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Czech Name *
                </label>
                <input
                  type="text"
                  value={formData.name_cs}
                  onChange={(e) => setFormData({...formData, name_cs: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Malý sál"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  English Name *
                </label>
                <input
                  type="text"
                  value={formData.name_en}
                  onChange={(e) => setFormData({...formData, name_en: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Small Hall"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Capacity
                </label>
                <input
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData({...formData, capacity: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 80"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sort Order
                </label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({...formData, sort_order: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                  min="0"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                >
                  {editingVenue ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Venues List */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Venue Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Capacity
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {venues.length === 0 ? (
              <tr>
                <td colSpan="4" className="px-6 py-4 text-center text-gray-500">
                  No venues found. Click "Add Venue" to create one.
                </td>
              </tr>
            ) : (
              venues.map(venue => (
                <tr key={venue.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {venue.name_cs}
                      </div>
                      <div className="text-sm text-gray-500">
                        {venue.name_en}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {venue.capacity || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {venue.sort_order}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => handleEdit(venue)}
                        className="text-blue-600 hover:text-blue-900 transition-colors duration-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(venue)}
                        className="text-red-600 hover:text-red-900 transition-colors duration-200"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Venues