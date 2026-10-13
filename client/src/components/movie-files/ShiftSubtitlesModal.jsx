import { useState } from 'react'
import Modal from '../Modal'
import { subtitleSyncApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'

const PRESETS = [
  { label: '−1 h', direction: -1, hours: 1, minutes: 0, seconds: 0 },
  { label: '+1 h', direction: 1, hours: 1, minutes: 0, seconds: 0 },
]

/**
 * Shift a subtitle track by a fixed amount of time (no audio analysis). The
 * result is saved as the synced copy, so it can be checked in the player and
 * then made the original with "Use as original".
 */
function ShiftSubtitlesModal({ isOpen, onClose, movieId, subtitleKind, label, syncedExists, onShifted }) {
  const { success, error: showError } = useToast()
  // Subtitles timed against a 01:00:00:00 timecode are the common case.
  const [direction, setDirection] = useState(-1)
  const [hours, setHours] = useState(1)
  const [minutes, setMinutes] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const offsetMs =
    direction *
    Math.round(((Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0)) * 1000)

  const close = () => {
    setSubmitting(false)
    onClose()
  }

  const applyPreset = (preset) => {
    setDirection(preset.direction)
    setHours(preset.hours)
    setMinutes(preset.minutes)
    setSeconds(preset.seconds)
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await subtitleSyncApi.shift({
        movie_id: movieId,
        subtitle_kind: subtitleKind,
        offset_ms: offsetMs,
      })
      const dropped = res.data.dropped_cues
      success(
        `${label} subtitles shifted` +
          (dropped ? ` (${dropped} cue${dropped === 1 ? '' : 's'} before the start removed)` : '')
      )
      if (onShifted) await onShifted()
      close()
    } catch (error) {
      showError('Shift failed: ' + (error.response?.data?.error || error.message))
      setSubmitting(false)
    }
  }

  const numberInput = (value, setValue, unit, props = {}) => (
    <label className="flex items-center gap-1 text-sm text-gray-700">
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm"
        {...props}
      />
      {unit}
    </label>
  )

  return (
    <Modal isOpen={isOpen} onClose={close} title={`Shift ${label} subtitles`} size="medium">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Moves every cue by a fixed amount of time. The result is saved as the synced copy — check
          it in the player, then use “Use as original”.
        </p>
        {syncedExists && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
            A synced copy already exists and will be replaced.
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Presets:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="px-2 py-1 rounded-md border border-gray-300 text-sm hover:bg-gray-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={direction}
            onChange={(e) => setDirection(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          >
            <option value={-1}>Earlier (−)</option>
            <option value={1}>Later (+)</option>
          </select>
          {numberInput(hours, setHours, 'h')}
          {numberInput(minutes, setMinutes, 'min')}
          {numberInput(seconds, setSeconds, 's', { step: '0.001' })}
        </div>
        <div className="text-xs text-gray-500">
          Earlier subtracts the time (subtitles appear sooner). Cues that would end before 0:00
          are removed.
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
            disabled={submitting || offsetMs === 0}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            Shift subtitles
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ShiftSubtitlesModal
