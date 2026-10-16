/*
 * Service worker of the IRMF TV player (scope /tv/). Keeps the player usable
 * offline:
 *   - player files (/tv/*): network first, cached copy when offline
 *   - programme data (/api/public/*): network first, last good response when offline
 *   - images and later media: served from the asset cache that app.js fills
 */
var SHELL_CACHE = 'irmf-tv-shell-v1';
var DATA_CACHE = 'irmf-tv-data-v1';
var ASSET_CACHE = 'irmf-tv-assets';
var SHELL_FILES = ['index.html', 'tv.css', 'app.js', 'logo-horizontal.png', 'logo-vertical.png'];
var NETWORK_TIMEOUT_MS = 8000;

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_FILES.map(scopeUrl)); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  var keep = [SHELL_CACHE, DATA_CACHE, ASSET_CACHE];
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (name.indexOf('irmf-tv-') === 0 && keep.indexOf(name) === -1) return caches.delete(name);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/**
 * Network first; the cached copy (stored under cacheKey) when the network
 * fails, or when it is slower than NETWORK_TIMEOUT_MS and a copy exists.
 */
function networkFirst(request, cacheName, cacheKey) {
  return new Promise(function (resolve) {
    var settled = false;
    function fromCache() {
      return caches.open(cacheName).then(function (cache) { return cache.match(cacheKey); });
    }
    var timer = setTimeout(function () {
      fromCache().then(function (cached) {
        if (cached && !settled) { settled = true; resolve(cached); }
      });
    }, NETWORK_TIMEOUT_MS);

    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(cacheName).then(function (cache) { return cache.put(cacheKey, copy); });
      }
      if (!settled) { settled = true; clearTimeout(timer); resolve(response); }
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (cached) {
        if (!settled) { settled = true; resolve(cached || Response.error()); }
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  var scope = new URL(self.registration.scope);

  if (url.origin === scope.origin && url.pathname.indexOf(scope.pathname) === 0) {
    // The page itself is cached as index.html whichever URL opened it
    var isPage = request.mode === 'navigate';
    var key = isPage ? scopeUrl('index.html') : url.origin + url.pathname;
    event.respondWith(networkFirst(request, SHELL_CACHE, key));
    return;
  }

  if (url.origin === scope.origin && url.pathname.indexOf('/api/public/') === 0) {
    event.respondWith(networkFirst(request, DATA_CACHE, request.url));
    return;
  }

  event.respondWith(
    caches.open(ASSET_CACHE)
      .then(function (cache) { return cache.match(request.url); })
      .then(function (cached) { return cached || fetch(request); })
  );
});
