/**
 * Stream a Drive file's bytes back to an HTTP client with Range support.
 *
 * Forwards the client's Range header to Drive's alt=media endpoint using a
 * freshly-fetched access token (so long streams outlive the ~1h token life),
 * and mirrors the upstream status (200/206/416) and content headers. Setting
 * Accept-Ranges: bytes is what lets an HTML5 <video> element (and ffmpeg's http
 * demuxer) seek.
 *
 * Used by the app's authenticated stream endpoint and by the transcode worker's
 * loopback input proxy that ffmpeg reads from.
 */

const axios = require('axios');
const googleDrive = require('./googleDrive');

const DRIVE_MEDIA_BASE = 'https://www.googleapis.com/drive/v3/files';

// Hard wall-clock cap for the upstream Drive fetch. axios `timeout` is only a
// socket-inactivity timeout for streamed responses, so use AbortSignal for a
// deadline that covers the whole request.
const UPSTREAM_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Transient Drive failures (rate limits, 5xx, dropped connections) are retried
// with exponential backoff before giving up: 1 s, 2 s, 4 s.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 1000;
const RETRYABLE_403_REASONS = [
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'internalError',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull status + Drive's reason/message out of a failed request. With
 * responseType 'stream' the error body is a stream, so read a bounded prefix.
 */
async function describeUpstreamError(error) {
  const status = error.response?.status || null;
  let reason = null;
  let message = error.message;
  const body = error.response?.data;
  if (body && typeof body.on === 'function') {
    try {
      let raw = '';
      for await (const chunk of body) {
        raw += chunk.toString();
        if (raw.length > 8192) break;
      }
      const parsed = JSON.parse(raw);
      reason = parsed?.error?.errors?.[0]?.reason || null;
      message = parsed?.error?.message || message;
    } catch {
      // not JSON / unreadable — keep axios' message
    }
  }
  return { status, reason, message };
}

function isRetryable(error, { status, reason }) {
  if (error.code === 'ERR_CANCELED') return false; // our own deadline
  if (!status) return true; // network error or token fetch failure
  if (status === 429 || status >= 500) return true;
  return status === 403 && RETRYABLE_403_REASONS.includes(reason);
}

// Copy through only the headers that describe the byte stream.
const PASS_THROUGH_HEADERS = ['content-length', 'content-range', 'content-type'];

/**
 * @param {import('http').IncomingMessage} req  needs req.headers.range
 * @param {import('http').ServerResponse} res
 * @param {string} fileId Drive file id
 * @param {string} [fallbackMime] content-type if Drive doesn't send one
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] upstream deadline (default 30 minutes)
 * @param {(detail: string) => void} [opts.onError] called with Drive's reason
 *   when the request finally fails (callers that only see the 502, like
 *   ffmpeg, can't report it themselves)
 */
async function proxyDriveMedia(req, res, fileId, fallbackMime, opts = {}) {
  let upstream;
  for (let attempt = 1; ; attempt++) {
    try {
      const token = await googleDrive.getAccessToken();
      const headers = { Authorization: `Bearer ${token}` };
      if (req.headers.range) headers.Range = req.headers.range;
      upstream = await axios.get(
        `${DRIVE_MEDIA_BASE}/${encodeURIComponent(fileId)}`,
        {
          params: { alt: 'media', supportsAllDrives: true },
          headers,
          responseType: 'stream',
          signal: AbortSignal.timeout(opts.timeoutMs || UPSTREAM_TIMEOUT_MS),
          // 416 (range not satisfiable) is a legitimate response to mirror.
          validateStatus: (s) => s === 200 || s === 206 || s === 416,
        }
      );
      break;
    } catch (error) {
      const info = await describeUpstreamError(error);
      const clientGone = res.destroyed || req.socket?.destroyed;
      if (attempt < MAX_ATTEMPTS && isRetryable(error, info) && !clientGone) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      const detail =
        `Drive ${info.status || 'request'} failed` +
        `${info.reason ? ` (${info.reason})` : ''}: ${info.message}` +
        ` [after ${attempt} attempt${attempt === 1 ? '' : 's'}]`;
      if (opts.onError) opts.onError(detail);
      if (!res.headersSent) res.status(502).json({ error: detail });
      return;
    }
  }

  res.status(upstream.status);
  for (const h of PASS_THROUGH_HEADERS) {
    if (upstream.headers[h] != null) res.setHeader(h, upstream.headers[h]);
  }
  if (upstream.headers['content-type'] == null && fallbackMime) {
    res.setHeader('Content-Type', fallbackMime);
  }
  res.setHeader('Accept-Ranges', 'bytes');

  // Tear down the upstream request if the client goes away mid-stream.
  const abort = () => upstream.data.destroy();
  res.on('close', abort);
  // Mid-stream failure: destroy rather than end. A clean end() looks like a
  // finished (just short) download, so ffmpeg would treat it as end of input
  // and write a truncated proxy; a torn connection makes it reconnect with a
  // Range request (or fail loudly) instead.
  upstream.data.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502);
      res.end();
    } else {
      res.destroy(err);
    }
  });
  upstream.data.pipe(res);
}

module.exports = { proxyDriveMedia };
