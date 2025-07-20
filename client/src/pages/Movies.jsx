import { useState, useEffect, useCallback } from 'react'
import { movieApi, editionApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import { useEdition } from '../contexts/EditionContext'
import Modal from '../components/Modal'

function Movies() {
  const { success, error: showError } = useToast()
  const { selectedEdition } = useEdition()
  const [movies, setMovies] = useState([])
  const [editions, setEditions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingMovie, setEditingMovie] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [condensedView, setCondensedView] = useState(() => {
    return localStorage.getItem('moviesCondensedView') === 'true'
  })
  const [sectionFilter, setSectionFilter] = useState('')
  const [editionFilter, setEditionFilter] = useState(selectedEdition?.id || '')
  const [visibleColumns, setVisibleColumns] = useState({
    name: true,
    director: true,
    year: true,
    section: true,
    country: false,
    runtime: false,
    premiere: false
  })
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [formData, setFormData] = useState({
    edition_id: selectedEdition?.id || '',
    catalogue_year: '',
    name_cs: '',
    name_en: '',
    synopsis_cs: '',
    synopsis_en: '',
    fulltext_cs: '',
    image: '',
    image_data: '',
    runtime: '',
    director: '',
    year: new Date().getFullYear(),
    country: '',
    cast: '',
    premiere: '',
    section: '',
    is_35mm: false,
    has_delegation: false
  })

  const sections = [
    { value: 'feature', label: 'Feature' },
    { value: 'documentary', label: 'Documentary' },
    { value: 'short', label: 'Short' },
    { value: 'retrospective', label: 'Retrospective' },
    { value: 'special', label: 'Special' },
    { value: 'workshop', label: 'Workshop' },
    { value: 'concert', label: 'Concert' },
    { value: 'discussion', label: 'Discussion' }
  ]

  const premiereTypes = [
    { value: '', label: 'None' },
    { value: 'czech', label: 'Czech Premiere' },
    { value: 'european', label: 'European Premiere' },
    { value: 'world', label: 'World Premiere' }
  ]

  useEffect(() => {
    fetchMovies()
    fetchEditions()
  }, [editionFilter])

  useEffect(() => {
    if (selectedEdition && !editionFilter) {
      setEditionFilter(selectedEdition.id)
    }
  }, [selectedEdition])

  // Handle click outside for column settings dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showColumnSettings && !event.target.closest('.column-settings-container')) {
        setShowColumnSettings(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showColumnSettings])

  const fetchMovies = async () => {
    try {
      const response = await movieApi.getAll(editionFilter)
      setMovies(response.data)
    } catch (error) {
      console.error('Error fetching movies:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchEditions = async () => {
    try {
      const response = await editionApi.getAll()
      setEditions(response.data)
    } catch (error) {
      console.error('Error fetching editions:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingMovie) {
        await movieApi.update(editingMovie.id, formData)
        success(`Movie "${formData.name_cs}" updated successfully!`)
      } else {
        await movieApi.create(formData)
        success(`Movie "${formData.name_cs}" created successfully!`)
      }
      await fetchMovies()
      resetForm()
    } catch (error) {
      console.error('Error saving movie:', error)
      showError('Failed to save movie: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleEdit = (movie) => {
    setEditingMovie(movie)
    setFormData({
      edition_id: movie.edition_id,
      catalogue_year: movie.catalogue_year || '',
      name_cs: movie.name_cs || '',
      name_en: movie.name_en || '',
      synopsis_cs: movie.synopsis_cs || '',
      synopsis_en: movie.synopsis_en || '',
      fulltext_cs: movie.fulltext_cs || '',
      image: movie.image || '',
      image_data: movie.image_data || '',
      runtime: movie.runtime || '',
      director: movie.director || '',
      year: movie.year || new Date().getFullYear(),
      country: movie.country || '',
      cast: movie.cast || '',
      premiere: movie.premiere || '',
      section: movie.section || '',
      is_35mm: movie.is_35mm || false,
      has_delegation: movie.has_delegation || false
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    const movie = movies.find(m => m.id === id)
    if (window.confirm(`Are you sure you want to delete "${movie?.name_cs}"?`)) {
      try {
        await movieApi.delete(id)
        success(`Movie "${movie?.name_cs}" deleted successfully!`)
        await fetchMovies()
      } catch (error) {
        console.error('Error deleting movie:', error)
        showError('Failed to delete movie: ' + (error.response?.data?.error || error.message))
      }
    }
  }

  const handleImageUpload = (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setFormData(prev => ({
          ...prev,
          image_data: reader.result,
          image: file.name
        }))
      }
      reader.readAsDataURL(file)
    }
  }

  const toggleColumnVisibility = (column) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }))
  }

  const toggleCondensedView = () => {
    const newValue = !condensedView
    setCondensedView(newValue)
    localStorage.setItem('moviesCondensedView', newValue.toString())
  }

  const getFilteredMovies = () => {
    let filtered = movies

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(movie => {
        const nameCz = (movie.name_cs || '').toLowerCase()
        const nameEn = (movie.name_en || '').toLowerCase()
        const director = (movie.director || '').toLowerCase()
        const country = (movie.country || '').toLowerCase()
        const cast = (movie.cast || '').toLowerCase()
        return nameCz.includes(query) || nameEn.includes(query) || 
               director.includes(query) || country.includes(query) || cast.includes(query)
      })
    }

    // Filter by section
    if (sectionFilter) {
      filtered = filtered.filter(movie => movie.section === sectionFilter)
    }

    // Sort by year descending, then by name
    filtered.sort((a, b) => {
      if (a.year !== b.year) {
        return (b.year || 0) - (a.year || 0)
      }
      return (a.name_cs || '').localeCompare(b.name_cs || '')
    })
    
    return filtered
  }

  const resetForm = () => {
    setFormData({
      edition_id: selectedEdition?.id || '',
      catalogue_year: '',
      name_cs: '',
      name_en: '',
      synopsis_cs: '',
      synopsis_en: '',
      fulltext_cs: '',
      image: '',
      image_data: '',
      runtime: '',
      director: '',
      year: new Date().getFullYear(),
      country: '',
      cast: '',
      premiere: '',
      section: '',
      is_35mm: false,
      has_delegation: false
    })
    setEditingMovie(null)
    setShowForm(false)
  }

  if (loading) {
    return <div className="text-center py-8">Loading movies...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Movies</h1>
        <div className="flex space-x-3">
          <div className="relative column-settings-container">
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
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                <div className="p-3">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Table Settings</h4>
                  <div className="mb-3 pb-3 border-b">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={condensedView}
                        onChange={toggleCondensedView}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Condensed view</span>
                    </label>
                  </div>
                  <h5 className="text-xs font-medium text-gray-700 mb-2">Show Columns</h5>
                  <div className="space-y-2">
                    {[
                      { key: 'name', label: 'Name', disabled: true },
                      { key: 'director', label: 'Director' },
                      { key: 'year', label: 'Year' },
                      { key: 'section', label: 'Section' },
                      { key: 'country', label: 'Country' },
                      { key: 'runtime', label: 'Runtime' },
                      { key: 'premiere', label: 'Premiere' }
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
              setEditingMovie(null)
              setFormData({
                edition_id: selectedEdition?.id || '',
                catalogue_year: '',
                name_cs: '',
                name_en: '',
                synopsis_cs: '',
                synopsis_en: '',
                fulltext_cs: '',
                image: '',
                image_data: '',
                runtime: '',
                director: '',
                year: new Date().getFullYear(),
                country: '',
                cast: '',
                premiere: '',
                section: '',
                is_35mm: false,
                has_delegation: false
              })
              setShowForm(true)
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Add Movie
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              placeholder="Search movies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Edition</label>
            <select
              value={editionFilter}
              onChange={(e) => setEditionFilter(e.target.value)}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Editions</option>
              {editions.map(edition => (
                <option key={edition.id} value={edition.id}>
                  {edition.year} - {edition.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Sections</option>
              {sections.map(section => (
                <option key={section.value} value={section.value}>
                  {section.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            {(searchQuery || editionFilter || sectionFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setEditionFilter('')
                  setSectionFilter('')
                }}
                className="bg-gray-300 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-400 text-sm"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={showForm}
        onClose={resetForm}
        title={editingMovie ? 'Edit Movie' : 'Add New Movie'}
        size="large"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Edition *</label>
              <select
                required
                value={formData.edition_id}
                onChange={(e) => setFormData({ ...formData, edition_id: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select Edition</option>
                {editions.map(edition => (
                  <option key={edition.id} value={edition.id}>
                    {edition.year} - {edition.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || '' })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                min="1900"
                max="2100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Czech Name *</label>
              <input
                type="text"
                required
                value={formData.name_cs}
                onChange={(e) => setFormData({ ...formData, name_cs: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">English Name</label>
              <input
                type="text"
                value={formData.name_en}
                onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Director</label>
              <input
                type="text"
                value={formData.director}
                onChange={(e) => setFormData({ ...formData, director: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
              <select
                value={formData.section}
                onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select Section</option>
                {sections.map(section => (
                  <option key={section.value} value={section.value}>
                    {section.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Runtime (min)</label>
              <input
                type="text"
                value={formData.runtime}
                onChange={(e) => setFormData({ ...formData, runtime: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                placeholder="e.g., 120"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Premiere</label>
              <select
                value={formData.premiere}
                onChange={(e) => setFormData({ ...formData, premiere: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                {premiereTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cast</label>
            <textarea
              value={formData.cast}
              onChange={(e) => setFormData({ ...formData, cast: e.target.value })}
              rows="2"
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Main cast members..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Text *</label>
            <textarea
              required
              value={formData.fulltext_cs}
              onChange={(e) => setFormData({ ...formData, fulltext_cs: e.target.value })}
              rows="4"
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="Full description of the movie..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Movie Image</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            {formData.image_data && (
              <div className="mt-2">
                <img
                  src={formData.image_data}
                  alt="Preview"
                  className="w-32 h-48 object-cover rounded border"
                />
              </div>
            )}
          </div>

          <div className="flex space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.is_35mm}
                onChange={(e) => setFormData({ ...formData, is_35mm: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">35mm Film</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.has_delegation}
                onChange={(e) => setFormData({ ...formData, has_delegation: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Has Delegation</span>
            </label>
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                {editingMovie ? 'Update Movie' : 'Create Movie'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
            {editingMovie && (
              <button
                type="button"
                onClick={() => handleDelete(editingMovie.id)}
                className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm font-medium"
              >
                Delete Movie
              </button>
            )}
          </div>
        </form>
      </Modal>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium">
            {(searchQuery || editionFilter || sectionFilter) ? 
              `Filtered Movies (${getFilteredMovies().length}/${movies.length})` : 
              `All Movies (${movies.length})`}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                  Name
                </th>
                {visibleColumns.director && (
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Director
                  </th>
                )}
                {visibleColumns.year && (
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Year
                  </th>
                )}
                {visibleColumns.section && (
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Section
                  </th>
                )}
                {visibleColumns.country && (
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Country
                  </th>
                )}
                {visibleColumns.runtime && (
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Runtime
                  </th>
                )}
                {visibleColumns.premiere && (
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Premiere
                  </th>
                )}
                <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                  Edition
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {getFilteredMovies().map((movie) => (
                <tr key={movie.id} className="hover:bg-gray-50">
                  <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm font-medium text-gray-900`}>
                    <button
                      onClick={() => handleEdit(movie)}
                      className="text-left hover:text-blue-600 transition-colors"
                      title="Click to edit movie"
                    >
                      <div className="flex items-center space-x-3">
                        {movie.image_data && (
                          <img
                            src={movie.image_data}
                            alt={movie.name_cs}
                            className={`${condensedView ? 'w-8 h-12' : 'w-12 h-16'} object-cover rounded`}
                          />
                        )}
                        <div>
                          <div className="font-medium">{movie.name_cs}</div>
                          {movie.name_en && (
                            <div className={`${condensedView ? 'text-xs' : 'text-sm'} text-gray-500`}>
                              {movie.name_en}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  </td>
                  {visibleColumns.director && (
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {movie.director || '-'}
                    </td>
                  )}
                  {visibleColumns.year && (
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {movie.year || '-'}
                    </td>
                  )}
                  {visibleColumns.section && (
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {movie.section ? sections.find(s => s.value === movie.section)?.label || movie.section : '-'}
                    </td>
                  )}
                  {visibleColumns.country && (
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {movie.country || '-'}
                    </td>
                  )}
                  {visibleColumns.runtime && (
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {movie.runtime ? `${movie.runtime} min` : '-'}
                    </td>
                  )}
                  {visibleColumns.premiere && (
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {movie.premiere ? premiereTypes.find(p => p.value === movie.premiere)?.label || movie.premiere : '-'}
                    </td>
                  )}
                  <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                    {movie.edition_year}
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

export default Movies