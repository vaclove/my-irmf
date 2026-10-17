// Find subtitles already burned into a movie's picture, from frames of its
// preview proxy, so added subtitles can be placed clear of them.
//
// Burned-in subtitles are bright (white or yellow) glyphs with a dark outline,
// in one or two lines of fixed height near the bottom, centered, and they come
// and go. Per frame we count "outlined bright" pixels per row in the bottom
// half, keep runs of rows about one text line tall, and then take the band of
// rows that holds such text across enough of the sampled frames.

const BRIGHT_LUMA = 190
const DARK_LUMA = 50
const OUTLINE_REACH = 3 // px between a glyph pixel and its dark outline
const ROW_MIN_SHARE = 0.03 // of the analysed width, for a row to count as text
const LINE_MIN = 0.015 // a run of text rows: one line (1.5 % of the frame height)
const LINE_MAX = 0.22 // up to ~3 touching lines (22 %)
const MIN_FRAME_SHARE = 0.03 // of sampled frames a row must hold text in (sparse dialogue)
const MIN_FRAME_HITS = 3
const BAR_MAX_LUMA = 32 // brightest pixel of a letterbox bar row
const CLUSTER_GAP = 0.06 // rows closer than this belong to one band (line spacing)

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

/**
 * Rows (in the bottom half) that hold a line of outlined bright text.
 * @param {ImageData} image a frame, any size
 * @returns {number[]} row indexes
 */
export function textRows(image) {
  const { data, width: w, height: h } = image
  const Y = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) Y[p] = luma(data, p * 4)
  const isGlyph = (p) => {
    const i = p * 4
    if (Y[p] >= BRIGHT_LUMA) return true
    return data[i] >= 170 && data[i + 1] >= 150 && data[i + 2] <= 110 // yellow
  }
  const x0 = Math.floor(w * 0.1)
  const x1 = Math.ceil(w * 0.9)
  const minCount = Math.max(4, w * ROW_MIN_SHARE)
  const hit = []
  for (let y = Math.floor(h / 2); y < h; y++) {
    let count = 0
    for (let x = x0; x < x1; x++) {
      const p = y * w + x
      if (!isGlyph(p)) continue
      let outlined = false
      for (let r = 2; r <= OUTLINE_REACH && !outlined; r++) {
        outlined =
          (x - r >= 0 && Y[p - r] <= DARK_LUMA) ||
          (x + r < w && Y[p + r] <= DARK_LUMA) ||
          (y - r >= 0 && Y[p - r * w] <= DARK_LUMA) ||
          (y + r < h && Y[p + r * w] <= DARK_LUMA)
      }
      if (outlined) count++
    }
    hit.push(count >= minCount ? y : -1)
  }
  // Keep runs one to about three text lines tall: bright scenery makes taller runs.
  const rows = []
  let run = []
  const flush = () => {
    if (run.length >= h * LINE_MIN && run.length <= h * LINE_MAX) rows.push(...run)
    run = []
  }
  for (const y of hit) {
    if (y >= 0 && (run.length === 0 || y === run[run.length - 1] + 1)) run.push(y)
    else {
      flush()
      if (y >= 0) run.push(y)
    }
  }
  flush()
  return rows
}

/**
 * Height in rows of a black bar at the top of a frame (a letterbox baked into
 * the master), or null for a frame that is mostly dark (fades, night).
 */
export function topBarRows(image) {
  const { data, width: w, height: h } = image
  let rows = 0
  for (let y = 0; y < h; y++) {
    let max = 0
    for (let x = 0; x < w; x += 2) max = Math.max(max, luma(data, (y * w + x) * 4))
    if (max >= BAR_MAX_LUMA) break
    rows++
  }
  return rows >= h * 0.4 ? null : rows
}

/**
 * The band of burned-in subtitles across sampled frames.
 * @param {number[][]} framesRows textRows() of each frame
 * @param {number} height frame height the rows refer to
 * @returns {{top: number, bottom: number, frames: number}|null} as fractions
 *   of the frame height, and in how many frames text was found
 */
