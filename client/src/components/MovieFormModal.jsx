import Modal from './Modal'
import MovieForm from './MovieForm'

/**
 * Thin modal wrapper around MovieForm. Used for the "Add Movie" flow on the
 * movies list (editing an existing movie now happens inline on the detail
 * page's Details tab).
 *
 * Props:
 *   isOpen, onClose
 *   movie            null for create, or a movie object for edit
 *   editions, sections
 *   defaultEditionId edition to preselect when creating
 *   onSaved(movie)   called after a successful create/update
 *   onDeleted(id)    called after a successful delete
 */
function MovieFormModal({ isOpen, onClose, movie = null, editions = [], sections = [], defaultEditionId, onSaved, onDeleted }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={movie ? 'Edit Movie' : 'Add New Movie'}
      size="large"
    >
      <MovieForm
        movie={movie}
        editions={editions}
        sections={sections}
        defaultEditionId={defaultEditionId}
        variant="modal"
        onCancel={onClose}
        onSaved={async (saved) => {
          if (onSaved) await onSaved(saved)
          onClose()
        }}
        onDeleted={onDeleted ? async (id) => {
          if (onDeleted) await onDeleted(id)
          onClose()
        } : undefined}
      />
    </Modal>
  )
}

export default MovieFormModal
