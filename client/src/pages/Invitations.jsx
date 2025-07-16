import { useState, useEffect } from 'react'
import { useEdition } from '../contexts/EditionContext'
import { invitationApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import Avatar from '../components/Avatar'

function Invitations() {
  const { selectedEdition } = useEdition()
  const { success, error: showError } = useToast()
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedInvitation, setSelectedInvitation] = useState(null)
  const [showDetails, setShowDetails] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => {
    if (selectedEdition) {
      fetchInvitations()
    } else {
      setLoading(false)
    }
  }, [selectedEdition])

  const fetchInvitations = async () => {
    try {
      const response = await invitationApi.getByEdition(selectedEdition.id)
      setInvitations(response.data.data || [])
    } catch (error) {
      console.error('Error fetching invitations:', error)
      showError('Failed to load invitations')
      setInvitations([]) // Ensure it's always an array
    } finally {
      setLoading(false)
    }
  }

  const handleResendInvitation = async (invitationId) => {
    try {
      await invitationApi.resend(invitationId)
      success('Invitation resent successfully!')
      fetchInvitations()
    } catch (error) {
      console.error('Error resending invitation:', error)
      showError('Failed to resend invitation')
    }
  }

  const handleDeleteInvitation = async (invitationId) => {
    if (!confirm('Are you sure you want to delete this invitation?')) return
    
    try {
      await invitationApi.delete(invitationId)
      success('Invitation deleted successfully!')
      fetchInvitations()
      setShowDetails(false)
    } catch (error) {
      console.error('Error deleting invitation:', error)
      showError('Failed to delete invitation')
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString()
  }

  const categories = ['filmmaker', 'press', 'guest', 'staff'] // For filtering only

  const getCategoryBadge = (category) => {
    const colors = {
      filmmaker: 'bg-purple-100 text-purple-800',
      press: 'bg-blue-100 text-blue-800',
      guest: 'bg-green-100 text-green-800',
      staff: 'bg-orange-100 text-orange-800'
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[category] || 'bg-blue-100 text-blue-800'}`}>
        {category.charAt(0).toUpperCase() + category.slice(1)}
      </span>
    )
  }

  const getFilteredAndSortedInvitations = () => {
    return invitations
      .filter(invitation => {
        // Filter by category
        if (filterCategory && invitation.guest?.category !== filterCategory) {
          return false
        }
        
        // Filter by status
        if (filterStatus) {
          if (filterStatus === 'confirmed' && invitation.status !== 'confirmed') return false
          if (filterStatus === 'sent' && invitation.status !== 'sent') return false
          if (filterStatus === 'opened' && invitation.status !== 'opened') return false
          if (filterStatus === 'declined' && invitation.status !== 'declined') return false
        }
        
        return true
      })
      .sort((a, b) => {
        // First sort by category
        const categoryA = a.guest?.category || 'guest'
        const categoryB = b.guest?.category || 'guest'
        if (categoryA !== categoryB) {
          return categoryA.localeCompare(categoryB)
        }
        
        // Then sort by status (confirmed > opened > sent > declined)
        const getStatusPriority = (invitation) => {
          if (invitation.status === 'confirmed') return 0
          if (invitation.status === 'opened') return 1
          if (invitation.status === 'sent') return 2
          if (invitation.status === 'declined') return 3
          return 4
        }
        
        const statusDiff = getStatusPriority(a) - getStatusPriority(b)
        if (statusDiff !== 0) return statusDiff
        
        // Finally sort by name (first_name + last_name)
        const nameA = `${a.guest?.first_name || ''} ${a.guest?.last_name || ''}`.toLowerCase()
        const nameB = `${b.guest?.first_name || ''} ${b.guest?.last_name || ''}`.toLowerCase()
        return nameA.localeCompare(nameB)
      })
  }

  const getStatusBadge = (invitation) => {
    if (invitation.status === 'confirmed') {
      const confirmedDate = invitation.responded_at ? formatDate(invitation.responded_at) : null
      return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-1 sm:space-y-0">
          <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs whitespace-nowrap">Confirmed</span>
          {confirmedDate && (
            <span className="text-xs text-gray-600 whitespace-nowrap">• {confirmedDate}</span>
          )}
        </div>
      )
    } else if (invitation.status === 'sent') {
      const sentDate = formatDate(invitation.sent_at)
      return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-1 sm:space-y-0">
          <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs whitespace-nowrap">Sent</span>
          {sentDate && (
            <span className="text-xs text-gray-600 whitespace-nowrap">• {sentDate}</span>
          )}
        </div>
      )
    } else if (invitation.status === 'opened') {
      const openedDate = invitation.opened_at ? formatDate(invitation.opened_at) : null
      return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-1 sm:space-y-0">
          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs whitespace-nowrap">Opened</span>
          {openedDate && (
            <span className="text-xs text-gray-600 whitespace-nowrap">• {openedDate}</span>
          )}
        </div>
      )
    } else if (invitation.status === 'declined') {
      const declinedDate = invitation.responded_at ? formatDate(invitation.responded_at) : null
      return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-1 sm:space-y-0">
          <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs whitespace-nowrap">Declined</span>
          {declinedDate && (
            <span className="text-xs text-gray-600 whitespace-nowrap">• {declinedDate}</span>
          )}
        </div>
      )
    } else {
      return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs whitespace-nowrap">{invitation.status}</span>
    }
  }

  if (!selectedEdition) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">No Edition Selected</h2>
        <p className="text-gray-600 mb-6">Please select an edition from the homepage to view invitations.</p>
        <a
          href="/"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Go to Homepage
        </a>
      </div>
    )
  }

  if (loading) {
    return <div className="text-center py-8">Loading invitations...</div>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invitations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Guests are automatically assigned by adding the year tag "{selectedEdition.year}" to them
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
              <option value="sent">Sent</option>
              <option value="opened">Opened</option>
              <option value="declined">Declined</option>
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

      {!Array.isArray(invitations) || invitations.length === 0 ? (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No invitations yet</h3>
          <p className="text-gray-600 mb-4">Invitations will appear here once guests are invited to this edition.</p>
        </div>
      ) : getFilteredAndSortedInvitations().length === 0 ? (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No invitations match your filters</h3>
          <p className="text-gray-600 mb-4">Try adjusting your category or status filters to see more results.</p>
          <button
            onClick={() => {
              setFilterCategory('')
              setFilterStatus('')
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Guest
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Accommodation
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Array.isArray(invitations) && getFilteredAndSortedInvitations().map((invitation) => (
                  <tr key={invitation.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Avatar
                          photo={invitation.guest?.photo}
                          firstName={invitation.guest?.first_name}
                          lastName={invitation.guest?.last_name}
                          size="sm"
                        />
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {invitation.guest?.first_name} {invitation.guest?.last_name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {invitation.guest?.company}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{invitation.guest?.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getCategoryBadge(invitation.guest?.category || 'guest')}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(invitation)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {invitation.accommodation ? (
                        <span className="text-green-600">
                          {invitation.covered_nights} {invitation.covered_nights === 1 ? 'night' : 'nights'}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            setSelectedInvitation(invitation)
                            setShowDetails(true)
                          }}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => handleResendInvitation(invitation.id)}
                          className="text-green-600 hover:text-green-900"
                        >
                          Resend
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {showDetails && selectedInvitation && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-1/2 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Invitation Details
                </h3>
                <button
                  onClick={() => setShowDetails(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <Avatar
                    photo={selectedInvitation.guest?.photo}
                    firstName={selectedInvitation.guest?.first_name}
                    lastName={selectedInvitation.guest?.last_name}
                    size="md"
                  />
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">
                      {selectedInvitation.guest?.first_name} {selectedInvitation.guest?.last_name}
                    </h4>
                    <p className="text-gray-500">{selectedInvitation.guest?.email}</p>
                    {selectedInvitation.guest?.company && (
                      <p className="text-gray-500">{selectedInvitation.guest?.company}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Category</label>
                    {getCategoryBadge(selectedInvitation.guest?.category || 'guest')}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Status</label>
                    {getStatusBadge(selectedInvitation)}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Accommodation</label>
                    <p className="text-sm text-gray-900">
                      {selectedInvitation.accommodation ? (
                        <span className="text-green-600">
                          {selectedInvitation.covered_nights} {selectedInvitation.covered_nights === 1 ? 'night' : 'nights'} covered
                        </span>
                      ) : (
                        <span className="text-gray-500">Not provided</span>
                      )}
                    </p>
                  </div>
                  {selectedInvitation.opened_at && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Opened Date</label>
                      <p className="text-sm text-gray-900">{formatDate(selectedInvitation.opened_at)}</p>
                    </div>
                  )}
                  {selectedInvitation.responded_at && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Responded Date</label>
                      <p className="text-sm text-gray-900">{formatDate(selectedInvitation.responded_at)}</p>
                    </div>
                  )}
                </div>

                {selectedInvitation.token && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Invitation Link</label>
                    <div className="mt-1 flex">
                      <input
                        type="text"
                        value={`${window.location.origin}/confirm/${selectedInvitation.token}`}
                        readOnly
                        className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 text-sm"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/confirm/${selectedInvitation.token}`)
                          success('Link copied to clipboard!')
                        }}
                        className="px-4 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-sm hover:bg-gray-200"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-between">
                <button
                  onClick={() => handleDeleteInvitation(selectedInvitation.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Delete Invitation
                </button>
                <div className="space-x-2">
                  <button
                    onClick={() => handleResendInvitation(selectedInvitation.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    Resend Invitation
                  </button>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Invitations