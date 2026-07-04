import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { movieApi, editionApi, api } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import MovieForm from '../components/MovieForm'
import MovieFilesSection from '../components/movie-files/MovieFilesSection'
import MoviePlayerSection from '../components/movie-files/MoviePlayerSection'

// Tabs shown on the detail page. Future sections are added as new entries here.
const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'files', label: 'Files & Subtitles' },
  { id: 'preview', label: 'Preview' },
]

function MovieDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { error: showError } = useToast()
  const [movie, setMovie] = useState(null)
  const [editions, setEditions] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailsDirty, setDetailsDirty] = useState(false)
  const previewRef = useRef(null)

  // Confirm before leaving the page (in-app navigation) with unsaved edits.
  const confirmLeave = (e) => {
    if (detailsDirty && !window.confirm('You have unsaved changes. Leave anyway?')) {
      e.preventDefault()
    }
  }

  const tabParam = searchParams.get('tab')
  const activeTab = TABS.some((t) => t.id === tabParam) ? tabParam : 'details'
  const selectTab = (tabId) =>
    setSearchParams(tabId === 'details' ? {} : { tab: tabId }, { replace: true })

  const fetchMovie = useCallback(async () => {
    try {
      const res = await movieApi.getById(id)
      setMovie(res.data)
      return res.data
    } catch (error) {
      console.error('Error loading movie:', error)
      showError('Failed to load movie: ' + (error.response?.data?.error || error.message))
      return null
    } finally {
      setLoading(false)
    }
  }, [id, showError])

  useEffect(() => {
    fetchMovie()
    editionApi.getAll().then((res) => setEditions(res.data)).catch(() => {})
  }, [fetchMovie])

  useEffect(() => {
    if (!movie?.edition_id) return
    api.sections
      .getByEdition(movie.edition_id)
      .then((res) =>
        setSections(
          res.data.map((s) => ({ value: s.key, label: s.name_cs, color: s.color_code }))
        )
      )
      .catch((err) => {
        console.error('Error loading sections:', err)
        showError('Failed to load sections')
      })
  }, [movie?.edition_id, showError])

  // Pause any playing preview video when leaving the Preview tab so audio does
  // not keep going from a hidden panel.
  useEffect(() => {
    if (activeTab !== 'preview') {
      previewRef.current?.querySelector('video')?.pause()
    }
  }, [activeTab])

  if (loading) {
    return <div className="text-center py-8">Loading movie…</div>
  }
  if (!movie) {
    return (
      <div className="text-center py-8 text-gray-500">
        Movie not found. <Link to="/movies" className="text-blue-600">Back to movies</Link>
      </div>
    )
  }

  const section = sections.find((s) => s.value === movie.section)
  const sectionColor = section?.color || '#6B7280'

  return (
    <div className="space-y-6">
      <div>
        <Link to="/movies" onClick={confirmLeave} className="text-sm text-blue-600 hover:text-blue-800">
          ← Back to movies
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start space-x-4 min-w-0">
          {movie.image_urls?.medium && (
            <img
              src={movie.image_urls.medium}
              alt={movie.name_cs}
              className="w-24 h-36 object-cover rounded border"
            />
          )}
          <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 items-start">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">{movie.name_cs}</h1>
              {movie.name_en && <div className="text-gray-500">{movie.name_en}</div>}
            </div>
            <div className="min-w-0 sm:text-right">
              <div className="text-sm text-gray-600 space-x-2">
                {movie.director && <span>{movie.director}</span>}
                {movie.year && <span>· {movie.year}</span>}
              </div>
              {movie.section && (
                <span
                  className="inline-flex items-center px-2 py-1 mt-2 rounded-md text-xs font-medium"
                  style={{ backgroundColor: sectionColor + '20', color: sectionColor }}
                >
                  {section?.label || movie.section}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels — all mounted, inactive ones hidden so in-flight uploads,
          transcode polling and unsaved edits survive tab switches. */}
      <div className={activeTab === 'details' ? '' : 'hidden'}>
        <div className="bg-white shadow rounded-lg p-6">
          <MovieForm
            movie={movie}
            editions={editions}
            sections={sections}
            variant="page"
            onSaved={fetchMovie}
            onDeleted={() => navigate('/movies')}
            onDirtyChange={setDetailsDirty}
          />
        </div>
      </div>

      <div className={activeTab === 'files' ? '' : 'hidden'}>
        <div className="bg-white shadow rounded-lg p-6">
          <MovieFilesSection movieId={movie.id} movie={movie} />
        </div>
      </div>

      <div ref={previewRef} className={activeTab === 'preview' ? '' : 'hidden'}>
        <div className="bg-white shadow rounded-lg p-6">
          <MoviePlayerSection movieId={movie.id} movie={movie} />
        </div>
      </div>
    </div>
  )
}

export default MovieDetail
