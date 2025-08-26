import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { invitationApi } from '../utils/api'

// Translation strings
const translations = {
  english: {
    loading: 'Loading invitation details...',
    loadingDesc: 'Please wait while we retrieve your invitation.',
    errorTitle: 'Confirmation Failed',
    invalidLink: 'This invitation link is invalid or has already been used.',
    contactOrganizers: 'Please contact the festival organizers if you need assistance.',
    
    invitationTitle: 'Festival Invitation',
    invitationDesc: 'Please review and confirm your invitation details',
    invitationDetails: 'Invitation Details',
    guest: 'Guest',
    event: 'Event',
    category: 'Category',
    festivalDates: 'Festival Dates',
    
    accommodation: 'Accommodation',
    accommodationDesc: (nights) => `The festival is offering accommodation for up to ${nights} night${nights > 1 ? 's' : ''}.`,
    selectNights: 'Please select nights you will need accommodation:',
    selected: 'Selected',
    of: 'of',
    nights: 'nights',
    maximumSelected: 'Maximum nights selected',
    continuousOnlyFeedback: 'Please select continuous nights only',
    canOnlyRemoveEnds: 'Can only remove first or last night',
    coveredNights: 'Covered by festival',
    extraNightsLabel: 'Extra nights (paid separately)',
    extraCostPerNight: '1,950 CZK per night',
    
    extraNightsWarning: 'Additional nights are subject to availability and must be paid separately.',
    estimatedExtraCost: 'Estimated extra cost:',
    extraNightsRequireApproval: 'Extra nights require approval and separate payment',
    totalSelected: 'Total selected:',
    nightsUnit: 'nights',
    nightUnit: 'night',
    
    confirmButton: 'Confirm Attendance',
    confirming: 'Confirming...',
    cancel: 'Cancel',
    
    successTitle: 'Invitation Confirmed!',
    successMessage: 'Thank you for confirming your attendance! We look forward to seeing you at the festival.',
    accommodationConfirmed: 'Accommodation confirmed for:',
    confirmedAt: 'Confirmed at',
    confirmationEmail: 'You will receive a confirmation email with all the details shortly.',
    
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  },
  czech: {
    loading: 'Načítání pozvánky...',
    loadingDesc: 'Prosím počkejte, načítáme vaši pozvánku.',
    errorTitle: 'Potvrzení selhalo',
    invalidLink: 'Tento odkaz je neplatný nebo již byl použit.',
    contactOrganizers: 'Pokud potřebujete pomoc, kontaktujte prosím organizátory festivalu.',
    
    invitationTitle: 'Pozvánka na festival',
    invitationDesc: 'Zkontrolujte prosím a potvrďte údaje vaší pozvánky',
    invitationDetails: 'Detaily pozvánky',
    guest: 'Host',
    event: 'Akce',
    category: 'Kategorie',
    festivalDates: 'Termín festivalu',
    
    accommodation: 'Ubytování',
    accommodationDesc: (nights) => {
      if (nights === 1) return 'Festival nabízí ubytování na 1 noc.';
      if (nights >= 2 && nights <= 4) return `Festival nabízí ubytování až na ${nights} noci.`;
      return `Festival nabízí ubytování až na ${nights} nocí.`;
    },
    selectNights: 'Vyberte prosím souvislé noci, kdy budete potřebovat ubytování:',
    selected: 'Vybráno',
    of: 'z',
    nights: nights => {
      if (nights === 1) return 'noc';
      if (nights >= 2 && nights <= 4) return 'noci';
      return 'nocí';
    },
    maximumSelected: 'Maximální počet nocí vybrán',
    continuousOnlyFeedback: 'Vyberte prosím pouze souvislé noci',
    canOnlyRemoveEnds: 'Lze odebrat pouze první nebo poslední noc',
    coveredNights: 'Hrazeno festivalem',
    extraNightsLabel: 'Dodatečné noci (hradí host)',
    extraCostPerNight: '1 950 Kč za noc',
    
    extraNightsWarning: 'Dodatečné noci podléhají dostupnosti a musí být uhrazeny samostatně.',
    estimatedExtraCost: 'Odhadované dodatečné náklady:',
    extraNightsRequireApproval: 'Dodatečné noci vyžadují schválení a samostatnou úhradu',
    totalSelected: 'Celkem vybráno:',
    nightsUnit: 'nocí',
    nightUnit: 'noc',
    
    confirmButton: 'Potvrdit účast',
    confirming: 'Potvrzování...',
    cancel: 'Zrušit',
    
    successTitle: 'Pozvánka potvrzena!',
    successMessage: 'Děkujeme za potvrzení vaší účasti! Těšíme se na vás na festivalu.',
    accommodationConfirmed: 'Ubytování potvrzeno na:',
    confirmedAt: 'Potvrzeno',
    confirmationEmail: 'Brzy obdržíte potvrzovací e-mail se všemi podrobnostmi.',
    
    weekdays: ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'],
    months: ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čer', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro']
  }
}

