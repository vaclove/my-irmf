/**
 * Pure helpers for the movie-files naming convention and Drive-scan
 * auto-classification. No side effects, no I/O — unit-testable.
 *
 * Convention (see MOVIE_FILES_PLAN.md):
 *   slug = slugify(name_en || name_cs)
 *   movie:        {slug}.{ext}          ext in VIDEO_EXTENSIONS
 *   CZ subtitles: {slug}.cs.{srt|vtt}
 *   EN subtitles: {slug}.en.{srt|vtt}
 *   folder name:  sanitized raw name_cs
 */

const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'avi', 'm4v', 'ts'];
const SUBTITLE_EXTENSIONS = ['srt', 'vtt'];

const FILE_KINDS = ['movie', 'subtitles_cs', 'subtitles_en'];

/**
 * Slugify a movie name for use in file names:
 * strip diacritics, lowercase, collapse non-alphanumeric runs to '-', trim,
 * cap length.
 */
function slugifyMovieName(name, maxLen = 80) {
  if (!name) return 'movie';
  const slug = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const capped = slug.slice(0, maxLen).replace(/-+$/g, '');
  return capped || 'movie';
}

/**
 * Sanitize a raw movie name into a Drive folder name:
 * replace characters illegal on common filesystems, collapse whitespace, cap.
 */
function sanitizeFolderName(name, maxLen = 100) {
  if (!name) return 'Untitled';
  const cleaned = String(name)
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = cleaned.slice(0, maxLen).trim();
  return capped || 'Untitled';
}

/** The best display name for a movie: English preferred, Czech fallback. */
function movieSlugSource(movie) {
  return (movie && (movie.name_en || movie.name_cs)) || '';
}

/**
 * Build the convention file name for a given movie + file kind + extension.
 * ext may include or omit a leading dot.
 */
function conventionFileName(movie, fileKind, ext) {
  const slug = slugifyMovieName(movieSlugSource(movie));
  const cleanExt = String(ext || '').replace(/^\./, '').toLowerCase();
  switch (fileKind) {
    case 'movie':
      return `${slug}.${cleanExt}`;
    case 'subtitles_cs':
      return `${slug}.cs.${cleanExt}`;
    case 'subtitles_en':
      return `${slug}.en.${cleanExt}`;
    default:
      throw new Error(`Unknown file kind: ${fileKind}`);
  }
}

/** Lowercased extension without the dot, or '' if none. */
function extensionOf(fileName) {
  const m = String(fileName || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Conservative auto-classification of a single file by name/mime.
 *   *.cs.(srt|vtt)  -> subtitles_cs
 *   *.en.(srt|vtt)  -> subtitles_en
 *   a video file    -> 'movie' ONLY if it is the sole video in the folder
 *                      (caller passes videoCountInFolder)
 * Everything else   -> null (unclassified / importable).
 *
 * @param {string} fileName
 * @param {string} [mimeType]
 * @param {object} [opts]
 * @param {number} [opts.videoCountInFolder] number of video files in the folder
 * @returns {'movie'|'subtitles_cs'|'subtitles_en'|null}
 */
function classifyByName(fileName, mimeType, opts = {}) {
  const name = String(fileName || '').toLowerCase();
  const ext = extensionOf(name);

  if (SUBTITLE_EXTENSIONS.includes(ext)) {
    if (/\.cs\.(srt|vtt)$/.test(name)) return 'subtitles_cs';
    if (/\.en\.(srt|vtt)$/.test(name)) return 'subtitles_en';
    return null; // subtitle file without a language marker -> unclassified
  }

  const isVideo =
    VIDEO_EXTENSIONS.includes(ext) ||
    (typeof mimeType === 'string' && mimeType.startsWith('video/'));
  if (isVideo && opts.videoCountInFolder === 1) {
    return 'movie';
  }

  return null;
}

/** Is this file name a video by extension? Used to count videos in a folder. */
function isVideoFile(fileName, mimeType) {
  const ext = extensionOf(fileName);
  return (
    VIDEO_EXTENSIONS.includes(ext) ||
    (typeof mimeType === 'string' && mimeType.startsWith('video/'))
  );
}

module.exports = {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  FILE_KINDS,
  slugifyMovieName,
  sanitizeFolderName,
  conventionFileName,
  classifyByName,
  isVideoFile,
  extensionOf,
};
