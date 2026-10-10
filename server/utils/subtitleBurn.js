/**
 * Burned-in subtitles (CS + EN) for laptop screenings: pure helpers, no I/O.
 * Shared by the app (pre-flight check) and the movie worker (render; copied
 * into its image).
 *
 * Look — the same for every movie:
 *   CS  bottom, white, full size (the main language)
 *   EN  directly above, light yellow, ~88 % of the CS size
 *   Roboto Medium with a black outline and a soft shadow. Sizes are fractions
 *   of the canvas height, so 1080p and 2160p renders look the same on screen.
 *
 * Canvas: 1920x1080, or 3840x2160 for UHD masters. The picture (with any
 * letterbox baked into the master cropped away) is scaled to fit; when it is
 * wider than 16:9 it is pushed up so the black band below it holds the
 * subtitles instead of the picture.
 *
 * Layouts:
 *   paired  CS and EN share timings (one is a translation of the other):
 *           each moment renders as one block, EN directly above CS
 *   zones   independent timings: each language keeps a fixed zone (EN sits
 *           above room for two CS lines), so nothing jumps when only one
 *           language changes
 *   single  one language only
 */

const { parseSubtitles } = require('./subtitles');

const FONT = 'Roboto Medium';
const CS_SIZE = 0.048; // of the canvas height: 52 px at 1080p
const EN_SIZE = 0.042; // 45 px at 1080p
const LINE_HEIGHT = 1.2; // libass line box of Roboto, in font sizes
const GAP = 0.012; // between the EN and CS blocks
const MARGIN_BOTTOM = 0.035;
const MARGIN_SIDE = 0.07; // of the canvas width
const OUTLINE = 0.0028;
const SHADOW = 0.0014;
// ASS colours are &HAABBGGRR.
const CS_COLOUR = '&H00FFFFFF'; // white
const EN_COLOUR = '&H0080E6FF'; // #FFE680
const OUTLINE_COLOUR = '&H00000000';
const SHADOW_COLOUR = '&H80000000';

const PAIR_TOLERANCE_MS = 250;
const PAIRED_MIN_RATIO = 0.8;
const MAX_LINE_CHARS = 42;

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Font sizes and spacing in canvas pixels. */
function metrics(canvasHeight) {
  const H = canvasHeight;
  const csSize = Math.round(H * CS_SIZE);
  const enSize = Math.round(H * EN_SIZE);
  const gap = Math.round(H * GAP);
  const margin = Math.round(H * MARGIN_BOTTOM);
  const csLines = 2 * csSize * LINE_HEIGHT;
  const enLines = 2 * enSize * LINE_HEIGHT;
  return {
    csSize,
    enSize,
    gap,
    margin,
    outline: Math.round(H * OUTLINE * 10) / 10,
    shadow: Math.round(H * SHADOW * 10) / 10,
    // Bottom margin of the EN zone in the zones layout.
    enZoneMargin: Math.round(margin + csLines + gap),
    // Room for two lines of each language.
    blockHeight: Math.ceil(margin + csLines + gap + enLines),
  };
}

/**
 * Canvas and picture placement for a master.
 * @param {{width:number, height:number, sar?:number, crop?:{x,y,w,h}|null}} source
 *   coded size, sample aspect ratio, and the letterbox crop (if any)
 */
