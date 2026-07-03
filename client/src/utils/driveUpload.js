import axios from 'axios'

// 32 MiB — must be a multiple of 256 KiB per Google's resumable-upload rules.
const CHUNK_SIZE = 32 * 1024 * 1024
const MAX_RETRIES = 5

// Bare axios instance: no cookies, no JSON defaults — the target is a
// googleusercontent upload URL, not our API.
const raw = axios.create({
  withCredentials: false,
  transformRequest: [(data) => data],
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function extractFileId(data) {
  if (!data) return null
  if (typeof data === 'string') {
    try {
      return JSON.parse(data).id
    } catch {
      return null
    }
  }
  return data.id || null
}

/** Ask Google how many bytes it has committed for this session. */
async function probeOffset(sessionUrl, size) {
  const res = await raw.put(sessionUrl, '', {
    headers: { 'Content-Range': `bytes */${size}` },
    validateStatus: (s) => s === 200 || s === 201 || s === 308,
  })
  if (res.status === 200 || res.status === 201) {
    return { done: true, id: extractFileId(res.data) }
  }
  const range = res.headers['range']
  const m = range && /bytes=\d+-(\d+)/.exec(range)
  return { done: false, offset: m ? parseInt(m[1], 10) + 1 : 0 }
}

// Google resumable upload: 5xx plus 408/429 are transient and worth retrying;
// 404 (session gone) and other 4xx are permanent — the session is unrecoverable.
function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

/**
 * Upload a File to a Google resumable session URL in 32 MiB chunks, directly
 * from the browser. HTTP 308 means "chunk received, keep going"; 200/201 means
 * the whole file is committed and the response carries the Drive file id.
 *
 * Retries are counted per chunk across replays (reset only when real progress is
 * made), so a persistently failing session is capped by MAX_RETRIES instead of
 * looping forever, and a permanent status (e.g. 404) aborts immediately.
 *
 * @param {File} file
 * @param {string} sessionUrl  resumable session URI from the backend
 * @param {{onProgress?:(p:{loaded:number,total:number})=>void, shouldCancel?:()=>boolean}} opts
 * @returns {Promise<string>} the uploaded Drive file id
 */
export async function uploadToDriveSession(file, sessionUrl, opts = {}) {
  const { onProgress, shouldCancel } = opts
  const size = file.size
  let start = 0
  let attempt = 0 // retries for the current (unchanged) offset

  while (start < size) {
    if (shouldCancel && shouldCancel()) {
      const err = new Error('Upload cancelled')
      err.cancelled = true
      throw err
    }

    const end = Math.min(start + CHUNK_SIZE, size)
    const chunk = file.slice(start, end)

    try {
      const res = await raw.put(sessionUrl, chunk, {
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
        validateStatus: (s) => s === 200 || s === 201 || s === 308,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      })

      if (res.status === 200 || res.status === 201) {
        if (onProgress) onProgress({ loaded: size, total: size })
        return extractFileId(res.data)
      }

      // 308: chunk accepted. Advance using the server's Range if present and
      // reset the retry budget since we made forward progress.
      const range = res.headers['range']
      const m = range && /bytes=\d+-(\d+)/.exec(range)
      start = m ? parseInt(m[1], 10) + 1 : end
      attempt = 0
      if (onProgress) onProgress({ loaded: Math.min(start, size), total: size })
    } catch (err) {
      // A non-2xx/308 response surfaces here (validateStatus rejected it).
      // Permanent statuses (404 session gone, other 4xx) are fatal.
      const status = err.response?.status
      if (status && !isRetryableStatus(status)) {
        throw new Error(`Upload failed with unrecoverable status ${status}`)
      }
      attempt += 1
      if (attempt > MAX_RETRIES) throw err
      // Re-sync with the server's committed offset, then retry the same chunk.
      try {
        const probed = await probeOffset(sessionUrl, size)
        if (probed.done) {
          if (onProgress) onProgress({ loaded: size, total: size })
          return probed.id
        }
        start = probed.offset
      } catch (probeErr) {
        const pstatus = probeErr.response?.status
        if (pstatus && !isRetryableStatus(pstatus)) {
          throw new Error(`Upload session unrecoverable (status ${pstatus})`)
        }
        // transient probe failure: fall through to back off and retry
      }
      await sleep(1000 * attempt)
    }
  }

  // Loop finished without an explicit 200/201 (rare) — confirm via a probe.
  const finalProbe = await probeOffset(sessionUrl, size).catch(() => null)
  return finalProbe && finalProbe.done ? finalProbe.id : null
}
