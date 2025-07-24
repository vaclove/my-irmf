import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'
import { useToast } from '../contexts/ToastContext'

const Programming = () => {
  const { selectedEdition } = useEdition()
  const { success, error } = useToast()
  const [schedule, setSchedule] = useState([])
  const [fullSchedule, setFullSchedule] = useState([]) // Unfiltered schedule for counts
  const [venues, setVenues] = useState([])
  const [movies, setMovies] = useState([])
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedVenue, setSelectedVenue] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [formData, setFormData] = useState({
    venue_id: '',
    scheduled_date: '',
    scheduled_time: '',
    movie_id: '',
    block_id: '',
    discussion_time: 0,
    title_override_cs: '',
    title_override_en: '',
    notes: ''
  })

  useEffect(() => {
    if (selectedEdition) {
      fetchData()
      // Start with no date filter (show all dates)
      setSelectedDate('')
    }
  }, [selectedEdition])

  useEffect(() => {
    if (selectedEdition) {
      fetchSchedule()
    }
  }, [selectedEdition, selectedDate, selectedVenue])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [venuesRes, moviesRes, blocksRes] = await Promise.all([
        axios.get('/api/venues'),
        axios.get(`/api/movies/edition/${selectedEdition.id}`),
        axios.get(`/api/blocks/edition/${selectedEdition.id}`)
      ])
      
      setVenues(venuesRes.data)
      setMovies(moviesRes.data)
      setBlocks(blocksRes.data)
    } catch (err) {
      console.error('Error fetching data:', err)
      error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const fetchSchedule = async () => {
    if (!selectedEdition) return
    
    try {
      // Fetch full schedule for counts
      const fullResponse = await axios.get(`/api/programming/edition/${selectedEdition.id}`)
      setFullSchedule(fullResponse.data)
      
      // Fetch filtered schedule for display
      const params = new URLSearchParams()
      if (selectedDate) params.append('date', selectedDate)
      if (selectedVenue) params.append('venue_id', selectedVenue)
      
      const response = await axios.get(`/api/programming/edition/${selectedEdition.id}?${params}`)
      setSchedule(response.data)
    } catch (err) {
      console.error('Error fetching schedule:', err)
      error('Failed to load schedule')
    }
  }

  const resetForm = () => {
    setFormData({
      venue_id: '',
      scheduled_date: selectedDate || '',
      scheduled_time: '',
      movie_id: '',
      block_id: '',
      discussion_time: 0,
      title_override_cs: '',
      title_override_en: '',
      notes: ''
    })
    setEditingEntry(null)
    setShowForm(false)
  }

  const handleAddEntry = () => {
    setFormData({
      venue_id: selectedVenue || '',
      scheduled_date: selectedDate || '',
      scheduled_time: '',
      movie_id: '',
      block_id: '',
      discussion_time: 0,
      title_override_cs: '',
      title_override_en: '',
      notes: ''
    })
    setShowForm(true)
  }

  const handleEdit = (entry) => {
    // Format date to YYYY-MM-DD format for HTML date input
    const formatDate = (dateString) => {
      if (!dateString) return ''
      
      // Parse the date and format it correctly
      const date = new Date(dateString)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    // Format time to HH:MM format for HTML time input
    const formatTime = (timeString) => {
      if (!timeString) return ''
      return timeString.slice(0, 5) // Remove seconds if present
    }

    setFormData({
      venue_id: entry.venue_id,
      scheduled_date: formatDate(entry.scheduled_date),
      scheduled_time: formatTime(entry.scheduled_time),
      movie_id: entry.movie_id || '',
      block_id: entry.block_id || '',
      discussion_time: entry.discussion_time || 0,
      title_override_cs: entry.title_override_cs || '',
      title_override_en: entry.title_override_en || '',
      notes: entry.notes || ''
    })
    setEditingEntry(entry)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.venue_id || !formData.scheduled_date || !formData.scheduled_time) {
      error('Please fill in venue, date, and time')
      return
    }

    if (!formData.movie_id && !formData.block_id) {
      error('Please select either a movie or a block')
      return
    }

    if (formData.movie_id && formData.block_id) {
      error('Please select either a movie OR a block, not both')
      return
    }

    try {
      const entryData = {
        edition_id: selectedEdition.id,
        ...formData,
        movie_id: formData.movie_id || null,
        block_id: formData.block_id || null,
        discussion_time: parseInt(formData.discussion_time) || 0
      }

      if (editingEntry) {
        await axios.put(`/api/programming/${editingEntry.id}`, entryData)
        success('Programming entry updated successfully')
      } else {
        await axios.post('/api/programming', entryData)
        success('Programming entry added successfully')
      }

      resetForm()
      fetchSchedule()
    } catch (err) {
      console.error('Error saving programming entry:', err)
      error(err.response?.data?.error || 'Failed to save programming entry')
    }
  }

  const handleDelete = async (entry) => {
    const title = entry.movie_name_cs || entry.block_name_cs || 'this entry'
    if (!window.confirm(`Are you sure you want to delete "${title}" from the schedule?`)) {
      return
    }

    try {
      await axios.delete(`/api/programming/${entry.id}`)
      success('Programming entry deleted successfully')
      fetchSchedule()
    } catch (err) {
      console.error('Error deleting programming entry:', err)
      error(err.response?.data?.error || 'Failed to delete programming entry')
    }
  }

  const formatTime = (timeString) => {
    return timeString.slice(0, 5) // Remove seconds
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('cs-CZ')
  }

  // Generate festival dates based on edition start/end dates
  const getFestivalDates = () => {
    if (!selectedEdition?.start_date || !selectedEdition?.end_date) return []
    
    const startDate = new Date(selectedEdition.start_date)
    const endDate = new Date(selectedEdition.end_date)
    const dates = []
    
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      dates.push({
        value: currentDate.toISOString().split('T')[0],
        label: currentDate.toLocaleDateString('cs-CZ', { 
          weekday: 'long', 
          day: 'numeric', 
          month: 'long' 
        })
      })
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    return dates
  }

  const generateTimeSlots = () => {
    const slots = []
    for (let hour = 8; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        slots.push(time)
      }
    }
    return slots
  }

  // Color coding for venues
  const getVenueColor = (venueName) => {
    const venueColors = {
      'Malý sál': { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-800', dot: 'bg-blue-500' },
      'Small Hall': { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-800', dot: 'bg-blue-500' },
      'Velký sál': { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-800', dot: 'bg-green-500' },
      'Great Hall': { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-800', dot: 'bg-green-500' },
      'Kavárna': { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-500' },
      'Café': { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-500' },
    }
    
    // Return color for the venue, or default purple for unknown venues
    return venueColors[venueName] || { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-800', dot: 'bg-purple-500' }
  }

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please select an edition to view programming.</p>
      </div>
    )
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Festival Schedule
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Program movies and blocks to specific venues, dates, and times
          </p>
        </div>
        <button
          onClick={handleAddEntry}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors duration-200"
        >
          Add Entry
        </button>
      </div>


      {/* Combined Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          {/* Date Filter */}
          <div className="flex-shrink-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Filter by Date
            </label>
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full lg:w-48 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All dates</option>
              {getFestivalDates().map(date => (
                <option key={date.value} value={date.value}>
                  {date.label}
                </option>
              ))}
            </select>
          </div>

          {/* Venue Filter */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Filter by Venue
            </label>
            <div className="flex flex-wrap gap-2">
              {/* All Venues Button */}
              <button
                onClick={() => setSelectedVenue('')}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md border transition-all duration-200 ${
                  selectedVenue === ''
                    ? 'bg-gray-800 text-white border-gray-800 shadow-md'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400'
                }`}
              >
                All Venues
                {selectedVenue === '' && (
                  <span className="ml-2 text-xs bg-white bg-opacity-20 px-2 py-0.5 rounded-full">
                    {fullSchedule.length}
                  </span>
                )}
              </button>

              {/* Individual Venue Buttons */}
              {venues.map(venue => {
                const colors = getVenueColor(venue.name_cs)
                const isSelected = selectedVenue === venue.id
                const venueEntryCount = fullSchedule.filter(entry => entry.venue_id === venue.id).length
                
                return (
                  <button
                    key={venue.id}
                    onClick={() => setSelectedVenue(venue.id)}
                    className={`flex items-center px-3 py-2 text-sm font-medium rounded-md border transition-all duration-200 ${
                      isSelected
                        ? `${colors.bg} ${colors.text} ${colors.border} shadow-md`
                        : `bg-white ${colors.text} border-gray-300 hover:${colors.bg} hover:${colors.border}`
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full ${colors.dot} mr-2 flex-shrink-0`}></div>
                    <span className="truncate">{venue.name_cs}</span>
                    {venueEntryCount > 0 && (
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                        isSelected 
                          ? 'bg-white bg-opacity-20' 
                          : `${colors.bg} ${colors.text}`
                      }`}>
                        {venueEntryCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Programming Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-4">
              {editingEntry ? 'Edit Programming Entry' : 'Add Programming Entry'}
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Venue *
                  </label>
                  <select
                    value={formData.venue_id}
                    onChange={(e) => setFormData({...formData, venue_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">Select Venue</option>
                    {venues.map(venue => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name_cs} / {venue.name_en}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData({...formData, scheduled_date: e.target.value})}
                    min={selectedEdition.start_date?.split('T')[0]}
                    max={selectedEdition.end_date?.split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Time *
                </label>
                <select
                  value={formData.scheduled_time}
                  onChange={(e) => setFormData({...formData, scheduled_time: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select Time</option>
                  {generateTimeSlots().map(time => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  Content (select one):
                </p>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Single Movie
                    </label>
                    <select
                      value={formData.movie_id}
                      onChange={(e) => setFormData({...formData, movie_id: e.target.value, block_id: ''})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Movie</option>
                      {movies.map(movie => (
                        <option key={movie.id} value={movie.id}>
                          {movie.name_cs} ({movie.runtime} min, {movie.director})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="text-center text-gray-400">OR</div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Movie Block
                    </label>
                    <select
                      value={formData.block_id}
                      onChange={(e) => setFormData({...formData, block_id: e.target.value, movie_id: ''})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Block</option>
                      {blocks.map(block => (
                        <option key={block.id} value={block.id}>
                          {block.name_cs} ({block.total_runtime} min, {block.movie_count} movies)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Discussion Time (minutes)
                </label>
                <input
                  type="number"
                  value={formData.discussion_time}
                  onChange={(e) => setFormData({...formData, discussion_time: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                  max="120"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title Override (Czech)
                  </label>
                  <input
                    type="text"
                    value={formData.title_override_cs}
                    onChange={(e) => setFormData({...formData, title_override_cs: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional custom title"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title Override (English)
                  </label>
                  <input
                    type="text"
                    value={formData.title_override_en}
                    onChange={(e) => setFormData({...formData, title_override_en: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional custom title"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder="Optional notes"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t">
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
                  {editingEntry ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Schedule Display */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden">
        {schedule.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No programming entries found for the selected filters.
            <br />
            Click "Add Entry" to create your first programming entry.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Venue
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Content
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {schedule.map(entry => {
                  const venueColors = getVenueColor(entry.venue_name_cs)
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatDate(entry.scheduled_date)}
                        </div>
                        <div className="text-sm text-gray-500">
                          {formatTime(entry.scheduled_time)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`w-3 h-3 rounded-full ${venueColors.dot} mr-2 flex-shrink-0`}></div>
                          <div>
                            <div className={`text-sm font-medium ${venueColors.text}`}>
                              {entry.venue_name_cs}
                            </div>
                            <div className="text-sm text-gray-500">
                              {entry.venue_name_en}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {entry.title_override_cs || entry.movie_name_cs || entry.block_name_cs}
                      </div>
                      <div className="text-sm text-gray-500">
                        {entry.title_override_en || entry.movie_name_en || entry.block_name_en}
                      </div>
                      {entry.movie_director && (
                        <div className="text-xs text-gray-400">
                          Dir: {entry.movie_director}
                        </div>
                      )}
                      {entry.notes && (
                        <div className="text-xs text-gray-400 mt-1">
                          {entry.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {entry.total_runtime} min
                      </div>
                      {entry.discussion_time > 0 && (
                        <div className="text-xs text-gray-500">
                          +{entry.discussion_time} min discussion
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => handleEdit(entry)}
                          className="text-blue-600 hover:text-blue-900 transition-colors duration-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(entry)}
                          className="text-red-600 hover:text-red-900 transition-colors duration-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Programming