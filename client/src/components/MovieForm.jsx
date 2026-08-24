import { useState, useEffect, useRef } from 'react'
import { movieApi } from '../utils/api'
import { useToast } from '../contexts/ToastContext'
import CountryPicker from './CountryPicker'
import LanguagePicker from './LanguagePicker'
import SubtitlesPicker from './SubtitlesPicker'

const premiereTypes = [
  { value: '', label: 'None' },
  { value: 'czech', label: 'Czech Premiere' },
  { value: 'european', label: 'European Premiere' },
  { value: 'world', label: 'World Premiere' }
]

// Synopsis translation directions, keyed as POST /api/movies/translate-synopsis
// expects them.
const synopsisDirections = {
  cs_to_en: { source: 'synopsis_cs', target: 'synopsis_en', sourceLabel: 'Czech', targetLabel: 'English' },
  en_to_cs: { source: 'synopsis_en', target: 'synopsis_cs', sourceLabel: 'English', targetLabel: 'Czech' }
}

const emptyForm = (editionId) => ({
  edition_id: editionId || '',
  catalogue_year: '',
  name_cs: '',
  name_en: '',
  synopsis_cs: '',
  synopsis_en: '',
  image: '',
  runtime: '',
  director: '',
  year: new Date().getFullYear(),
  country: '',
  cast: '',
  premiere: '',
  section: '',
  language: '',
  subtitles: '',
  is_35mm: false,
  has_delegation: false,
  is_public: true
})

const seedFromMovie = (movie) => ({
  edition_id: movie.edition_id || '',
  catalogue_year: movie.catalogue_year || '',
  name_cs: movie.name_cs || '',
  name_en: movie.name_en || '',
  synopsis_cs: movie.synopsis_cs || '',
  synopsis_en: movie.synopsis_en || '',
  image: movie.image || '',
  runtime: movie.runtime || '',
  director: movie.director || '',
  year: movie.year || new Date().getFullYear(),
  country: movie.country || '',
  cast: movie.cast || '',
  premiere: movie.premiere || '',
  section: movie.section || '',
  language: movie.language || '',
  subtitles: movie.subtitles || '',
  is_35mm: movie.is_35mm || false,
  has_delegation: movie.has_delegation || false,
  is_public: movie.is_public !== undefined ? movie.is_public : true
})

/**
 * Create/edit movie form. Owns its own form state so it can be reused from the
 * "Add Movie" modal (variant="modal") and inline on the movie detail page
 * (variant="page").
 *
 * Props:
 *   movie            null for create, or a movie object for edit
 *   editions, sections
 *   defaultEditionId edition to preselect when creating
 *   variant          'page' | 'modal' — controls the footer layout only
 *   onSaved(movie)   called after a successful create/update
 *   onDeleted(id)    called after a successful delete; Delete button hidden if absent
 *   onCancel         modal only: renders a Cancel button that calls this
 *   onDirtyChange    called with the current unsaved-changes state whenever it changes
 */
