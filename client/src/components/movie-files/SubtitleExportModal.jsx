import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../Modal'
import { subtitleBurnApi } from '../../utils/api'
import { useToast } from '../../contexts/ToastContext'
import BurnedInPositioner, { defaultPlacement } from './BurnedInPositioner'

const LANGS = [
  { lang: 'cs', label: 'Czech', original: 'subtitles_cs', synced: 'subtitles_cs_synced' },
  { lang: 'en', label: 'English', original: 'subtitles_en', synced: 'subtitles_en_synced' },
]
const MAX_LINE_CHARS = 42
// Below this share of EN cues timed like a CS cue, the two languages change
// at visibly different moments.
const MATCHED_TIMING = 0.8

/** Default per language: the synced file when there is one, else the original. */
function defaultChoice(sources, { original, synced }) {
  if (sources[synced]) return synced
  if (sources[original]) return original
  return ''
}

/** "1:02:03" / "2:03" / "123" -> seconds, '' -> null, invalid -> NaN. */
function parseTime(text) {
  const t = text.trim()
  if (!t) return null
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
}

function layoutText(check, existingLang) {
  if (existingLang) {
    const existing = LANGS.find((l) => l.lang === existingLang).label
    const added =
      existingLang === 'cs' ? 'English, smaller and light grey' : 'Czech, white'
    return `Added to the ${existing} subtitles already burned into the picture: ${added}, at the place set below. The picture is left as it is.`
  }
  if (check.layout === 'dual') {
    return 'Czech at the bottom (white), English at the top (smaller, light grey). With black bars above and below the picture, each goes into its bar.'
  }
  return 'One language only: larger white subtitles at the bottom.'
}

/**
 * Start a burned-in subtitle export: choose which CS/EN files to burn in
 * (synced copies preferred), see readability warnings for them, and for a
 * preview optionally where the clip starts. When the master already has one
 * language burned in, the other one is placed against the movie's preview.
 * `lastAdded` (the movie's latest export over burned-in subtitles) prefills
 * that.
 */
