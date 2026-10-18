/**
 * Burned-in subtitles (CS + EN) for laptop screenings: pure helpers, no I/O.
 * Shared by the app (pre-flight check) and the movie worker (render; copied
 * into its image).
 *
 * Look — the same for every movie:
 *   CS  bottom, white, full size (the main language — where the audience
 *       looks by habit)
 *   EN  top, light grey (85 % white), 85 % of the CS size: it keeps out of
 *       the way of the Czech audience and the position alone tells the
 *       languages apart (no colour, and italics keep their own meaning)
 *   one language only: bottom, white and larger
 *   added to a master with subtitles already burned in: the new language in
 *   its usual style (EN grey/smaller, CS white), anchored at the top or the
 *   bottom at an edge chosen in the app so it clears the existing ones; the
 *   picture stays untouched (no crop, centered, same size)
 *   Liberation Sans regular (Arial-like, the classic cinema subtitle look)
 *   with a thin black outline and a faint, blurred shadow — the light look
 *   of distributor subtitles rather than a heavy dark rim. Sizes are
 *   fractions of the canvas height, so 1080p and 2160p renders look the same
 *   on screen.
 *
 * Canvas: 1920x1080, or 3840x2160 for UHD masters. The picture (with any
 * letterbox baked into the master cropped away) is scaled to fit and
 * centered. When a black band above or below it holds two lines of a
 * language, that language sits inside the band (CS in the bottom one, EN in
 * the top one) and the picture stays clean. A single language pushes the
 * picture up instead, to use one band below.
 */

const { parseSubtitles } = require('./subtitles');

const FONT = 'Liberation Sans';
const CS_SIZE = 0.048; // of the canvas height: 52 px at 1080p
const EN_SIZE = 0.0408; // 85 % of CS: 44 px at 1080p (below 80 % the back rows suffer)
const SINGLE_SIZE = 0.06; // 65 px at 1080p, when only one language is burned in
const LINE_HEIGHT = 1.2; // libass line box (Liberation Sans: ~1.15), in font sizes
const MARGIN = 0.035; // from the top/bottom edge
const MIN_BAND_MARGIN = 0.01; // inside a letterbox band, to keep two lines in it
const MARGIN_SIDE = 0.07; // of the canvas width
const OUTLINE = 0.0014; // 1.5 px at 1080p
const SHADOW = 0.0014;
const BLUR = 0.00055; // softens the outline and shadow edges, not the letters
// ASS colours are &HAABBGGRR.
const CS_COLOUR = '&H00FFFFFF'; // white
const EN_COLOUR = '&H00D9D9D9'; // 85 % white
const OUTLINE_COLOUR = '&H00000000';
const SHADOW_COLOUR = '&HA0000000'; // black, ~37 % opaque

const PAIR_TOLERANCE_MS = 250;
const MAX_LINE_CHARS = 42;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Font sizes and spacing in canvas pixels; `single` = one language only. */
function metrics(canvasHeight, { single = false } = {}) {
  const H = canvasHeight;
  const singleSize = Math.round(H * SINGLE_SIZE);
  const csSize = Math.round(H * CS_SIZE);
  const enSize = Math.round(H * EN_SIZE);
  const margin = Math.round(H * MARGIN);
  return {
    csSize,
    enSize,
    singleSize,
    margin,
    minMargin: Math.round(H * MIN_BAND_MARGIN),
    outline: Math.round(H * OUTLINE * 10) / 10,
    shadow: Math.round(H * SHADOW * 10) / 10,
    blur: Math.round(H * BLUR * 10) / 10,
    // Two lines of each language.
    csBlock: Math.ceil(2 * csSize * LINE_HEIGHT),
    enBlock: Math.ceil(2 * enSize * LINE_HEIGHT),
    // Room below the picture a single language wants.
    blockHeight: Math.ceil(margin + 2 * (single ? singleSize : csSize) * LINE_HEIGHT),
  };
}

/**
 * Margin from the canvas edge for a block of two lines next to a black band:
 * inside the band when it fits (as close to the usual margin as the band
 * allows), else the usual margin over the picture.
 */
