import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import Scanner from './Scanner'
import { phoneScannerClient } from '../utils/scannerClient'

// Public page opened from a scanner QR code: join with a name, then scan without logging in
const SESSION_KEY = 'scanner.phoneSession' // { linkToken, sessionKey, name, expiresAt }
const NAME_KEY = 'scanner.operatorName'

const readSession = (token) => {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY))
    if (session?.linkToken === token && new Date(session.expiresAt) > new Date()) return session
  } catch {
    // Missing or broken, join again
  }
  return null
}

const formatTime = (time) => String(time).substring(0, 5)
const formatDate = (date) =>
  new Date(date).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'short' })

function Message({ title, children }) {
  return (
    <div className="max-w-md mx-auto bg-white rounded-lg shadow-sm border p-6 text-center">
      <h1 className="text-xl font-semibold text-gray-900 mb-2">{title}</h1>
      <p className="text-gray-600">{children}</p>
    </div>
  )
}

function PhoneScanner() {
  const { token } = useParams()
  const [session, setSession] = useState(() => readSession(token))
  const [link, setLink] = useState(null)
  const [problem, setProblem] = useState(null) // { title, text }
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || '')
  const [joining, setJoining] = useState(false)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (session) return
    fetch(`/api/scanner-session/join/${token}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (response.status === 429) {
          setProblem({ title: 'Too many people joining', text: 'Wait a minute and open the code again.' })
        } else if (!response.ok) {
          setProblem({ title: 'Invalid code', text: data.error || 'This scanner code is not valid.' })
        } else if (!data.joinOpen) {
          setProblem({ title: 'Code expired', text: 'This scanner code has expired. Ask the festival staff for a new one.' })
        } else if (data.screenings.length === 0) {
          setProblem({ title: 'Nothing to scan', text: 'There is nothing left to scan today.' })
        } else {
          setLink(data)
        }
      })
      .catch(() => setProblem({ title: 'No connection', text: 'Check your internet connection and open the code again.' }))
  }, [token, session])

  const join = async (e) => {
    e.preventDefault()
    setJoining(true)
    try {
      const response = await fetch(`/api/scanner-session/join/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setProblem({ title: 'Could not join', text: data.error || 'Please try again.' })
        return
      }
      localStorage.setItem(NAME_KEY, data.name)
      const newSession = { linkToken: token, sessionKey: data.sessionToken, name: data.name, expiresAt: data.expiresAt }
      localStorage.setItem(SESSION_KEY, JSON.stringify(newSession))
      setSession(newSession)
    } catch {
      setProblem({ title: 'No connection', text: 'Check your internet connection and try again.' })
    } finally {
      setJoining(false)
    }
  }

  const endSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setScanning(false)
    setProblem({ title: 'Session ended', text: 'This phone can no longer scan. Ask the festival staff for a new code.' })
  }, [])

  const client = useMemo(
    () => (session ? phoneScannerClient(session.sessionKey, endSession) : null),
    [session, endSession]
  )

  let content
  if (problem) {
    content = <Message title={problem.title}>{problem.text}</Message>
  } else if (session) {
    content = (
      <>
        {!scanning && (
          <div className="max-w-2xl mx-auto mb-4 text-sm text-gray-600">
            Scanning as <span className="font-medium text-gray-900">{session.name}</span>
          </div>
        )}
        <Scanner client={client} onScanningChange={setScanning} />
      </>
    )
  } else if (link) {
    content = (
      <form onSubmit={join} className="max-w-md mx-auto bg-white rounded-lg shadow-sm border p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Scanner</h1>
          <p className="text-sm text-gray-600 mt-1">
            {link.screenings[0].venue.cs} · {formatDate(link.screenings[0].date)}
          </p>
          <ul className="mt-2 text-sm text-gray-700">
            {link.screenings.map(s => (
              <li key={s.id}>{formatTime(s.time)} {s.title.cs || s.title.en}</li>
            ))}
          </ul>
        </div>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoComplete="name"
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-base"
          />
        </label>
        <button
          type="submit"
          disabled={joining || !name.trim()}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {joining ? 'Joining…' : 'Start scanning'}
        </button>
      </form>
    )
  } else {
    content = <div className="text-center text-gray-500 py-12">Loading…</div>
  }

  return (
    <div className={`min-h-screen ${scanning ? 'bg-gray-900' : 'bg-gray-50 p-4'}`}>
      {!scanning && (
        <div className="max-w-2xl mx-auto mb-4 flex items-center gap-2">
          <img
            src="https://irmf.cz/wp-content/uploads/2022/07/irmf_web_logo_90px_black.png"
            alt="IRMF"
            className="h-7 w-auto"
          />
        </div>
      )}
      {content}
    </div>
  )
}

export default PhoneScanner
