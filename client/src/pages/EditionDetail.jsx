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
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [selectedGuest, setSelectedGuest] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('guest')
  const [showInvitationDialog, setShowInvitationDialog] = useState(false)
  const [selectedGuestForInvitation, setSelectedGuestForInvitation] = useState(null)

  const categories = ['filmmaker', 'press', 'guest', 'staff']

  useEffect(() => {
    fetchEditionData()
  }, [id])

  const fetchEditionData = async () => {
    try {
      const [editionResponse, assignedResponse, allGuestsResponse] = await Promise.all([
        editionApi.getById(id),
        editionApi.getGuests(id),
        guestApi.getAll()
      ])
      
      setEdition(editionResponse.data)
      setAssignedGuests(assignedResponse.data)
      setAllGuests(allGuestsResponse.data)
    } catch (error) {
      console.error('Error fetching edition data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAssignGuest = async (e) => {
    e.preventDefault()
    try {
      await editionApi.assignGuest(id, {
        guest_id: selectedGuest,
        category: selectedCategory
      })
      await fetchEditionData()
      resetAssignForm()
    } catch (error) {
      console.error('Error assigning guest:', error)
    }
  }

  const handleRemoveGuest = async (assignmentId) => {
    if (window.confirm('Are you sure you want to remove this guest from the edition?')) {
      try {
        await editionApi.removeGuest(id, assignmentId)
        await fetchEditionData()
      } catch (error) {
        console.error('Error removing guest:', error)
      }
    }
  }

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

  const resetAssignForm = () => {
    setSelectedGuest('')
    setSelectedCategory('guest')
    setShowAssignForm(false)
  }

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

  const availableGuests = allGuests.filter(
    guest => !assignedGuests.some(assigned => assigned.id === guest.id)
  )

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
        <h2 className="text-lg font-medium">Assigned Guests ({assignedGuests.length})</h2>
        <button
          onClick={() => setShowAssignForm(true)}
          disabled={availableGuests.length === 0}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          Assign Guest
        </button>
      </div>

      {showAssignForm && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium mb-4">Assign Guest to Edition</h3>
          <form onSubmit={handleAssignGuest} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Guest</label>
              <select
                required
                value={selectedGuest}
                onChange={(e) => setSelectedGuest(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">Select a guest</option>
                {availableGuests.map((guest) => (
                  <option key={guest.id} value={guest.id}>
                    {guest.name} ({guest.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
              >
                Assign Guest
              </button>
              <button
                type="button"
                onClick={resetAssignForm}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

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
              {assignedGuests.map((guest) => (
                <tr key={guest.assignment_id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {guest.name}
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
                      <button
                        onClick={() => handleRemoveGuest(guest.assignment_id)}
                        className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {assignedGuests.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No guests assigned yet</h3>
          <p className="text-gray-600 mb-4">Start by assigning guests to this edition</p>
          {availableGuests.length > 0 ? (
            <button
              onClick={() => setShowAssignForm(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              Assign First Guest
            </button>
          ) : (
            <p className="text-gray-500">No guests available. Please add guests first.</p>
          )}
        </div>
      )}

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