function bandMargin(band, block, m) {
  return band >= block + m.minMargin ? Math.min(m.margin, band - block) : m.margin;
}

/**
 * Canvas and picture placement for a master.
 * @param {{width:number, height:number, sar?:number, crop?:{x,y,w,h}|null, single?:boolean, centered?:boolean}} source
 *   coded size, sample aspect ratio, the letterbox crop (if any), whether
 *   only one language is burned in, and whether to keep the picture centered
 *   even then (subtitles added to burned-in ones are placed against it)
 * @returns {{canvas, picture, crop, band, margins: {cs, en}, metrics}}
 */
function computeLayout({ width, height, sar = 1, crop = null, single = false, centered = false }) {
  const uhd = width > 2560 || height > 1440;
  const W = uhd ? 3840 : 1920;
  const H = uhd ? 2160 : 1080;
  const m = metrics(H, { single });
  const srcW = (crop ? crop.w : width) * (sar > 0 ? sar : 1);
  const srcH = crop ? crop.h : height;
  const scale = Math.min(W / srcW, H / srcH);
  const pw = Math.min(W, even(srcW * scale));
  const ph = Math.min(H, even(srcH * scale));
  const free = H - ph;
  // Centered; only a single language pushes it up (at most to the top edge)
  // when the band below can't hold two lines of it.
  const push = single && !centered && free / 2 < m.blockHeight;
  const py = push ? Math.max(0, Math.floor((free - m.blockHeight) / 2) * 2) : Math.floor(free / 4) * 2;
  const bandBelow = H - py - ph;
  return {
    canvas: { width: W, height: H },
    picture: { x: Math.floor((W - pw) / 4) * 2, y: py, width: pw, height: ph },
    crop: crop || null,
    band: bandBelow,
    margins: {
      cs: single ? m.margin : bandMargin(bandBelow, m.csBlock, m),
      en: bandMargin(py, m.enBlock, m),
    },
    metrics: m,
  };
}

// ---------------------------------------------------------------------------
// Letterbox detection (cropdetect output)
// ---------------------------------------------------------------------------

/** The last cropdetect bounds in an ffmpeg stderr dump: {y1, y2} or null. */
function parseCropdetect(stderr) {
  const re = /x1:(-?\d+)\s+x2:(-?\d+)\s+y1:(-?\d+)\s+y2:(-?\d+)/g;
  let last = null;
  let m;
  while ((m = re.exec(String(stderr || '')))) last = m;
  return last ? { y1: Number(last[3]), y2: Number(last[4]) } : null;
}

/**
 * Combine cropdetect samples from across the movie into one vertical crop,
 * or null. Uses the union of the picture bounds (a dark scene never shrinks
 * it) and only accepts symmetric bars — a dark sky or floor is not a
 * letterbox. Keeps a few pixels of slack: extra black is invisible on the
 * black canvas, a cut picture is not.
 */
function letterboxCrop(samples, width, height) {
  const valid = samples.filter((s) => s && s.y2 > s.y1 && s.y2 - s.y1 + 1 >= height * 0.3);
  if (valid.length < 3) return null;
  const y1 = Math.min(...valid.map((s) => s.y1));
  const y2 = Math.max(...valid.map((s) => s.y2));
  const top = y1;
  const bottom = height - 1 - y2;
  if (top + bottom < height * 0.02) return null;
  if (Math.abs(top - bottom) > Math.max(4, height * 0.01)) return null;
  const y = Math.max(0, Math.floor((y1 - 4) / 2) * 2);
  const h = Math.min(height - y, Math.ceil((y2 + 4 - y + 1) / 2) * 2);
  return { x: 0, y, w: width, h };
}

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };

/**
 * SRT/VTT cue text -> ASS text. Keeps <b>/<i>/<u>, drops other markup and
 * any ASS override blocks except a top position ({\an8} and friends).
 * @returns {{ass: string, lines: string[], top: boolean}}
 */
