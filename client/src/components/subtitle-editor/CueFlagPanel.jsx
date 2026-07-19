const SEVERITY_DOT = {
  error: 'bg-red-500',
  warn: 'bg-amber-400',
  info: 'bg-blue-400',
}

/**
 * Expanded detail for a flagged cue: each quality-gate finding with its
 * severity and message, plus the (shared) LLM fix suggestion with Accept /
 * Dismiss actions. Accept only fills the cue's textarea (a normal dirty
 * edit) — the flag is resolved in the DB when the file is saved.
 */
function CueFlagPanel({ flags, onAccept, onDismiss, busy }) {
  if (!flags || flags.length === 0) return null
  const suggestion = flags.find((f) => f.suggestion)?.suggestion || null
  const verified = flags.some((f) => f.suggestion && f.suggestion_verified)

  return (
    <div className="ml-16 mb-1 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm space-y-2">
      <ul className="space-y-1">
        {flags.map((f) => (
          <li key={f.id} className="flex items-start gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[f.severity] || 'bg-gray-400'}`} />
            <span className="text-gray-700">
              <span className="font-mono text-xs font-semibold text-gray-500 mr-1">{f.code}</span>
              {f.message}
            </span>
          </li>
        ))}
      </ul>

      {suggestion && (
        <div className="rounded border border-blue-200 bg-blue-50 p-2">
          <div className="flex items-center gap-2 text-xs text-blue-800 font-medium mb-1">
            Suggested fix
            {verified && (
              <span className="inline-flex items-center gap-0.5 text-green-700" title="The suggestion passes all quality checks">
                ✓ verified
              </span>
            )}
          </div>
          <div className="whitespace-pre-line text-gray-900">{suggestion}</div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {suggestion && (
          <button
            onClick={onAccept}
            disabled={busy}
            className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs hover:bg-blue-700 disabled:opacity-50"
          >
            Accept suggestion
          </button>
        )}
        <button
          onClick={onDismiss}
          disabled={busy}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          title="Dismiss these findings — the cue is fine as it is"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

export default CueFlagPanel
