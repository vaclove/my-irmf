import { useState, useEffect } from 'react'
import { formatBytes } from '../../utils/fileSize'

const PHOTO_SECONDS_OPTIONS = [4, 6, 8, 10, 15, 20, 30]
const DEFAULT_PHOTO_SECONDS = 8 // keep in sync with PHOTO_SECONDS in client/public/tv/app.js

function formatDuration(seconds) {
  if (!seconds) return ''
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Thumbnail({ slide }) {
  const box = 'w-32 h-[4.5rem] flex-shrink-0 rounded overflow-hidden bg-gray-900 flex items-center justify-center'
  if (slide.kind === 'programme') {
    return <div className={`${box} bg-lime-300 text-gray-900 text-sm font-semibold`}>📅 Programme</div>
  }
  if (slide.status !== 'ready' || !slide.url) {
    return <div className={`${box} text-gray-400 text-2xl`}>{slide.kind === 'photo' ? '🖼️' : '🎬'}</div>
  }
  if (slide.kind === 'photo') {
    return (
      <div className={box}>
        <img src={slide.url} alt="" className="w-full h-full object-contain" loading="lazy" />
      </div>
    )
  }
  return (
    <div className={box}>
      {/* #t=1: show a frame from the first second, not a black opening frame */}
      <video src={`${slide.url}#t=1`} preload="metadata" muted className="w-full h-full object-contain" />
    </div>
  )
}

// Matches STUCK_PROCESSING_MINUTES in server/routes/tv.js
const STUCK_MS = 10 * 60 * 1000

function Status({ slide, onRetry }) {
  if (slide.status === 'processing') {
    const stuck = Date.now() - new Date(slide.updated_at).getTime() > STUCK_MS
    return (
      <div className="mt-2 max-w-xs">
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${slide.progress_percent || 0}%` }} />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Preparing for the TV… {slide.progress_percent || 0}%
          {stuck && (
            <>
              {' '}— no progress for a while.
              <button type="button" onClick={() => onRetry(slide)} className="ml-1 underline hover:text-gray-800">
                Retry
              </button>
            </>
          )}
        </p>
      </div>
    )
  }
  if (slide.status === 'uploading') {
    return <p className="text-xs text-amber-700 mt-1">Upload not finished — delete it and upload again.</p>
  }
  if (slide.status === 'failed') {
    return (
      <div className="text-xs text-red-700 mt-1">
        Failed: {slide.error_message || 'unknown error'}
        <button type="button" onClick={() => onRetry(slide)} className="ml-2 underline hover:text-red-900">
          Retry
        </button>
      </div>
    )
  }
  return null
}

function SlideRow({ slide, index, movies, programmeLabel, dragging, onHandleDown, onDragStart, onDragOver, onDragEnd, onUpdate, onDelete, onRetry }) {
  const [title, setTitle] = useState(slide.title || '')
  useEffect(() => setTitle(slide.title || ''), [slide.title])

  const saveTitle = () => {
    if (title.trim() !== (slide.title || '')) onUpdate(slide, { title: title.trim() })
  }

  const details = []
  if (slide.width && slide.height) details.push(`${slide.width}×${slide.height}`)
  if (slide.kind === 'video' && slide.media_seconds) details.push(formatDuration(slide.media_seconds))
  if (slide.size) details.push(formatBytes(slide.size))

  return (
    <li
      draggable={dragging}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      className={`flex items-start gap-3 p-3 bg-white border rounded-md ${slide.hidden ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onMouseDown={onHandleDown}
        onTouchStart={onHandleDown}
        className="self-center px-1 text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing select-none"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        ⋮⋮
      </button>

      <Thumbnail slide={slide} />

      <div className="flex-1 min-w-0">
        {slide.kind === 'programme' ? (
          <>
            <p className="font-medium text-gray-900">Programme of the day</p>
            <p className="text-sm text-gray-600">{programmeLabel}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${slide.kind === 'photo' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {slide.kind === 'photo' ? 'Photo' : 'Video'}
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                placeholder={slide.file_name || 'Untitled'}
                className="flex-1 min-w-0 px-2 py-1 text-sm border border-transparent rounded hover:border-gray-300 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
              {details.length > 0 && <span>{details.join(' · ')}</span>}
              {slide.kind === 'photo' && (
                <label className="flex items-center gap-1">
                  Shown for
                  <select
                    value={slide.display_seconds || ''}
                    onChange={(e) => onUpdate(slide, { display_seconds: e.target.value ? Number(e.target.value) : null })}
                    className="border border-gray-300 rounded px-1 py-0.5 text-xs"
                  >
                    <option value="">{DEFAULT_PHOTO_SECONDS} s (default)</option>
                    {PHOTO_SECONDS_OPTIONS.filter((s) => s !== DEFAULT_PHOTO_SECONDS).map((s) => (
                      <option key={s} value={s}>{s} s</option>
                    ))}
                  </select>
                </label>
              )}
              {slide.kind === 'video' && (
                <label className="flex items-center gap-1">
                  Trailer of
                  <select
                    value={slide.movie_id || ''}
                    onChange={(e) => onUpdate(slide, { movie_id: e.target.value || null })}
                    className="border border-gray-300 rounded px-1 py-0.5 text-xs max-w-[16rem]"
                  >
                    <option value="">— not a trailer —</option>
                    {slide.movie_id && !movies.some((m) => m.id === slide.movie_id) && (
                      <option value={slide.movie_id}>(film of another edition)</option>
                    )}
                    {movies.map((movie) => (
                      <option key={movie.id} value={movie.id}>{movie.name_cs || movie.name_en}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <Status slide={slide} onRetry={onRetry} />
          </>
        )}
      </div>

      <div className="flex items-center gap-2 self-center">
        <button
          type="button"
          onClick={() => onUpdate(slide, { hidden: !slide.hidden })}
          className={`px-3 py-1 text-sm rounded-md border ${slide.hidden ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'}`}
          title={slide.hidden ? 'Hidden — the screen skips it' : 'Shown on the screen'}
        >
          {slide.hidden ? '🙈 Hidden' : '👁️ Shown'}
        </button>
        {slide.kind === 'programme' ? (
          <span className="w-8" aria-hidden="true" />
        ) : (
          <button
            type="button"
            onClick={() => onDelete(slide)}
            className="px-2 py-1 text-sm text-red-600 hover:text-red-800"
            title="Delete"
            aria-label="Delete"
          >
            🗑️
          </button>
        )}
      </div>
    </li>
  )
}

/**
 * The TV player's slides in play order. Drag a row by its handle to reorder;
 * the new order is saved when the drag ends.
 */
function TvSlideList({ slides, movies, programmeLabel, onReorder, onUpdate, onDelete, onRetry }) {
  const [items, setItems] = useState(slides)
  const [dragId, setDragId] = useState(null) // row whose handle is pressed
  const [dragIndex, setDragIndex] = useState(null)

  useEffect(() => {
    if (dragIndex === null) setItems(slides)
  }, [slides, dragIndex])

  const handleDragStart = (e, index) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', items[index].id) // Firefox needs data to start a drag
  }

  const handleDragOver = (e, index) => {
    if (dragIndex === null) return
    e.preventDefault()
    if (index === dragIndex) return
    const next = [...items]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(index, 0, moved)
    setItems(next)
    setDragIndex(index)
  }

  const handleDragEnd = () => {
    const changed = items.some((item, i) => item.id !== slides[i]?.id)
    setDragIndex(null)
    setDragId(null)
    if (changed) onReorder(items)
  }

  return (
    <ul className="space-y-2" onMouseUp={() => dragIndex === null && setDragId(null)}>
      {items.map((slide, index) => (
        <SlideRow
          key={slide.id}
          slide={slide}
          index={index}
          movies={movies}
          programmeLabel={programmeLabel}
          dragging={dragId === slide.id}
          onHandleDown={() => setDragId(slide.id)}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      ))}
    </ul>
  )
}

export default TvSlideList
