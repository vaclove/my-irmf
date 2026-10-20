import React, { useState, useEffect, useMemo, useRef } from 'react'
import { qlabApi } from '../utils/api'

// Live view of the projection QLab: what plays now, how far it is and the
// show's cue list. The server proxies and caches the read-only QLab API
// (server/services/qlab.js); between polls the progress runs on locally.
const STATUS_POLL_MS = 1500
const CUELISTS_POLL_MS = 60 * 1000
// Refetch the show sooner when a running cue is missing from it
const CUELISTS_RETRY_MS = 10 * 1000
const TICK_MS = 250
// The bridge takes a new projector frame at most every 10 s
const SNAPSHOT_REFRESH_MS = 10 * 1000
// Older frames get their age shown (the Mac or projector dropped out)
const SNAPSHOT_STALE_MS = 30 * 1000

const STATES = {
  ok: { label: 'Live', dot: 'bg-green-500', pill: 'bg-green-50 text-green-700 border-green-200' },
  offline: {
    label: 'Projection offline',
    dot: 'bg-gray-400',
    pill: 'bg-gray-50 text-gray-600 border-gray-200',
    message: 'The projection Mac is off or not connected (bridge or tunnel is not running).',
  },
  qlab_down: {
    label: 'QLab not running',
    dot: 'bg-amber-500',
    pill: 'bg-amber-50 text-amber-700 border-amber-200',
    message: 'The Mac is online, but QLab is not running or has no workspace open.',
  },
  error: {
    label: 'Data unavailable',
    dot: 'bg-red-500',
    pill: 'bg-red-50 text-red-700 border-red-200',
    message: 'The QLab API rejected the request. Check the service token in the app settings.',
  },
  not_configured: {
    label: 'Not configured',
    dot: 'bg-red-500',
    pill: 'bg-red-50 text-red-700 border-red-200',
    message: 'QLAB_API_URL, QLAB_CF_CLIENT_ID and QLAB_CF_CLIENT_SECRET are not set on the server.',
  },
  unreachable: {
    label: 'Server unreachable',
    dot: 'bg-red-500',
    pill: 'bg-red-50 text-red-700 border-red-200',
    message: 'my.irmf.cz did not answer the last status request.',
  },
}

const COLOR_DOTS = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  gray: 'bg-gray-400',
  grey: 'bg-gray-400',
}

function formatTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–'
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`
  return h ? `${h}:${mmss}` : mmss
}

/** Elapsed seconds now, run on from the poll unless the cue is paused. */
function liveElapsed(cue, receivedAt, now) {
  if (cue.elapsed === null) return null
  const elapsed = cue.paused ? cue.elapsed : cue.elapsed + Math.max(0, now - receivedAt) / 1000
  return cue.duration > 0 ? Math.min(elapsed, cue.duration) : elapsed
}

/** The film on screen: the longest Video, otherwise the first running cue. */
function pickMainCue(running) {
  const videos = running.filter((cue) => cue.type === 'Video')
  if (videos.length) return videos.reduce((a, b) => ((b.duration || 0) > (a.duration || 0) ? b : a))
  return running[0] || null
}

/** Sibling list and position of a cue anywhere in the cue-list tree. */
function locateCue(cues, id) {
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].uniqueID === id) return { siblings: cues, index: i }
    if (cues[i].cues) {
      const found = locateCue(cues[i].cues, id)
      if (found) return found
    }
  }
  return null
}

const ProgressBar = ({ elapsed, duration, paused, large = false }) => {
  const height = large ? 'h-3' : 'h-1.5'
  if (!(duration > 0) || elapsed === null) {
    return (
      <div className={`${height} w-full rounded-full bg-gray-100 overflow-hidden`}>
        <div className={`${height} w-1/3 rounded-full bg-blue-200 animate-pulse`} />
      </div>
    )
  }
  const percent = Math.min(100, (elapsed / duration) * 100)
  return (
    <div className={`${height} w-full rounded-full bg-gray-100 overflow-hidden`}>
      <div
        className={`${height} rounded-full ${paused ? 'bg-amber-400' : 'bg-blue-600'} transition-[width] duration-200 ease-linear`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/** What the projector shows now, reloaded every 10 s while the tab is visible. */
const ProjectorSnapshot = ({ ageMs }) => {
  const [stamp, setStamp] = useState(Date.now())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setStamp(Date.now())
    }, SNAPSHOT_REFRESH_MS)
    return () => clearInterval(interval)
  }, [])

  return (
    <figure className="w-full md:w-80 lg:w-96 shrink-0">
      <div className="relative aspect-video rounded-md overflow-hidden bg-gray-900">
        <img
          src={qlabApi.snapshotUrl(stamp)}
          alt="Projector output"
          className={`w-full h-full object-contain ${failed ? 'invisible' : ''}`}
          onLoad={() => setFailed(false)}
          onError={() => setFailed(true)}
        />
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            No projector image
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-xs text-gray-500">
        On screen{!failed && ageMs > SNAPSHOT_STALE_MS ? ` · ${formatTime(ageMs / 1000)} ago` : ', every 10 s'}
      </figcaption>
    </figure>
  )
}

const CueRows = ({ cues, depth, runningById, mainId, nextId }) =>
  cues.map((cue) => {
    const running = runningById.get(cue.uniqueID)
    const isMain = cue.uniqueID === mainId
    let badge = null
    if (running) {
      badge = running.paused ? (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Paused</span>
      ) : (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Playing</span>
      )
    } else if (cue.uniqueID === nextId) {
      badge = <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Next</span>
    } else if (!cue.armed) {
      badge = <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Disarmed</span>
    }
    return (
      <React.Fragment key={cue.uniqueID}>
        <tr className={isMain ? 'bg-green-50' : running ? 'bg-green-50/50' : cue.uniqueID === nextId ? 'bg-blue-50/50' : ''}>
          <td className="px-4 py-2 text-sm text-gray-500 tabular-nums w-16">{cue.number}</td>
          <td className="px-4 py-2 text-sm">
            <div className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
              {COLOR_DOTS[cue.colorName] && <span className={`h-2.5 w-2.5 rounded-full ${COLOR_DOTS[cue.colorName]}`} />}
              <span className={`${isMain ? 'font-semibold text-gray-900' : 'text-gray-800'} ${cue.armed ? '' : 'line-through text-gray-400'}`}>
                {cue.name || <span className="italic text-gray-400">untitled</span>}
              </span>
              {cue.flagged && <span title="Flagged">🚩</span>}
            </div>
          </td>
          <td className="px-4 py-2 text-sm text-gray-500 w-28">{cue.type}</td>
          <td className="px-4 py-2 text-right w-28">{badge}</td>
        </tr>
        {cue.cues && (
          <CueRows cues={cue.cues} depth={depth + 1} runningById={runningById} mainId={mainId} nextId={nextId} />
        )}
      </React.Fragment>
    )
  })

const QLab = () => {
  const [status, setStatus] = useState(null) // { ...response, receivedAt }
  const [cuelists, setCuelists] = useState(null)
  const [now, setNow] = useState(Date.now())
  const lastCuelistsFetch = useRef(0)

  // Status poll; paused while the browser tab is hidden
  useEffect(() => {
    let cancelled = false
    let timer = null
    const poll = async () => {
      if (!document.hidden) {
        try {
          const response = await qlabApi.getStatus()
          if (!cancelled) setStatus({ ...response.data, receivedAt: Date.now() - response.data.ageMs })
        } catch (error) {
          if (!cancelled) setStatus((prev) => ({ ...(prev || {}), state: 'unreachable', receivedAt: Date.now() }))
        }
      }
      if (!cancelled) timer = setTimeout(poll, STATUS_POLL_MS)
    }
    poll()
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        poll()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const fetchCuelists = async () => {
    lastCuelistsFetch.current = Date.now()
    try {
      const response = await qlabApi.getCuelists()
      setCuelists(response.data)
    } catch (error) {
      // The status pill already reports an unreachable server
    }
  }

  useEffect(() => {
    fetchCuelists()
    const interval = setInterval(fetchCuelists, CUELISTS_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  const running = status?.state === 'ok' ? status.running : []
  const mainCue = useMemo(() => pickMainCue(running), [running])
  const runningById = useMemo(() => new Map(running.map((cue) => [cue.uniqueID, cue])), [running])
  const cueLists = cuelists?.cueLists || []

  const nextCue = useMemo(() => {
    if (!mainCue) return null
    for (const list of cueLists) {
      const found = locateCue(list.cues || [], mainCue.uniqueID)
      if (found) return found.siblings.slice(found.index + 1).find((cue) => cue.armed) || null
    }
    return null
  }, [mainCue, cueLists])

  // A running cue the cue list does not know means the show was edited
  useEffect(() => {
    if (!running.length || cuelists?.state !== 'ok') return
    const known = running.every((cue) => cueLists.some((list) => locateCue(list.cues || [], cue.uniqueID)))
    if (!known && Date.now() - lastCuelistsFetch.current > CUELISTS_RETRY_MS) fetchCuelists()
  }, [running, cuelists, cueLists])

  if (!status) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const stateInfo = STATES[status.state] || STATES.error
  const secondsAgo = Math.max(0, Math.round((now - status.receivedAt) / 1000))
  const mainElapsed = mainCue ? liveElapsed(mainCue, status.receivedAt, now) : null
  const otherRunning = running.filter((cue) => cue !== mainCue)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Projection QLab</h2>
          <p className="text-sm text-gray-500">
            {status.workspace ? `Workspace ${status.workspace}` : 'Live status of the projection Mac, read-only'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {secondsAgo > 5 && <span className="text-xs text-gray-400">updated {secondsAgo} s ago</span>}
          <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-medium ${stateInfo.pill}`}>
            <span className={`h-2 w-2 rounded-full ${stateInfo.dot} ${status.state === 'ok' ? 'animate-pulse' : ''}`} />
            {stateInfo.label}
          </span>
        </div>
      </div>

      {/* Now playing */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 min-w-0">
            {status.state !== 'ok' ? (
              <div className="text-center py-8">
                <p className="text-gray-700 font-medium">{stateInfo.label}</p>
                <p className="text-sm text-gray-500 mt-1">{stateInfo.message}</p>
              </div>
            ) : !mainCue ? (
              <div className="text-center py-8">
                <p className="text-gray-700 font-medium">Nothing is playing</p>
                <p className="text-sm text-gray-500 mt-1">QLab is ready, no cue is running.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {mainCue.paused ? 'Paused' : 'Now playing'}
                      {mainCue.number && ` · cue ${mainCue.number}`}
                      {mainCue.type && ` · ${mainCue.type}`}
                    </p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1 break-words">{mainCue.name || 'Untitled cue'}</h3>
                  </div>
                  {mainCue.paused && (
                    <span className="shrink-0 px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-800">⏸ Paused</span>
                  )}
                </div>
                <ProgressBar elapsed={mainElapsed} duration={mainCue.duration} paused={mainCue.paused} large />
                <div className="grid grid-cols-3 text-sm">
                  <div>
                    <p className="text-gray-500">Elapsed</p>
                    <p className="text-lg font-semibold text-gray-900 tabular-nums">{formatTime(mainElapsed)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-gray-500">Remaining</p>
                    <p className="text-lg font-semibold text-gray-900 tabular-nums">
                      {mainCue.duration > 0 && mainElapsed !== null ? `−${formatTime(mainCue.duration - mainElapsed)}` : '–'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-500">Duration</p>
                    <p className="text-lg font-semibold text-gray-900 tabular-nums">
                      {mainCue.duration > 0 ? formatTime(mainCue.duration) : '–'}
                    </p>
                  </div>
                </div>
                {mainCue.duration > 0 && mainElapsed !== null && !mainCue.paused && (
                  <p className="text-sm text-gray-500">
                    Ends at{' '}
                    {new Date(now + (mainCue.duration - mainElapsed) * 1000).toLocaleTimeString('cs-CZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            )}
            {status.state === 'ok' && nextCue && (
              <div className="mt-5 pt-4 border-t text-sm text-gray-600">
                <span className="text-gray-500">Next:</span>{' '}
                {nextCue.number && <span className="text-gray-500 tabular-nums">{nextCue.number} · </span>}
                <span className="font-medium text-gray-800">{nextCue.name}</span>
              </div>
            )}
          </div>
          {status.state === 'ok' && <ProjectorSnapshot ageMs={status.snapshotAgeMs} />}
        </div>
      </div>

      {/* Other running cues */}
      {otherRunning.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Also running</h3>
          <div className="space-y-3">
            {otherRunning.map((cue) => {
              const elapsed = liveElapsed(cue, status.receivedAt, now)
              return (
                <div key={cue.uniqueID}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-800">
                      {cue.number && <span className="text-gray-500 tabular-nums">{cue.number} · </span>}
                      {cue.name || 'Untitled cue'} <span className="text-gray-400">({cue.type})</span>
                      {cue.paused && <span className="ml-2 text-amber-700">paused</span>}
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      {formatTime(elapsed)}
                      {cue.duration > 0 && ` / ${formatTime(cue.duration)}`}
                    </span>
                  </div>
                  <ProgressBar elapsed={elapsed} duration={cue.duration} paused={cue.paused} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cue lists */}
      {cueLists.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {cuelists.stale && (
            <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b">
              Last known cue list, QLab is not reachable right now.
            </div>
          )}
          {cueLists.map((list) => (
            <div key={list.uniqueID}>
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{list.name}</h3>
                <span className="text-xs text-gray-500">{list.type}</span>
              </div>
              {list.cues?.length ? (
                <table className="min-w-full divide-y divide-gray-100">
                  <tbody className="divide-y divide-gray-100">
                    <CueRows
                      cues={list.cues}
                      depth={0}
                      runningById={runningById}
                      mainId={mainCue?.uniqueID}
                      nextId={nextCue?.uniqueID}
                    />
                  </tbody>
                </table>
              ) : (
                <p className="px-4 py-3 text-sm text-gray-500">No cues</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default QLab
