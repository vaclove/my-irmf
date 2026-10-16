import { useState, useEffect, useCallback } from 'react'
import Modal from './Modal'

const formatTime = (time) => String(time).substring(0, 5)

const agoText = (iso, now) => {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

const countdown = (ms) => {
  const seconds = Math.max(Math.ceil(ms / 1000), 0)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * QR code that lets any phone scan a screening (and the later ones in the same
 * venue that day) without logging in, plus the phones that joined.
 */
function ShareScannerModal({ screening, onClose }) {
  const [link, setLink] = useState(null)
  const [devices, setDevices] = useState([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  const createLink = useCallback(async () => {
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/scanner/links', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programming_id: screening.id })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setLink(data)
    } catch (err) {
      setError(err.message || 'Failed to create scanner code')
    } finally {
      setCreating(false)
    }
  }, [screening.id])

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch(`/api/scanner/devices?programming_id=${screening.id}`, { credentials: 'include' })
      if (response.ok) setDevices((await response.json()).devices)
    } catch (err) {
      console.error('Error loading scanner devices:', err)
    }
  }, [screening.id])

  useEffect(() => {
    createLink()
    loadDevices()
    const poll = setInterval(loadDevices, 10000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [createLink, loadDevices])

  const disconnect = async (device) => {
    if (!confirm(`Disconnect ${device.name}'s phone? It will stop scanning right away.`)) return
    try {
      await fetch(`/api/scanner/devices/${device.id}/disconnect`, { method: 'POST', credentials: 'include' })
    } finally {
      loadDevices()
    }
  }

  const copyUrl = async () => {
    await navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const joinLeft = link ? new Date(link.joinUntil).getTime() - now : 0
  const expired = link && joinLeft <= 0

  return (
    <Modal isOpen onClose={onClose} title="Share scanner" size="medium">
      <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
        <p className="text-sm text-gray-600">
          Scan this code with any phone to use it as a scanner, no login needed.
        </p>

        {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</div>}

        {link && (
          <div className="flex flex-col sm:flex-row gap-5 items-center">
            <img
              src={link.qr}
              alt="Scanner QR code"
              className={`w-56 h-56 border rounded ${expired ? 'opacity-20' : ''}`}
            />
            <div className="flex-1 min-w-0 space-y-3 text-sm">
              <div>
                {expired ? (
                  <span className="text-red-700 font-medium">Code expired, phones can't join with it anymore</span>
                ) : (
                  <span className="text-gray-700">
                    Phones can join for <span className="font-semibold tabular-nums">{countdown(joinLeft)}</span>
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input readOnly value={link.url} className="flex-1 min-w-0 px-2 py-1 border rounded text-xs text-gray-600 bg-gray-50" />
                <button onClick={copyUrl} className="px-2 py-1 border rounded text-xs hover:bg-gray-50">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button
                onClick={createLink}
                disabled={creating}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'New code'}
              </button>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Phones can scan</div>
                <ul className="text-gray-700">
                  {link.screenings.map(s => (
                    <li key={s.id}>{formatTime(s.time)} {s.title.cs || s.title.en}</li>
                  ))}
                </ul>
                <div className="text-xs text-gray-500 mt-1">
                  {screening.venue.cs}, until 1 hour after each screening ends
                </div>
              </div>
            </div>
          </div>
        )}

        {!link && !error && <div className="text-center text-gray-500 py-10">Creating scanner code…</div>}

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Connected phones</h3>
          {devices.length === 0 ? (
            <p className="text-sm text-gray-500">No phones yet</p>
          ) : (
            <ul className="divide-y border rounded-md">
              {devices.map(device => (
                <li key={device.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{device.name}</div>
                    <div className="text-xs text-gray-500">
                      {device.scans} scans · active {agoText(device.lastSeenAt, now)}
                    </div>
                  </div>
                  {device.active ? (
                    <button onClick={() => disconnect(device)} className="text-red-600 hover:text-red-800 text-xs font-medium">
                      Disconnect
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">{device.disconnected ? 'Disconnected' : 'Ended'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default ShareScannerModal
