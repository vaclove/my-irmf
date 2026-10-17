/*
 * IRMF TV player — a looping showcase for a TV in the festival venue
 * (Fully Kiosk Browser on a TV box, or any Chrome in kiosk mode).
 *
 * What it plays is managed in my.irmf.cz → Programme → TV Screen: an ordered
 * list of slides — the programme of the day, photos and videos (partner
 * videos, trailers) — read from /api/public/tv/manifest every minute.
 *
 * In Fully Kiosk Browser with its JavaScript interface (a PLUS feature) videos
 * play in Android's native player from files downloaded to the box: the
 * WebView drops ~11 % of the frames of a 1080p video on a Mi Box S, the native
 * player none. Elsewhere they play in <video>.
 *
 * Plain script, no build step: it runs on low-end TV boxes and must keep
 * working offline. sw.js caches this page and the last data; this script
 * downloads every photo, video and programme image into the Cache API, so
 * after the first load the loop survives a lost connection.
 *
 * URL parameters (for testing):
 *   ?debug=1                  show a status box (cache, data, errors)
 *   ?now=2026-10-23T19:00     pretend it is this local time (the clock keeps running)
 */
(function () {
  'use strict';

  var API = '/api/public';
  var PROGRAMME_SCENE = { overviewSeconds: 15, featureSeconds: 12 };
  var PHOTO_SECONDS = 8;
  var ROWS_PER_PAGE = 8; // what fits under the heading together with the all-day line
  var SYNOPSIS_MAX = 420;
  var MANIFEST_REFRESH_MS = 60 * 1000;
  var DATA_REFRESH_MS = 5 * 60 * 1000;
  var UPDATE_CHECK_MS = 5 * 60 * 1000;
  var RETRY_MS = 30 * 1000;
  var VIDEO_READY_TIMEOUT_MS = 10 * 1000;
  var FADE_MS = 500; // matches the .slide opacity transition
  var ASSET_CACHE = 'irmf-tv-assets';
  var TRAILER_INTRO_SECONDS = 7;
  var NATIVE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Without a manifest (offline before the first load, older server) just the programme
  var DEFAULT_SLIDES = [{ kind: 'programme' }];

  var params = new URLSearchParams(location.search);
  var DEBUG = params.has('debug');
  var timeOffset = params.get('now') ? new Date(params.get('now')).getTime() - Date.now() : 0;
  if (isNaN(timeOffset)) timeOffset = 0;

  var stage = document.getElementById('stage');
  var sceneEl = document.getElementById('scene');
  var statusEl = document.getElementById('status');
  var clockEl = document.getElementById('clock');

  var state = {
    data: null,            // { edition, entries }
    manifest: null,        // { settings, slides } from my.irmf.cz
    reloadBaseline: undefined,
    loadedAt: null,
    lastError: null,
    cache: { files: 0, bytes: 0, pending: 0, full: false },
    reloadPending: false,
    restartLoop: false,    // the manifest changed: start the loop again after this slide
    shellTag: null,
    current: '',
  };

  // ---------- helpers ----------

  function now() {
    return new Date(Date.now() + timeOffset);
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function localDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function minutesOf(d) {
    return d.getHours() * 60 + d.getMinutes();
  }

  function parseDay(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatDay(iso) {
    return parseDay(iso).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** Tiny DOM builder; text always goes in as text nodes, never as HTML. */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') el.className = attrs[key];
      else el.setAttribute(key, attrs[key]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  /** Cut a synopsis at a sentence end (or a word) so it fits the slide. */
  function shorten(text, max) {
    text = (text || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    var cut = text.slice(0, max);
    var sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
    return cut.slice(0, cut.lastIndexOf(' ')) + '…';
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function unique(list) {
    return list.filter(function (item, i) { return item && list.indexOf(item) === i; });
  }

  function errorText(err) {
    return String((err && err.message) || err);
  }

  // ---------- stage + clock ----------

  function fitStage() {
    // clientWidth, not innerWidth: Android WebView widens the layout viewport
    // to fit the unscaled 1920px stage, so innerWidth reports ~1920 there
    var width = document.documentElement.clientWidth;
    var height = document.documentElement.clientHeight;
    var scale = Math.min(width / 1920, height / 1080);
    var x = (width - 1920 * scale) / 2;
    var y = (height - 1080 * scale) / 2;
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  }

  function tickClock() {
    var d = now();
    var text = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (clockEl.textContent !== text) clockEl.textContent = text;
  }

  function renderStatus() {
    if (!DEBUG) return;
    statusEl.hidden = false;
    var d = state.data;
    var m = state.manifest;
    statusEl.textContent = [
      'now: ' + now().toString().slice(0, 24) + (timeOffset ? ' (override)' : ''),
      'page loaded: ' + new Date(performance.timeOrigin).toTimeString().slice(0, 8),
      'viewport: ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight + ' @' + window.devicePixelRatio + 'x',
      'sw: ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlling' : 'not controlling'),
      'edition: ' + (d ? d.edition.name + ' ' + d.edition.start + '..' + d.edition.end : '-'),
      'entries: ' + (d ? d.entries.length : '-') + ', loaded ' + (state.loadedAt ? state.loadedAt.toTimeString().slice(0, 8) : '-'),
      'slides: ' + (m ? m.slides.map(function (s) { return s.kind + (s.hidden ? '(hidden)' : ''); }).join(' ') : 'default') +
        ', programme days: ' + programmeDays(),
      'cache: ' + state.cache.files + ' files, ' + (state.cache.bytes / 1e6).toFixed(0) + ' MB' +
        (state.cache.pending ? ', downloading ' + state.cache.pending : '') + (state.cache.full ? ', STORAGE FULL' : ''),
      'storage: ' + (state.storage || '-'),
      'showing: ' + state.current,
      'last video: ' + (state.lastVideo || '-'),
      'native video: ' + (native.enabled ? Object.keys(native.files).length + ' files' +
        (native.downloading ? ', downloading ' + native.downloading.id : '') : 'off (no Fully JS interface)'),
      'error: ' + (state.lastError || '-'),
    ].join('\n');
  }

  // ---------- data ----------

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
      return res.json();
    });
  }

  function programmeDays() {
    return (state.manifest && state.manifest.settings.programme_days) || 'today';
  }

  /** The running or next edition; after the last one ends, the last one. */
  function pickEdition(editions, today) {
    var list = editions
      .filter(function (e) { return e.start_date && e.end_date; })
      .map(function (e) {
        return { id: e.id, name: e.name, year: e.year, start: e.start_date.slice(0, 10), end: e.end_date.slice(0, 10) };
      });
    var current = list
      .filter(function (e) { return e.end >= today; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; })[0];
    return current || list.sort(function (a, b) { return a.end < b.end ? 1 : -1; })[0] || null;
  }

  function normalize(e) {
    var blockMovies = e.block_movies || [];
    var blockImage = blockMovies.filter(function (m) { return m.image_urls; })[0];
    var time = e.all_day || !e.scheduled_time ? null : e.scheduled_time.slice(0, 5);
    var parts = time ? time.split(':') : null;
    return {
      id: e.id,
      date: e.scheduled_date,
      time: time,
      startMin: parts ? Number(parts[0]) * 60 + Number(parts[1]) : null,
      runtime: Number(e.total_runtime) || Number(e.movie_runtime) || 0,
      title: e.title_override_cs || e.movie_name_cs || e.block_name_cs || e.title_override_en || e.movie_name_en || e.block_name_en || '',
      venue: e.venue_name_cs || e.venue_name_en || '',
      director: e.movie_director || '',
      synopsis: shorten(e.movie_synopsis_cs || e.block_description_cs || e.movie_synopsis_en || e.block_description_en, SYNOPSIS_MAX),
      image: (e.movie_image_urls && e.movie_image_urls.large) || (blockImage && blockImage.image_urls.large) || null,
      films: blockMovies.map(function (m) { return m.name_cs || m.name_en; }),
      // Films screened here (for trailers: "when is this film on?")
      movies: (e.movie_id ? [{ id: e.movie_id, name: e.movie_name_cs || e.movie_name_en }] : [])
        .concat(blockMovies.map(function (m) { return { id: m.id, name: m.name_cs || m.name_en }; })),
      highlighted: !!e.highlighted,
    };
  }

  /** The programme of the running or next edition. */
  function loadData() {
    var today = localDate(now());
    return getJson(API + '/editions').then(function (res) {
      var edition = pickEdition(res.editions || [], today);
      if (!edition) throw new Error('no edition with dates');
      return getJson(API + '/programming?edition_id=' + encodeURIComponent(edition.id) + '&limit=500').then(function (prog) {
        state.data = { edition: edition, entries: (prog.programming || []).map(normalize) };
        state.loadedAt = new Date();
        state.lastError = null;
        syncCache();
      });
    }).catch(function (err) {
      state.lastError = errorText(err);
    }).then(renderStatus);
  }

  /** What to play and the settings, from my.irmf.cz. */
  function loadManifest() {
    return getJson(API + '/tv/manifest').then(function (manifest) {
      var requested = manifest.settings.reload_requested_at || null;
      if (state.reloadBaseline === undefined) state.reloadBaseline = requested;
      else if (requested !== state.reloadBaseline) return hardReload();
      if (state.manifest && JSON.stringify(state.manifest) !== JSON.stringify(manifest)) state.restartLoop = true;
      state.manifest = manifest;
      syncCache();
      syncNative();
    }).catch(function (err) {
      state.lastError = 'manifest: ' + errorText(err);
    }).then(renderStatus);
  }

  /**
   * "Reload screens" in the admin: update the service worker and load the
   * page again — the page is fetched network first, so new styles and scripts
   * arrive. Nothing cached is dropped: a connection lost right now falls back
   * to the cached copy instead of blanking the screen.
   */
  function hardReload() {
    var registration = navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(null);
    return registration.then(function (reg) {
      return reg ? reg.update().catch(function () {}) : null;
    }).catch(function () {}).then(function () {
      stopNativeVideo();
      location.reload();
    });
  }

  // ---------- offline cache of photos, videos and programme images ----------

  var syncing = null;
  var syncAgain = false;

  /**
   * Absolute URL → size of every photo and video in the manifest (hidden ones
   * too: they stay cached). With the native player videos are kept as files
   * instead (see syncNative).
   */
  function mediaSizes() {
    var sizes = {};
    (state.manifest ? state.manifest.slides : []).forEach(function (s) {
      if (s.url && !(native.enabled && s.kind === 'video')) sizes[new URL(s.url, location.href).href] = s.size || 0;
    });
    return sizes;
  }

  function wantedAssets(sizes) {
    var images = state.data ? state.data.entries.map(function (e) { return e.image; }) : [];
    // Small things first, so a big video download doesn't hold up the programme images
    return unique(images).concat(Object.keys(sizes).sort(function (a, b) { return sizes[a] - sizes[b]; }));
  }

  function isMediaUrl(url) {
    return url.indexOf(location.origin + API + '/tv/media/') === 0;
  }

  /** Whether the source that lists this kind of asset has loaded, so a missing URL really is unused. */
  function sourceLoaded(url) {
    return isMediaUrl(url) ? !!state.manifest : !!state.data;
  }

  /**
   * Download every asset that is not cached yet (one at a time) and drop the
   * ones no longer used. s3.irmf.cz sends no CORS headers, so programme
   * images are opaque responses — fine for <img>. The manifest and the
   * programme load separately: only assets of a loaded source are pruned.
   */
  function syncCache() {
    if (!window.caches) return;
    if (syncing) { syncAgain = true; return; }
    var sizes = mediaSizes();
    var urls = wantedAssets(sizes);
    syncing = caches.open(ASSET_CACHE).then(function (cache) {
      return cache.keys().then(function (keys) {
        var cached = keys.map(function (req) { return req.url; });
        return Promise.all(cached.filter(function (url) { return urls.indexOf(url) === -1 && sourceLoaded(url); })
          .map(function (url) { return cache.delete(url); }))
          .then(function () {
            var missing = urls.filter(function (url) { return cached.indexOf(url) === -1; });
            state.cache.pending = missing.length;
            return missing.reduce(function (chain, url) {
              return chain.then(function () { return cacheOne(cache, url, sizes[url] || 0); });
            }, Promise.resolve());
          });
      }).then(function () { return measureCache(cache, sizes); });
    }).catch(function (err) {
      state.lastError = 'cache: ' + errorText(err);
    }).then(function () {
      syncing = null;
      renderStatus();
      if (syncAgain) { syncAgain = false; syncCache(); }
    });
  }

  function cacheOne(cache, url, size) {
    var sameOrigin = url.indexOf(location.origin) === 0;
    return roomFor(size).then(function (room) {
      if (!room) { state.cache.full = true; return; }
      // no-store: the file goes to the Cache API only, not a second copy into the HTTP cache
      return fetch(url, { mode: sameOrigin ? 'same-origin' : 'no-cors', cache: 'no-store' }).then(function (res) {
        if (res.ok || res.type === 'opaque') return cache.put(url, res);
      });
    }).catch(function () { /* offline or gone: try again on the next sync */ })
      .then(function () { state.cache.pending = Math.max(0, state.cache.pending - 1); renderStatus(); });
  }

  /** Keep 10 % of the browser's storage quota free. */
  function roomFor(bytes) {
    if (!bytes || !navigator.storage || !navigator.storage.estimate) return Promise.resolve(true);
    return navigator.storage.estimate().then(function (est) {
      return est.usage + bytes < est.quota * 0.9;
    }).catch(function () { return true; });
  }

  function measureCache(cache, sizes) {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        state.storage = (est.usage / 1e6).toFixed(0) + ' of ' + (est.quota / 1e6).toFixed(0) + ' MB';
      }).catch(function () {});
    }
    return cache.keys().then(function (keys) {
      state.cache.files = keys.length;
      state.cache.bytes = keys.reduce(function (sum, req) { return sum + (sizes[req.url] || 0); }, 0);
    });
  }

  // ---------- native video player (Fully Kiosk) ----------

  /**
   * Fully's JavaScript interface: download each video to the box (named by
   * slide id, so a replaced file shows up as a size mismatch) and play it in
   * Android's native player. Downloads must go to Fully's app-specific
   * storage — shared storage is not writable for it.
   */
  var native = (function () {
    var fully = window.fully;
    var enabled = !!(fully && fully.playVideo && fully.downloadFile && fully.getFileList && fully.getInternalAppSpecificStoragePath);
    return {
      enabled: enabled,
      dir: enabled ? fully.getInternalAppSpecificStoragePath() : null,
      files: {},          // slide id → size of the complete local file
      downloading: null,  // { id, timer }
    };
  })();

  function nativeFileUrl(slideId) {
    return 'file://' + native.dir + '/' + slideId;
  }

  function nativeFileList() {
    try {
      return JSON.parse(window.fully.getFileList(native.dir) || '[]');
    } catch (err) {
      return [];
    }
  }

  /**
   * Bring the files in line with the manifest: drop unknown or incomplete
   * ones, then download the smallest missing video (one at a time; the
   * download callbacks call this again).
   */
  function syncNative() {
    if (!native.enabled || !state.manifest || native.downloading) return;
    var before = Object.keys(native.files).sort().join();
    var wanted = {};
    state.manifest.slides.forEach(function (s) {
      if (s.kind === 'video' && s.url) wanted[s.id] = s;
    });
    native.files = {};
    nativeFileList().forEach(function (f) {
      if (f.type !== 'file' || !UUID_RE.test(f.name)) return;
      var slide = wanted[f.name];
      if (!slide || (slide.size && f.size !== slide.size)) {
        window.fully.deleteFile(native.dir + '/' + f.name);
        return;
      }
      native.files[f.name] = f.size;
    });
    var next = Object.keys(wanted).map(function (id) { return wanted[id]; })
      .filter(function (s) { return !native.files[s.id]; })
      .sort(function (a, b) { return (a.size || 0) - (b.size || 0); })[0];
    // Videos became playable natively (or went away): rebuild the loop after this slide
    if (Object.keys(native.files).sort().join() !== before) state.restartLoop = true;
    renderStatus();
    if (!next) return;
    native.downloading = {
      id: next.id,
      // No callback ever came (download lost): try again
      timer: setTimeout(nativeDownloadDone, NATIVE_DOWNLOAD_TIMEOUT_MS),
    };
    window.fully.downloadFile(new URL(next.url, location.href).href, native.dir, false);
  }

  function nativeDownloadDone() {
    if (native.downloading) clearTimeout(native.downloading.timer);
    native.downloading = null;
    syncNative();
  }

  function nativeDownloadFailed(url, dir, code) {
    state.lastError = 'video download failed (' + code + ')';
    if (native.downloading) clearTimeout(native.downloading.timer);
    native.downloading = null;
    setTimeout(syncNative, RETRY_MS);
  }

  if (native.enabled) {
    window.__irmfTvDownloadDone = nativeDownloadDone;
    window.__irmfTvDownloadFailed = nativeDownloadFailed;
    window.fully.bind('onDownloadSuccess', '__irmfTvDownloadDone();');
    window.fully.bind('onDownloadFailure', '__irmfTvDownloadFailed("$url", "$dir", "$code");');
  }

  function stopNativeVideo() {
    if (native.enabled) {
      try { window.fully.stopVideo(); } catch (err) { /* nothing playing */ }
    }
  }

  /**
   * Play a downloaded video full screen in the native player. There is no
   * "ended" event: wait for its length (the player closes itself at the end),
   * then make sure it is gone.
   */
  function playNative(slide) {
    window.fully.playVideo(slide.file, false, false, false, true);
    return sleep(slide.seconds * 1000).then(stopNativeVideo);
  }

  // ---------- programme slides ----------

  function entryEnd(e) {
    return e.startMin + Math.max(e.runtime, 15);
  }

  /**
   * Which festival days to show. The first one: before the festival its first
   * day, during it today (or the next day once today's programme is over),
   * after it the last day. With programme_days 'upcoming' every later festival
   * day follows.
   */
  function pickDays(entries, d, days) {
    var today = localDate(d);
    var nowMin = minutesOf(d);
    var tomorrow = localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    var dates = unique(entries.map(function (e) { return e.date; })).sort();
    if (!dates.length) return [];

    var leftToday = entries.some(function (e) {
      return e.date === today && e.time && entryEnd(e) > nowMin;
    });
    var future = dates.filter(function (day) { return day > today; });
    var first;
    if (today < dates[0]) first = { date: dates[0], mode: 'first' };
    else if (leftToday) first = { date: today, mode: 'today' };
    else if (future.length) first = { date: future[0], mode: future[0] === tomorrow ? 'tomorrow' : 'later' };
    else return [{ date: dates[dates.length - 1], mode: 'past' }];

    if (days !== 'upcoming') return [first];
    return [first].concat(dates.filter(function (day) { return day > first.date; }).map(function (day) {
      return { date: day, mode: day === tomorrow ? 'tomorrow' : 'later' };
    }));
  }

  // "v sobotu", "ve čtvrtek"… by Date.getDay()
  var ON_WEEKDAY = ['v neděli', 'v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu'];

  function dayLabels(day) {
    var date = formatDay(day.date);
    switch (day.mode) {
      case 'today': return { eyebrow: 'Dnes · ' + date, heading: 'Dnes na programu' };
      case 'tomorrow': return { eyebrow: 'Zítra · ' + date, heading: 'Zítra na programu' };
      case 'first': return { eyebrow: 'Festival začíná · ' + date, heading: 'Program prvního dne' };
      case 'later': {
        var on = ON_WEEKDAY[parseDay(day.date).getDay()];
        return { eyebrow: date, heading: on.charAt(0).toUpperCase() + on.slice(1) + ' na programu' };
      }
      default: return { eyebrow: date, heading: 'Program' };
    }
  }

  function isRunning(e, day, nowMin) {
    return day.mode === 'today' && e.time && e.startMin <= nowMin && nowMin < entryEnd(e);
  }

  function overviewSlide(labels, rows, allDay, page, day, nowMin) {
    return h('div', { class: 'overview' },
      h('div', { class: 'eyebrow' }, labels.eyebrow + (page ? ' · ' + page : '')),
      h('h1', null, labels.heading),
      h('div', { class: 'rows' }, rows.map(function (e) {
        return h('div', { class: 'row' + (isRunning(e, day, nowMin) ? ' running' : '') },
          h('div', { class: 'time' }, e.time),
          h('div', { class: 'title' }, e.title, isRunning(e, day, nowMin) ? h('span', { class: 'badge' }, 'Právě běží') : null),
          h('div', { class: 'venue' }, e.venue));
      }).reduce(function (el, row) { el.appendChild(row); return el; }, document.createDocumentFragment())),
      allDay.length ? h('div', { class: 'allday' }, h('strong', null, 'Celý den'),
        allDay.map(function (e) { return e.title + ' (' + e.venue + ')'; }).join(' · ')) : null);
  }

  function featureSlide(e, labels, day, nowMin) {
    var photo = e.image ? h('img', { class: 'photo', src: e.image, alt: '' }) : h('div', { class: 'photo' });
    // Films and blocks show their length; other events (DJ sets, workshops) when they end
    var isFilm = e.director || e.films.length > 1;
    var end = e.time && e.runtime ? pad(Math.floor(entryEnd(e) / 60) % 24) + ':' + pad(entryEnd(e) % 60) : '';
    var meta = isFilm
      ? [e.director ? 'Režie: ' + e.director : '', e.runtime ? e.runtime + ' min' : ''].filter(Boolean).join(' · ')
      : (end ? 'Do ' + end : '');
    return h('div', { class: 'feature' },
      photo,
      h('div', { class: 'photo-fade' }),
      h('div', { class: 'info' },
        h('div', { class: 'eyebrow' }, labels.eyebrow),
        h('div', { class: 'when' },
          h('div', { class: 'time' }, e.time || 'Celý den'),
          h('div', { class: 'venue' }, e.venue)),
        isRunning(e, day, nowMin) ? h('div', { class: 'badge' }, 'Právě běží') : null,
        h('h2', null, e.title),
        meta ? h('div', { class: 'meta' }, meta) : null,
        h('p', { class: 'synopsis' }, e.synopsis),
        e.films.length > 1 ? h('div', { class: 'block-films' }, h('strong', null, 'Ve bloku: '), e.films.join(' · ')) : null));
  }

  function messageSlide(eyebrow, text) {
    return h('div', { class: 'message' },
      h('img', { class: 'logo', src: 'logo-vertical.png', alt: '' }),
      h('div', { class: 'eyebrow' }, eyebrow),
      h('div', null, text));
  }

  function programmeSlides() {
    if (!state.data) return [{ el: messageSlide('IRMF', 'Načítám program…'), seconds: 10, label: 'loading' }];
    var d = now();
    var nowMin = minutesOf(d);
    var days = pickDays(state.data.entries, d, programmeDays());
    if (!days.length) return [{ el: messageSlide(state.data.edition.name, 'Program brzy zveřejníme'), seconds: 20, label: 'no programme' }];

    var slides = [];
    days.forEach(function (day) {
      slides = slides.concat(daySlides(day, nowMin));
    });
    return slides;
  }

  /** The day's overview (paged) followed by a slide per screening. */
  function daySlides(day, nowMin) {
    var labels = dayLabels(day);
    var ofDay = state.data.entries.filter(function (e) { return e.date === day.date; });
    var timed = ofDay.filter(function (e) {
      return e.time && (day.mode !== 'today' || entryEnd(e) > nowMin);
    });
    var allDay = ofDay.filter(function (e) { return !e.time; });

    var slides = [];
    var pages = chunk(timed, ROWS_PER_PAGE);
    if (!pages.length) pages = [[]];
    pages.forEach(function (rows, i) {
      var last = i === pages.length - 1;
      slides.push({
        el: overviewSlide(labels, rows, last ? allDay : [], pages.length > 1 ? (i + 1) + '/' + pages.length : '', day, nowMin),
        seconds: PROGRAMME_SCENE.overviewSeconds,
        label: 'programme ' + day.date,
      });
    });
    timed.concat(allDay).forEach(function (e) {
      slides.push({ el: featureSlide(e, labels, day, nowMin), seconds: PROGRAMME_SCENE.featureSeconds, label: e.title });
    });
    return slides;
  }

  // ---------- photo and video slides ----------

  function photoSlide(slide) {
    // Close to 16:9 fills the screen; anything else (portraits…) is shown whole
    var ratio = slide.width && slide.height ? slide.width / slide.height : 16 / 9;
    var fill = Math.abs(ratio - 16 / 9) < 0.25;
    return {
      el: h('div', { class: 'media' }, h('img', { class: fill ? 'cover' : 'contain', src: slide.url, alt: '' })),
      seconds: slide.display_seconds || PHOTO_SECONDS,
      media: true,
      label: 'photo ' + (slide.title || slide.id),
    };
  }

  /** The next screening of a trailer's film, for the caption. */
  function nextScreening(movieId) {
    if (!movieId || !state.data) return null;
    var d = now();
    var today = localDate(d);
    var nowMin = minutesOf(d);
    var found = null;
    state.data.entries.forEach(function (e) {
      if (!e.time) return;
      var movie = e.movies.filter(function (m) { return m.id === movieId; })[0];
      if (!movie) return;
      if (e.date < today || (e.date === today && e.startMin < nowMin)) return;
      if (!found || e.date < found.entry.date || (e.date === found.entry.date && e.startMin < found.entry.startMin)) {
        found = { entry: e, movie: movie };
      }
    });
    return found;
  }

  function screeningWhen(entry) {
    var d = now();
    var tomorrow = localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
    var day = entry.date === localDate(d) ? 'Dnes'
      : entry.date === tomorrow ? 'Zítra'
        : parseDay(entry.date).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' });
    return [day.charAt(0).toUpperCase() + day.slice(1), entry.time, entry.venue].join(' · ');
  }

  /** Before a trailer played natively (nothing can be drawn over it): when its film is on. */
  function trailerIntroSlide(screening) {
    return {
      el: h('div', { class: 'message trailer-intro' },
        screening.entry.image ? h('img', { class: 'backdrop', src: screening.entry.image, alt: '' }) : null,
        h('div', { class: 'eyebrow' }, 'Trailer · na festivalu'),
        h('div', { class: 'trailer-title' }, screening.movie.name || ''),
        h('div', { class: 'trailer-when' }, screeningWhen(screening.entry))),
      seconds: TRAILER_INTRO_SECONDS,
      label: 'trailer intro ' + (screening.movie.name || ''),
    };
  }

  /** Slides for a video: native playback when the file is on the box, else <video>. */
  function videoSlides(slide) {
    if (native.enabled && native.files[slide.id]) {
      var screening = nextScreening(slide.movie_id);
      var played = {
        el: h('div', { class: 'media' }),
        file: nativeFileUrl(slide.id),
        seconds: Math.ceil((slide.media_seconds || 120) + 1),
        media: true,
        label: 'native video ' + (slide.title || slide.id),
      };
      return screening ? [trailerIntroSlide(screening), played] : [played];
    }
    return [videoSlide(slide)];
  }

  function videoSlide(slide) {
    // src is set in show(): a detached <video> with a src would start downloading at once
    var video = h('video', { class: 'contain', preload: 'auto', playsinline: '' });
    // A trailer's caption: when its film is on (nothing once it has been screened)
    var screening = nextScreening(slide.movie_id);
    var caption = screening ? h('div', { class: 'caption' },
      h('div', { class: 'eyebrow' }, 'Na festivalu'),
      h('div', { class: 'caption-title' }, screening.movie.name || ''),
      h('div', { class: 'caption-when' }, screeningWhen(screening.entry))) : null;
    return {
      el: h('div', { class: 'media' }, video, caption),
      video: video,
      src: slide.url,
      // Stop waiting if 'ended' never comes (stalled stream)
      seconds: Math.ceil((slide.media_seconds || 120) + 10),
      media: true,
      label: 'video ' + (slide.title || slide.id),
    };
  }

  function buildSlides() {
    var list = state.manifest ? state.manifest.slides : DEFAULT_SLIDES;
    var slides = [];
    list.forEach(function (slide) {
      if (slide.hidden) return;
      if (slide.kind === 'programme') slides = slides.concat(programmeSlides());
      else if (slide.kind === 'photo' && slide.url) slides.push(photoSlide(slide));
      else if (slide.kind === 'video' && slide.url) slides = slides.concat(videoSlides(slide));
    });
    if (!slides.length) slides.push({ el: messageSlide('IRMF', 'International Road Movie Festival'), seconds: 20, label: 'empty playlist' });
    return slides;
  }

  // ---------- loop ----------

  /** Resolves true when the slide can be shown, false to skip it. */
  function whenReady(wrapper, slide) {
    var imgs = Array.prototype.slice.call(wrapper.querySelectorAll('img'));
    var images = Promise.all(imgs.map(function (img) {
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      var ready = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
      return Promise.race([ready, sleep(4000)]);
    }));
    if (!slide.video) return images.then(function () { return true; });
    var video = slide.video;
    var canPlay = new Promise(function (resolve) {
      if (video.readyState >= 3) return resolve(true);
      video.addEventListener('canplay', function () { resolve(true); }, { once: true });
      video.addEventListener('error', function () { resolve(false); }, { once: true });
      setTimeout(function () { resolve(false); }, VIDEO_READY_TIMEOUT_MS);
    });
    return Promise.all([images, canPlay]).then(function (r) { return r[1]; });
  }

  /** Play a video slide to its end (with sound if the browser lets us). */
  function playVideo(video, maxSeconds) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      }
      var timer = setTimeout(finish, maxSeconds * 1000);
      video.addEventListener('ended', finish);
      video.addEventListener('error', finish);
      video.play().catch(function () {
        video.muted = true;
        video.play().catch(finish);
      });
    });
  }

  /** Free the hardware decoder of a slide that is going away. */
  function release(wrapper) {
    Array.prototype.forEach.call(wrapper.querySelectorAll('video'), function (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    wrapper.remove();
  }

  /** For ?debug=1: frames the box dropped while playing the last video. */
  function recordQuality(slide) {
    var q = slide.video.getVideoPlaybackQuality ? slide.video.getVideoPlaybackQuality() : null;
    if (q) state.lastVideo = slide.label + ': dropped ' + q.droppedVideoFrames + ' of ' + q.totalVideoFrames + ' frames';
  }

  var current = null;

  /**
   * Fade the current slide out, then the next one in — never both at once:
   * overlapping texts look messy and two full-screen layers stutter on TV boxes.
   * Resolves false when the slide could not be shown (a video that won't load).
   */
  function show(slide) {
    var wrapper = h('div', { class: 'slide' }, slide.el);
    if (slide.video) slide.video.src = slide.src;
    sceneEl.appendChild(wrapper);
    return whenReady(wrapper, slide).then(function (ready) {
      if (!ready) {
        release(wrapper);
        return false;
      }
      var previous = current;
      current = wrapper;
      if (!previous) return true;
      previous.classList.remove('visible');
      return sleep(FADE_MS).then(function () { release(previous); return true; });
    }).then(function (ready) {
      if (!ready) return false;
      state.current = slide.label || '';
      renderStatus();
      stage.classList.toggle('media-mode', !!slide.media);
      // Two frames so the browser paints the slide at opacity 0 before fading in
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { wrapper.classList.add('visible'); });
      });
      var playing = slide.file ? sleep(FADE_MS).then(function () { return playNative(slide); })
        : slide.video ? playVideo(slide.video, slide.seconds).then(function () { recordQuality(slide); })
          : sleep(slide.seconds * 1000);
      return playing.then(function () { return true; });
    });
  }

  function loop() {
    var slides = buildSlides();
    var shown = 0;
    state.restartLoop = false;
    return slides.reduce(function (chain, slide) {
      return chain.then(function () {
        if (state.restartLoop) return null;
        return show(slide).then(function (ok) { if (ok !== false) shown++; });
      });
    }, Promise.resolve()).then(function () {
      if (state.reloadPending) { stopNativeVideo(); location.reload(); }
      // Everything was skipped (e.g. only videos that can't load offline): don't spin
      if (!shown) return show({ el: messageSlide('IRMF', 'International Road Movie Festival'), seconds: 20, label: 'nothing to show' });
    }).then(function () {
      // Without data yet, wait a little before trying the (message) loop again
      return state.data ? null : sleep(RETRY_MS).then(loadData);
    }).catch(function (err) {
      state.lastError = errorText(err);
      renderStatus();
      return sleep(5000);
    }).then(loop);
  }

  // ---------- updates ----------

  /** Reload (between loops) when a new version of the player is deployed. */
  function checkForUpdate() {
    fetch('app.js', { method: 'HEAD', cache: 'no-store' }).then(function (res) {
      if (!res.ok) return;
      var tag = res.headers.get('ETag') || res.headers.get('Last-Modified');
      if (!tag) return;
      if (state.shellTag && state.shellTag !== tag) state.reloadPending = true;
      state.shellTag = tag;
    }).catch(function () {});
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration().then(function (reg) { if (reg) reg.update(); }).catch(function () {});
    }
  }

  // ---------- start ----------

  fitStage();
  window.addEventListener('resize', fitStage);
  tickClock();
  setInterval(tickClock, 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      state.lastError = 'SW: ' + err.message;
    });
  }
  // Ask the browser not to evict the cache when space runs low (it may say no)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  Promise.all([loadManifest(), loadData()]).then(function () {
    setInterval(loadManifest, MANIFEST_REFRESH_MS);
    setInterval(loadData, DATA_REFRESH_MS);
    checkForUpdate();
    setInterval(checkForUpdate, UPDATE_CHECK_MS);
    loop();
  });
})();
