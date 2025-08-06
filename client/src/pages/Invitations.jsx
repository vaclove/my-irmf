import { useState, useEffect } from 'react'
import { useEdition } from '../contexts/EditionContext'
import { invitationApi, badgeApi, guestApi, accommodationApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import { printBadge } from '../utils/badgePrinter'
import Avatar from '../components/Avatar'
import InvitationDialog from '../components/InvitationDialog'
import Modal from '../components/Modal'
import GuestModal from '../components/GuestModal'

function Invitations() {
  const { selectedEdition } = useEdition()
  const { success, error: showError } = useToast()
  const [invitations, setInvitations] = useState([])
  const [assignedNotInvited, setAssignedNotInvited] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingAssigned, setLoadingAssigned] = useState(true)
  const [selectedInvitation, setSelectedInvitation] = useState(null)
  const [showDetails, setShowDetails] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedGuestForInvitation, setSelectedGuestForInvitation] = useState(null)
  const [showInvitationDialog, setShowInvitationDialog] = useState(false)
  const [editingGuest, setEditingGuest] = useState(null)
  const [showGuestForm, setShowGuestForm] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [condensedView, setCondensedView] = useState(() => {
    return localStorage.getItem('invitationsCondensedView') === 'true'
  })
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  
  // Room assignment states
  const [roomAssignments, setRoomAssignments] = useState([])
  const [showRoomAssignmentModal, setShowRoomAssignmentModal] = useState(false)
  const [selectedInvitationForRoom, setSelectedInvitationForRoom] = useState(null)
  const [availableRooms, setAvailableRooms] = useState([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [assigningRoom, setAssigningRoom] = useState(false)
  
  // Accommodation date editing states
  const [editingAccommodationDates, setEditingAccommodationDates] = useState(false)
  const [selectedAccommodationDates, setSelectedAccommodationDates] = useState([])
  const [savingDates, setSavingDates] = useState(false)
  
  // Tab and rooming list states
  const [activeTab, setActiveTab] = useState('invitations')
  const [roomingData, setRoomingData] = useState([])
  const [loadingRoomingData, setLoadingRoomingData] = useState(false)

  useEffect(() => {
    if (selectedEdition) {
      fetchInvitations()
      fetchAssignedNotInvited()
      fetchRoomAssignments()
    } else {
      setLoading(false)
      setLoadingAssigned(false)
    }
  }, [selectedEdition])

  // Handle Escape key for details modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showDetails) {
        setShowDetails(false)
      }
    }

    if (showDetails) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showDetails])

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

  const fetchAssignedNotInvited = async () => {
    try {
      const response = await invitationApi.getAssignedNotInvited(selectedEdition.id)
      setAssignedNotInvited(response.data.data || [])
    } catch (error) {
      console.error('Error fetching assigned but not invited guests:', error)
      showError('Failed to load assigned guests')
      setAssignedNotInvited([]) // Ensure it's always an array
    } finally {
      setLoadingAssigned(false)
    }
  }

  const fetchRoomAssignments = async () => {
    try {
      const response = await accommodationApi.getAssignments(selectedEdition.id)
      setRoomAssignments(response.data.assignments || [])
    } catch (error) {
      console.error('Error fetching room assignments:', error)
      setRoomAssignments([])
    }
  }

  const fetchRoomingData = async () => {
    if (!selectedEdition) return
    
    setLoadingRoomingData(true)
    try {
      // Fetch room assignments and get hotel/room type info
      const assignmentsResponse = await accommodationApi.getAssignments(selectedEdition.id)
      const assignments = assignmentsResponse.data.assignments || []
      
      // Get unique room types from assignments to fetch availability data
      const roomTypeIds = [...new Set(assignments.map(a => a.room_type_id))].filter(Boolean)
      
      // Fetch availability data for each room type during the edition period
      // Extend end_date by 1 day to include the full last day
      const endDate = new Date(selectedEdition.end_date)
      endDate.setDate(endDate.getDate() + 1)
      const extendedEndDate = endDate.toISOString()
      
      const availabilityPromises = roomTypeIds.map(roomTypeId => 
        accommodationApi.getAvailability(roomTypeId, {
          start_date: selectedEdition.start_date,
          end_date: extendedEndDate
        })
      )
      
      const availabilityResponses = await Promise.all(availabilityPromises)
      
      // Create availability lookup map
      const availabilityMap = new Map()
      availabilityResponses.forEach(response => {
        const availData = response.data.availability || []
        availData.forEach(avail => {
          const key = `${avail.hotel_name}-${avail.room_type_name}`
          if (!availabilityMap.has(key)) {
            availabilityMap.set(key, {})
          }
          // Store by date
          availabilityMap.get(key)[avail.available_date] = {
            total_rooms: avail.total_rooms || 0,
            reserved_rooms: avail.reserved_rooms || 0,
            available_rooms: avail.available_rooms || 0
          }
        })
      })

      // Group by hotel and room type
      const roomingMap = new Map()
      
      assignments.forEach(assignment => {
        const key = `${assignment.hotel_name}-${assignment.room_type_name}`
        if (!roomingMap.has(key)) {
          const availInfo = availabilityMap.get(key) || {}
          roomingMap.set(key, {
            hotel_name: assignment.hotel_name,
            room_type_name: assignment.room_type_name,
            guests: [],
            room_capacity: assignment.capacity || 1,
            availability_by_date: availInfo  // Store date-specific availability
          })
        }
        // Generate accommodation dates from check-in and check-out dates
        const accommodationDates = []
        if (assignment.check_in_date && assignment.check_out_date) {
          const checkIn = new Date(assignment.check_in_date + 'T12:00:00')
          const checkOut = new Date(assignment.check_out_date + 'T12:00:00')
          
          const currentDate = new Date(checkIn)
          while (currentDate < checkOut) { // Note: < not <= because checkout day is not included
            const year = currentDate.getFullYear()
            const month = String(currentDate.getMonth() + 1).padStart(2, '0')
            const day = String(currentDate.getDate()).padStart(2, '0')
            accommodationDates.push(`${year}-${month}-${day}`)
            currentDate.setDate(currentDate.getDate() + 1)
          }
        }
        
        const roomGroup = roomingMap.get(key)
        roomGroup.guests.push({
          guest_name: assignment.guest_name,
          accommodation_dates: accommodationDates,
          room_number: assignment.room_number || 'TBD'
        })
        
        // Store room capacity info (assuming all assignments of same room type have same capacity)
        if (!roomGroup.room_capacity) {
          roomGroup.room_capacity = assignment.capacity || 1
        }
      })
      
      setRoomingData(Array.from(roomingMap.values()))
    } catch (error) {
      console.error('Error fetching rooming data:', error)
      showError('Failed to load rooming data')
      setRoomingData([])
    } finally {
      setLoadingRoomingData(false)
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

  const handleSendInvitation = (guest) => {
    setSelectedGuestForInvitation(guest)
    setShowInvitationDialog(true)
  }

  const handleInvitationSent = () => {
    fetchInvitations()
    fetchAssignedNotInvited()
  }

  // Room assignment functions
  const handleAssignRoom = (invitation) => {
    setSelectedInvitationForRoom(invitation)
    setShowRoomAssignmentModal(true)
    fetchAvailableRooms(invitation)
  }

  const fetchAvailableRooms = async (invitation) => {
    if (!invitation.accommodation_dates || invitation.accommodation_dates.length === 0) {
      showError('No accommodation dates selected for this guest')
      return
    }

    setLoadingRooms(true)
    try {
      // Convert dates to proper format and sort
      const dates = invitation.accommodation_dates
        .map(date => {
          // Handle different date formats (Date objects, ISO strings, date strings)
          if (date instanceof Date) {
            return date.toISOString().split('T')[0]
          } else if (typeof date === 'string') {
            // Remove any time component and ensure it's just YYYY-MM-DD
            return date.split('T')[0]
          }
          return date
        })
        .sort()
      
      const checkInDate = dates[0]
      
      // Calculate checkout date by adding one day to the last accommodation date
      const lastDateStr = dates[dates.length - 1]
      const lastDate = new Date(lastDateStr + 'T12:00:00') // Use noon to avoid timezone issues
      lastDate.setDate(lastDate.getDate() + 1)
      const checkOutDate = lastDate.toISOString().split('T')[0]
      
      console.log('Fetching rooms for dates:', { checkInDate, checkOutDate, originalDates: invitation.accommodation_dates })
      
      const response = await accommodationApi.getAvailableRooms(selectedEdition.id, {
        check_in_date: checkInDate,
        check_out_date: checkOutDate
      })
      setAvailableRooms(response.data.hotels || [])
    } catch (error) {
      console.error('Error fetching available rooms:', error)
      showError('Failed to load available rooms')
      setAvailableRooms([])
    } finally {
      setLoadingRooms(false)
    }
  }

  const handleRoomAssignment = async (roomTypeId) => {
    if (!selectedInvitationForRoom || !roomTypeId) return

    setAssigningRoom(true)
    try {
      // Convert dates to proper format and sort
      const dates = selectedInvitationForRoom.accommodation_dates
        .map(date => {
          // Handle different date formats (Date objects, ISO strings, date strings)
          if (date instanceof Date) {
            return date.toISOString().split('T')[0]
          } else if (typeof date === 'string') {
            // Remove any time component and ensure it's just YYYY-MM-DD
            return date.split('T')[0]
          }
          return date
        })
        .sort()
      
      const checkInDate = dates[0]
      
      // Calculate checkout date by adding one day to the last accommodation date
      const lastDateStr = dates[dates.length - 1]
      const lastDate = new Date(lastDateStr + 'T12:00:00') // Use noon to avoid timezone issues
      lastDate.setDate(lastDate.getDate() + 1)
      const checkOutDate = lastDate.toISOString().split('T')[0]

      console.log('Assigning room for dates:', { checkInDate, checkOutDate, originalDates: selectedInvitationForRoom.accommodation_dates })

      await accommodationApi.assignRoom({
        invitation_id: selectedInvitationForRoom.id,
        room_type_id: roomTypeId,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        guests_count: 1
      })

      success('Room assigned successfully!')
      setShowRoomAssignmentModal(false)
      setSelectedInvitationForRoom(null)
      fetchRoomAssignments()
    } catch (error) {
      console.error('Error assigning room:', error)
      showError(error.response?.data?.error || 'Failed to assign room')
    } finally {
      setAssigningRoom(false)
    }
  }

  const handleCancelRoomAssignment = async (assignmentId) => {
    if (!confirm('Are you sure you want to cancel this room assignment?')) return

    try {
      await accommodationApi.cancelAssignment(assignmentId)
      success('Room assignment cancelled successfully!')
      fetchRoomAssignments()
    } catch (error) {
      console.error('Error cancelling room assignment:', error)
      showError('Failed to cancel room assignment')
    }
  }

  const getRoomAssignmentForInvitation = (invitationId) => {
    return roomAssignments.find(assignment => assignment.invitation_id === invitationId)
  }

  // Accommodation date editing functions
  const handleEditAccommodationDates = (invitation) => {
    setEditingAccommodationDates(true)
    setSelectedAccommodationDates(invitation.accommodation_dates || [])
  }

  const handleSaveAccommodationDates = async (invitationId) => {
    setSavingDates(true)
    try {
      await invitationApi.updateAccommodationDates(invitationId, selectedAccommodationDates)
      success('Accommodation dates updated successfully!')
      
      // Refresh the invitations to get updated dates
      await fetchInvitations()
      
      // Update the selectedInvitation if it's the one being edited
      if (selectedInvitation && selectedInvitation.id === invitationId) {
        setSelectedInvitation(prev => ({
          ...prev,
          accommodation_dates: selectedAccommodationDates
        }))
      }
      
      // Cancel any existing room assignment since dates changed
      const assignment = getRoomAssignmentForInvitation(invitationId)
      if (assignment) {
        await handleCancelRoomAssignment(assignment.id)
      }
      
      setEditingAccommodationDates(false)
    } catch (error) {
      console.error('Error updating accommodation dates:', error)
      showError(error.response?.data?.error || 'Failed to update accommodation dates')
    } finally {
      setSavingDates(false)
    }
  }

  const toggleAccommodationDate = (date) => {
    setSelectedAccommodationDates(prev => {
      if (prev.includes(date)) {
        // Removing a date - only allow if it's at the start or end of the range
        const sorted = [...prev].sort()
        const dateIndex = sorted.indexOf(date)
        
        // Allow removal only if it's the first or last date
        if (dateIndex === 0 || dateIndex === sorted.length - 1) {
          return prev.filter(d => d !== date)
        } else {
          // Schedule error to be shown after render
          setTimeout(() => showError('You can only remove dates from the beginning or end of the range'), 0)
          return prev
        }
      } else {
        // Adding a date - check if it maintains continuity
        if (prev.length === 0) {
          return [date]
        }
        
        const sorted = [...prev].sort()
        const newDates = [...sorted, date].sort()
        
        // Check if the new dates form a continuous range
        for (let i = 1; i < newDates.length; i++) {
          const prevDate = new Date(newDates[i - 1] + 'T12:00:00')
          const currDate = new Date(newDates[i] + 'T12:00:00')
          const dayDiff = (currDate - prevDate) / (1000 * 60 * 60 * 24)
          
          if (dayDiff !== 1) {
            // Schedule error to be shown after render
            setTimeout(() => showError('Please select continuous dates only'), 0)
            return prev
          }
        }
        
        return newDates
      }
    })
  }

  // Guest editing functions

  const handleEditGuest = (guest) => {
    setEditingGuest(guest)
    setShowGuestForm(true)
  }



  const handlePrintBadge = async (guestId) => {
    try {
      // Get badge print data from API
      const response = await badgeApi.getPrintData(guestId, selectedEdition.id);
      const { layout, guest } = response.data;

      // Generate and download PDF
      await printBadge(layout, guest, selectedEdition.year);
      success('Badge PDF generated successfully!');
      
    } catch (error) {
      console.error('Error printing badge:', error);
      if (error.response?.status === 404) {
        const errorMsg = error.response.data?.error || 'Badge data not found';
        if (errorMsg.includes('badge layout assigned')) {
          showError('No badge layout assigned to this guest category. Please configure badge settings first.');
        } else if (errorMsg.includes('Guest not found') || errorMsg.includes('not assigned to this edition')) {
          showError('Guest not found or not assigned to this edition. Please send invitation first.');
        } else {
          showError(errorMsg);
        }
      } else if (error.response?.status === 400) {
        const errorMsg = error.response.data?.error || 'Badge printing error';
        if (errorMsg.includes('no category assigned')) {
          showError('Guest has no category assigned. Please edit guest to assign a category.');
        } else {
          showError(errorMsg);
        }
      } else {
        showError('Failed to print badge. Please try again.');
      }
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
    if (!dateString) return ''
    
    // Handle timezone-safe date formatting
    if (dateString.includes('T')) {
      // Already has time component (timestamp)
      return new Date(dateString).toLocaleDateString()
    } else {
      // Date only string, add noon time to avoid timezone shift
      const date = new Date(dateString + 'T12:00:00');
      return date.toLocaleDateString()
    }
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

  const toggleCondensedView = () => {
    const newValue = !condensedView
    setCondensedView(newValue)
    localStorage.setItem('invitationsCondensedView', newValue.toString())
  }

  const getFilteredAndSortedInvitations = () => {
    return invitations
      .filter(invitation => {
        // Filter by search query
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim()
          const fullName = `${invitation.guest?.first_name || ''} ${invitation.guest?.last_name || ''}`.toLowerCase()
          const email = (invitation.guest?.email || '').toLowerCase()
          const company = (invitation.guest?.company || '').toLowerCase()
          if (!fullName.includes(query) && !email.includes(query) && !company.includes(query)) {
            return false
          }
        }
        
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
    if (invitation.status === 'badge_printed') {
      const printedDate = invitation.badge_printed_at ? formatDate(invitation.badge_printed_at) : null
      return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2 space-y-1 sm:space-y-0">
          <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs whitespace-nowrap">Badge Printed</span>
          {printedDate && (
            <span className="text-xs text-gray-600 whitespace-nowrap">• {printedDate}</span>
          )}
        </div>
      )
    } else if (invitation.status === 'confirmed') {
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
          <h1 className="text-2xl font-bold text-gray-900">Invitations & Rooming</h1>
          <p className="text-sm text-gray-500 mt-1">
            Guests are automatically assigned by adding the year tag "{selectedEdition.year}" to them
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <nav className="flex space-x-8 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('invitations')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'invitations'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Invitations
          </button>
          <button
            onClick={() => {
              setActiveTab('rooming')
              if (roomingData.length === 0) {
                fetchRoomingData()
              }
            }}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'rooming'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Rooming
          </button>
        </nav>
      </div>

      {/* Invitations Tab Content */}
      {activeTab === 'invitations' && (
        <>
          {/* Search and Filter Controls */}
          <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-medium text-gray-700">Search & Filters</h3>
          <div className="relative column-settings-container">
              <button
                onClick={() => setShowColumnSettings(!showColumnSettings)}
                className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 002 2m0 0v10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2z" />
                </svg>
                <span>Settings</span>
              </button>
            {showColumnSettings && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 z-10">
                <div className="p-3">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Table Settings</h4>
                  <div className="mb-3">
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
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search guests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
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
                setSearchQuery('')
                setFilterCategory('')
                setFilterStatus('')
              }}
              className="bg-gray-200 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-300 text-sm"
            >
              Clear All
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
          <p className="text-gray-600 mb-4">Try adjusting your search or filters to see more results.</p>
          <button
            onClick={() => {
              setSearchQuery('')
              setFilterCategory('')
              setFilterStatus('')
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
          >
            Clear All
          </button>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium">
              {(searchQuery.trim() || filterCategory || filterStatus) ? `Filtered Invitations (${getFilteredAndSortedInvitations().length}/${invitations.length})` : `All Invitations (${invitations.length})`}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Guest
                  </th>
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Email
                  </th>
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Category
                  </th>
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Status
                  </th>
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Accommodation
                  </th>
                  <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Array.isArray(invitations) && getFilteredAndSortedInvitations().map((invitation) => (
                  <tr key={invitation.id} className="hover:bg-gray-50">
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap`}>
                      <button
                        onClick={() => handleEditGuest(invitation.guest)}
                        className={`flex items-center text-left hover:bg-gray-50 rounded-md ${condensedView ? 'p-1 -m-1' : 'p-2 -m-2'} transition-colors w-full`}
                        title="Click to edit guest"
                      >
                        <Avatar
                          photo={invitation.guest?.photo}
                          firstName={invitation.guest?.first_name}
                          lastName={invitation.guest?.last_name}
                          size={condensedView ? "xs" : "sm"}
                        />
                        <div className={condensedView ? 'ml-2' : 'ml-4'}>
                          <div className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors flex items-center">
                            {invitation.guest?.first_name} {invitation.guest?.last_name}
                            {invitation.guest?.secondary_relationships && invitation.guest?.secondary_relationships.length > 0 && (
                              <span 
                                className="ml-2 inline-flex items-center text-xs font-medium text-blue-600"
                                title={`Related to: ${invitation.guest?.secondary_relationships.map(rel => 
                                  `${rel.primary_guest_name} (${rel.relationship_type} for ${rel.edition_year})`
                                ).join(', ')}`}
                              >
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <div className={`${condensedView ? 'text-xs' : 'text-sm'} text-gray-500`}>
                            {invitation.guest?.company}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap`}>
                      <div className="text-sm text-gray-900">{invitation.guest?.email}</div>
                    </td>
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap`}>
                      {getCategoryBadge(invitation.guest?.category || 'guest')}
                    </td>
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'}`}>
                      {getStatusBadge(invitation)}
                    </td>
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500`}>
                      {invitation.accommodation ? (
                        <div className="space-y-1">
                          {(() => {
                            const assignment = getRoomAssignmentForInvitation(invitation.id)
                            
                            // Format assigned dates
                            const formatDateRange = (checkIn, checkOut) => {
                              const startDate = new Date(checkIn + 'T12:00:00')
                              const endDate = new Date(checkOut + 'T12:00:00')
                              endDate.setDate(endDate.getDate() - 1) // Checkout is morning, so last night is day before
                              
                              const formatShort = (date) => {
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              }
                              
                              if (startDate.getMonth() === endDate.getMonth()) {
                                // Same month: "Oct 16-17"
                                return `${formatShort(startDate)}-${endDate.getDate()}`
                              } else {
                                // Different months: "Oct 31 - Nov 2"
                                return `${formatShort(startDate)} - ${formatShort(endDate)}`
                              }
                            }
                            
                            if (assignment) {
                              return (
                                <>
                                  <div className="text-green-600">
                                    {invitation.covered_nights} {invitation.covered_nights === 1 ? 'night' : 'nights'} • {formatDateRange(assignment.check_in_date, assignment.check_out_date)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {assignment.hotel_name} - {assignment.room_type_name}
                                  </div>
                                </>
                              )
                            } else if (invitation.status === 'confirmed' && invitation.accommodation_dates?.length > 0) {
                              return (
                                <>
                                  <div className="text-green-600">
                                    {invitation.covered_nights} {invitation.covered_nights === 1 ? 'night' : 'nights'}
                                  </div>
                                  <button
                                    onClick={() => handleAssignRoom(invitation)}
                                    className="text-xs bg-red-700 text-white px-3 py-1 rounded hover:bg-red-800 transition-colors font-medium"
                                  >
                                    Assign Room
                                  </button>
                                </>
                              )
                            } else if (invitation.status === 'confirmed') {
                              return (
                                <>
                                  <div className="text-green-600">
                                    {invitation.covered_nights} {invitation.covered_nights === 1 ? 'night' : 'nights'}
                                  </div>
                                  <div className="text-xs text-amber-600">
                                    No dates selected
                                  </div>
                                </>
                              )
                            } else {
                              return (
                                <div className="text-green-600">
                                  {invitation.covered_nights} {invitation.covered_nights === 1 ? 'night' : 'nights'}
                                </div>
                              )
                            }
                          })()}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap text-sm font-medium`}>
                      <div className={`flex ${condensedView ? 'space-x-1' : 'space-x-2'}`}>
                        <button
                          onClick={() => {
                            setSelectedInvitation(invitation)
                            setShowDetails(true)
                          }}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Details
                        </button>
                        {!invitation.badge_printed_at && (
                          <button
                            onClick={() => handlePrintBadge(invitation.guest_id)}
                            className="text-purple-600 hover:text-purple-900"
                          >
                            Print Badge
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assigned but Not Invited Guests Section */}
      {selectedEdition && (
        <div className="mt-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Assigned but Not Invited</h2>
          </div>

          {loadingAssigned ? (
            <div className="text-center py-8">Loading assigned guests...</div>
          ) : !Array.isArray(assignedNotInvited) || assignedNotInvited.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-900">All assigned guests have been invited</h3>
            </div>
          ) : (
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                        Guest
                      </th>
                      <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                        Email
                      </th>
                      <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                        Category
                      </th>
                      <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                        Notes
                      </th>
                      <th className={`${condensedView ? 'px-3 py-2' : 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase ${condensedView ? '' : 'tracking-wider'}`}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {assignedNotInvited.map((guest) => (
                      <tr key={guest.id} className="hover:bg-gray-50">
                        <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap`}>
                          <button
                            onClick={() => handleEditGuest(guest)}
                            className={`flex items-center text-left hover:bg-gray-50 rounded-md ${condensedView ? 'p-1 -m-1' : 'p-2 -m-2'} transition-colors w-full`}
                            title="Click to edit guest"
                          >
                            <Avatar
                              photo={guest.photo}
                              firstName={guest.first_name}
                              lastName={guest.last_name}
                              size={condensedView ? "xs" : "sm"}
                            />
                            <div className={condensedView ? 'ml-2' : 'ml-4'}>
                              <div className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors flex items-center">
                                {guest.first_name} {guest.last_name}
                                {guest.secondary_relationships && guest.secondary_relationships.length > 0 && (
                                  <span 
                                    className="ml-2 inline-flex items-center text-xs font-medium text-blue-600"
                                    title={`Related to: ${guest.secondary_relationships.map(rel => 
                                      `${rel.primary_guest_name} (${rel.relationship_type} for ${rel.edition_year})`
                                    ).join(', ')}`}
                                  >
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                                    </svg>
                                  </span>
                                )}
                              </div>
                              <div className={`${condensedView ? 'text-xs' : 'text-sm'} text-gray-500`}>
                                {guest.company}
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap`}>
                          <div className="text-sm text-gray-900">{guest.email}</div>
                        </td>
                        <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap`}>
                          {getCategoryBadge(guest.category)}
                        </td>
                        <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} text-sm text-gray-500 max-w-xs`}>
                          <div className="truncate" title={guest.notes}>
                            {guest.notes || '-'}
                          </div>
                        </td>
                        <td className={`${condensedView ? 'px-3 py-2' : 'px-6 py-4'} whitespace-nowrap text-sm font-medium`}>
                          <button
                            onClick={() => handleSendInvitation(guest)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Send Invitation
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Rooming Tab Content */}
      {activeTab === 'rooming' && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="mb-4">
            <h3 className="text-lg font-medium text-gray-900">Rooming List</h3>
          </div>

          {loadingRoomingData ? (
            <div className="text-center py-8">
              <div className="text-gray-600">Loading rooming data...</div>
            </div>
          ) : roomingData.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-600">No room assignments found</div>
            </div>
          ) : (
            <div className="space-y-6">
              {roomingData.map((roomGroup, groupIndex) => {
                // Get all dates from the edition period
                const editionDates = []
                if (selectedEdition?.start_date && selectedEdition?.end_date) {
                  const adjustDateIfNeeded = (dateStr, isoStr) => {
                    if (isoStr && isoStr.includes('T')) {
                      const date = new Date(isoStr)
                      const year = date.getFullYear()
                      const month = String(date.getMonth() + 1).padStart(2, '0')
                      const day = String(date.getDate()).padStart(2, '0')
                      return `${year}-${month}-${day}`
                    }
                    return dateStr
                  }
                  
                  const startDateStr = adjustDateIfNeeded(selectedEdition.start_date, selectedEdition.start_date)
                  const endDateStr = adjustDateIfNeeded(selectedEdition.end_date, selectedEdition.end_date)
                  
                  const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number)
                  const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number)
                  
                  const currentDate = new Date(startYear, startMonth - 1, startDay)
                  const endDate = new Date(endYear, endMonth - 1, endDay)
                  
                  while (currentDate <= endDate) {
                    const year = currentDate.getFullYear()
                    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
                    const day = String(currentDate.getDate()).padStart(2, '0')
                    editionDates.push(`${year}-${month}-${day}`)
                    currentDate.setDate(currentDate.getDate() + 1)
                  }
                }
                
                const sortedDates = editionDates

                return (
                  <div key={groupIndex} className="border border-gray-200 rounded-lg p-4">
                    <h4 className="text-md font-medium text-gray-900 mb-3">
                      {roomGroup.hotel_name} - {roomGroup.room_type_name}
                    </h4>
                    
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Guest
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Room
                            </th>
                            {sortedDates.map(date => {
                              const dateObj = new Date(date + 'T12:00:00')
                              return (
                                <th key={date} className="px-1 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider min-w-16">
                                  <div className="flex flex-col">
                                    <div>{dateObj.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                                    <div>{dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                  </div>
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {roomGroup.guests.map((guest, guestIndex) => (
                            <tr key={guestIndex} className="hover:bg-gray-50">
                              <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                {guest.guest_name}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                {guest.room_number}
                              </td>
                              {sortedDates.map(date => {
                                const hasDate = guest.accommodation_dates && Array.isArray(guest.accommodation_dates) ? guest.accommodation_dates.includes(date) : false
                                
                                return (
                                  <td key={date} className="px-1 py-2 text-center">
                                    {hasDate ? (
                                      <div className="w-8 h-8 bg-green-500 rounded-md mx-auto flex items-center justify-center" title={`${guest.guest_name} staying on ${date}`}>
                                        <div className="w-4 h-4 bg-white rounded-full"></div>
                                      </div>
                                    ) : (
                                      <div className="w-8 h-8 bg-gray-100 rounded-md mx-auto border border-gray-300"></div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t border-gray-200">
                          <tr>
                            <td className="px-4 py-2 text-sm font-medium text-gray-700" colSpan="2">
                              Occupancy
                            </td>
                            {sortedDates.map(date => {
                              const occupiedCount = roomGroup.guests.filter(guest => 
                                guest.accommodation_dates && Array.isArray(guest.accommodation_dates) && 
                                guest.accommodation_dates.includes(date)
                              ).length
                              
                              // Get total rooms for this specific date
                              const dateAvailability = roomGroup.availability_by_date[date]
                              const totalRooms = dateAvailability ? dateAvailability.total_rooms : 0
                              const freeCount = totalRooms - occupiedCount
                              
                              return (
                                <td key={date} className="px-1 py-2 text-center text-xs text-gray-600">
                                  <span className="text-green-600 font-medium">{occupiedCount}</span>
                                  <span className="text-gray-400"> / {totalRooms}</span>
                                </td>
                              )
                            })}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Details Modal */}
      {showDetails && selectedInvitation && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
          onClick={() => {
            setShowDetails(false)
            setEditingAccommodationDates(false)
          }}
        >
          <div 
            className="relative top-20 mx-auto p-5 border w-11/12 md:w-1/2 shadow-lg rounded-md bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mt-3">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Invitation Details
                </h3>
                <button
                  onClick={() => {
                    setShowDetails(false)
                    setEditingAccommodationDates(false)
                  }}
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
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Accommodation</label>
                    {selectedInvitation.accommodation ? (
                      <div className="mt-1 space-y-2">
                        <p className="text-sm text-green-600">
                          {selectedInvitation.covered_nights} {selectedInvitation.covered_nights === 1 ? 'night' : 'nights'} covered
                        </p>
                        
                        {editingAccommodationDates ? (
                          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3">
                            <div className="text-sm text-blue-700 font-medium">
                              Select continuous accommodation dates (max {selectedInvitation.covered_nights} nights):
                            </div>
                            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                              {(() => {
                                // Get edition dates
                                if (!selectedEdition?.start_date || !selectedEdition?.end_date) {
                                  return []
                                }
                                
                                // Generate dates between start and end
                                const startDateStr = selectedEdition.start_date
                                const endDateStr = selectedEdition.end_date
                                
                                // Extract just the date part (handle both ISO datetime strings and date-only strings)
                                const startDateOnly = startDateStr.includes('T') ? startDateStr.split('T')[0] : startDateStr
                                const endDateOnly = endDateStr.includes('T') ? endDateStr.split('T')[0] : endDateStr
                                
                                // For ISO datetime strings, we need to convert from UTC to local date
                                // The issue is that "2025-10-15T22:00:00.000Z" represents 2025-10-16 in local time (UTC+2)
                                const adjustDateIfNeeded = (dateStr, isoStr) => {
                                  if (isoStr.includes('T')) {
                                    // This is an ISO string - parse it as local time and get the date
                                    const date = new Date(isoStr)
                                    const year = date.getFullYear()
                                    const month = String(date.getMonth() + 1).padStart(2, '0')
                                    const day = String(date.getDate()).padStart(2, '0')
                                    return `${year}-${month}-${day}`
                                  }
                                  return dateStr
                                }
                                
                                const correctedStartDate = adjustDateIfNeeded(startDateOnly, startDateStr)
                                const correctedEndDate = adjustDateIfNeeded(endDateOnly, endDateStr)
                                
                                // Generate date range using corrected dates
                                const dates = []
                                const [startYear, startMonth, startDay] = correctedStartDate.split('-').map(Number)
                                const [endYear, endMonth, endDay] = correctedEndDate.split('-').map(Number)
                                
                                const currentDate = new Date(startYear, startMonth - 1, startDay)
                                const endDate = new Date(endYear, endMonth - 1, endDay)
                                
                                while (currentDate <= endDate) {
                                  const year = currentDate.getFullYear()
                                  const month = String(currentDate.getMonth() + 1).padStart(2, '0')
                                  const day = String(currentDate.getDate()).padStart(2, '0')
                                  dates.push(`${year}-${month}-${day}`)
                                  currentDate.setDate(currentDate.getDate() + 1)
                                }
                                
                                return dates.map(date => {
                                  const isSelected = selectedAccommodationDates.includes(date)
                                  const isDisabled = !isSelected && selectedAccommodationDates.length >= selectedInvitation.covered_nights
                                  
                                  return (
                                    <button
                                      key={date}
                                      type="button"
                                      onClick={() => !isDisabled && toggleAccommodationDate(date)}
                                      disabled={isDisabled}
                                      className={`
                                        px-2 py-1 rounded text-xs
                                        ${isSelected 
                                          ? 'bg-blue-600 text-white' 
                                          : isDisabled
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }
                                      `}
                                    >
                                      {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { 
                                        month: 'short', 
                                        day: 'numeric' 
                                      })}
                                    </button>
                                  )
                                })
                              })()}
                            </div>
                            <div className="flex justify-end gap-2 pt-3 border-t border-blue-300">
                              <button
                                onClick={() => handleSaveAccommodationDates(selectedInvitation.id)}
                                disabled={savingDates || selectedAccommodationDates.length === 0}
                                className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                {savingDates ? (
                                  <span className="flex items-center justify-center">
                                    <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Saving...
                                  </span>
                                ) : (
                                  'Save Dates'
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingAccommodationDates(false)
                                  setSelectedAccommodationDates(selectedInvitation.accommodation_dates || [])
                                }}
                                className="text-sm bg-gray-300 text-gray-700 px-3 py-1 rounded hover:bg-gray-400"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {selectedEdition?.start_date && selectedEdition?.end_date ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-gray-600">
                                    Accommodation dates ({selectedInvitation.accommodation_dates?.length || 0} selected):
                                  </p>
                                  <button
                                    onClick={() => handleEditAccommodationDates(selectedInvitation)}
                                    className="text-sm text-blue-600 hover:text-blue-800"
                                  >
                                    Edit Dates
                                  </button>
                                </div>
                                <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto">
                                  {(() => {
                                    // Generate all edition dates (same logic as editing mode)
                                    if (!selectedEdition?.start_date || !selectedEdition?.end_date) {
                                      return []
                                    }
                                    
                                    const startDateStr = selectedEdition.start_date
                                    const endDateStr = selectedEdition.end_date
                                    
                                    const startDateOnly = startDateStr.includes('T') ? startDateStr.split('T')[0] : startDateStr
                                    const endDateOnly = endDateStr.includes('T') ? endDateStr.split('T')[0] : endDateStr
                                    
                                    const adjustDateIfNeeded = (dateStr, isoStr) => {
                                      if (isoStr.includes('T')) {
                                        const date = new Date(isoStr)
                                        const year = date.getFullYear()
                                        const month = String(date.getMonth() + 1).padStart(2, '0')
                                        const day = String(date.getDate()).padStart(2, '0')
                                        return `${year}-${month}-${day}`
                                      }
                                      return dateStr
                                    }
                                    
                                    const correctedStartDate = adjustDateIfNeeded(startDateOnly, startDateStr)
                                    const correctedEndDate = adjustDateIfNeeded(endDateOnly, endDateStr)
                                    
                                    const dates = []
                                    const [startYear, startMonth, startDay] = correctedStartDate.split('-').map(Number)
                                    const [endYear, endMonth, endDay] = correctedEndDate.split('-').map(Number)
                                    
                                    const currentDate = new Date(startYear, startMonth - 1, startDay)
                                    const endDate = new Date(endYear, endMonth - 1, endDay)
                                    
                                    while (currentDate <= endDate) {
                                      const year = currentDate.getFullYear()
                                      const month = String(currentDate.getMonth() + 1).padStart(2, '0')
                                      const day = String(currentDate.getDate()).padStart(2, '0')
                                      dates.push(`${year}-${month}-${day}`)
                                      currentDate.setDate(currentDate.getDate() + 1)
                                    }
                                    
                                    return dates.map(date => {
                                      const isSelected = selectedInvitation.accommodation_dates?.includes(date)
                                      return (
                                        <div
                                          key={date}
                                          className={`px-2 py-1 rounded text-xs text-center ${
                                            isSelected 
                                              ? 'bg-green-100 text-green-800 font-medium' 
                                              : 'bg-gray-100 text-gray-500'
                                          }`}
                                        >
                                          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { 
                                            month: 'short', 
                                            day: 'numeric' 
                                          })}
                                        </div>
                                      )
                                    })
                                  })()}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <p className="text-sm text-amber-600">No dates selected</p>
                                <button
                                  onClick={() => handleEditAccommodationDates(selectedInvitation)}
                                  className="text-sm text-blue-600 hover:text-blue-800"
                                >
                                  Select Dates
                                </button>
                              </div>
                            )}
                          </>
                        )}
                        {(() => {
                          const assignment = getRoomAssignmentForInvitation(selectedInvitation.id)
                          if (assignment) {
                            const formatDateRange = (checkIn, checkOut) => {
                              const startDate = new Date(checkIn + 'T12:00:00')
                              const endDate = new Date(checkOut + 'T12:00:00')
                              endDate.setDate(endDate.getDate() - 1)
                              
                              const formatLong = (date) => {
                                return date.toLocaleDateString('en-US', { 
                                  weekday: 'short',
                                  month: 'short', 
                                  day: 'numeric',
                                  year: 'numeric'
                                })
                              }
                              
                              return `${formatLong(startDate)} - ${formatLong(endDate)}`
                            }
                            
                            return (
                              <div className="mt-3 p-3 bg-blue-50 rounded-md">
                                <h5 className="text-sm font-medium text-gray-900 mb-2">Room Assignment</h5>
                                <p className="text-sm text-gray-700">
                                  <strong>Hotel:</strong> {assignment.hotel_name}
                                </p>
                                <p className="text-sm text-gray-700">
                                  <strong>Room Type:</strong> {assignment.room_type_name}
                                </p>
                                <p className="text-sm text-gray-700">
                                  <strong>Dates:</strong> {formatDateRange(assignment.check_in_date, assignment.check_out_date)}
                                </p>
                                <button
                                  onClick={() => handleCancelRoomAssignment(assignment.id)}
                                  className="mt-3 text-sm text-red-600 hover:text-red-800 font-medium"
                                >
                                  Cancel Room Assignment
                                </button>
                              </div>
                            )
                          } else if (selectedInvitation.status === 'confirmed' && selectedInvitation.accommodation_dates?.length > 0) {
                            return (
                              <button
                                onClick={() => {
                                  setShowDetails(false)
                                  handleAssignRoom(selectedInvitation)
                                }}
                                className="mt-2 text-sm bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 font-medium"
                              >
                                Assign Room
                              </button>
                            )
                          }
                          return null
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 mt-1">Not provided</p>
                    )}
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
                    onClick={() => handlePrintBadge(selectedInvitation.guest_id)}
                    className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                  >
                    Print Badge
                  </button>
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

      {/* Invitation Modal */}
      <InvitationDialog
        isOpen={showInvitationDialog}
        onClose={() => setShowInvitationDialog(false)}
        guest={selectedGuestForInvitation}
        edition={selectedEdition}
        onInvitationSent={handleInvitationSent}
      />

      {/* Guest Edit Modal */}
      <GuestModal
        isOpen={showGuestForm}
        onClose={() => {
          setShowGuestForm(false)
          setEditingGuest(null)
        }}
        guest={editingGuest}
        onUpdate={(updatedGuest) => {
          // Refresh invitations data to get updated guest info
          fetchInvitations()
          fetchAssignedNotInvited()
          setShowGuestForm(false)
          setEditingGuest(null)
        }}
        onDelete={(guestId) => {
          // Refresh data after guest deletion
          fetchInvitations()
          fetchAssignedNotInvited()
          setShowGuestForm(false)
          setEditingGuest(null)
        }}
      />
      {/* Room Assignment Modal */}
      <Modal
        isOpen={showRoomAssignmentModal}
        onClose={() => {
          setShowRoomAssignmentModal(false)
          setSelectedInvitationForRoom(null)
          setAvailableRooms([])
        }}
        title="Assign Room"
        size="large"
      >
        {selectedInvitationForRoom && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-md">
              <h4 className="font-medium text-gray-900 mb-2">Guest Information</h4>
              <div className="text-sm text-gray-600">
                <p><strong>Name:</strong> {selectedInvitationForRoom.guest?.first_name} {selectedInvitationForRoom.guest?.last_name}</p>
                <p><strong>Email:</strong> {selectedInvitationForRoom.guest?.email}</p>
                <p><strong>Accommodation Dates:</strong> {selectedInvitationForRoom.accommodation_dates?.join(', ')}</p>
                <p><strong>Nights:</strong> {selectedInvitationForRoom.covered_nights}</p>
              </div>
            </div>

            {loadingRooms ? (
              <div className="text-center py-8">
                <div className="text-gray-600">Loading available rooms...</div>
              </div>
            ) : availableRooms.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-gray-600">No rooms available for the selected dates</div>
              </div>
            ) : (
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">Available Rooms</h4>
                {availableRooms.map(hotel => (
                  <div key={hotel.hotel_id} className="border border-gray-200 rounded-md p-4">
                    <h5 className="font-medium text-gray-800 mb-3">{hotel.hotel_name}</h5>
                    <div className="space-y-2">
                      {hotel.room_types.map(roomType => (
                        <div key={roomType.room_type_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{roomType.room_type_name}</div>
                            <div className="text-sm text-gray-600">
                              Capacity: {roomType.capacity} guests • Available rooms: {roomType.available_rooms}
                              {roomType.price_per_night && (
                                <span> • {roomType.price_per_night} {roomType.currency}/night</span>
                              )}
                            </div>
                            {roomType.amenities && roomType.amenities.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                {roomType.amenities.join(', ')}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleRoomAssignment(roomType.room_type_id)}
                            disabled={assigningRoom}
                            className="ml-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {assigningRoom ? 'Assigning...' : 'Assign'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                onClick={() => {
                  setShowRoomAssignmentModal(false)
                  setSelectedInvitationForRoom(null)
                  setAvailableRooms([])
                }}
                className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Invitations