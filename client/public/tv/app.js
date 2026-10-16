/*
 * IRMF TV player — a looping showcase for a TV in the festival venue
 * (Fully Kiosk Browser on a TV box, or any Chrome in kiosk mode).
 *
 * Plain script, no build step: it runs on low-end TV boxes and must keep
 * working offline. sw.js caches this page, the last programme data and every
 * image it shows, so after the first load the loop survives a lost connection.
 *
 * URL parameters (for testing):
 *   ?debug=1                  show a status box (cache, data, errors)
 *   ?now=2026-10-23T19:00     pretend it is this local time (the clock keeps running)
 */
(function () {
  'use strict';

  var API = '/api/public';
  // Scenes played in a loop. Later this comes from my.irmf.cz; for now only
  // the programme exists.
  var PLAYLIST = [{ type: 'programme', overviewSeconds: 15, featureSeconds: 12 }];
  var ROWS_PER_PAGE = 10;
  var SYNOPSIS_MAX = 420;
  var DATA_REFRESH_MS = 5 * 60 * 1000;
  var UPDATE_CHECK_MS = 5 * 60 * 1000;
  var RETRY_MS = 30 * 1000;
  var ASSET_CACHE = 'irmf-tv-assets';

  var params = new URLSearchParams(location.search);
  var DEBUG = params.has('debug');
  var timeOffset = params.get('now') ? new Date(params.get('now')).getTime() - Date.now() : 0;
  if (isNaN(timeOffset)) timeOffset = 0;

  var stage = document.getElementById('stage');
  var sceneEl = document.getElementById('scene');
  var statusEl = document.getElementById('status');
  var clockEl = document.getElementById('clock');

  var state = {
    data: null,          // { edition, entries }
    loadedAt: null,
    lastError: null,
    cachedImages: 0,
    reloadPending: false,
    shellTag: null,
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
    statusEl.textContent = [
      'now: ' + now().toString().slice(0, 24) + (timeOffset ? ' (override)' : ''),
      'viewport: ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight + ' @' + window.devicePixelRatio + 'x',
      'sw: ' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlling' : 'not controlling'),
      'edition: ' + (d ? d.edition.name + ' ' + d.edition.start + '..' + d.edition.end : '-'),
      'entries: ' + (d ? d.entries.length : '-') + ', loaded ' + (state.loadedAt ? state.loadedAt.toTimeString().slice(0, 8) : '-'),
      'cached images: ' + state.cachedImages,
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
      highlighted: !!e.highlighted,
    };
  }

  function loadData() {
    var today = localDate(now());
    return getJson(API + '/editions').then(function (res) {
      var edition = pickEdition(res.editions || [], today);
      if (!edition) throw new Error('no edition with dates');
      return getJson(API + '/programming?edition_id=' + encodeURIComponent(edition.id) + '&limit=500').then(function (prog) {
        state.data = { edition: edition, entries: (prog.programming || []).map(normalize) };
        state.loadedAt = new Date();
        state.lastError = null;
        precacheImages(state.data.entries);
      });
    }).catch(function (err) {
      state.lastError = String(err && err.message || err);
    }).then(renderStatus);
  }

  /**
   * Keep every programme image in the Cache API so slides render offline.
   * s3.irmf.cz sends no CORS headers, so these are opaque responses — fine for
   * <img>. Images that left the programme are dropped.
   */
  function precacheImages(entries) {
    if (!window.caches) return;
    var urls = entries.map(function (e) { return e.image; }).filter(Boolean)
      .filter(function (url, i, all) { return all.indexOf(url) === i; });
    caches.open(ASSET_CACHE).then(function (cache) {
      var chain = Promise.resolve();
      urls.forEach(function (url) {
        chain = chain.then(function () {
          return cache.match(url).then(function (hit) {
            if (hit) return;
            return fetch(url, { mode: 'no-cors' }).then(function (res) {
              if (res.ok || res.type === 'opaque') return cache.put(url, res);
            }).catch(function () { /* offline: try again on the next refresh */ });
          });
        });
      });
      return chain.then(function () { return cache.keys(); }).then(function (keys) {
        var keep = 0;
        return Promise.all(keys.map(function (req) {
          if (urls.indexOf(req.url) === -1) return cache.delete(req);
          keep++;
        })).then(function () { state.cachedImages = keep; renderStatus(); });
      });
    });
  }

  // ---------- programme scene ----------

  function entryEnd(e) {
    return e.startMin + Math.max(e.runtime, 15);
  }

  /**
   * Which festival day to show: before the festival its first day, during it
   * today (or the next day once today's programme is over), after it the last day.
   */
  function pickDay(entries, d) {
    var today = localDate(d);
    var nowMin = minutesOf(d);
    var days = entries.map(function (e) { return e.date; })
      .filter(function (day, i, all) { return all.indexOf(day) === i; })
      .sort();
    if (!days.length) return null;
    if (today < days[0]) return { date: days[0], mode: 'first' };
    var leftToday = entries.some(function (e) {
      return e.date === today && e.time && entryEnd(e) > nowMin;
    });
    if (leftToday) return { date: today, mode: 'today' };
    var next = days.filter(function (day) { return day > today; })[0];
    if (next) {
      var tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      return { date: next, mode: next === localDate(tomorrow) ? 'tomorrow' : 'next' };
    }
    return { date: days[days.length - 1], mode: 'past' };
  }

  function dayLabels(day) {
    var date = formatDay(day.date);
    switch (day.mode) {
      case 'today': return { eyebrow: 'Dnes · ' + date, heading: 'Dnes na programu' };
      case 'tomorrow': return { eyebrow: 'Zítra · ' + date, heading: 'Zítra na programu' };
      case 'first': return { eyebrow: 'Festival začíná · ' + date, heading: 'Program prvního dne' };
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

  function buildProgramme(scene) {
    if (!state.data) return [{ el: messageSlide('IRMF', 'Načítám program…'), seconds: 10 }];
    var d = now();
    var nowMin = minutesOf(d);
    var day = pickDay(state.data.entries, d);
    if (!day) return [{ el: messageSlide(state.data.edition.name, 'Program brzy zveřejníme'), seconds: 20 }];

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
        seconds: scene.overviewSeconds,
      });
    });
    timed.concat(allDay).forEach(function (e) {
      slides.push({ el: featureSlide(e, labels, day, nowMin), seconds: scene.featureSeconds });
    });
    return slides;
  }

  var SCENES = { programme: buildProgramme };

  // ---------- loop ----------

  function whenImagesReady(el) {
    var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      var ready = img.decode ? img.decode().catch(function () {}) : Promise.resolve();
      return Promise.race([ready, sleep(4000)]);
    }));
  }

  var current = null;
  var FADE_MS = 500; // matches the .slide opacity transition

  /**
   * Fade the current slide out, then the next one in — never both at once:
   * overlapping texts look messy and two full-screen layers stutter on TV boxes.
   */
  function show(slide) {
    var wrapper = h('div', { class: 'slide' }, slide.el, h('div', { class: 'progress' }));
    wrapper.lastChild.style.animationDuration = slide.seconds + 's';
    sceneEl.appendChild(wrapper);
    return whenImagesReady(wrapper).then(function () {
      var previous = current;
      current = wrapper;
      if (!previous) return;
      previous.classList.remove('visible');
      return sleep(FADE_MS).then(function () { previous.remove(); });
    }).then(function () {
      // Two frames so the browser paints the slide at opacity 0 before fading in
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { wrapper.classList.add('visible'); });
      });
      return sleep(slide.seconds * 1000);
    });
  }

  function loop() {
    var chain = Promise.resolve();
    PLAYLIST.forEach(function (scene) {
      chain = chain.then(function () {
        var build = SCENES[scene.type];
        if (!build) return;
        return build(scene).reduce(function (p, slide) {
          return p.then(function () { return show(slide); });
        }, Promise.resolve());
      });
    });
    return chain.then(function () {
      if (state.reloadPending) location.reload();
      // Without data yet, wait a little before trying the (message) loop again
      return state.data ? null : sleep(RETRY_MS).then(loadData);
    }).catch(function (err) {
      state.lastError = String(err && err.message || err);
      renderStatus();
      return sleep(5000);
    }).then(loop);
  }

  // ---------- updates ----------

  /** Reload (between scenes) when a new version of the player is deployed. */
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

  loadData().then(function () {
    setInterval(loadData, DATA_REFRESH_MS);
    checkForUpdate();
    setInterval(checkForUpdate, UPDATE_CHECK_MS);
    loop();
  });
})();
