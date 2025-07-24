import React from 'react'

const TimelineView = ({ schedule, venues, selectedDate, onEditEntry }) => {
  // Generate time slots for the day (every 15 minutes from 8:00 to 24:00)
  const generateTimeSlots = () => {
    const slots = []
    for (let hour = 8; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
        slots.push(time)
      }
    }
    return slots
  }

  // Convert time string to minutes since 8:00 AM
  const timeToMinutes = (timeString) => {
    const [hours, minutes] = timeString.split(':').map(Number)
    return (hours - 8) * 60 + minutes
  }

  // Get venue colors (matching the existing color scheme)
  const getVenueColor = (venueName) => {
    const venueColors = {
      'Malý sál': { bg: 'bg-blue-500', text: 'text-white', light: 'bg-blue-100' },
      'Small Hall': { bg: 'bg-blue-500', text: 'text-white', light: 'bg-blue-100' },
      'Velký sál': { bg: 'bg-green-500', text: 'text-white', light: 'bg-green-100' },
      'Great Hall': { bg: 'bg-green-500', text: 'text-white', light: 'bg-green-100' },
      'Kavárna': { bg: 'bg-orange-500', text: 'text-white', light: 'bg-orange-100' },
      'Café': { bg: 'bg-orange-500', text: 'text-white', light: 'bg-orange-100' },
    }
    return venueColors[venueName] || { bg: 'bg-purple-500', text: 'text-white', light: 'bg-purple-100' }
  }

  // Format time for display
  const formatTime = (timeString) => {
    return timeString.slice(0, 5)
  }

  // Calculate entry position and width
  const getEntryStyle = (entry) => {
    const startMinutes = timeToMinutes(entry.scheduled_time)
    const duration = entry.total_runtime || 0
    const left = (startMinutes / (16 * 60)) * 100 // 16 hours from 8:00 to 24:00
    const width = (duration / (16 * 60)) * 100
    
    return {
      left: `${left}%`,
      width: `${width}%`,
      minWidth: '120px' // Ensure minimum width for readability
    }
  }

  // Filter schedule for selected date if provided
  const filteredSchedule = selectedDate 
    ? schedule.filter(entry => entry.scheduled_date === selectedDate)
    : schedule

  // Group entries by venue
  const entriesByVenue = {}
  venues.forEach(venue => {
    entriesByVenue[venue.id] = filteredSchedule.filter(entry => entry.venue_id === venue.id)
  })

  const timeSlots = generateTimeSlots()
  const majorTimeSlots = timeSlots.filter((time, index) => index % 4 === 0) // Every hour

  if (filteredSchedule.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
        <p className="text-gray-500">
          {selectedDate ? 'No programming entries for the selected date.' : 'No programming entries to display.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-900">Schedule Timeline</h3>
        {selectedDate && (
          <p className="text-sm text-gray-600 mt-1">
            {new Date(selectedDate).toLocaleDateString('cs-CZ', { 
              weekday: 'long', 
              day: 'numeric', 
              month: 'long' 
            })}
          </p>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <div className="min-w-[800px] p-4">
          {/* Time axis */}
          <div className="relative mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              {majorTimeSlots.map(time => (
                <div key={time} className="flex-1 text-center">
                  {time}
                </div>
              ))}
            </div>
            <div className="h-px bg-gray-200"></div>
          </div>

          {/* Venue rows */}
          <div className="space-y-4">
            {venues.map(venue => {
              const venueEntries = entriesByVenue[venue.id] || []
              const colors = getVenueColor(venue.name_cs)
              
              return (
                <div key={venue.id} className="relative">
                  {/* Venue label */}
                  <div className="flex items-center mb-2">
                    <div className={`w-3 h-3 rounded-full ${colors.bg} mr-2`}></div>
                    <span className="text-sm font-medium text-gray-700">{venue.name_cs}</span>
                    <span className="text-xs text-gray-500 ml-2">({venue.name_en})</span>
                  </div>

                  {/* Timeline track */}
                  <div className="relative h-16 bg-gray-50 rounded-md border">
                    {/* Hour grid lines */}
                    {majorTimeSlots.map((time, index) => (
                      <div
                        key={time}
                        className="absolute top-0 bottom-0 w-px bg-gray-200"
                        style={{ left: `${(index / (majorTimeSlots.length - 1)) * 100}%` }}
                      ></div>
                    ))}

                    {/* Programming entries */}
                    {venueEntries.map(entry => {
                      const entryStyle = getEntryStyle(entry)
                      const colors = getVenueColor(venue.name_cs)
                      
                      return (
                        <div
                          key={entry.id}
                          className={`absolute top-1 bottom-1 ${colors.bg} ${colors.text} rounded px-2 py-1 shadow-sm cursor-pointer hover:shadow-md transition-all duration-200 hover:scale-105`}
                          style={entryStyle}
                          onClick={() => onEditEntry && onEditEntry(entry)}
                          title={`Click to edit: ${entry.title_override_cs || entry.movie_name_cs || entry.block_name_cs} (${formatTime(entry.scheduled_time)} • ${entry.total_runtime}min)`}
                        >
                          <div className="text-xs font-medium truncate">
                            {entry.title_override_cs || entry.movie_name_cs || entry.block_name_cs}
                          </div>
                          <div className="text-xs opacity-90">
                            {formatTime(entry.scheduled_time)} • {entry.total_runtime}min
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="mt-6 pt-4 border-t">
            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-gray-200 rounded mr-1"></div>
                <span>Timeline (8:00 - 24:00)</span>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded mr-1"></div>
                <span>Programming blocks</span>
              </div>
              <div className="text-gray-500">
                Hover for details • Click to edit
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TimelineView