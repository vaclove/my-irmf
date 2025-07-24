import React, { useState } from 'react'

const TimelineView = ({ schedule, venues, selectedDate, onEditEntry, onTimelineClick, onTimeUpdate }) => {
  const [hoveredEntry, setHoveredEntry] = useState(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [draggingEntry, setDraggingEntry] = useState(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [previewTime, setPreviewTime] = useState(null)
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

  // Convert click position to time
  const positionToTime = (clickX, containerRect) => {
    const relativeX = clickX - containerRect.left
    const percentage = relativeX / containerRect.width
    const minutesSince8AM = Math.round(percentage * 16 * 60) // 16 hours from 8:00 to 24:00
    
    // Round to nearest 15 minutes
    const roundedMinutes = Math.round(minutesSince8AM / 15) * 15
    
    const hours = Math.floor(roundedMinutes / 60) + 8
    const minutes = roundedMinutes % 60
    
    // Ensure time is within bounds
    if (hours < 8) return '08:00'
    if (hours >= 24) return '23:45'
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  // Handle drag start
  const handleDragStart = (e, entry) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setDraggingEntry(entry)
    setDragOffset(e.clientX - rect.left)
    e.currentTarget.style.opacity = '0.5'
    e.currentTarget.style.zIndex = '20'
  }

  // Handle drag end
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1'
    e.currentTarget.style.zIndex = '10'
    
    if (draggingEntry && previewTime && onTimeUpdate) {
      onTimeUpdate(draggingEntry.id, previewTime)
    }
    
    setDraggingEntry(null)
    setPreviewTime(null)
  }

  // Handle drag over timeline
  const handleTimelineDragOver = (e) => {
    e.preventDefault()
    if (!draggingEntry) return
    
    const rect = e.currentTarget.getBoundingClientRect()
    const time = positionToTime(e.clientX - dragOffset, rect)
    setPreviewTime(time)
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
      // No minimum width - let proportions be accurate
      // Very short films might be hard to click, but hover helps
    }
  }

  // Timeline requires a specific date - schedule should already be filtered
  const filteredSchedule = schedule

  // Group entries by venue
  const entriesByVenue = {}
  venues.forEach(venue => {
    entriesByVenue[venue.id] = filteredSchedule.filter(entry => entry.venue_id === venue.id)
  })

  const timeSlots = generateTimeSlots()
  const majorTimeSlots = timeSlots.filter((time, index) => index % 4 === 0).slice(1) // Every hour, skip 08:00

  if (filteredSchedule.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
        <div className="max-w-md mx-auto">
          <div className="text-4xl mb-4">📅</div>
          <p className="text-gray-500 text-lg">No programming entries for this date.</p>
          <p className="text-gray-400 text-sm mt-2">
            {selectedDate && (() => {
              const [year, month, day] = selectedDate.split('-').map(Number);
              const date = new Date(year, month - 1, day);
              return `${date.toLocaleDateString('cs-CZ', { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long' 
              })} appears to be a free day.`;
            })()}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-900">Schedule Timeline</h3>
      </div>
      
      <div className="overflow-x-auto">
        <div className="min-w-[1200px] p-4">
          {/* Time axis */}
          <div className="relative mb-4">
            <div className="relative h-6">
              {majorTimeSlots.map((time, index) => {
                // Calculate position based on actual time
                const [hours] = time.split(':').map(Number)
                const minutesSince8AM = (hours - 8) * 60
                const position = (minutesSince8AM / (16 * 60)) * 100
                
                return (
                  <div 
                    key={time} 
                    className="absolute text-xs text-gray-500"
                    style={{ 
                      left: `${position}%`,
                      transform: 'translateX(-50%)'
                    }}
                  >
                    {time}
                  </div>
                )
              })}
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
                  <div 
                    className="relative h-16 bg-gray-50 rounded-md border cursor-cell"
                    onClick={(e) => {
                      // Only handle clicks on the track itself, not on entries
                      if (e.target === e.currentTarget || e.target.classList.contains('timeline-grid-line')) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const time = positionToTime(e.clientX, rect)
                        if (onTimelineClick) {
                          onTimelineClick(venue.id, time)
                        }
                      }
                    }}
                    onDragOver={handleTimelineDragOver}
                    onDrop={(e) => e.preventDefault()}
                  >
                    {/* Hour grid lines */}
                    {majorTimeSlots.map((time, index) => {
                      const [hours] = time.split(':').map(Number)
                      const minutesSince8AM = (hours - 8) * 60
                      const position = (minutesSince8AM / (16 * 60)) * 100
                      
                      return (
                        <div
                          key={time}
                          className="absolute top-0 bottom-0 w-px bg-gray-200 timeline-grid-line pointer-events-none"
                          style={{ left: `${position}%` }}
                        ></div>
                      )
                    })}

                    {/* Preview ghost for dragging */}
                    {draggingEntry && previewTime && draggingEntry.venue_id === venue.id && (
                      <div
                        className={`absolute top-1 bottom-1 bg-gray-400 opacity-50 rounded px-1 py-1`}
                        style={{
                          left: `${(timeToMinutes(previewTime) / (16 * 60)) * 100}%`,
                          width: `${((draggingEntry.total_runtime || 0) / (16 * 60)) * 100}%`
                        }}
                      >
                        <div className="text-xs font-medium text-white text-center">
                          {previewTime}
                        </div>
                      </div>
                    )}

                    {/* Programming entries */}
                    {venueEntries.map(entry => {
                      const entryStyle = getEntryStyle(entry)
                      const colors = getVenueColor(venue.name_cs)
                      
                      return (
                        <div
                          key={entry.id}
                          className={`absolute top-1 bottom-1 ${colors.bg} ${colors.text} rounded px-1 py-1 shadow-sm cursor-move hover:shadow-md transition-all duration-200 hover:scale-105 hover:z-10`}
                          style={entryStyle}
                          draggable
                          onClick={() => onEditEntry && onEditEntry(entry)}
                          onDragStart={(e) => handleDragStart(e, entry)}
                          onDragEnd={handleDragEnd}
                          onMouseEnter={(e) => {
                            if (!draggingEntry) {
                              setHoveredEntry(entry)
                              const rect = e.currentTarget.getBoundingClientRect()
                              setMousePosition({ x: rect.left + rect.width / 2, y: rect.top })
                            }
                          }}
                          onMouseLeave={() => setHoveredEntry(null)}
                        >
                          <div className="h-full flex items-center overflow-hidden px-2">
                            {/* For very short entries (< 20 min), just show the time */}
                            {entry.total_runtime < 20 ? (
                              <div className="text-xs font-bold">
                                {formatTime(entry.scheduled_time)}
                              </div>
                            ) : entry.total_runtime < 45 ? (
                              // For short entries (20-45 min), show abbreviated title and time
                              <div className="flex flex-col justify-center w-full">
                                <div className="text-xs font-medium truncate">
                                  {(entry.title_override_cs || entry.movie_name_cs || entry.block_name_cs).substring(0, 8)}...
                                </div>
                                <div className="text-xs opacity-75">
                                  {formatTime(entry.scheduled_time)}
                                </div>
                              </div>
                            ) : (
                              // For longer entries, show full content
                              <div className="flex flex-col justify-center w-full">
                                <div className="text-xs font-medium truncate">
                                  {entry.title_override_cs || entry.movie_name_cs || entry.block_name_cs}
                                </div>
                                <div className="text-xs opacity-90 whitespace-nowrap">
                                  {formatTime(entry.scheduled_time)} • {entry.total_runtime}min
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

        </div>
      </div>
      
      {/* Custom Tooltip */}
      {hoveredEntry && (
        <div
          className="fixed z-50 bg-gray-900 text-white px-3 py-2 rounded-md shadow-lg pointer-events-none"
          style={{
            left: mousePosition.x < 150 ? '10px' : `${mousePosition.x}px`,
            top: `${mousePosition.y}px`,
            transform: mousePosition.x < 150 
              ? 'translateY(-100%) translateY(-8px)' 
              : 'translate(-50%, -100%) translateY(-8px)'
          }}
        >
          <div className="text-sm font-medium">
            {hoveredEntry.title_override_cs || hoveredEntry.movie_name_cs || hoveredEntry.block_name_cs}
          </div>
          <div className="text-xs opacity-90 mt-1">
            {formatTime(hoveredEntry.scheduled_time)} • {hoveredEntry.total_runtime} min
          </div>
          {hoveredEntry.movie_director && (
            <div className="text-xs opacity-75 mt-1">
              Director: {hoveredEntry.movie_director}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TimelineView