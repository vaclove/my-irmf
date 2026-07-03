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

  const putChunk = async (buf, isLast) => {
    const start = offset;
    const endInclusive = offset + buf.length - 1;
    const rangeTotal = total != null ? total : isLast ? String(offset + buf.length) : '*';
    const res = await rawPut.put(sessionUrl, buf, {
      headers: {
        'Content-Range': `bytes ${start}-${endInclusive}/${rangeTotal}`,
        'Content-Length': String(buf.length),
      },
    });
    offset += buf.length;
    if (onProgress) await onProgress(offset);
    if (res.status === 200 || res.status === 201) {
      fileId = res.data && res.data.id;
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
