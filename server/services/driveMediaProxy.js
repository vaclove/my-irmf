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

// Copy through only the headers that describe the byte stream.
const PASS_THROUGH_HEADERS = ['content-length', 'content-range', 'content-type'];

/**
 * @param {import('http').IncomingMessage} req  needs req.headers.range
 * @param {import('http').ServerResponse} res
 * @param {string} fileId Drive file id
 * @param {string} [fallbackMime] content-type if Drive doesn't send one
 */
async function proxyDriveMedia(req, res, fileId, fallbackMime) {
  const token = await googleDrive.getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await axios.get(
      `${DRIVE_MEDIA_BASE}/${encodeURIComponent(fileId)}`,
      {
        params: { alt: 'media', supportsAllDrives: true },
        headers,
        responseType: 'stream',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        // 416 (range not satisfiable) is a legitimate response to mirror.
        validateStatus: (s) => s === 200 || s === 206 || s === 416,
      }
    );
  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to reach Drive: ' + error.message });
    }
    return;
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
  upstream.data.on('error', () => {
    if (!res.headersSent) res.status(502);
    res.end();
  });
  upstream.data.pipe(res);
}

module.exports = { proxyDriveMedia };
