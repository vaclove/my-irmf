import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { movieApi, editionApi, api } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import MovieFormModal from '../components/MovieFormModal'
import MovieFilesSection from '../components/movie-files/MovieFilesSection'

// Registry of stacked detail sections. Future sections (preview player,
// subtitle translator) are added as new entries here.
const DETAIL_SECTIONS = [
  { id: 'files', title: 'Files', Component: MovieFilesSection },
]

function MovieDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { error: showError } = useToast()
  const [movie, setMovie] = useState(null)
  const [editions, setEditions] = useState([])
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

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
      .catch(() => {})
  }, [movie?.edition_id])

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
        <Link to="/movies" className="text-sm text-blue-600 hover:text-blue-800">
          ← Back to movies
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-4 min-w-0">
            {movie.image_urls?.medium && (
              <img
                src={movie.image_urls.medium}
                alt={movie.name_cs}
                className="w-24 h-36 object-cover rounded border"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">{movie.name_cs}</h1>
              {movie.name_en && <div className="text-gray-500">{movie.name_en}</div>}
              <div className="mt-2 text-sm text-gray-600 space-x-2">
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
          <button
            onClick={() => setShowEdit(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium shrink-0"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Stacked sections */}
      {DETAIL_SECTIONS.map(({ id: sectionId, title, Component }) => (
        <div key={sectionId} className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">{title}</h2>
          <Component movieId={movie.id} movie={movie} />
        </div>
      ))}

      <MovieFormModal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        movie={movie}
        editions={editions}
        sections={sections}
        onSaved={fetchMovie}
        onDeleted={() => navigate('/movies')}
      />
    </div>
  )
}

export default MovieDetail
