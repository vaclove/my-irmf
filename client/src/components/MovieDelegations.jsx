import React, { useState, useEffect } from 'react'
import { useEdition } from '../contexts/EditionContext'
import { associationApi, movieApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import SearchableSelect from './SearchableSelect'

function MovieDelegations({ selectedGuest, onUpdate }) {
  const { selectedEdition } = useEdition()
  const { success, error } = useToast()
  const [delegations, setDelegations] = useState([])
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newDelegation, setNewDelegation] = useState({
    movie_id: '',
    role: 'delegation_member',
    is_primary: false,
    notes: ''
  })

  const roles = [
    { value: 'director', label: 'Director' },
    { value: 'producer', label: 'Producer' },
    { value: 'actor', label: 'Actor' },
    { value: 'delegation_member', label: 'Delegation Member' },
    { value: 'distributor', label: 'Distributor' },
    { value: 'sales_agent', label: 'Sales Agent' }
  ]

  useEffect(() => {
    if (selectedGuest && selectedEdition) {
      fetchDelegations()
      fetchMovies()
    }
  }, [selectedGuest, selectedEdition])

  const fetchDelegations = async () => {
    try {
      setLoading(true)
      const response = await associationApi.getGuestDelegations(selectedGuest.id)
      // Filter to current edition
      setDelegations(response.data.delegations.filter(d => d.edition_year === selectedEdition.year))
    } catch (err) {
      error('Failed to load delegations: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchMovies = async () => {
    try {
      const response = await movieApi.getAll(selectedEdition.id)
      setMovies(response.data)
    } catch (err) {
      error('Failed to load movies: ' + err.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!newDelegation.movie_id) {
      error('Please select a movie')
      return
    }

    try {
      setLoading(true)
      await associationApi.createDelegation({
        guest_id: selectedGuest.id,
        movie_id: newDelegation.movie_id,
        role: newDelegation.role,
        is_primary: newDelegation.is_primary,
        notes: newDelegation.notes
      })
      
      success('Delegation added successfully')
      setNewDelegation({ movie_id: '', role: 'delegation_member', is_primary: false, notes: '' })
      setShowAddForm(false)
      fetchDelegations()
      if (onUpdate) onUpdate()
    } catch (err) {
      error('Failed to add delegation: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (delegationId, updates) => {
    try {
      setLoading(true)
      await associationApi.updateDelegation(delegationId, updates)
      success('Delegation updated successfully')
      fetchDelegations()
      if (onUpdate) onUpdate()
    } catch (err) {
      error('Failed to update delegation: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (delegationId) => {
    if (!confirm('Are you sure you want to remove this delegation?')) return

    try {
      setLoading(true)
      await associationApi.deleteDelegation(delegationId)
      success('Delegation removed successfully')
      fetchDelegations()
      if (onUpdate) onUpdate()
    } catch (err) {
      error('Failed to remove delegation: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!selectedGuest) {
    return <div className="text-gray-500">Select a guest to manage movie delegations</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">
          Movie Delegations for {selectedGuest.first_name} {selectedGuest.last_name}
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Add to Movie
        </button>
      </div>

      {showAddForm && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Movie
              </label>
              <div className="mt-1">
                <SearchableSelect
                  options={movies.map(movie => ({
                    value: movie.id,
                    label: `${movie.name_cs}${movie.name_en ? ` (${movie.name_en})` : ''} - ${movie.director} (${movie.year})`
                  }))}
                  value={newDelegation.movie_id}
                  onChange={(value) => setNewDelegation({ ...newDelegation, movie_id: value })}
                  placeholder="Search for a movie..."
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Role
              </label>
              <select
                value={newDelegation.role}
                onChange={(e) => setNewDelegation({ ...newDelegation, role: e.target.value })}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              >
                {roles.map(role => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center">
                <input
                  id="is_primary"
                  type="checkbox"
                  checked={newDelegation.is_primary}
                  onChange={(e) => setNewDelegation({ ...newDelegation, is_primary: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="is_primary" className="ml-2 block text-sm text-gray-900">
                  Primary contact for this movie
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <textarea
                value={newDelegation.notes}
                onChange={(e) => setNewDelegation({ ...newDelegation, notes: e.target.value })}
                rows={2}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Any additional notes about this delegation..."
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? 'Adding...' : 'Add Delegation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && !showAddForm && (
        <div className="text-center py-4">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      )}

      {!loading && delegations.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No movie delegations found for this guest
        </div>
      )}

      {!loading && delegations.length > 0 && (
        <div className="space-y-3">
          {delegations.map(delegation => (
            <div
              key={delegation.id}
              className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-gray-900">
                      {delegation.movie_name_cs}
                    </span>
                    {delegation.movie_name_en && (
                      <span className="text-sm text-gray-500">
                        ({delegation.movie_name_en})
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    <span>Dir: {delegation.director}</span>
                    {delegation.year && <span className="ml-2">• {delegation.year}</span>}
                    {delegation.section && <span className="ml-2">• {delegation.section}</span>}
                  </div>
                  <div className="mt-2 flex items-center space-x-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      delegation.role === 'director' ? 'bg-purple-100 text-purple-800' :
                      delegation.role === 'producer' ? 'bg-green-100 text-green-800' :
                      delegation.role === 'actor' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {roles.find(r => r.value === delegation.role)?.label || delegation.role}
                    </span>
                    {delegation.is_primary && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Primary Contact
                      </span>
                    )}
                  </div>
                  {delegation.notes && (
                    <p className="mt-2 text-sm text-gray-600">{delegation.notes}</p>
                  )}
                </div>
                <div className="ml-4 flex items-center space-x-2">
                  <button
                    onClick={() => handleUpdate(delegation.id, { is_primary: !delegation.is_primary })}
                    disabled={loading}
                    className={`px-2 py-1 text-xs rounded ${
                      delegation.is_primary 
                        ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    } disabled:opacity-50`}
                    title={delegation.is_primary ? 'Remove as primary contact' : 'Set as primary contact'}
                  >
                    {delegation.is_primary ? 'Primary' : 'Set Primary'}
                  </button>
                  <button
                    onClick={() => handleDelete(delegation.id)}
                    disabled={loading}
                    className="text-red-600 hover:text-red-900 disabled:opacity-50"
                    title="Remove delegation"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MovieDelegations