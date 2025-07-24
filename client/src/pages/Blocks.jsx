import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useEdition } from '../contexts/EditionContext'

const Blocks = () => {
  const { selectedEdition } = useEdition()
  const [blocks, setBlocks] = useState([])
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingBlock, setEditingBlock] = useState(null)
  const [selectedBlock, setSelectedBlock] = useState(null)
  const [showMovies, setShowMovies] = useState(false)
  const [movieFilter, setMovieFilter] = useState('')
  const [formData, setFormData] = useState({
    name_cs: '',
    name_en: '',
    description_cs: '',
    description_en: ''
  })

  useEffect(() => {
    if (selectedEdition) {
      fetchData()
    }
  }, [selectedEdition])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [blocksRes, moviesRes] = await Promise.all([
        axios.get(`/api/blocks/edition/${selectedEdition.id}`),
        axios.get(`/api/movies/edition/${selectedEdition.id}`)
      ])
      
      setBlocks(blocksRes.data)
      setMovies(moviesRes.data)
    } catch (error) {
      console.error('Error fetching data:', error)
      setError('Failed to load data')
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
      description_cs: '',
      description_en: ''
    })
    setEditingBlock(null)
    setShowForm(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.name_cs) {
      showError('Please fill in the Czech name')
      return
    }

    try {
      const blockData = {
        ...formData,
        edition_id: selectedEdition.id
      }

      if (editingBlock) {
        await axios.put(`/api/blocks/${editingBlock.id}`, blockData)
        showSuccess('Block updated successfully')
      } else {
        await axios.post('/api/blocks', blockData)
        showSuccess('Block created successfully')
      }

      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error saving block:', error)
      showError(error.response?.data?.error || 'Failed to save block')
    }
  }

  const handleEdit = (block) => {
    setFormData({
      name_cs: block.name_cs,
      name_en: block.name_en || '',
      description_cs: block.description_cs || '',
      description_en: block.description_en || ''
    })
    setEditingBlock(block)
    setShowForm(true)
  }

  const handleDelete = async (block) => {
    if (!window.confirm(`Are you sure you want to delete block "${block.name_cs}"?`)) {
      return
    }

    try {
      await axios.delete(`/api/blocks/${block.id}`)
      showSuccess('Block deleted successfully')
      fetchData()
      if (selectedBlock?.id === block.id) {
        setSelectedBlock(null)
        setShowMovies(false)
      }
    } catch (error) {
      console.error('Error deleting block:', error)
      showError(error.response?.data?.error || 'Failed to delete block')
    }
  }

  const handleViewMovies = async (block) => {
    try {
      const response = await axios.get(`/api/blocks/${block.id}`)
      setSelectedBlock(response.data)
      setMovieFilter('') // Reset filter when opening modal
      setShowMovies(true)
    } catch (error) {
      console.error('Error fetching block details:', error)
      showError('Failed to load block details')
    }
  }

  const handleAddMovieToBlock = async (movieId) => {
    try {
      await axios.post(`/api/blocks/${selectedBlock.id}/movies`, {
        movie_id: movieId,
        sort_order: selectedBlock.movies.length
      })
      
      // Refresh block details
      const response = await axios.get(`/api/blocks/${selectedBlock.id}`)
      setSelectedBlock(response.data)
      
      // Refresh blocks list
      fetchData()
      showSuccess('Movie added to block')
    } catch (error) {
      console.error('Error adding movie to block:', error)
      showError(error.response?.data?.error || 'Failed to add movie to block')
    }
  }

  const handleRemoveMovieFromBlock = async (movieId) => {
    try {
      await axios.delete(`/api/blocks/${selectedBlock.id}/movies/${movieId}`)
      
      // Refresh block details
      const response = await axios.get(`/api/blocks/${selectedBlock.id}`)
      setSelectedBlock(response.data)
      
      // Refresh blocks list
      fetchData()
      showSuccess('Movie removed from block')
    } catch (error) {
      console.error('Error removing movie from block:', error)
      showError(error.response?.data?.error || 'Failed to remove movie from block')
    }
  }

  const getAvailableMovies = () => {
    if (!selectedBlock) return movies
    
    const blockMovieIds = selectedBlock.movies.map(m => m.id)
    let availableMovies = movies.filter(movie => !blockMovieIds.includes(movie.id))
    
    // Apply text filter
    if (movieFilter.trim()) {
      const filterText = movieFilter.toLowerCase().trim()
      availableMovies = availableMovies.filter(movie => {
        const czechName = (movie.name_cs || '').toLowerCase()
        const englishName = (movie.name_en || '').toLowerCase()
        const director = (movie.director || '').toLowerCase()
        const year = (movie.year || '').toString()
        
        return czechName.includes(filterText) || 
               englishName.includes(filterText) ||
               director.includes(filterText) ||
               year.includes(filterText)
      })
    }
    
    return availableMovies
  }

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please select an edition to manage blocks.</p>
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
            Movie Blocks
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage blocks of movies, typically used for grouping short films
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors duration-200"
        >
          Create Block
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

      {/* Block Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <h2 className="text-xl font-semibold mb-4">
              {editingBlock ? 'Edit Block' : 'Create New Block'}
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Czech Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name_cs}
                    onChange={(e) => setFormData({...formData, name_cs: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Krátké filmy I"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    English Name
                  </label>
                  <input
                    type="text"
                    value={formData.name_en}
                    onChange={(e) => setFormData({...formData, name_en: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Short Films I"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Czech Description
                </label>
                <textarea
                  value={formData.description_cs}
                  onChange={(e) => setFormData({...formData, description_cs: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder="Optional description in Czech"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  English Description
                </label>
                <textarea
                  value={formData.description_en}
                  onChange={(e) => setFormData({...formData, description_en: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder="Optional description in English"
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
                  {editingBlock ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Movie Management Modal */}
      {showMovies && selectedBlock && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">
                Manage Movies - {selectedBlock.name_cs}
              </h2>
              <button
                onClick={() => setShowMovies(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6">
              {/* Current Movies in Block */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">
                  Movies in Block ({selectedBlock.movies.length})
                </h3>
                {selectedBlock.movies.length === 0 ? (
                  <p className="text-gray-500 text-sm">No movies in this block yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedBlock.movies.map(movie => (
                      <div key={movie.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-md">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {movie.name_cs}
                          </div>
                          <div className="text-xs text-gray-500">
                            {movie.director} • {movie.runtime} min • {movie.year}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveMovieFromBlock(movie.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="text-sm text-gray-600 mt-2">
                      Total Runtime: {selectedBlock.total_runtime} minutes
                    </div>
                  </div>
                )}
              </div>

              {/* Available Movies */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-gray-900">
                    Available Movies ({getAvailableMovies().length})
                  </h3>
                </div>
                
                {/* Movie Filter */}
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="Filter movies by name, director, or year..."
                    value={movieFilter}
                    onChange={(e) => setMovieFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {movieFilter && (
                    <div className="mt-1 text-xs text-gray-500">
                      Showing {getAvailableMovies().length} of {movies.filter(movie => !selectedBlock.movies.map(m => m.id).includes(movie.id)).length} available movies
                    </div>
                  )}
                </div>
                
                {getAvailableMovies().length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    {movieFilter ? 'No movies match your filter.' : 'All movies are already in blocks or no movies available.'}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {getAvailableMovies().map(movie => (
                      <div key={movie.id} className="flex items-center justify-between bg-blue-50 p-3 rounded-md">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">
                            {movie.name_cs}
                            {movie.name_en && movie.name_en !== movie.name_cs && (
                              <span className="text-gray-600 ml-1">/ {movie.name_en}</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {movie.director} • {movie.runtime} min • {movie.year}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddMovieToBlock(movie.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium ml-4 flex-shrink-0"
                        >
                          Add to Block
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t mt-6">
              <button
                onClick={() => setShowMovies(false)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors duration-200"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocks List */}
      <div className="bg-white shadow-sm rounded-lg overflow-hidden">
        {blocks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No blocks found for this edition.
            <br />
            Click "Create Block" to create your first movie block.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Block Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Movies
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Runtime
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {blocks.map(block => (
                  <tr key={block.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {block.name_cs}
                        </div>
                        {block.name_en && (
                          <div className="text-sm text-gray-500">
                            {block.name_en}
                          </div>
                        )}
                        {block.description_cs && (
                          <div className="text-xs text-gray-400 mt-1">
                            {block.description_cs}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {block.movie_count} movies
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {block.total_runtime} min
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => handleViewMovies(block)}
                          className="text-green-600 hover:text-green-900 transition-colors duration-200"
                        >
                          Movies
                        </button>
                        <button
                          onClick={() => handleEdit(block)}
                          className="text-blue-600 hover:text-blue-900 transition-colors duration-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(block)}
                          className="text-red-600 hover:text-red-900 transition-colors duration-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Blocks