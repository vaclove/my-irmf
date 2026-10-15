// API used by the Scanner page: staff (logged-in session) or a phone that joined
// through a scanner link (session key, see server/routes/scanner-session.js).
// Every call resolves to { ok, status, data } and never throws on HTTP errors.

const request = async (url, options = {}) => {
  const response = await fetch(url, options)
  let data = null
  try {
    data = await response.json()
  } catch {
    // Not JSON (e.g. an older server answering with index.html)
  }
  return { ok: response.ok, status: response.status, data: data || {} }
}

const json = (body) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})

export const staffScannerClient = {
  isPhone: false,
  screenings: (editionId) =>
    request(`/api/scanner/screenings?edition_id=${editionId}`, { credentials: 'include' }),
  scans: (programmingId) =>
    request(`/api/scanner/scans/${programmingId}`, { credentials: 'include' }),
  scan: (programmingId, code) =>
    request('/api/scanner/scan', {
      method: 'POST',
      credentials: 'include',
      ...json({ programming_id: programmingId, scanned_code: code })
    }),
  removeScan: (scanId) =>
    request(`/api/scanner/scans/${scanId}`, { method: 'DELETE', credentials: 'include' }),
  editionScans: (editionId) =>
    request(`/api/scanner/edition/${editionId}/scans`, { credentials: 'include' })
}

/**
 * @param {string} sessionKey - the phone's session key from joining
 * @param {() => void} onSessionEnded - called when the server no longer accepts the key
 */
export const phoneScannerClient = (sessionKey, onSessionEnded) => {
  const authorized = async (url, options = {}) => {
    const result = await request(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${sessionKey}` }
    })
    if (result.status === 401) onSessionEnded()
    return result
  }

  return {
    isPhone: true,
    screenings: () => authorized('/api/scanner-session/screenings'),
    scans: (programmingId) => authorized(`/api/scanner-session/scans/${programmingId}`),
    scan: (programmingId, code) =>
      authorized('/api/scanner-session/scan', {
        method: 'POST',
        ...json({ programming_id: programmingId, scanned_code: code })
      }),
    // Phones can't remove scans or see the edition history
    removeScan: null,
    editionScans: null
  }
}