function computeLayout({ width, height, sar = 1, crop = null }) {
  const uhd = width > 2560 || height > 1440;
  const W = uhd ? 3840 : 1920;
  const H = uhd ? 2160 : 1080;
  const m = metrics(H);
  const srcW = (crop ? crop.w : width) * (sar > 0 ? sar : 1);
  const srcH = crop ? crop.h : height;
  const scale = Math.min(W / srcW, H / srcH);
  const pw = Math.min(W, even(srcW * scale));
  const ph = Math.min(H, even(srcH * scale));
  const free = H - ph;
  // Centered when the band below already holds two lines of each language,
  // otherwise pushed up (at most to the top edge) to make room.
  const py = free / 2 >= m.blockHeight ? Math.floor(free / 4) * 2 : Math.max(0, Math.floor((free - m.blockHeight) / 2) * 2);
  return {
    canvas: { width: W, height: H },
    picture: { x: Math.floor((W - pw) / 4) * 2, y: py, width: pw, height: ph },
    crop: crop || null,
    band: H - py - ph,
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
 * SRT/VTT cue text -> ASS text. Keeps <i>/<b>/<u>, drops other markup and
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
  t = t.replace(/<\s*(\/?)\s*([ibu])\s*>/gi, (_, close, tag) => `{\\${tag.toLowerCase()}${close ? 0 : 1}}`);
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

/** 'single' | 'paired' | 'zones' plus the pairing ratio. */
function chooseLayout(cs, en) {
  if (!cs?.length || !en?.length) return { layout: 'single', ratio: null };
  const { ratio } = pairCues(cs, en);
  return { layout: ratio >= PAIRED_MIN_RATIO ? 'paired' : 'zones', ratio };
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

function styleLine(name, size, colour, marginSide, marginV, m) {
  return (
    `Style: ${name},${FONT},${size},${colour},${colour},${OUTLINE_COLOUR},${SHADOW_COLOUR},` +
    `0,0,0,0,100,100,0,0,1,${m.outline},${m.shadow},2,${marginSide},${marginSide},${marginV},1`
  );
}

/**
 * One event per moment where the set of visible cues stays the same, so a
 * pair always renders as one block (EN above CS).
 */
function mergeTimeline(items) {
  const points = [...new Set(items.flatMap((i) => [i.start, i.end]))].sort((a, b) => a - b);
  const byStart = [...items].sort((a, b) => a.start - b.start);
  const out = [];
  let k = 0;
  let active = [];
  for (let p = 0; p < points.length - 1; p++) {
    const a = points[p];
    const b = points[p + 1];
    while (k < byStart.length && byStart[k].start <= a) active.push(byStart[k++]);
    active = active.filter((i) => i.end > a);
    if (active.length === 0) continue;
    const key = active
      .map((i) => i.id)
      .sort()
      .join(',');
    const last = out[out.length - 1];
    if (last && last.key === key && last.end === a) last.end = b;
    else out.push({ start: a, end: b, key, items: [...active] });
  }
  return out;
}

const joinAss = (items) => items.map((i) => i.ass).join('\\N');

/**
 * Build the ASS script.
 * @param {object} opts
 * @param {Array} opts.cs render cues (or empty)
 * @param {Array} opts.en render cues (or empty)
 * @param {object} opts.layout computeLayout() result
 * @param {number} [opts.offsetMs] shift (preview clips start at 0)
 * @param {number} [opts.lengthMs] clip events to [0, lengthMs] after the shift
 * @param {string} [opts.title]
 * @returns {{script: string, mode: string, ratio: number|null, events: number}}
 */
function buildAss({ cs = [], en = [], layout, offsetMs = 0, lengthMs = null, title = '' }) {
  const { width: W, height: H } = layout.canvas;
  const m = layout.metrics;
  const side = Math.round(W * MARGIN_SIDE);
  const { layout: mode, ratio } = chooseLayout(cs, en);

  let events = [];
  if (mode === 'paired') {
    const { pairs } = pairCues(cs, en);
    // Snap paired EN cues to their CS timing so the block changes as one.
    const enTimed = en.map((c) => ({ ...c }));
    for (const [ci, ei] of pairs) {
      enTimed[ei].start = cs[ci].start;
      enTimed[ei].end = cs[ci].end;
    }
    const items = [
      ...cs.map((c, i) => ({ ...c, lang: 'cs', id: `c${i}` })),
      ...enTimed.map((c, i) => ({ ...c, lang: 'en', id: `e${i}` })),
    ];
    for (const seg of mergeTimeline(items)) {
      const csItems = seg.items.filter((i) => i.lang === 'cs').sort((a, b) => a.start - b.start);
      const enItems = seg.items.filter((i) => i.lang === 'en').sort((a, b) => a.start - b.start);
      const pos = seg.items.some((i) => i.top) ? '{\\an8}' : '';
      let style;
      let text;
      if (csItems.length && enItems.length) {
        style = 'CS';
        text = `${pos}{\\rEN}${joinAss(enItems)}\\N{\\rGap}\\h\\N{\\rCS}${joinAss(csItems)}`;
      } else if (csItems.length) {
        style = 'CS';
        text = pos + joinAss(csItems);
      } else {
        style = 'EN';
        text = pos + joinAss(enItems);
      }
      events.push({ start: seg.start, end: seg.end, style, text });
    }
  } else {
    for (const c of cs) events.push({ start: c.start, end: c.end, style: 'CS', text: (c.top ? '{\\an8}' : '') + c.ass });
    for (const c of en) events.push({ start: c.start, end: c.end, style: 'EN', text: (c.top ? '{\\an8}' : '') + c.ass });
  }

  events = events
    .map((e) => ({ ...e, start: e.start - offsetMs, end: e.end - offsetMs }))
    .map((e) => (lengthMs != null ? { ...e, start: Math.max(0, e.start), end: Math.min(lengthMs, e.end) } : e))
    .filter((e) => e.end > e.start && e.end > 0)
    .sort((a, b) => a.start - b.start);

  const enMarginV = mode === 'zones' ? m.enZoneMargin : m.margin;
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
    styleLine('CS', m.csSize, CS_COLOUR, side, m.margin, m),
    styleLine('EN', m.enSize, EN_COLOUR, side, enMarginV, m),
    // The spacer line between EN and CS in a paired block.
    styleLine('Gap', Math.max(1, Math.round(m.gap / LINE_HEIGHT)), CS_COLOUR, side, m.margin, m),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events.map((e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${e.text}`),
    '',
  ];
  return { script: lines.join('\n'), mode, ratio, events: events.length };
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
