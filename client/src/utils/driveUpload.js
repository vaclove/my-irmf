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

/**
 * Upload a File to a Google resumable session URL in 32 MiB chunks, directly
 * from the browser. HTTP 308 means "chunk received, keep going"; 200/201 means
 * the whole file is committed and the response carries the Drive file id.
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

  while (start < size) {
    if (shouldCancel && shouldCancel()) {
      const err = new Error('Upload cancelled')
      err.cancelled = true
      throw err
    }

    const end = Math.min(start + CHUNK_SIZE, size)
    const chunk = file.slice(start, end)
    let attempt = 0

    // Retry loop for this chunk.
    // eslint-disable-next-line no-constant-condition
    while (true) {
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

        // 308: chunk accepted. Advance using the server's Range if present.
        const range = res.headers['range']
        const m = range && /bytes=\d+-(\d+)/.exec(range)
        start = m ? parseInt(m[1], 10) + 1 : end
        break
      } catch (err) {
        attempt += 1
        if (attempt > MAX_RETRIES) throw err
        // Network hiccup: re-sync with the server's committed offset, then retry.
        try {
          const probed = await probeOffset(sessionUrl, size)
          if (probed.done) {
            if (onProgress) onProgress({ loaded: size, total: size })
            return probed.id
          }
          start = probed.offset
        } catch {
          // ignore probe failure; back off and retry the same chunk
        }
        await sleep(1000 * attempt)
        break // recompute chunk from the (possibly updated) start
      }
    }

    if (onProgress) onProgress({ loaded: Math.min(start, size), total: size })
  }

  // Loop finished without an explicit 200/201 (rare) — confirm via a probe.
  const finalProbe = await probeOffset(sessionUrl, size).catch(() => null)
  return finalProbe && finalProbe.done ? finalProbe.id : null
}
