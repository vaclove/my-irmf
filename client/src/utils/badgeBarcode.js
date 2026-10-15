import JsBarcode from 'jsbarcode';

// Badges are printed on a Brother VC-500W (313 dpi). Bars that are a whole
// number of printer dots wide print evenly; fractional widths get rounded
// unevenly from bar to bar, which is what makes 1D codes hard to scan.
export const PRINTER_DOT_MM = 25.4 / 313;

// Code128 needs a blank margin of 10 modules on both sides of the bars. The
// barcode box in the layout includes it, so nothing can be placed there.
export const QUIET_ZONE_MODULES = 10;

// Recommended minimum: 5 printer dots (0.41 mm) per module, 7 mm tall
export const MIN_MODULE_DOTS = 5;
export const MIN_HEIGHT_MM = 7;

// Badge codes are YYYY + 3 digits, every one encodes to the same width
export const SAMPLE_BADGE_CODE = '2026001';

// Code128 modules as a string of '1' (bar) and '0' (space)
export const encodeBarcode = (text) => {
  const target = {};
  JsBarcode(target, text, { format: 'CODE128' });
  return target.encodings.map(e => e.data).join('');
};

// Fit the bars into a box of the given width (mm), centred, with the module
// width snapped down to whole printer dots
export const fitBarcode = (bits, boxWidthMm) => {
  const modules = bits.length + 2 * QUIET_ZONE_MODULES;
  const dots = Math.max(1, Math.floor(boxWidthMm / modules / PRINTER_DOT_MM));
  const moduleMm = dots * PRINTER_DOT_MM;
  const barsWidthMm = bits.length * moduleMm;
  return { dots, moduleMm, barsWidthMm, offsetMm: (boxWidthMm - barsWidthMm) / 2 };
};

// Runs of consecutive bar modules: [{ start, length }] in modules
export const barRuns = (bits) => {
  const runs = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const start = i;
    while (bits[i + 1] === '1') i++;
    runs.push({ start, length: i - start + 1 });
  }
  return runs;
};

// Box width (mm) needed for the recommended module width
export const recommendedBoxWidthMm = (bits) =>
  (bits.length + 2 * QUIET_ZONE_MODULES) * MIN_MODULE_DOTS * PRINTER_DOT_MM;
