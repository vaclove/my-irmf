/**
 * Fixed-window rate limit kept in memory (the app runs as a single instance).
 * @param {object} options
 * @param {number} options.windowMs - window length
 * @param {number} options.max - requests allowed per key and window
 * @param {(req) => string} options.key - what to count by (IP, session, ...)
 */
function rateLimit({ windowMs, max, key }) {
  const hits = new Map(); // key -> { count, resetAt }

  return (req, res, next) => {
    const now = Date.now();
    const id = key(req);
    let entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(id, entry);
    }
    entry.count++;

    // Forget finished windows now and then
    if (hits.size > 10000) {
      for (const [k, e] of hits) if (e.resetAt <= now) hits.delete(k);
    }

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests, try again in a minute' });
    }
    next();
  };
}

module.exports = { rateLimit };
