/**
 * Chunked upload of an arbitrary readable stream into a Drive resumable upload
 * session, with bounded memory (32 MiB chunks) and backpressure (each chunk is
 * PUT before more source bytes are pulled).
 *
 * Extracted from movieDownloader so both the in-process downloader and the
 * out-of-process transcode worker can share the exact same sink.
 */

const axios = require('axios');

const CHUNK_SIZE = 32 * 1024 * 1024; // 32 MiB (multiple of 256 KiB)

// Per-chunk upload timeout (ms). A 32 MiB PUT should complete well within this;
// the bound stops a stalled upload from hanging forever.
const CHUNK_PUT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Bounded retry with backoff for transient chunk-PUT failures. On retry we ask
// Drive how many bytes it actually received (resumable offset probe) and resume
// from there rather than restarting the whole multi-GB upload.
const MAX_CHUNK_ATTEMPTS = 5;
const CHUNK_RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for transient conditions worth retrying (network errors, 5xx, 429). */
function isTransientPutError(err) {
  if (!err) return false;
  const status = err.response && err.response.status;
  if (status != null) return status === 429 || (status >= 500 && status <= 599);
  // No response => network/timeout error (ECONNRESET, ETIMEDOUT, aborted, ...).
  return true;
}

// Bare axios for raw chunk PUTs into the resumable session.
const rawPut = axios.create({
  maxRedirects: 0,
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
  timeout: CHUNK_PUT_TIMEOUT_MS,
  transformRequest: [(d) => d],
  validateStatus: (s) => s === 200 || s === 201 || s === 308,
});

/** Pull exactly `take` bytes from the head of a buffer array. */
function takeBytes(pending, take) {
  const out = Buffer.allocUnsafe(take);
  let filled = 0;
  while (filled < take) {
    const head = pending[0];
    const need = take - filled;
    if (head.length <= need) {
      head.copy(out, filled);
      filled += head.length;
      pending.shift();
    } else {
      head.copy(out, filled, 0, need);
      pending[0] = head.subarray(need);
      filled += need;
    }
  }
  return out;
}

/**
 * Consume a readable stream and PUT it into the resumable session in 32 MiB
 * chunks. Updates progress per chunk and checks for cancellation between chunks.
 *
 * @param {object} opts
 * @param {import('stream').Readable} opts.readable source stream
 * @param {string} opts.sessionUrl resumable session URI (Location header)
 * @param {number|null} opts.total total byte count if known (else null)
 * @param {(bytesUploaded:number)=>(void|Promise<void>)} [opts.onProgress]
 * @param {()=>boolean} [opts.shouldCancel] return true to abort; throws err.cancelled
 * @returns {Promise<string>} the Drive file id
 */
async function uploadStreamToDrive({ readable, sessionUrl, total, onProgress, shouldCancel }) {
  const pending = [];
  let pendingLen = 0;
  let offset = 0;
  let fileId = null;

  const cancelled = () => (typeof shouldCancel === 'function' ? shouldCancel() : false);
  const throwCancelled = () => {
    const err = new Error('cancelled');
    err.cancelled = true;
    throw err;
  };

  // Ask Drive how many contiguous bytes of the session it has stored so far.
  // Returns { received, complete } where `received` is the next expected byte
  // offset, or complete=true (with fileId set) if the upload already finished.
  const probeReceived = async () => {
    const rangeTotal = total != null ? total : '*';
    const res = await rawPut.put(sessionUrl, '', {
      headers: { 'Content-Range': `bytes */${rangeTotal}`, 'Content-Length': '0' },
    });
    if (res.status === 200 || res.status === 201) {
      fileId = res.data && res.data.id;
      return { received: null, complete: true };
    }
    // 308: a Range header (e.g. "bytes=0-12345") reports the last stored byte.
    const range = res.headers && res.headers.range;
    const match = range && /bytes=\d+-(\d+)/.exec(range);
    return { received: match ? Number(match[1]) + 1 : 0, complete: false };
  };

  const putChunk = async (bufIn, isLast) => {
    const chunkStart = offset;
    let buf = bufIn;
    let start = chunkStart;

    for (let attempt = 1; ; attempt += 1) {
      if (attempt > 1) {
        // Re-probe the session and realign to whatever Drive actually stored,
        // trimming bytes it already has instead of restarting the transfer.
        const probe = await probeReceived();
        if (probe.complete) {
          offset = chunkStart + bufIn.length;
          break;
        }
        const chunkEnd = chunkStart + bufIn.length; // exclusive
        if (probe.received >= chunkEnd) {
          offset = probe.received;
          break; // whole chunk already stored
        }
        if (probe.received > chunkStart) {
          buf = bufIn.subarray(probe.received - chunkStart);
          start = probe.received;
        } else {
          buf = bufIn;
          start = chunkStart;
        }
      }

      try {
        const endInclusive = start + buf.length - 1;
        const rangeTotal = total != null ? total : isLast ? String(chunkStart + bufIn.length) : '*';
        const res = await rawPut.put(sessionUrl, buf, {
          headers: {
            'Content-Range': `bytes ${start}-${endInclusive}/${rangeTotal}`,
            'Content-Length': String(buf.length),
          },
        });
        offset = start + buf.length;
        if (res.status === 200 || res.status === 201) {
          fileId = res.data && res.data.id;
        }
        break;
      } catch (err) {
        if (attempt >= MAX_CHUNK_ATTEMPTS || !isTransientPutError(err)) throw err;
        await sleep(CHUNK_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    if (onProgress) {
      try {
        await onProgress(offset);
      } catch {
        // Progress reporting is best-effort; don't let a transient DB error abort the upload.
      }
    }
  };

  const flush = async (finalize) => {
    while (pendingLen >= CHUNK_SIZE || (finalize && pendingLen > 0)) {
      if (cancelled()) throwCancelled();
      const take = Math.min(CHUNK_SIZE, pendingLen);
      const buf = takeBytes(pending, take);
      pendingLen -= take;
      const isLast = finalize && pendingLen === 0;
      await putChunk(buf, isLast);
    }
  };

  for await (const chunk of readable) {
    if (cancelled()) throwCancelled();
    pending.push(chunk);
    pendingLen += chunk.length;
    await flush(false);
  }
  await flush(true);

  if (!fileId) {
    throw new Error('Upload to Drive did not return a file id');
  }
  return fileId;
}

module.exports = { uploadStreamToDrive, CHUNK_SIZE };
