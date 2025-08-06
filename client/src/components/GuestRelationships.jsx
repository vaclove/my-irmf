import React, { useState, useEffect } from 'react'
import { useEdition } from '../contexts/EditionContext'
import { associationApi, guestApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import SearchableSelect from './SearchableSelect'

function GuestRelationships({ selectedGuest, onUpdate }) {
  const { selectedEdition } = useEdition()
  const { success, error } = useToast()
  const [relationships, setRelationships] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newRelationship, setNewRelationship] = useState({
    related_guest_id: '',
    relationship_type: 'plus_one',
    notes: ''
  })

  const relationshipTypes = [
    { value: 'plus_one', label: 'Plus One' },
    { value: 'companion', label: 'Companion' },
    { value: 'spouse', label: 'Spouse' },
    { value: 'partner', label: 'Partner' }
  ]

  useEffect(() => {
    if (selectedGuest && selectedEdition) {
      fetchRelationships()
      fetchGuests()
    }
  }, [selectedGuest, selectedEdition])

  const fetchRelationships = async () => {
    try {
      setLoading(true)
      const response = await associationApi.getGuestRelationships(selectedGuest.id, selectedEdition.id)
      setRelationships(response.data.relationships)
    } catch (err) {
      error('Failed to load relationships: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchGuests = async () => {
    try {
      const response = await guestApi.getAll()
      // Filter out current guest
      setGuests(response.data.filter(g => g.id !== selectedGuest.id))
    } catch (err) {
      error('Failed to load guests: ' + err.message)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!newRelationship.related_guest_id) {
      error('Please select a related guest')
      return
    }

    try {
      setLoading(true)
      await associationApi.createRelationship({
        primary_guest_id: selectedGuest.id,
        related_guest_id: newRelationship.related_guest_id,
        relationship_type: newRelationship.relationship_type,
        edition_id: selectedEdition.id,
        notes: newRelationship.notes
      })
      
      success('Relationship added successfully')
      setNewRelationship({ related_guest_id: '', relationship_type: 'plus_one', notes: '' })
      setShowAddForm(false)
      fetchRelationships()
      if (onUpdate) onUpdate()
    } catch (err) {
      error('Failed to add relationship: ' + (err.response?.data?.error || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (relationshipId) => {
    if (!confirm('Are you sure you want to remove this relationship?')) return

    try {
      setLoading(true)
      await associationApi.deleteRelationship(relationshipId)
      success('Relationship removed successfully')
      fetchRelationships()
      if (onUpdate) onUpdate()
    } catch (err) {
      error('Failed to remove relationship: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!selectedGuest) {
    return <div className="text-gray-500">Select a guest to manage relationships</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-gray-900">
          Relationships for {selectedGuest.first_name} {selectedGuest.last_name}
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Add Relationship
        </button>
      </div>

      {showAddForm && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Related Guest
              </label>
              <div className="mt-1">
                <SearchableSelect
                  options={guests.map(guest => ({
                    value: guest.id,
                    label: `${guest.first_name} ${guest.last_name} (${guest.email})`
                  }))}
                  value={newRelationship.related_guest_id}
                  onChange={(value) => setNewRelationship({ ...newRelationship, related_guest_id: value })}
                  placeholder="Search for a guest..."
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Relationship Type
              </label>
              <select
                value={newRelationship.relationship_type}
                onChange={(e) => setNewRelationship({ ...newRelationship, relationship_type: e.target.value })}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              >
                {relationshipTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <textarea
                value={newRelationship.notes}
                onChange={(e) => setNewRelationship({ ...newRelationship, notes: e.target.value })}
                rows={2}
                className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Any additional notes about this relationship..."
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
                {loading ? 'Adding...' : 'Add Relationship'}
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

      {!loading && relationships.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No relationships found for this guest
        </div>
      )}

      {!loading && relationships.length > 0 && (
        <div className="space-y-3">
          {relationships.map(relationship => (
            <div
              key={relationship.id}
              className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-gray-900">
                      {relationship.other_guest_name}
                    </span>
                    <span className="text-sm text-gray-500">
                      ({relationship.other_guest_email})
                    </span>
                  </div>
                  <div className="mt-1">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      relationship.relationship_type === 'plus_one' ? 'bg-blue-100 text-blue-800' :
                      relationship.relationship_type === 'spouse' ? 'bg-green-100 text-green-800' :
                      relationship.relationship_type === 'partner' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {relationshipTypes.find(t => t.value === relationship.relationship_type)?.label || relationship.relationship_type}
                    </span>
                    <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      relationship.relationship_direction === 'outgoing' ? 'bg-yellow-100 text-yellow-800' : 'bg-indigo-100 text-indigo-800'
                    }`}>
                      {relationship.relationship_direction === 'outgoing' ? 'Primary' : 'Related to'}
                    </span>
                  </div>
                  {relationship.notes && (
                    <p className="mt-2 text-sm text-gray-600">{relationship.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(relationship.id)}
                  disabled={loading}
                  className="ml-4 text-red-600 hover:text-red-900 disabled:opacity-50"
                  title="Remove relationship"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default GuestRelationships