function cueToAss(text) {
  let top = false;
  let t = String(text || '').replace(/\{([^}]*)\}/g, (_, inner) => {
    if (/\\an[789]|\\a[567](?!\d)/.test(inner)) top = true;
    return '';
  });
  t = t.replace(/\{/g, '(').replace(/\}/g, ')');
  t = t.replace(/<\s*(\/?)\s*([biu])\s*>/gi, (_, close, tag) => `{\\${tag.toLowerCase()}${close ? 0 : 1}}`);
  t = t.replace(/<[^>]*>/g, '');
  t = t.replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (e) => ENTITIES[e]);
  const assLines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.replace(/\{[^}]*\}/g, '').trim() !== '');
  return {
    ass: assLines.join('\\N'),
    lines: assLines.map((l) => l.replace(/\{[^}]*\}/g, '')),
    top,
  };
}

/** Parsed cues -> sorted render cues {start, end, ass, lines, top}. */
function prepareCues(cues) {
  return cues
    .filter((c) => c.startMs != null && c.endMs != null && c.endMs > c.startMs)
    .map((c) => ({ start: c.startMs, end: c.endMs, ...cueToAss(c.text) }))
    .filter((c) => c.lines.length > 0)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Subtitle file text -> render cues. Throws when the file has no cues. */
function parseCues(text) {
  return prepareCues(parseSubtitles(text));
}

/**
 * Match CS cues to EN cues with (nearly) the same timing.
 * @returns {{pairs: Map<number, number>, ratio: number}} cs index -> en index;
 *   ratio = pairs / the larger cue count
 */
function pairCues(cs, en, toleranceMs = PAIR_TOLERANCE_MS) {
  const used = new Uint8Array(en.length);
  const pairs = new Map();
  let lo = 0;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    while (lo < en.length && en[lo].start < c.start - toleranceMs) lo++;
    let best = -1;
    let bestDiff = Infinity;
    for (let j = lo; j < en.length && en[j].start <= c.start + toleranceMs; j++) {
      if (used[j]) continue;
      const endDiff = Math.abs(en[j].end - c.end);
      if (endDiff > toleranceMs) continue;
      const diff = Math.abs(en[j].start - c.start) + endDiff;
      if (diff < bestDiff) {
        best = j;
        bestDiff = diff;
      }
    }
    if (best >= 0) {
      used[best] = 1;
      pairs.set(i, best);
    }
  }
  return { pairs, ratio: pairs.size / Math.max(cs.length, en.length, 1) };
}

/**
 * 'single' | 'dual', plus how many cues share their timing with the other
 * language (both languages should change at the same moments).
 */
function chooseLayout(cs, en) {
  if (!cs?.length || !en?.length) return { layout: 'single', ratio: null };
  return { layout: 'dual', ratio: pairCues(cs, en).ratio };
}

/** Readability numbers for the pre-flight warning. */
function subtitleStats(cues) {
  let overTwoLines = 0;
  let longLines = 0;
  let maxLineLength = 0;
  for (const c of cues) {
    if (c.lines.length > 2) overTwoLines++;
    const longest = Math.max(...c.lines.map((l) => l.length));
    if (longest > MAX_LINE_CHARS) longLines++;
    maxLineLength = Math.max(maxLineLength, longest);
  }
  return { cues: cues.length, over_two_lines: overTwoLines, long_lines: longLines, max_line_length: maxLineLength };
}

/**
 * Start (ms) of the `lengthMs` window with the most cue starts, with a short
 * lead-in, kept inside the movie.
 */
function densestWindowStart(cueLists, lengthMs, durationMs) {
  const starts = cueLists
    .flat()
    .map((c) => c.start)
    .sort((a, b) => a - b);
  if (starts.length === 0) return 0;
  let best = starts[0];
  let bestCount = 0;
  let j = 0;
  for (let i = 0; i < starts.length; i++) {
    while (j < starts.length && starts[j] < starts[i] + lengthMs) j++;
    if (j - i > bestCount) {
      bestCount = j - i;
      best = starts[i];
    }
  }
  let start = Math.max(0, best - 2000);
  if (durationMs) start = Math.max(0, Math.min(start, durationMs - lengthMs));
  return start;
}

// ---------------------------------------------------------------------------
// ASS script
// ---------------------------------------------------------------------------