export function subtitleBand(framesRows, height) {
  const hits = new Array(height).fill(0)
  let frames = 0
  for (const rows of framesRows) {
    if (rows.length) frames++
    for (const y of rows) hits[y]++
  }
  const minHits = Math.max(MIN_FRAME_HITS, Math.ceil(framesRows.length * MIN_FRAME_SHARE))
  const rows = []
  for (let y = 0; y < height; y++) if (hits[y] >= minHits) rows.push(y)
  if (rows.length === 0) return null

  // One-line and two-line subtitles merge into one band; keep the band with
  // the most text (credits or signs elsewhere are rarer).
  const gap = height * CLUSTER_GAP
  const bands = []
  for (const y of rows) {
    const last = bands[bands.length - 1]
    if (last && y - last.bottom <= gap) {
      last.bottom = y
      last.weight += hits[y]
    } else bands.push({ top: y, bottom: y, weight: hits[y] })
  }
  const best = bands.reduce((a, b) => (b.weight > a.weight ? b : a))
  return { top: best.top / height, bottom: (best.bottom + 1) / height, frames }
}

/**
 * Where the picture sits in the 16:9 export canvas (centered, as exports over
 * burned-in subtitles render it), as fractions of the canvas height.
 */
export function pictureInCanvas(videoWidth, videoHeight) {
  const aspect = videoWidth / videoHeight
  const height = aspect > 16 / 9 ? 16 / 9 / aspect : 1
  return { top: (1 - height) / 2, height }
}

/**
 * Sample times: evenly across the movie, plus moments when the added
 * subtitles are on screen (when they are synced to this master, someone is
 * talking there, so the burned-in ones show too).
 */
export function sampleTimes(duration, cueTimes = [], { even = 60, fromCues = 60 } = {}) {
  const times = []
  for (let i = 0; i < even; i++) times.push(duration * (0.05 + (0.9 * i) / Math.max(1, even - 1)))
  const usable = cueTimes.filter((t) => t > 0 && t < duration)
  const n = Math.min(fromCues, usable.length)
  for (let i = 0; i < n; i++) times.push(usable[Math.floor((i * usable.length) / n)])
  return times.sort((a, b) => a - b)
}

/**
 * Seek through a video and find its burned-in subtitle band and any black
 * bar at the top.
 * @param {string} url direct (CORS-readable) URL of the preview proxy
 * @param {{cueTimes?: number[], onProgress?: (done: number, total: number) => void}} opts
 *   cueTimes: seconds when the added subtitles are on screen
 * @returns {Promise<{band: {top, bottom, frames}|null, topBar: number, samples, videoWidth, videoHeight}>}
 *   band and topBar as fractions of the frame height
 */
export async function detectBurnedInSubtitles(url, { cueTimes = [], onProgress } = {}) {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  const once = (event) =>
    new Promise((resolve, reject) => {
      const ok = () => {
        video.removeEventListener('error', fail)
        resolve()
      }
      const fail = () => {
        video.removeEventListener(event, ok)
        reject(new Error('The preview video could not be read'))
      }
      video.addEventListener(event, ok, { once: true })
      video.addEventListener('error', fail, { once: true })
    })
  const loaded = once('loadedmetadata')
  video.src = url
  await loaded

  const { videoWidth, videoHeight } = video
  const width = 480
  const height = Math.round((width * videoHeight) / videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const times = sampleTimes(video.duration, cueTimes)
  const samples = times.length
  const framesRows = []
  const topBars = []
  try {
    for (let i = 0; i < samples; i++) {
      const seeked = once('seeked')
      video.currentTime = times[i]
      await seeked
      ctx.drawImage(video, 0, 0, width, height)
      const image = ctx.getImageData(0, 0, width, height)
      framesRows.push(textRows(image))
      const bar = topBarRows(image)
      if (bar != null) topBars.push(bar)
      if (onProgress) onProgress(i + 1, samples)
    }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
  return {
    band: subtitleBand(framesRows, height),
    // The thinnest bar seen: a scene reaching into it means it is picture.
    topBar: topBars.length ? Math.min(...topBars) / height : 0,
    samples,
    videoWidth,
    videoHeight,
  }
}
