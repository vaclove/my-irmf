// Lightweight cross-section signal for a single movie's files changing.
//
// The movie detail page stacks independent sibling sections (Files, Preview)
// with no shared state. A file mutation in one (e.g. adding a master, which
// kicks off proxy transcoding server-side) must let the others refresh. This
// decouples them via a window CustomEvent instead of lifting shared state.

const EVENT_NAME = 'movie-files-changed'

/** Announce that a movie's files changed (uploaded, imported, removed, …). */
export function notifyMovieFilesChanged(movieId) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { movieId } }))
}

/**
 * Subscribe to file-change events for a specific movie.
 * @returns {() => void} unsubscribe
 */
export function onMovieFilesChanged(movieId, handler) {
  const listener = (e) => {
    if (!e.detail || e.detail.movieId === movieId) handler()
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