function assTime(ms) {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = String(Math.floor((cs % 360000) / 6000)).padStart(2, '0');
  const s = String(Math.floor((cs % 6000) / 100)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(cs % 100).padStart(2, '0')}`;
}

function styleLine(name, size, colour, alignment, marginSide, marginV, m) {
  return (
    `Style: ${name},${FONT},${size},${colour},${colour},${OUTLINE_COLOUR},${SHADOW_COLOUR},` +
    // Bold = 0 (Liberation Sans regular).
    `0,0,0,0,100,100,0,0,1,${m.outline},${m.shadow},${alignment},${marginSide},${marginSide},${marginV},1`
  );
}

/**
 * Build the ASS script.
 * @param {object} opts
 * @param {Array} opts.cs render cues (or empty)
 * @param {Array} opts.en render cues (or empty)
 * @param {object} opts.layout computeLayout() result
 * @param {number} [opts.offsetMs] shift (preview clips start at 0)
 * @param {number} [opts.lengthMs] clip events to [0, lengthMs] after the shift
 * @param {string} [opts.title]
 * @param {{align: 'top'|'bottom', edge: number}} [opts.added] the master
 *   already has subtitles burned in: where the added language goes — its
 *   top or bottom edge as a fraction of the canvas height
 * @returns {{script: string, mode: string, ratio: number|null, events: number}}
 */
function buildAss({ cs = [], en = [], layout, offsetMs = 0, lengthMs = null, title = '', added = null }) {
  const { width: W, height: H } = layout.canvas;
  const m = layout.metrics;
  const side = Math.round(W * MARGIN_SIDE);
  const chosen = chooseLayout(cs, en);
  const mode = added ? 'added' : chosen.layout;

  // Each language on its own: they sit apart, so nothing needs merging. A
  // cue's own {\an8} (text in the picture below) still moves it to the top.
  // Blur is not a style field, so every event carries it.
  const text = (c) => `{${c.top ? '\\an8' : ''}\\blur${m.blur}}${c.ass}`;
  const events = [
    ...cs.map((c) => ({ start: c.start, end: c.end, style: 'CS', text: text(c) })),
    ...en.map((c) => ({ start: c.start, end: c.end, style: 'EN', text: text(c) })),
  ]
    .map((e) => ({ ...e, start: e.start - offsetMs, end: e.end - offsetMs }))
    .map((e) => (lengthMs != null ? { ...e, start: Math.max(0, e.start), end: Math.min(lengthMs, e.end) } : e))
    .filter((e) => e.end > e.start && e.end > 0)
    .sort((a, b) => a.start - b.start);

  // [size, colour, alignment (2 = bottom, 8 = top), marginV]
  let csStyle = [m.csSize, CS_COLOUR, 2, layout.margins.cs];
  let enStyle = [m.enSize, EN_COLOUR, 8, layout.margins.en];
  if (mode === 'single') {
    csStyle = enStyle = [m.singleSize, CS_COLOUR, 2, layout.margins.cs];
  } else if (mode === 'added') {
    const edge = Math.min(1, Math.max(0, Number(added.edge)));
    const top = added.align === 'top';
    const alignment = top ? 8 : 2;
    const marginV = Math.max(m.minMargin, Math.round(H * (top ? edge : 1 - edge)));
    csStyle = [m.csSize, CS_COLOUR, alignment, marginV];
    enStyle = [m.enSize, EN_COLOUR, alignment, marginV];
  }
  const lines = [
    '[Script Info]',
    `Title: ${String(title).replace(/[\r\n]/g, ' ')}`,
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine('CS', csStyle[0], csStyle[1], csStyle[2], side, csStyle[3], m),
    styleLine('EN', enStyle[0], enStyle[1], enStyle[2], side, enStyle[3], m),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events.map((e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${e.text}`),
    '',
  ];
  return { script: lines.join('\n'), mode, ratio: chosen.ratio, events: events.length };
}

module.exports = {
  FONT,
  MAX_LINE_CHARS,
  metrics,
  computeLayout,
  parseCropdetect,
  letterboxCrop,
  cueToAss,
  prepareCues,
  parseCues,
  pairCues,
  chooseLayout,
  subtitleStats,
  densestWindowStart,
  assTime,
  buildAss,
};