function Confirmation() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')
  const [invitationData, setInvitationData] = useState(null)
  const [confirmationData, setConfirmationData] = useState(null)
  const [error, setError] = useState('')
  const [selectedNights, setSelectedNights] = useState([])
  const [isConfirming, setIsConfirming] = useState(false)
  const [language, setLanguage] = useState('english')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [invalidAttemptIndex, setInvalidAttemptIndex] = useState(null)
  const [extraNightsRequested, setExtraNightsRequested] = useState(0)
  const [extraNightsComment, setExtraNightsComment] = useState('')
  const [showExtraNights, setShowExtraNights] = useState(false)
  
  // Get translations for current language
  const t = translations[language] || translations.english

  useEffect(() => {
    fetchInvitationDetails()
  }, [token])

  const fetchInvitationDetails = async () => {
    try {
      const response = await invitationApi.getDetails(token)
      setInvitationData(response.data)
      setLanguage(response.data.language || 'english')
      
      // Initialize all nights in the edition period if accommodation is included
      if (response.data.accommodation && response.data.covered_nights > 0) {
        const nightsArray = []
        
        // Parse dates manually to avoid timezone issues
        const parseEditionDate = (dateStr) => {
          if (dateStr.includes('T')) {
            // ISO datetime string - convert to local date
            const date = new Date(dateStr)
            return {
              year: date.getFullYear(),
              month: date.getMonth() + 1,
              day: date.getDate()
            }
          } else {
            // Simple date string
            const [year, month, day] = dateStr.split('-').map(Number)
            return { year, month, day }
          }
        }
        
        const startDateParts = parseEditionDate(response.data.edition_start_date)
        const endDateParts = parseEditionDate(response.data.edition_end_date)
        
        const startDate = new Date(startDateParts.year, startDateParts.month - 1, startDateParts.day)
        const endDate = new Date(endDateParts.year, endDateParts.month - 1, endDateParts.day)
        
        // Generate all nights from start to end date
        let currentDate = new Date(startDate)
        while (currentDate <= endDate) {
          const dayIndex = currentDate.getDay()
          const monthIndex = currentDate.getMonth()
          const dayNum = currentDate.getDate()
          const lang = response.data.language || 'english'
          
          // Format date as YYYY-MM-DD without timezone conversion
          const year = currentDate.getFullYear()
          const month = String(currentDate.getMonth() + 1).padStart(2, '0')
          const day = String(currentDate.getDate()).padStart(2, '0')
          const dateStr = `${year}-${month}-${day}`
          
          nightsArray.push({
            date: dateStr,
            selected: false, // Start with none selected
            dayName: translations[lang].weekdays[dayIndex],
            dateFormatted: `${dayNum}. ${translations[lang].months[monthIndex]}`
          })
          currentDate = new Date(currentDate)
          currentDate.setDate(currentDate.getDate() + 1)
        }
        setSelectedNights(nightsArray)
      }
      setStatus('ready')
    } catch (error) {
      console.error('Error fetching invitation details:', error)
      if (error.response?.status === 404) {
        setError(translations[language].invalidLink)
      } else {
        setError(error.response?.data?.error || translations[language].invalidLink)
      }
      setStatus('error')
    }
  }

  const confirmInvitation = async () => {
    setIsConfirming(true)
    try {
      const selectedDates = invitationData.accommodation 
        ? selectedNights.filter(n => n.selected).map(n => n.date)
        : []
      
      const response = await invitationApi.confirm(token, {
        accommodation_dates: selectedDates,
        extra_nights_requested: extraNightsRequested,
        extra_nights_comment: '' // No comment field anymore, but keep for backend compatibility
      })
      setConfirmationData(response.data)
      setStatus('success')
    } catch (error) {
      console.error('Error confirming invitation:', error)
      setError(error.response?.data?.error || 'Failed to confirm invitation')
      setIsConfirming(false)
    }
  }

  const showFeedback = (message, index = null) => {
    setFeedbackMessage(message)
    if (index !== null) {
      setInvalidAttemptIndex(index)
      setTimeout(() => setInvalidAttemptIndex(null), 500) // Clear flash after 500ms
    }
    setTimeout(() => setFeedbackMessage(''), 3000) // Clear message after 3 seconds
  }

  const toggleNight = (index) => {
    const newNights = [...selectedNights]
    const currentlySelected = newNights.filter(n => n.selected).length
    const coveredNights = invitationData.covered_nights || 0
    
    if (newNights[index].selected) {
      // Removing a date - only allow if it's at the start or end of the range
      const selectedIndices = newNights.map((n, i) => n.selected ? i : -1).filter(i => i !== -1)
      
      // Allow removal only if it's the first or last selected date
      if (selectedIndices.length > 1 && index !== selectedIndices[0] && index !== selectedIndices[selectedIndices.length - 1]) {
        showFeedback(t.canOnlyRemoveEnds, index)
        return // Don't allow removing middle dates
      }
    } else {
      // Adding a date - check if it maintains continuity
      const selectedIndices = newNights.map((n, i) => n.selected ? i : -1).filter(i => i !== -1)
      
      if (selectedIndices.length > 0) {
        // Check if the new index would create a continuous range
        const newSelectedIndices = [...selectedIndices, index].sort((a, b) => a - b)
        
        // Check if all indices are continuous
        for (let i = 1; i < newSelectedIndices.length; i++) {
          if (newSelectedIndices[i] !== newSelectedIndices[i - 1] + 1) {
            showFeedback(t.continuousOnlyFeedback, index)
            return // Don't allow non-continuous selection
          }
        }
      }
    }
    
    // Clear any existing feedback on successful selection
    setFeedbackMessage('')
    newNights[index].selected = !newNights[index].selected
    setSelectedNights(newNights)
    
    // Update extra nights requested count based on selections beyond covered nights
    const totalSelected = newNights.filter(n => n.selected).length
    const extraSelected = Math.max(0, totalSelected - coveredNights)
    setExtraNightsRequested(extraSelected)
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading invitation details...</h2>
          <p className="text-gray-600">Please wait while we retrieve your invitation.</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t.errorTitle}</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">{t.contactOrganizers}</p>
        </div>
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12">
        <div className="max-w-2xl w-full bg-white shadow-lg rounded-lg p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.invitationTitle}</h2>
            <p className="text-gray-600">{t.invitationDesc}</p>
          </div>
          
          <div className="bg-blue-50 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.invitationDetails}</h3>
            <div className="space-y-2">
              <p className="text-gray-700">
                <span className="font-medium">{t.guest}:</span> {invitationData?.guest_name}
              </p>
              <p className="text-gray-700">
                <span className="font-medium">{t.event}:</span> {invitationData?.edition_name}
              </p>
              <p className="text-gray-700">
                <span className="font-medium">{t.category}:</span> {invitationData?.category}
              </p>
              {invitationData?.edition_start_date && (
                <p className="text-gray-700">
                  <span className="font-medium">{t.festivalDates}:</span> {new Date(invitationData.edition_start_date).toLocaleDateString()} - {new Date(invitationData.edition_end_date).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {invitationData?.accommodation && invitationData?.covered_nights > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">🏨 {t.accommodation}</h3>
              <p className="text-gray-700 mb-4">
                {t.accommodationDesc(invitationData.covered_nights)}
              </p>
              <p className="text-gray-700 mb-4">
                {t.selectNights}
              </p>
              <div className="space-y-2">
                {selectedNights.map((night, index) => {
                  // For sequential selection, determine which nights are extra based on selection order
                  // Since selection must be continuous, we can use the selection index
                  const selectedIndices = selectedNights.map((n, i) => n.selected ? i : -1).filter(i => i !== -1).sort((a, b) => a - b);
                  const selectionPosition = selectedIndices.indexOf(index);
                  const isExtraNight = night.selected && (selectionPosition >= invitationData.covered_nights)
                  const isFlashing = invalidAttemptIndex === index
                  
                  return (
                    <label 
                      key={index} 
                      className={`flex items-center justify-between p-3 rounded border transition-all duration-200 cursor-pointer ${
                        isFlashing 
                          ? 'border-red-300 bg-red-50 animate-pulse'
                          : night.selected 
                            ? isExtraNight 
                              ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' 
                              : 'bg-green-50 border-green-200 hover:bg-green-100'
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={night.selected}
                          onChange={() => toggleNight(index)}
                          className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span className="ml-3">
                          <span className="font-medium">{night.dayName}</span>, {night.dateFormatted}
                        </span>
                      </div>
                      {night.selected && (
                        <div className="flex items-center space-x-2">
                          {isExtraNight ? (
                            <>
                              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                                {t.extraNightsLabel}
                              </span>
                              <span className="text-xs text-amber-700 font-medium">
                                {t.extraCostPerNight}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                              {t.coveredNights}
                            </span>
                          )}
                        </div>
                      )}
                    </label>
                  )
                })}
              </div>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                {(() => {
                  const totalSelected = selectedNights.filter(n => n.selected).length
                  const coveredSelected = Math.min(totalSelected, invitationData.covered_nights)
                  const extraSelected = Math.max(0, totalSelected - invitationData.covered_nights)
                  
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">
                          🏨 {t.coveredNights}: 
                        </span>
                        <span className="text-sm font-medium text-green-600">
                          {coveredSelected} / {invitationData.covered_nights} {invitationData.covered_nights === 1 ? t.nightUnit : t.nightsUnit}
                        </span>
                      </div>
                      
                      {extraSelected > 0 && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-700">
                              💰 {t.extraNightsLabel}:
                            </span>
                            <span className="text-sm font-medium text-amber-600">
                              +{extraSelected} {extraSelected === 1 ? t.nightUnit : t.nightsUnit}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-1 border-t border-gray-200">
                            <span className="text-sm font-medium text-gray-700">
                              {t.estimatedExtraCost}
                            </span>
                            <span className="text-sm font-bold text-amber-700">
                              {(extraSelected * 1950).toLocaleString()} CZK
                            </span>
                          </div>
                          <p className="text-xs text-amber-600 mt-2">
                            ⚠️ {t.extraNightsRequireApproval}
                          </p>
                        </>
                      )}
                      
                      <div className="flex justify-between items-center pt-2 border-t border-gray-300">
                        <span className="text-sm font-bold text-gray-900">
                          {t.totalSelected}
                        </span>
                        <span className="text-sm font-bold text-blue-600">
                          {totalSelected} {totalSelected === 1 ? t.nightUnit : t.nightsUnit}
                        </span>
                      </div>
                    </div>
                  )
                })()}
                
                {feedbackMessage && (
                  <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded">
                    <p className="text-sm text-orange-600 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {feedbackMessage}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}


          <div className="flex gap-4">
            <button
              onClick={confirmInvitation}
              disabled={isConfirming || (invitationData?.accommodation && selectedNights.filter(n => n.selected).length === 0)}
              className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isConfirming ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t.confirming}
                </span>
              ) : (
                t.confirmButton
              )}
            </button>
            <a
              href="/"
              className="px-6 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              {t.cancel}
            </a>
          </div>

        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t.successTitle}</h2>
          
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-600 mb-2">
              <strong>{t.guest}:</strong> {confirmationData?.guest}
            </p>
            <p className="text-sm text-gray-600 mb-2">
              <strong>{t.event}:</strong> {confirmationData?.edition}
            </p>
            <p className="text-sm text-gray-600 mb-2">
              <strong>{t.category}:</strong> {confirmationData?.category}
            </p>
            {confirmationData?.accommodation_dates && confirmationData.accommodation_dates.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>{t.accommodationConfirmed}</strong>
                </p>
                <ul className="text-sm text-gray-600 ml-4">
                  {confirmationData.accommodation_dates.map((date, index) => {
                    // Parse date manually to avoid timezone issues
                    const [year, month, day] = date.split('-')
                    const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
                    const dayIndex = dateObj.getDay()
                    const monthIndex = dateObj.getMonth()
                    const dayNum = dateObj.getDate()
                    return (
                      <li key={index}>• {t.weekdays[dayIndex]}, {dayNum}. {t.months[monthIndex]}</li>
                    )
                  })}
                </ul>
              </div>
            )}
            <p className="text-sm text-gray-600 mt-3">
              <strong>{t.confirmedAt}:</strong> {new Date(confirmationData?.confirmed_at).toLocaleString()}
            </p>
          </div>
          
          <p className="text-gray-600 mb-4">
            {t.successMessage}
          </p>
          
          <p className="text-sm text-gray-500">
            {t.confirmationEmail}
          </p>
        </div>
      </div>
    )
  }

  return null
}

export default Confirmation