function SubtitleExportModal({ onClose, movieId, kind, sources, lastAdded, onCreated }) {
  const { info, error: showError } = useToast()
  // Mounted per opening (the parent renders it only while open), so the
  // defaults come from the files as they are now.
  const [existingLang, setExistingLang] = useState(lastAdded?.existing_subtitles_lang || '')
  const [placement, setPlacement] = useState(() =>
    lastAdded?.added_position != null
      ? { align: lastAdded.added_align || 'bottom', edge: Number(lastAdded.added_position) }
      : defaultPlacement(lastAdded?.existing_subtitles_lang === 'cs' ? 'en' : 'cs')
  )
  const [choice, setChoice] = useState(() => ({
    cs: lastAdded?.existing_subtitles_lang === 'cs' ? '' : defaultChoice(sources, LANGS[0]),
    en: lastAdded?.existing_subtitles_lang === 'en' ? '' : defaultChoice(sources, LANGS[1]),
  }))
  const onPlacementChange = useCallback((p) => setPlacement(p), [])

  const changeExisting = (lang) => {
    setExistingLang(lang)
    if (!lang) return
    setChoice((c) => ({ ...c, [lang]: '' }))
    // The saved place belongs to the saved burned-in language.
    setPlacement(
      lang === lastAdded?.existing_subtitles_lang && lastAdded?.added_position != null
        ? { align: lastAdded.added_align || 'bottom', edge: Number(lastAdded.added_position) }
        : defaultPlacement(lang === 'cs' ? 'en' : 'cs')
    )
  }
  const addedLang = existingLang ? LANGS.find((l) => l.lang !== existingLang) : null
  const addedKind = addedLang ? choice[addedLang.lang] : ''
  const [startText, setStartText] = useState('')
  const [check, setCheck] = useState(null)
  const [checkError, setCheckError] = useState(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Readability check of the chosen files.
  useEffect(() => {
    if (!choice.cs && !choice.en) {
      setCheck(null)
      setCheckError(null)
      return undefined
    }
    let stale = false
    setChecking(true)
    setCheckError(null)
    subtitleBurnApi
      .check({ movie_id: movieId, cs: choice.cs || null, en: choice.en || null })
      .then((res) => {
        if (!stale) setCheck(res.data)
      })
      .catch((error) => {
        if (!stale) {
          setCheck(null)
          setCheckError(error.response?.data?.error || error.message)
        }
      })
      .finally(() => {
        if (!stale) setChecking(false)
      })
    return () => {
      stale = true
    }
  }, [movieId, choice])

  const previewStart = parseTime(startText)
  const startInvalid = kind === 'preview' && Number.isNaN(previewStart)
  const canSubmit =
    (choice.cs || choice.en) && (!existingLang || addedKind) && !startInvalid && !submitting && !checkError

  const submit = async () => {
    setSubmitting(true)
    try {
      await subtitleBurnApi.create({
        movie_id: movieId,
        kind,
        cs: choice.cs || null,
        en: choice.en || null,
        preview_start_seconds: kind === 'preview' ? previewStart : null,
        existing_subtitles_lang: existingLang || null,
        added_position: existingLang ? placement.edge : null,
        added_align: existingLang ? placement.align : null,
      })
      info(kind === 'preview' ? 'Preview clip queued' : 'Export queued')
      if (onCreated) await onCreated()
      onClose()
    } catch (error) {
      showError('Export failed to start: ' + (error.response?.data?.error || error.message))
      setSubmitting(false)
    }
  }

  const warnings = check
    ? LANGS.filter(({ lang }) => check[lang] && (check[lang].over_two_lines || check[lang].long_lines))
    : []

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={kind === 'preview' ? 'Preview clip with burned-in subtitles' : 'Export with burned-in subtitles'}
      size={existingLang ? 'large' : 'medium'}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {kind === 'preview'
            ? 'Renders about 60 seconds of the movie exactly as the full export will look — by default the part with the most subtitles. Takes a few minutes.'
            : 'Renders the whole movie from the master: 1080p, or 2160p for 4K masters, with the original audio. A feature film takes roughly 1–2 hours in HD, longer in 4K; the worker handles one job at a time.'}
        </p>

        <div className="grid grid-cols-2 gap-4">
          {LANGS.map((l) => (
            <div key={l.lang}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{l.label} subtitles</label>
              <select
                value={choice[l.lang]}
                onChange={(e) => setChoice((c) => ({ ...c, [l.lang]: e.target.value }))}
                disabled={existingLang === l.lang}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100"
              >
                <option value="">{existingLang === l.lang ? 'Already burned in' : 'Don\u2019t burn in'}</option>
                {sources[l.synced] && <option value={l.synced}>Synced</option>}
                {sources[l.original] && <option value={l.original}>Original</option>}
              </select>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Subtitles already burned into the master
          </label>
          <select
            value={existingLang}
            onChange={(e) => changeExisting(e.target.value)}
            className="block w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">None</option>
            {LANGS.map((l) => (
              <option key={l.lang} value={l.lang}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {existingLang && !addedKind && (
          <div className="text-sm text-gray-500">Choose the {addedLang.label} subtitles to add.</div>
        )}
        {existingLang && addedKind && (
          <BurnedInPositioner
            movieId={movieId}
            subtitleKind={addedKind}
            placement={placement}
            onChange={onPlacementChange}
            autoDetect={lastAdded?.added_position == null}
          />
        )}

        {kind === 'preview' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clip start (optional)</label>
            <input
              type="text"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              placeholder="e.g. 0:42:10 — empty = the part with the most subtitles"
              className={`block w-full border rounded-md px-3 py-2 text-sm ${
                startInvalid ? 'border-red-400' : 'border-gray-300'
              }`}
            />
          </div>
        )}

        {checking && <div className="text-sm text-gray-500">Checking subtitles…</div>}
        {checkError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{checkError}</div>
        )}
        {check && !checking && (
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700 space-y-1">
            <div>{layoutText(check, existingLang)}</div>
            {!existingLang && check.layout === 'dual' && check.paired_ratio < MATCHED_TIMING && (
              <div className="text-yellow-800">
                Only {Math.round(check.paired_ratio * 100)} % of the cues are timed the same in both languages, so
                Czech and English will change at different moments. Best is English translated into the Czech
                cue timing (at most 2 lines per language).
              </div>
            )}
            {LANGS.filter(({ lang }) => check[lang]).map(({ lang, label }) => (
              <div key={lang}>
                {label}: {check[lang].cues} subtitles
              </div>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800 space-y-1">
            <div>
              With both languages on screen, long subtitles cover more of the picture. Consider fixing these
              in the{' '}
              <Link to={`/catalogue/${movieId}/subtitles`} className="underline">
                subtitle editor
              </Link>{' '}
              first:
            </div>
            <ul className="list-disc ml-5">
              {warnings.map(({ lang, label }) => (
                <li key={lang}>
                  {label}:{' '}
                  {[
                    check[lang].over_two_lines > 0 && `${check[lang].over_two_lines} with more than 2 lines`,
                    check[lang].long_lines > 0 &&
                      `${check[lang].long_lines} with lines over ${MAX_LINE_CHARS} characters (longest ${check[lang].max_line_length})`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
          >
            {kind === 'preview' ? 'Render preview' : 'Start export'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default SubtitleExportModal
