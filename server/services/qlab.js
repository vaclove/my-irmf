const { logger } = require('../utils/logger');

// Read-only status of the projection QLab (https://qlab.irmf.cz), see
// docs/QLAB_API.md. The API sits behind Cloudflare Access: the service token
// stays on the server and every visitor gets the same cached copy, so QLab is
// asked at most once per STATUS_TTL_MS however many people watch the tab.
// Nothing is polled while nobody has the tab open.

const STATUS_TTL_MS = 1500;
const CUELISTS_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

const cache = {
  status: { snapshot: null, inflight: null },
  cuelists: { snapshot: null, inflight: null },
};
let lastLoggedState = null;

function isConfigured() {
  return Boolean(process.env.QLAB_API_URL && process.env.QLAB_CF_CLIENT_ID && process.env.QLAB_CF_CLIENT_SECRET);
}

function fetchQLab(path) {
  return fetch(`${process.env.QLAB_API_URL.replace(/\/+$/, '')}${path}`, {
    headers: {
      'CF-Access-Client-Id': process.env.QLAB_CF_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.QLAB_CF_CLIENT_SECRET,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Cloudflare answers errors in HTML, the bridge in JSON: map both to a state. */
async function request(path) {
  try {
    const res = await fetchQLab(path);
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (res.ok && isJson) return { state: 'ok', data: await res.json() };
    if (res.status === 503 && isJson) return { state: 'qlab_down' };
    if (res.status === 502 || res.status === 530) return { state: 'offline' };
    return { state: 'error', httpStatus: res.status }; // 403 = wrong service token
  } catch (error) {
    return { state: 'offline' }; // timeout or network
  }
}

/** Log state changes only, the endpoint is polled every second or two. */
function logTransition(path, result) {
  if (result.state === lastLoggedState) return;
  lastLoggedState = result.state;
  if (result.state === 'error') {
    logger.error(`QLab API ${path} answered HTTP ${result.httpStatus}`);
  } else {
    logger.info(`QLab API ${path} state: ${result.state}`);
  }
}

function toRunningCue(cue) {
  return {
    uniqueID: cue.uniqueID,
    number: cue.number || '',
    name: cue.name || '',
    type: cue.type || '',
    paused: Boolean(cue.paused),
    elapsed: typeof cue.elapsed === 'number' ? cue.elapsed : null,
    duration: typeof cue.duration === 'number' ? cue.duration : null,
  };
}

function toListCue(cue) {
  return {
    uniqueID: cue.uniqueID,
    number: cue.number || '',
    name: cue.listName || cue.name || '',
    type: cue.type || '',
    armed: cue.armed !== false,
    flagged: Boolean(cue.flagged),
    colorName: cue.colorName || 'none',
    ...(Array.isArray(cue.cues) ? { cues: cue.cues.map(toListCue) } : {}),
  };
}

/** Serve the cached snapshot while fresh, otherwise one shared refresh. */
async function cached(entry, ttl, load) {
  if (entry.snapshot && Date.now() - entry.snapshot.fetchedAt < ttl) return entry.snapshot;
  if (!entry.inflight) {
    entry.inflight = load()
      .then((snapshot) => {
        entry.snapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        entry.inflight = null;
      });
  }
  return entry.inflight;
}

async function getStatus() {
  if (!isConfigured()) return { state: 'not_configured', fetchedAt: Date.now() };
  return cached(cache.status, STATUS_TTL_MS, async () => {
    const fetchedAt = Date.now();
    const result = await request('/status');
    logTransition('/status', result);
    if (result.state !== 'ok') return { state: result.state, fetchedAt };
    return {
      state: 'ok',
      fetchedAt,
      workspace: result.data.workspace?.name || null,
      running: Array.isArray(result.data.running) ? result.data.running.map(toRunningCue) : [],
      qlabTime: result.data.time || null,
    };
  });
}

async function getCuelists() {
  if (!isConfigured()) return { state: 'not_configured', fetchedAt: Date.now() };
  return cached(cache.cuelists, CUELISTS_TTL_MS, async () => {
    const fetchedAt = Date.now();
    const result = await request('/cuelists');
    if (result.state === 'ok') {
      return { state: 'ok', fetchedAt, cueLists: Array.isArray(result.data) ? result.data.map(toListCue) : [] };
    }
    // Keep the last known show when the Mac drops out, but retry soon
    const previous = cache.cuelists.snapshot;
    const retryAt = fetchedAt - CUELISTS_TTL_MS + 5000;
    if (previous?.cueLists) return { ...previous, state: result.state, stale: true, fetchedAt: retryAt };
    return { state: result.state, fetchedAt: retryAt };
  });
}

module.exports = { isConfigured, getStatus, getCuelists };
