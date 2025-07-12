import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { editionApi, guestApi, invitationApi } from '../utils/api'
import InvitationDialog from '../components/InvitationDialog'

function EditionDetail() {
  const { id } = useParams()
  const [edition, setEdition] = useState(null)
  const [assignedGuests, setAssignedGuests] = useState([])
  const [allGuests, setAllGuests] = useState([])
  const [loading, setLoading] = useState(true)
  // Removed manual assignment form state - now using tag-based assignment
  const [showInvitationDialog, setShowInvitationDialog] = useState(false)
  const [selectedGuestForInvitation, setSelectedGuestForInvitation] = useState(null)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Categories are now determined from tags automatically
  const categories = ['filmmaker', 'press', 'guest', 'staff'] // For filtering only

  useEffect(() => {
    fetchEditionData()
  }, [id])

  const fetchEditionData = async () => {
    try {
      const [editionResponse, assignedResponse] = await Promise.all([
        editionApi.getById(id),
        editionApi.getGuests(id)
      ])
      
      setEdition(editionResponse.data)
      setAssignedGuests(assignedResponse.data)
    } catch (error) {
      console.error('Error fetching edition data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Manual assignment functions removed - now using tag-based assignment

  const handleSendInvitation = (guest) => {
    setSelectedGuestForInvitation({
      ...guest,
      id: guest.id,
      category: guest.category
    })
    setShowInvitationDialog(true)
  }

  const handleInvitationSent = () => {
    fetchEditionData()
  }

  // Invitation confirmation removed - will be reimplemented with new tag-based system

  const getStatusBadge = (guest) => {
    if (guest.confirmed_at) {
      return <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Confirmed</span>
    } else if (guest.invited_at) {
      return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">Invited</span>
    } else {
      return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">Not Invited</span>
    }
  }

  const getCategoryBadge = (category) => {
    const colors = {
      filmmaker: 'bg-purple-100 text-purple-800',
      press: 'bg-blue-100 text-blue-800',
      guest: 'bg-green-100 text-green-800',
      staff: 'bg-orange-100 text-orange-800'
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[category]}`}>
        {category.charAt(0).toUpperCase() + category.slice(1)}
      </span>
    )
  }

  // No longer needed - guests are automatically assigned via tags

  const getFilteredAndSortedGuests = () => {
    return assignedGuests
      .filter(guest => {
        // Filter by category
        if (filterCategory && guest.category !== filterCategory) {
          return false
        }
        
        // Filter by status
        if (filterStatus) {
          if (filterStatus === 'confirmed' && !guest.confirmed_at) return false
          if (filterStatus === 'invited' && (!guest.invited_at || guest.confirmed_at)) return false
          if (filterStatus === 'not_invited' && guest.invited_at) return false
        }
        
        return true
      })
      .sort((a, b) => {
        // First sort by category
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category)
        }
        
        // Then sort by status (confirmed > invited > not invited)
        const getStatusPriority = (guest) => {
          if (guest.confirmed_at) return 0 // Confirmed first
          if (guest.invited_at) return 1   // Invited second
          return 2                          // Not invited last
        }
        
        const statusDiff = getStatusPriority(a) - getStatusPriority(b)
        if (statusDiff !== 0) return statusDiff
        
        // Finally sort by name (first_name + last_name)
        const nameA = `${a.first_name} ${a.last_name}`.toLowerCase()
        const nameB = `${b.first_name} ${b.last_name}`.toLowerCase()
        return nameA.localeCompare(nameB)
      })
  }

  if (loading) {
    return <div className="text-center py-8">Loading edition details...</div>
  }

  if (!edition) {
    return <div className="text-center py-8">Edition not found</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{edition.name}</h1>
        <div className="flex items-center space-x-4 text-sm text-gray-600">
          <span>Year: {edition.year}</span>
          {edition.start_date && edition.end_date && (
            <span>
              {new Date(edition.start_date).toLocaleDateString()} - {new Date(edition.end_date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-medium">Edition Guests ({getFilteredAndSortedGuests().length}/{assignedGuests.length})</h2>
          <p className="text-sm text-gray-600 mt-1">
            Guests are automatically assigned by adding the year tag "{edition?.year}" to them
          </p>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="invited">Invited</option>
              <option value="not_invited">Not Invited</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setFilterCategory('')
                setFilterStatus('')
              }}
              className="bg-gray-200 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-300 text-sm"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Manual assignment form removed - guests are now automatically assigned via tags */}

      <div className="bg-white shadow rounded-lg">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Guest</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {getFilteredAndSortedGuests().map((guest) => (
                <tr key={guest.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {guest.first_name} {guest.last_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {guest.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getCategoryBadge(guest.category)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(guest)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex space-x-2">
                      {!guest.invited_at && (
                        <button
                          onClick={() => handleSendInvitation(guest)}
                          className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700"
                        >
                          Send Invite
                        </button>
                      )}
                      {guest.confirmed_at && (
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                          Confirmed
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {assignedGuests.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No guests assigned yet</h3>
          <p className="text-gray-600 mb-4">
            Guests are automatically assigned when you add the "{edition?.year}" tag to them.
          </p>
          <p className="text-gray-500 text-sm">
            Go to the Guests page and add tags to assign guests to this edition.
          </p>
        </div>
      ) : getFilteredAndSortedGuests().length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No guests match the current filters</h3>
          <p className="text-gray-600 mb-4">Try adjusting your filters or clear them to see all guests</p>
          <button
            onClick={() => {
              setFilterCategory('')
              setFilterStatus('')
            }}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
          >
            Clear Filters
          </button>
        </div>
      ) : null}

      <InvitationDialog
        isOpen={showInvitationDialog}
        onClose={() => setShowInvitationDialog(false)}
        guest={selectedGuestForInvitation}
        edition={edition}
        onInvitationSent={handleInvitationSent}
      />
    </div>
  )
}

export default EditionDetail