function MovieForm({
  movie = null,
  editions = [],
  sections = [],
  defaultEditionId,
  variant = 'page',
  onSaved,
  onDeleted,
  onCancel,
  onDirtyChange
}) {
  const { success, error: showError } = useToast()
  const [formData, setFormData] = useState(() =>
    movie ? seedFromMovie(movie) : emptyForm(defaultEditionId)
  )
  // Snapshot of the last-seeded/saved state, used to detect unsaved changes.
  const seededRef = useRef(formData)
  // Direction of the synopsis translation in flight, or null when idle.
  const [translating, setTranslating] = useState(null)

  // Reseed when the target movie changes (e.g. detail page refetches after save).
  useEffect(() => {
    const next = movie ? seedFromMovie(movie) : emptyForm(defaultEditionId)
    setFormData(next)
    seededRef.current = next
  }, [movie, defaultEditionId])

  const isDirty = JSON.stringify(formData) !== JSON.stringify(seededRef.current)

  // Report dirtiness to the parent (e.g. so the detail page can guard its
  // "back to movies" link) and warn on browser refresh/close while dirty.
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    if (!isDirty) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handleImageUpload = (e) => {
    const file = e.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setFormData(prev => ({
          ...prev,
          image: file.name,
          image_base64: reader.result
        }))
      }
      reader.readAsDataURL(file)
    }
  }

  // Machine-translate one synopsis into the other language. The result only
  // fills the opposite textarea — saving stays with the form's submit button.
  const handleTranslateSynopsis = async (direction) => {
    const { source, target, sourceLabel, targetLabel } = synopsisDirections[direction]
    const sourceText = (formData[source] || '').trim()
    if (!sourceText) {
      showError(`The ${sourceLabel} synopsis is empty — nothing to translate`)
      return
    }
    if (
      (formData[target] || '').trim() &&
      !window.confirm(`This will overwrite the ${targetLabel} synopsis. Continue?`)
    ) {
      return
    }

    setTranslating(direction)
    try {
      const res = await movieApi.translateSynopsis({
        direction,
        text: sourceText,
        movie: {
          name_cs: formData.name_cs,
          name_en: formData.name_en,
          year: formData.year,
          director: formData.director,
          country: formData.country
        }
      })
      setFormData(prev => ({ ...prev, [target]: res.data.text }))
      success(`${targetLabel} synopsis translated — review it before saving`)
    } catch (error) {
      console.error('Error translating synopsis:', error)
      showError('Failed to translate synopsis: ' + (error.response?.data?.error || error.message))
    } finally {
      setTranslating(null)
    }
  }

  const translateButton = (direction, label, arrowPath) => (
    <button
      type="button"
      onClick={() => handleTranslateSynopsis(direction)}
      disabled={translating !== null}
      title={label}
      aria-label={label}
      className="p-2 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {translating === direction ? (
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={arrowPath} />
        </svg>
      )}
    </button>
  )

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.section) {
      showError('Please select a section for the movie')
      return
    }

    try {
      let saved
      if (movie) {
        const res = await movieApi.update(movie.id, formData)
        saved = res.data
        success(`Movie "${formData.name_cs}" updated successfully!`)
      } else {
        const res = await movieApi.create(formData)
        saved = res.data
        success(`Movie "${formData.name_cs}" created successfully!`)
      }
      // Reset the dirty baseline to the just-saved values.
      seededRef.current = formData
      if (onSaved) await onSaved(saved)
    } catch (error) {
      console.error('Error saving movie:', error)
      showError('Failed to save movie: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleDelete = async () => {
    if (!movie) return
    if (window.confirm(`Are you sure you want to delete "${movie.name_cs}"?`)) {
      try {
        await movieApi.delete(movie.id)
        success(`Movie "${movie.name_cs}" deleted successfully!`)
        if (onDeleted) await onDeleted(movie.id)
      } catch (error) {
        console.error('Error deleting movie:', error)
        showError('Failed to delete movie: ' + (error.response?.data?.error || error.message))
      }
    }
  }

  const showDelete = Boolean(movie && onDeleted)

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Edition *</label>
          <select
            required
            value={formData.edition_id}
            onChange={(e) => setFormData({ ...formData, edition_id: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">Select Edition</option>
            {editions.map(edition => (
              <option key={edition.id} value={edition.id}>
                {edition.year} - {edition.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Section *</label>
          <select
            required
            value={formData.section}
            onChange={(e) => setFormData({ ...formData, section: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">Select Section</option>
            {sections.map(section => (
              <option key={section.value} value={section.value}>
                {section.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Czech Name *</label>
          <input
            type="text"
            required
            value={formData.name_cs}
            onChange={(e) => setFormData({ ...formData, name_cs: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">English Name *</label>
          <input
            type="text"
            required
            value={formData.name_en}
            onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Director</label>
          <input
            type="text"
            value={formData.director}
            onChange={(e) => setFormData({ ...formData, director: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
          <CountryPicker
            value={formData.country}
            onChange={(value) => setFormData({ ...formData, country: value })}
            placeholder="Select countries..."
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
          <input
            type="number"
            value={formData.year}
            onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || '' })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            min="1900"
            max="2100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Runtime (min)</label>
          <input
            type="text"
            value={formData.runtime}
            onChange={(e) => setFormData({ ...formData, runtime: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder="e.g., 120"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Premiere</label>
          <select
            value={formData.premiere}
            onChange={(e) => setFormData({ ...formData, premiere: e.target.value })}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {premiereTypes.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
          <LanguagePicker
            value={formData.language}
            onChange={(value) => setFormData({ ...formData, language: value })}
            placeholder="Select primary language..."
            className="w-full"
            multiple={false}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subtitles</label>
          <SubtitlesPicker
            value={formData.subtitles}
            onChange={(value) => setFormData({ ...formData, subtitles: value })}
            placeholder="Select subtitle languages..."
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cast</label>
          <textarea
            value={formData.cast}
            onChange={(e) => setFormData({ ...formData, cast: e.target.value })}
            rows="2"
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder="Main cast members..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Movie Attributes</label>
          <div className="flex flex-col space-y-3 pt-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.is_35mm}
                onChange={(e) => setFormData({ ...formData, is_35mm: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">35mm Film</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.has_delegation}
                onChange={(e) => setFormData({ ...formData, has_delegation: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Has Delegation</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.is_public}
                onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Public in Catalogue</span>
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Czech Synopsis</label>
          <textarea
            value={formData.synopsis_cs}
            onChange={(e) => setFormData({ ...formData, synopsis_cs: e.target.value })}
            rows="10"
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder="Czech synopsis..."
          />
        </div>
        <div className="flex flex-col justify-center gap-2 pt-6">
          {translateButton('cs_to_en', 'Translate Czech → English', 'M14 5l7 7m0 0l-7 7m7-7H3')}
          {translateButton('en_to_cs', 'Translate English → Czech', 'M10 19l-7-7m0 0l7-7m-7 7h18')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">English Synopsis</label>
          <textarea
            value={formData.synopsis_en}
            onChange={(e) => setFormData({ ...formData, synopsis_en: e.target.value })}
            rows="10"
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder="English synopsis..."
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Movie Image</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
        {(formData.image_base64 || (movie?.image_urls?.medium)) && (
          <div className="mt-2">
            <img
              src={formData.image_base64 || movie?.image_urls?.medium}
              alt="Preview"
              className="max-w-[200px] max-h-[300px] object-contain rounded border"
            />
          </div>
        )}
      </div>

      <div className="flex justify-between items-center pt-4 border-t">
        {showDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm font-medium"
          >
            Delete Movie
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center space-x-3 ml-auto">
          {variant === 'page' && isDirty && (
            <span className="text-sm text-amber-600">Unsaved changes</span>
          )}
          {variant === 'modal' && (
            <button
              type="button"
              onClick={onCancel}
              className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={variant === 'page' && !isDirty}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {movie ? (variant === 'page' ? 'Save Changes' : 'Update Movie') : 'Create Movie'}
          </button>
        </div>
      </div>
    </form>
  )
}

export default MovieForm
