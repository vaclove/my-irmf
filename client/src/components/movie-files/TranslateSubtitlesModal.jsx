import { useState, useEffect } from 'react'
import Modal from '../Modal'
import { subtitleTranslationApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'

const CONTEXT_MAX_CHARS = 4000

/**
 * Start an LLM subtitle translation with an optional free-text context note
 * for the translator (tykání/vykání between characters, character genders,
 * terminology, ...). The note is prefilled from the movie's most recent
 * translation job and stored on the new job, so retries reuse it.
 */
function TranslateSubtitlesModal({ isOpen, onClose, movieId, translation, targetExists, onCreated }) {
  const { info, error: showError } = useToast()
  const [context, setContext] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Prefill from the movie's most recent job each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return
    let stale = false
    subtitleTranslationApi
      .getLastContext(movieId)
      .then((res) => {
        if (!stale) setContext(res.data.context || '')
      })
      .catch(() => {
        // Prefill only; start with an empty note if it fails.
      })
    return () => {
      stale = true
    }
  }, [isOpen, movieId])

  const close = () => {
    setContext('')
    setSubmitting(false)
    onClose()
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      await subtitleTranslationApi.create({
        movie_id: movieId,
        direction: translation.direction,
        overwrite: targetExists,
        context: context.trim() || undefined,
      })
      info('Translation started')
      if (onCreated) await onCreated()
      close()
    } catch (error) {
      showError('Translation failed to start: ' + (error.response?.data?.error || error.message))
      setSubmitting(false)
    }
  }

  if (!translation) return null

  return (
    <Modal isOpen={isOpen} onClose={close} title={`Translate subtitles → ${translation.targetLabel}`} size="medium">
      <div className="space-y-4">
        {targetExists && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
            {translation.targetLabel} subtitles already exist and will be replaced by this
            machine translation.
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Context for the translator (optional)
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            maxLength={CONTEXT_MAX_CHARS}
            rows={5}
            placeholder={
              'E.g. Petr and Jana address each other informally (tykání); ' +
              'the narrator is a woman; "the Institute" = "Ústav".'
            }
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <div className="text-xs text-gray-500 mt-1">
            Facts the translator cannot infer from the subtitles alone: who addresses whom
            formally vs informally, character genders, names and recurring terms. Reused when
            the job is retried, and prefilled next time from the most recent job.
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            onClick={close}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            Start translation
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default TranslateSubtitlesModal
