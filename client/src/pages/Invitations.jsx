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
  
  // Multi-guest room assignment states
  const [showMultiRoomModal, setShowMultiRoomModal] = useState(false)
  const [selectedGuestsForRoom, setSelectedGuestsForRoom] = useState([])
  const [primaryGuestId, setPrimaryGuestId] = useState(null)
  
  // Mass mailer states
  const [selectedInvitationsForEmail, setSelectedInvitationsForEmail] = useState([])
  const [showMassMailer, setShowMassMailer] = useState(false)
  const [massEmailContent, setMassEmailContent] = useState({ czech: '', english: '' })
  const [massEmailSubject, setMassEmailSubject] = useState({ czech: '', english: '' })
  const [sendingMassEmail, setSendingMassEmail] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [previewData, setPreviewData] = useState({ czech: null, english: null })
  
  
  // Accommodation date editing states
  const [editingAccommodationDates, setEditingAccommodationDates] = useState(false)
  const [selectedAccommodationDates, setSelectedAccommodationDates] = useState([])
  const [savingDates, setSavingDates] = useState(false)
  
  // Tab and rooming list states
  const [activeTab, setActiveTab] = useState('invitations')
  const [roomingData, setRoomingData] = useState([])
  const [loadingRoomingData, setLoadingRoomingData] = useState(false)
  
  // Room number editing states
  const [editingRoomNumber, setEditingRoomNumber] = useState(null)
  const [tempRoomNumber, setTempRoomNumber] = useState('')
  
  // Add guest to existing room states
  const [showAddToRoomModal, setShowAddToRoomModal] = useState(false)
  const [selectedRoomForGuest, setSelectedRoomForGuest] = useState(null)
  const [selectedGuestToAdd, setSelectedGuestToAdd] = useState(null)

  // Utility function to format date ranges
  const formatDateRange = (checkIn, checkOut) => {
    const startDate = new Date(checkIn + 'T12:00:00')
    const endDate = new Date(checkOut + 'T12:00:00')
    endDate.setDate(endDate.getDate() - 1) // Checkout is morning, so last night is day before
    
    return `${startDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })} - ${endDate.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    })}`
  }

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

      // Group by hotel and room type (original logic)
      const roomingMap = new Map()
      
      assignments.forEach(assignment => {
        const key = `${assignment.hotel_name}-${assignment.room_type_name}`
        
        if (!roomingMap.has(key)) {
          const availInfo = availabilityMap.get(key) || {}
          roomingMap.set(key, {
            hotel_name: assignment.hotel_name,
            room_type_name: assignment.room_type_name,
            room_capacity: assignment.capacity || 1,
            availability_by_date: availInfo,
            room_groups: [] // Array of room groups (individual or shared)
          })
        }
        
        const roomTypeGroup = roomingMap.get(key)
        
        // Find existing room group or create new one
        const roomGroupId = assignment.room_group_id || `individual_${assignment.id}`
        let roomGroup = roomTypeGroup.room_groups.find(rg => rg.group_id === roomGroupId)
        
        if (!roomGroup) {
          roomGroup = {
            group_id: roomGroupId,
            is_shared_room: !!assignment.room_group_id,
            guests: []
          }
          roomTypeGroup.room_groups.push(roomGroup)
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
        
        roomGroup.guests.push({
          guest_name: assignment.guest_name,
          accommodation_dates: accommodationDates,
          room_number: assignment.room_number || '',
          is_primary: assignment.is_primary_booking || false,
          email: assignment.email,
          assignment_id: assignment.id
        })
        
        // Sort guests so primary guest comes first
        roomGroup.guests.sort((a, b) => {
          if (a.is_primary && !b.is_primary) return -1
          if (!a.is_primary && b.is_primary) return 1
          return 0
        })
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

  const handleMultiGuestRoomAssignment = async (roomTypeId) => {
    if (!selectedGuestsForRoom.length || !roomTypeId || !primaryGuestId) return

    setAssigningRoom(true)
    try {
      // Get the primary guest's accommodation dates to use for all guests
      const primaryGuest = selectedGuestsForRoom.find(guest => guest.id === primaryGuestId)
      if (!primaryGuest || !primaryGuest.accommodation_dates?.length) {
        throw new Error('Primary guest must have accommodation dates selected')
      }

      // Convert dates to proper format and sort
      const dates = primaryGuest.accommodation_dates
        .map(date => {
          if (date instanceof Date) {
            return date.toISOString().split('T')[0]
          } else if (typeof date === 'string') {
            return date.split('T')[0]
          }
          return date
        })
        .sort()
      
      const checkInDate = dates[0]
      const lastDateStr = dates[dates.length - 1]
      const lastDate = new Date(lastDateStr + 'T12:00:00')
      lastDate.setDate(lastDate.getDate() + 1)
      const checkOutDate = lastDate.toISOString().split('T')[0]

      await accommodationApi.assignMultipleGuests({
        invitation_ids: selectedGuestsForRoom.map(guest => guest.id),
        room_type_id: roomTypeId,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        primary_invitation_id: primaryGuestId
      })

      success(`Successfully assigned ${selectedGuestsForRoom.length} guests to shared room!`)
      setShowMultiRoomModal(false)
      setSelectedGuestsForRoom([])
      setPrimaryGuestId(null)
      fetchRoomAssignments()
    } catch (error) {
      console.error('Error assigning multiple guests to room:', error)
      showError(error.response?.data?.error || 'Failed to assign guests to room')
    } finally {
      setAssigningRoom(false)
    }
  }

  const openMultiGuestRoomModal = () => {
    // Get guests with accommodation who don't have room assignments
    const availableGuests = invitations.filter(inv => 
      inv.accommodation && 
      inv.accommodation_dates?.length > 0 &&
      !roomAssignments.some(assignment => assignment.invitation_id === inv.id)
    )
    
    if (availableGuests.length === 0) {
      showError('No guests with accommodation are available for room assignment')
      return
    }

    setSelectedGuestsForRoom([])
    setPrimaryGuestId(null)
    setShowMultiRoomModal(true)
  }

  const toggleGuestSelection = (guest) => {
    setSelectedGuestsForRoom(prev => {
      const isSelected = prev.some(g => g.id === guest.id)
      if (isSelected) {
        const newSelection = prev.filter(g => g.id !== guest.id)
        // If we're removing the primary guest, reset primary selection
        if (guest.id === primaryGuestId) {
          setPrimaryGuestId(newSelection.length > 0 ? newSelection[0].id : null)
        }
        return newSelection
      } else {
        const newSelection = [...prev, guest]
        // If this is the first guest selected, make them primary
        if (newSelection.length === 1) {
          setPrimaryGuestId(guest.id)
        }
        return newSelection
      }
    })
  }

  const handleRoomNumberUpdate = async (assignmentId, newRoomNumber) => {
    try {
      await accommodationApi.updateRoomNumber(assignmentId, newRoomNumber)
      
      // Update the local state
      setRoomingData(prevData => 
        prevData.map(roomGroup => ({
          ...roomGroup,
          room_groups: roomGroup.room_groups.map(subGroup => ({
            ...subGroup,
            guests: subGroup.guests.map(guest =>
              guest.assignment_id === assignmentId
                ? { ...guest, room_number: newRoomNumber }
                : guest
            )
          }))
        }))
      )
      
      success('Room number updated successfully!')
    } catch (error) {
      console.error('Error updating room number:', error)
      showError('Failed to update room number')
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

  const handleAddGuestToRoom = async () => {
    if (!selectedGuestToAdd || !selectedRoomForGuest) return

    setAssigningRoom(true)
    try {
      // Get the guest's accommodation dates
      const guestToAdd = invitations.find(inv => inv.id === selectedGuestToAdd)
      if (!guestToAdd?.accommodation_dates?.length) {
        throw new Error('Selected guest must have accommodation dates')
      }

      // Convert dates to proper format and sort
      const dates = guestToAdd.accommodation_dates
        .map(date => {
          if (date instanceof Date) {
            return date.toISOString().split('T')[0]
          } else if (typeof date === 'string') {
            return date.split('T')[0]
          }
          return date
        })
        .sort()
      
      const checkInDate = dates[0]
      const lastDateStr = dates[dates.length - 1]
      const lastDate = new Date(lastDateStr + 'T12:00:00')
      lastDate.setDate(lastDate.getDate() + 1)
      const checkOutDate = lastDate.toISOString().split('T')[0]

      // Handle both shared rooms (with room_group_id) and individual rooms (without room_group_id)
      if (selectedRoomForGuest.room_group_id) {
        // Existing shared room - add guest to room group
        await accommodationApi.addGuestToRoom({
          invitation_id: selectedGuestToAdd,
          room_group_id: selectedRoomForGuest.room_group_id,
          check_in_date: checkInDate,
          check_out_date: checkOutDate
        })
      } else {
        // Individual room - convert to shared room by using assignment ID
        await accommodationApi.addGuestToRoom({
          invitation_id: selectedGuestToAdd,
          existing_assignment_id: selectedRoomForGuest.assignment_id,
          check_in_date: checkInDate,
          check_out_date: checkOutDate
        })
      }

      success('Guest successfully added to existing room!')
      setShowAddToRoomModal(false)
      setSelectedRoomForGuest(null)
      setSelectedGuestToAdd(null)
      fetchRoomAssignments()
      fetchRoomingData()
    } catch (error) {
      console.error('Error adding guest to room:', error)
      showError(error.response?.data?.error || 'Failed to add guest to room')
    } finally {
      setAssigningRoom(false)
    }
  }

  const openAddToRoomModal = (roomAssignment) => {
    setSelectedRoomForGuest(roomAssignment)
    setSelectedGuestToAdd(null)
    setShowAddToRoomModal(true)
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

  // Mass mailer helper functions
  const handleSelectAllInvitations = (checked) => {
    if (checked) {
      const filteredInvitations = getFilteredAndSortedInvitations()
      setSelectedInvitationsForEmail(filteredInvitations.map(inv => inv.id))
    } else {
      setSelectedInvitationsForEmail([])
    }
  }

  const handleSelectInvitation = (invitationId, checked) => {
    if (checked) {
      setSelectedInvitationsForEmail(prev => [...prev, invitationId])
    } else {
      setSelectedInvitationsForEmail(prev => prev.filter(id => id !== invitationId))
    }
  }

  const getLanguageRequirements = () => {
    const selectedInvitations = invitations.filter(inv => 
      selectedInvitationsForEmail.includes(inv.id)
    )
    
    const czechGuests = selectedInvitations.filter(inv => 
      inv.guest?.language === 'czech'
    ).length
    
    const englishGuests = selectedInvitations.filter(inv => 
      inv.guest?.language === 'english' || !inv.guest?.language
    ).length
    
    return {
      czech: czechGuests,
      english: englishGuests,
      total: selectedInvitations.length,
      needsBoth: czechGuests > 0 && englishGuests > 0
    }
  }

  const handleOpenMassMailer = () => {
    if (selectedInvitationsForEmail.length === 0) {
      showError('Please select at least one guest to send email to')
      return
    }
    setShowMassMailer(true)
  }

  const canSendMassEmail = () => {
    const langReq = getLanguageRequirements()
    
    if (langReq.czech > 0 && (!massEmailSubject.czech.trim() || !massEmailContent.czech.trim())) {
      return false
    }
    
    if (langReq.english > 0 && (!massEmailSubject.english.trim() || !massEmailContent.english.trim())) {
      return false
    }
    
    return true
  }

  const handlePreviewMassEmail = () => {
    if (!canSendMassEmail()) return
    
    // Generate preview data for both languages
    const langReq = getLanguageRequirements()
    const selectedInvitations = invitations.filter(inv => 
      selectedInvitationsForEmail.includes(inv.id)
    )
    
    const preview = {}
    
    if (langReq.czech > 0) {
      const czechGuests = selectedInvitations.filter(inv => inv.guest?.language === 'czech')
      const sampleGuest = czechGuests[0]
      
      // Format the full email HTML like the backend does
      const emailHtml = massEmailContent.czech.replace(/\n/g, '<br>')
      const fullEmailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="margin-bottom: 20px;">
          ${sampleGuest?.guest?.greeting ? `<p>${sampleGuest.guest.greeting}</p>` : ''}
          ${emailHtml}
        </div>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        <div style="color: #666; font-size: 12px;">
          <p>This email was sent to: ${sampleGuest ? `${sampleGuest.guest.first_name} ${sampleGuest.guest.last_name}` : 'Sample Guest'}</p>
          <p>Event: ${selectedEdition?.name || 'Event Name'}</p>
          <p>Category: ${sampleGuest?.guest?.category || 'guest'}</p>
        </div>
      </div>`
      
      preview.czech = {
        subject: massEmailSubject.czech,
        content: massEmailContent.czech,
        fullEmailHtml: fullEmailHtml,
        recipients: czechGuests.length,
        sampleRecipient: sampleGuest ? `${sampleGuest.guest.first_name} ${sampleGuest.guest.last_name}` : 'N/A'
      }
    }
    
    if (langReq.english > 0) {
      const englishGuests = selectedInvitations.filter(inv => 
        inv.guest?.language === 'english' || !inv.guest?.language
      )
      const sampleGuest = englishGuests[0]
      
      // Format the full email HTML like the backend does
      const emailHtml = massEmailContent.english.replace(/\n/g, '<br>')
      const fullEmailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="margin-bottom: 20px;">
          ${sampleGuest?.guest?.greeting ? `<p>${sampleGuest.guest.greeting}</p>` : ''}
          ${emailHtml}
        </div>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        <div style="color: #666; font-size: 12px;">
          <p>This email was sent to: ${sampleGuest ? `${sampleGuest.guest.first_name} ${sampleGuest.guest.last_name}` : 'Sample Guest'}</p>
          <p>Event: ${selectedEdition?.name || 'Event Name'}</p>
          <p>Category: ${sampleGuest?.guest?.category || 'guest'}</p>
        </div>
      </div>`
      
      preview.english = {
        subject: massEmailSubject.english,
        content: massEmailContent.english,
        fullEmailHtml: fullEmailHtml,
        recipients: englishGuests.length,
        sampleRecipient: sampleGuest ? `${sampleGuest.guest.first_name} ${sampleGuest.guest.last_name}` : 'N/A'
      }
    }
    
    setPreviewData(preview)
    setShowEmailPreview(true)
  }

  const handleSendMassEmail = async () => {
    setSendingMassEmail(true)
    try {
      const selectedInvitations = invitations.filter(inv => 
        selectedInvitationsForEmail.includes(inv.id)
      )
      
      const response = await invitationApi.sendMassEmail({
        invitation_ids: selectedInvitationsForEmail,
        subjects: massEmailSubject,
        contents: massEmailContent
      })
      
      success(`Mass email sent successfully to ${selectedInvitations.length} guests`)
      setShowMassMailer(false)
      setShowEmailPreview(false)
      setSelectedInvitationsForEmail([])
      setMassEmailContent({ czech: '', english: '' })
      setMassEmailSubject({ czech: '', english: '' })
      setPreviewData({ czech: null, english: null })
    } catch (error) {
      console.error('Error sending mass email:', error)
      showError('Failed to send mass email: ' + (error.response?.data?.error || error.message))
    } finally {
      setSendingMassEmail(false)
    }
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

  const getFilteredAssignedNotInvited = () => {
    return assignedNotInvited
      .filter(guest => {
        // Filter by search query (same logic as invitations)
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim()
          const fullName = `${guest.first_name || ''} ${guest.last_name || ''}`.toLowerCase()
          const email = (guest.email || '').toLowerCase()
          const company = (guest.company || '').toLowerCase()
          if (!fullName.includes(query) && !email.includes(query) && !company.includes(query)) {
            return false
          }
        }
        
        // Filter by category (same logic as invitations)
        if (filterCategory && guest.category !== filterCategory) {
          return false
        }
        
        // Note: Status filter doesn't apply to "assigned but not invited" since they don't have invitation status
        
        return true
      })
      .sort((a, b) => {
        // First sort by category
        const categoryA = a.category || 'guest'
        const categoryB = b.category || 'guest'
        if (categoryA !== categoryB) {
          return categoryA.localeCompare(categoryB)
        }
        
        // Then sort alphabetically by name
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase()
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase()
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
        {/* <div className="flex space-x-3">
          <button
            onClick={openMultiGuestRoomModal}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium text-sm"
          >
            Assign Multiple Guests to Room
          </button>
        </div> */}
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
              fetchRoomingData() // Always fetch fresh data when opening rooming tab
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
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-medium">
              {(searchQuery.trim() || filterCategory || filterStatus) ? `Filtered Invitations (${getFilteredAndSortedInvitations().length}/${invitations.length})` : `All Invitations (${invitations.length})`}
            </h3>
            <div className="flex items-center space-x-4">
              {selectedInvitationsForEmail.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">
                    {selectedInvitationsForEmail.length} selected
                  </span>
                  <button
                    onClick={handleOpenMassMailer}
                    className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Mass Email</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${condensedView ? 'px-2 py-2' : 'px-4 py-3'} text-left`}>
                    <input
                      type="checkbox"
                      checked={selectedInvitationsForEmail.length > 0 && selectedInvitationsForEmail.length === getFilteredAndSortedInvitations().length}
                      onChange={(e) => handleSelectAllInvitations(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                  </th>
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
                    <td className={`${condensedView ? 'px-2 py-2' : 'px-4 py-4'} whitespace-nowrap`}>
                      <input
                        type="checkbox"
                        checked={selectedInvitationsForEmail.includes(invitation.id)}
                        onChange={(e) => handleSelectInvitation(invitation.id, e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                    </td>
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
            <h2 className="text-lg font-semibold text-gray-900">
              {(searchQuery.trim() || filterCategory) ? 
                `Filtered Assigned but Not Invited (${getFilteredAssignedNotInvited().length}/${assignedNotInvited.length})` : 
                `Assigned but Not Invited (${assignedNotInvited.length})`
              }
            </h2>
          </div>

          {loadingAssigned ? (
            <div className="text-center py-8">Loading assigned guests...</div>
          ) : !Array.isArray(assignedNotInvited) || assignedNotInvited.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-900">All assigned guests have been invited</h3>
            </div>
          ) : getFilteredAssignedNotInvited().length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-900">No assigned guests match your filters</h3>
              <p className="text-gray-600 mt-2">Try adjusting your search or category filter to see more results.</p>
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
                    {getFilteredAssignedNotInvited().map((guest) => (
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
                      <span>{roomGroup.hotel_name} - {roomGroup.room_type_name}</span>
                    </h4>
                    
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Guest(s)
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
                          {roomGroup.room_groups.map((subRoomGroup, subGroupIndex) => (
                            <tr key={subGroupIndex} className="hover:bg-gray-50">
                              <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                <div className="space-y-1">
                                  {subRoomGroup.guests.map((guest, guestIndex) => (
                                    <div key={guestIndex} className="flex items-center space-x-2">
                                      <span>{guest.guest_name}</span>
                                      {guest.is_primary && subRoomGroup.is_shared_room && subRoomGroup.guests.length > 1 && (
                                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                                          Primary
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                  {subRoomGroup.is_shared_room && subRoomGroup.guests.length > 1 && (
                                    <div className="text-xs text-gray-500 italic">
                                      Shared room ({subRoomGroup.guests.length} guests)
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                                {editingRoomNumber === `${groupIndex}-${subGroupIndex}` ? (
                                  <input
                                    type="text"
                                    value={tempRoomNumber}
                                    onChange={(e) => setTempRoomNumber(e.target.value)}
                                    onBlur={async () => {
                                      if (tempRoomNumber !== (subRoomGroup.guests[0]?.room_number || '')) {
                                        try {
                                          // Update all guests in the room group (for shared rooms)
                                          const updatePromises = subRoomGroup.guests.map(guest =>
                                            handleRoomNumberUpdate(guest.assignment_id, tempRoomNumber)
                                          )
                                          
                                          await Promise.all(updatePromises)
                                        } catch (error) {
                                          // Error handling is done in handleRoomNumberUpdate
                                        }
                                      }
                                      setEditingRoomNumber(null)
                                      setTempRoomNumber('')
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.target.blur()
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingRoomNumber(null)
                                        setTempRoomNumber('')
                                      }
                                    }}
                                    className="w-20 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Room #"
                                    autoFocus
                                  />
                                ) : (
                                  <div
                                    onClick={() => {
                                      setEditingRoomNumber(`${groupIndex}-${subGroupIndex}`)
                                      setTempRoomNumber(subRoomGroup.guests[0]?.room_number || '')
                                    }}
                                    className="cursor-pointer hover:bg-gray-100 px-2 py-1 rounded min-w-16 text-center"
                                    title="Click to edit room number"
                                  >
                                    {subRoomGroup.guests[0]?.room_number || (
                                      <span className="text-gray-400 italic">Room #</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              {sortedDates.map(date => {
                                // For shared rooms, show occupied if any guest is staying
                                // For individual rooms, show based on the specific guest
                                let hasOccupancy = false
                                
                                if (subRoomGroup.is_shared_room) {
                                  // Show green if any guest in the shared room is staying this date
                                  hasOccupancy = subRoomGroup.guests.some(guest => 
                                    guest.accommodation_dates && Array.isArray(guest.accommodation_dates) && 
                                    guest.accommodation_dates.includes(date)
                                  )
                                } else {
                                  // For individual rooms, show if this specific guest is staying
                                  hasOccupancy = subRoomGroup.guests[0]?.accommodation_dates && 
                                    Array.isArray(subRoomGroup.guests[0].accommodation_dates) && 
                                    subRoomGroup.guests[0].accommodation_dates.includes(date)
                                }
                                
                                return (
                                  <td key={date} className="px-1 py-2 text-center">
                                    {hasOccupancy ? (
                                      <div className="w-8 h-8 bg-green-500 rounded-md mx-auto flex items-center justify-center" 
                                           title={subRoomGroup.is_shared_room ? 
                                             `Shared room occupied on ${date}` : 
                                             `${subRoomGroup.guests[0]?.guest_name} staying on ${date}`}>
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
                              // Count total occupied rooms for this date
                              const occupiedCount = roomGroup.room_groups.filter(subGroup => {
                                if (subGroup.is_shared_room) {
                                  // For shared rooms, count as 1 if any guest is staying
                                  return subGroup.guests.some(guest => 
                                    guest.accommodation_dates && Array.isArray(guest.accommodation_dates) && 
                                    guest.accommodation_dates.includes(date)
                                  )
                                } else {
                                  // For individual rooms, count if the guest is staying
                                  return subGroup.guests[0]?.accommodation_dates && 
                                    Array.isArray(subGroup.guests[0].accommodation_dates) && 
                                    subGroup.guests[0].accommodation_dates.includes(date)
                                }
                              }).length
                              
                              // Get total rooms for this specific date
                              const dateAvailability = roomGroup.availability_by_date[date]
                              const totalRooms = dateAvailability ? dateAvailability.total_rooms : 0
                              
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

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Category</label>
                    {getCategoryBadge(selectedInvitation.guest?.category || 'guest')}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Status</label>
                    {getStatusBadge(selectedInvitation)}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Language</label>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      selectedInvitation.guest?.language === 'czech' 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {selectedInvitation.guest?.language === 'czech' ? 'Czech' : 'English'}
                    </span>
                  </div>
                  <div className="col-span-3">
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
                                {assignment.roommates && (
                                  <p className="text-sm text-gray-700">
                                    <strong>Sharing with:</strong> {assignment.roommates}
                                  </p>
                                )}
                                {assignment.total_guests_in_room > 1 && (
                                  <p className="text-sm text-gray-700">
                                    <strong>Total guests in room:</strong> {assignment.total_guests_in_room}
                                    {assignment.is_primary_booking && assignment.total_guests_in_room > 1 && (
                                      <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                                        Primary Booking
                                      </span>
                                    )}
                                  </p>
                                )}
                                <div className="mt-3 space-x-3">
                                  <button
                                    onClick={() => openAddToRoomModal(assignment)}
                                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    Add Guest to Room
                                  </button>
                                  <button
                                    onClick={() => handleCancelRoomAssignment(assignment.id)}
                                    className="text-sm text-red-600 hover:text-red-800 font-medium"
                                  >
                                    Cancel Room Assignment
                                  </button>
                                </div>
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
              <div className="space-y-6">
                {/* Existing Rooms with Space */}
                {(() => {
                  // Get existing room assignments that have capacity for more guests
                  const existingRooms = roomAssignments.filter(assignment => 
                    assignment.capacity > 1 && // Room can accommodate multiple guests
                    (assignment.total_guests_in_room || 1) < assignment.capacity && // Has space (default to 1 if not set)
                    assignment.invitation_id !== selectedInvitationForRoom.id // Not the same guest
                  )
                  
                  // Remove duplicates (same room group or same individual assignment)
                  const uniqueRooms = existingRooms.filter((room, index, arr) => {
                    if (room.room_group_id) {
                      // For shared rooms, deduplicate by room_group_id
                      return arr.findIndex(r => r.room_group_id === room.room_group_id) === index
                    } else {
                      // For individual rooms, each assignment is unique (no deduplication needed)
                      return true
                    }
                  })
                  
                  if (uniqueRooms.length > 0) {
                    return (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Join Existing Rooms</h4>
                        <div className="space-y-2">
                          {uniqueRooms.map(room => (
                            <div key={room.room_group_id} className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-md">
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">{room.hotel_name} - {room.room_type_name}</div>
                                <div className="text-sm text-gray-600">
                                  {formatDateRange(room.check_in_date, room.check_out_date)} • 
                                  {room.total_guests_in_room}/{room.capacity} guests • 
                                  Room #{room.room_number || 'TBD'}
                                </div>
                                <div className="text-sm text-green-700">
                                  <strong>Current guests:</strong> {room.guest_name}{room.roommates ? `, ${room.roommates}` : ''}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  const roomToJoin = { 
                                    room_group_id: room.room_group_id,
                                    assignment_id: room.id, // Include assignment ID for individual rooms
                                    hotel_name: room.hotel_name,
                                    room_type_name: room.room_type_name,
                                    capacity: room.capacity,
                                    check_in_date: room.check_in_date,
                                    check_out_date: room.check_out_date,
                                    guest_name: room.guest_name,
                                    roommates: room.roommates
                                  }
                                  setSelectedRoomForGuest(roomToJoin)
                                  setSelectedGuestToAdd(selectedInvitationForRoom.id)
                                  setShowRoomAssignmentModal(false)
                                  setShowAddToRoomModal(true)
                                }}
                                disabled={assigningRoom}
                                className="ml-4 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Join Room
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}
                
                <h4 className="font-medium text-gray-900">New Room Assignment</h4>
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

      {/* Multi-Guest Room Assignment Modal */}
      <Modal
        isOpen={showMultiRoomModal}
        onClose={() => {
          setShowMultiRoomModal(false)
          setSelectedGuestsForRoom([])
          setPrimaryGuestId(null)
          setAvailableRooms([])
        }}
        title="Assign Multiple Guests to Room"
        size="large"
      >
        <div className="space-y-6">
          {/* Step 1: Select Guests */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Step 1: Select Guests to Share Room</h4>
            <div className="bg-gray-50 p-4 rounded-md">
              <p className="text-sm text-gray-600 mb-4">
                Select guests with accommodation who don't have room assignments yet.
              </p>
              
              {/* Guest Selection List */}
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {invitations
                  .filter(inv => 
                    inv.accommodation && 
                    inv.accommodation_dates?.length > 0 &&
                    !roomAssignments.some(assignment => assignment.invitation_id === inv.id)
                  )
                  .map(guest => {
                    const isSelected = selectedGuestsForRoom.some(g => g.id === guest.id)
                    const isPrimary = guest.id === primaryGuestId
                    
                    return (
                      <div
                        key={guest.id}
                        className={`flex items-center justify-between p-3 rounded-md cursor-pointer ${
                          isSelected
                            ? isPrimary 
                              ? 'bg-blue-100 border-2 border-blue-500' 
                              : 'bg-blue-50 border border-blue-200'
                            : 'bg-white border border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => toggleGuestSelection(guest)}
                      >
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-4 w-4 text-blue-600"
                          />
                          <div>
                            <div className="font-medium text-gray-900">
                              {guest.guest.first_name} {guest.guest.last_name}
                              {isPrimary && (
                                <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
                                  Primary
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600">
                              {guest.guest.email} • {guest.accommodation_dates?.length} nights
                            </div>
                          </div>
                        </div>
                        {isSelected && !isPrimary && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setPrimaryGuestId(guest.id)
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Make Primary
                          </button>
                        )}
                      </div>
                    )
                  })}
              </div>
              
              {selectedGuestsForRoom.length > 0 && (
                <div className="mt-4 p-3 bg-blue-50 rounded-md">
                  <p className="text-sm text-blue-800">
                    Selected {selectedGuestsForRoom.length} guests. 
                    Room dates will be based on the primary guest's accommodation dates.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Select Room (shown when guests are selected) */}
          {selectedGuestsForRoom.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Step 2: Select Room</h4>
              
              {selectedGuestsForRoom.length > 0 && !availableRooms.length && (
                <button
                  onClick={async () => {
                    if (!primaryGuestId) return
                    
                    const primaryGuest = selectedGuestsForRoom.find(g => g.id === primaryGuestId)
                    if (!primaryGuest?.accommodation_dates?.length) return
                    
                    const dates = primaryGuest.accommodation_dates
                      .map(date => typeof date === 'string' ? date.split('T')[0] : date)
                      .sort()
                    
                    const checkInDate = dates[0]
                    const lastDate = new Date(dates[dates.length - 1] + 'T12:00:00')
                    lastDate.setDate(lastDate.getDate() + 1)
                    const checkOutDate = lastDate.toISOString().split('T')[0]
                    
                    try {
                      setLoadingRooms(true)
                      const response = await accommodationApi.getAvailableRooms(selectedEdition.id, {
                        check_in_date: checkInDate,
                        check_out_date: checkOutDate
                      })
                      setAvailableRooms(response.data.hotels)
                    } catch (error) {
                      console.error('Error loading available rooms:', error)
                      showError('Failed to load available rooms')
                    } finally {
                      setLoadingRooms(false)
                    }
                  }}
                  className="w-full bg-gray-100 border-2 border-dashed border-gray-300 rounded-md p-4 text-center hover:bg-gray-50"
                >
                  <div className="text-gray-600">
                    Click to Load Available Rooms
                    <div className="text-sm text-gray-500 mt-1">
                      Based on primary guest's dates
                    </div>
                  </div>
                </button>
              )}
              
              {loadingRooms && (
                <div className="text-center py-8">
                  <div className="text-gray-600">Loading available rooms...</div>
                </div>
              )}
              
              {availableRooms.length > 0 && (
                <div className="space-y-4">
                  {availableRooms.map(hotel => (
                    <div key={hotel.hotel_id} className="border border-gray-200 rounded-md p-4">
                      <h5 className="font-medium text-gray-800 mb-3">{hotel.hotel_name}</h5>
                      <div className="space-y-2">
                        {hotel.room_types.map(roomType => {
                          const canFit = roomType.capacity >= selectedGuestsForRoom.length
                          
                          return (
                            <div key={roomType.room_type_id} className={`flex items-center justify-between p-3 rounded-md ${
                              canFit ? 'bg-gray-50' : 'bg-red-50 opacity-60'
                            }`}>
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">{roomType.room_type_name}</div>
                                <div className="text-sm text-gray-600">
                                  Capacity: {roomType.capacity} guests • Available rooms: {roomType.available_rooms}
                                  {!canFit && (
                                    <span className="text-red-600 ml-2">
                                      (Too small for {selectedGuestsForRoom.length} guests)
                                    </span>
                                  )}
                                  {roomType.price_per_night && (
                                    <span> • {roomType.price_per_night} {roomType.currency}/night</span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => handleMultiGuestRoomAssignment(roomType.room_type_id)}
                                disabled={assigningRoom || !canFit}
                                className="ml-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {assigningRoom ? 'Assigning...' : `Assign ${selectedGuestsForRoom.length} Guests`}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button
              onClick={() => {
                setShowMultiRoomModal(false)
                setSelectedGuestsForRoom([])
                setPrimaryGuestId(null)
                setAvailableRooms([])
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Guest to Existing Room Modal */}
      <Modal
        isOpen={showAddToRoomModal}
        onClose={() => {
          setShowAddToRoomModal(false)
          setSelectedRoomForGuest(null)
          setSelectedGuestToAdd(null)
        }}
        title="Add Guest to Existing Room"
        size="medium"
      >
        <div className="space-y-6">
          {selectedRoomForGuest && (
            <>
              {/* Room Information */}
              <div className="bg-gray-50 p-4 rounded-md">
                <h4 className="font-medium text-gray-900 mb-2">Room Details</h4>
                <p className="text-sm text-gray-600">
                  <strong>Hotel:</strong> {selectedRoomForGuest.hotel_name}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Room Type:</strong> {selectedRoomForGuest.room_type_name}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Dates:</strong> {formatDateRange(selectedRoomForGuest.check_in_date, selectedRoomForGuest.check_out_date)}
                </p>
                {selectedRoomForGuest.roommates && (
                  <p className="text-sm text-gray-600">
                    <strong>Current Guests:</strong> {selectedRoomForGuest.guest_name}{selectedRoomForGuest.roommates ? `, ${selectedRoomForGuest.roommates}` : ''}
                  </p>
                )}
                <p className="text-sm text-gray-600">
                  <strong>Room Capacity:</strong> {selectedRoomForGuest.capacity} guests
                </p>
              </div>

              {/* Guest Selection */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Select Guest to Add</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {invitations
                    .filter(inv => 
                      inv.accommodation && 
                      inv.accommodation_dates?.length > 0 &&
                      !roomAssignments.some(assignment => assignment.invitation_id === inv.id)
                    )
                    .map(guest => (
                      <div
                        key={guest.id}
                        className={`flex items-center justify-between p-3 rounded-md cursor-pointer ${
                          selectedGuestToAdd === guest.id
                            ? 'bg-blue-100 border-2 border-blue-500' 
                            : 'bg-white border border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => setSelectedGuestToAdd(guest.id)}
                      >
                        <div className="flex items-center space-x-3">
                          <input
                            type="radio"
                            checked={selectedGuestToAdd === guest.id}
                            onChange={() => {}}
                            className="h-4 w-4 text-blue-600"
                          />
                          <div>
                            <div className="font-medium text-gray-900">
                              {guest.guest.first_name} {guest.guest.last_name}
                            </div>
                            <div className="text-sm text-gray-600">
                              {guest.guest.email} • {guest.accommodation_dates?.length} nights
                            </div>
                            <div className="text-xs text-gray-500">
                              Dates: {guest.accommodation_dates?.join(', ')}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
                
                {invitations.filter(inv => 
                  inv.accommodation && 
                  inv.accommodation_dates?.length > 0 &&
                  !roomAssignments.some(assignment => assignment.invitation_id === inv.id)
                ).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No available guests with accommodation to add to this room.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setShowAddToRoomModal(false)
                    setSelectedRoomForGuest(null)
                    setSelectedGuestToAdd(null)
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddGuestToRoom}
                  disabled={!selectedGuestToAdd || assigningRoom}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {assigningRoom ? 'Adding Guest...' : 'Add Guest to Room'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Mass Mailer Modal */}
      <Modal
        isOpen={showMassMailer}
        onClose={() => {
          setShowMassMailer(false)
          setShowEmailPreview(false)
          setMassEmailContent({ czech: '', english: '' })
          setMassEmailSubject({ czech: '', english: '' })
          setPreviewData({ czech: null, english: null })
        }}
        title="Mass Email"
      >
        <div className="max-w-4xl">
          {(() => {
            const langReq = getLanguageRequirements()
            return (
              <div className="mb-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-blue-800 mb-2">Recipients Summary</h4>
                  <div className="text-sm text-blue-700">
                    <p><strong>Total selected:</strong> {langReq.total} guests</p>
                    <p><strong>Czech guests:</strong> {langReq.czech}</p>
                    <p><strong>English guests:</strong> {langReq.english}</p>
                    {langReq.needsBoth && (
                      <p className="text-orange-700 mt-2">
                        ⚠️ You need to provide both Czech and English versions of the email
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="space-y-6">
            {/* Czech Version */}
            {getLanguageRequirements().czech > 0 && (
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="text-lg font-medium text-gray-900 mb-4">
                  Czech Version ({getLanguageRequirements().czech} recipients)
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Subject (Czech)
                    </label>
                    <input
                      type="text"
                      value={massEmailSubject.czech}
                      onChange={(e) => setMassEmailSubject(prev => ({ ...prev, czech: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter Czech subject..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message (Czech)
                    </label>
                    <textarea
                      value={massEmailContent.czech}
                      onChange={(e) => setMassEmailContent(prev => ({ ...prev, czech: e.target.value }))}
                      rows={8}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter Czech message..."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* English Version */}
            {getLanguageRequirements().english > 0 && (
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="text-lg font-medium text-gray-900 mb-4">
                  English Version ({getLanguageRequirements().english} recipients)
                </h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Subject (English)
                    </label>
                    <input
                      type="text"
                      value={massEmailSubject.english}
                      onChange={(e) => setMassEmailSubject(prev => ({ ...prev, english: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter English subject..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message (English)
                    </label>
                    <textarea
                      value={massEmailContent.english}
                      onChange={(e) => setMassEmailContent(prev => ({ ...prev, english: e.target.value }))}
                      rows={8}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter English message..."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowMassMailer(false)
                  setShowEmailPreview(false)
                  setMassEmailContent({ czech: '', english: '' })
                  setMassEmailSubject({ czech: '', english: '' })
                  setPreviewData({ czech: null, english: null })
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={sendingMassEmail}
              >
                Cancel
              </button>
              <button
                onClick={handlePreviewMassEmail}
                disabled={!canSendMassEmail()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span>Preview & Send</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Email Preview Modal */}
      <Modal
        isOpen={showEmailPreview}
        onClose={() => {
          setShowEmailPreview(false)
          setPreviewData({ czech: null, english: null })
        }}
        title="Email Preview - Final Confirmation"
      >
        <div className="max-w-4xl">
          <div className="mb-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-amber-800">Review before sending</h4>
                  <p className="text-sm text-amber-700 mt-1">
                    Please review the email content below. Once you click "Send Emails", the messages will be sent immediately to all selected recipients.
                  </p>
                </div>
              </div>
            </div>

            {/* Czech Email Preview */}
            {previewData.czech && (
              <div className="border border-gray-200 rounded-lg p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Czech Version</h3>
                  <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded">
                    {previewData.czech.recipients} recipients
                  </span>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject Line:</label>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3 font-medium">
                      {previewData.czech.subject}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Email Preview:</label>
                    <div className="bg-white border border-gray-200 rounded p-4 min-h-32">
                      <div dangerouslySetInnerHTML={{ 
                        __html: previewData.czech.fullEmailHtml
                      }} />
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-500">
                    <strong>Sample recipient:</strong> {previewData.czech.sampleRecipient}
                  </div>
                </div>
              </div>
            )}

            {/* English Email Preview */}
            {previewData.english && (
              <div className="border border-gray-200 rounded-lg p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">English Version</h3>
                  <span className="bg-green-100 text-green-800 text-sm font-medium px-2.5 py-0.5 rounded">
                    {previewData.english.recipients} recipients
                  </span>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject Line:</label>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3 font-medium">
                      {previewData.english.subject}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Email Preview:</label>
                    <div className="bg-white border border-gray-200 rounded p-4 min-h-32">
                      <div dangerouslySetInnerHTML={{ 
                        __html: previewData.english.fullEmailHtml
                      }} />
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-500">
                    <strong>Sample recipient:</strong> {previewData.english.sampleRecipient}
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowEmailPreview(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={sendingMassEmail}
              >
                ← Back to Edit
              </button>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowEmailPreview(false)
                    setShowMassMailer(false)
                    setSelectedInvitationsForEmail([])
                    setMassEmailContent({ czech: '', english: '' })
                    setMassEmailSubject({ czech: '', english: '' })
                    setPreviewData({ czech: null, english: null })
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={sendingMassEmail}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendMassEmail}
                  disabled={sendingMassEmail}
                  className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {sendingMassEmail && (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span>{sendingMassEmail ? 'Sending...' : 'Send Emails Now'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default Invitations