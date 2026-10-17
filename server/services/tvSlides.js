/**
 * TV player slides (see migration 067_create_tv_screen.sql): file naming,
 * photo processing and the video transcode queue.
 *
 * Files live in the movie storage account under tv/<slide id>/. Videos are
 * transcoded by the movie worker (job type 'tv_video', the slide id is the
 * job id); the slide row itself carries the job status.
 */

const crypto = require('crypto');
const sharp = require('sharp');
const movieStorage = require('./movieStorage');
const transcodeQueue = require('./transcodeQueue');

// What the player renders: photos are scaled to fit a Full HD screen.
const PHOTO_MAX_WIDTH = 1920;
const PHOTO_MAX_HEIGHT = 1080;
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'mpg', 'mpeg', 'ts'];
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Whether uploaded videos can be sent to the worker. Unlike movie transcodes
 * (transcodeQueue.isConfigured) this needs no Google Drive.
 */
function canTranscode() {
  return (
    movieStorage.isConfigured() &&
    !!process.env.AZURE_STORAGE_CONNECTION_STRING &&
    process.env.MOVIE_TRANSCODE_ENABLED !== 'false'
  );
}

async function enqueueVideo(slideId) {
  await transcodeQueue.enqueueMessage({ type: 'tv_video', job_id: slideId });
}

function extensionOf(fileName) {
  const match = /\.([a-z0-9]{1,5})$/i.exec(fileName || '');
  return match ? match[1].toLowerCase() : '';
}

/** Every new file gets a new name, so the player's cache never serves an old one. */
function blobName(slideId, base, ext) {
  return `tv/${slideId}/${base}-${Date.now()}.${ext}`;
}

/** Scale a photo to fit the screen (honouring EXIF rotation) as a JPEG. */
async function processPhoto(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: PHOTO_MAX_WIDTH, height: PHOTO_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Public URL of a slide's file; the version changes whenever the file does. */
function mediaUrl(slide) {
  if (!slide.blob_name) return null;
  const version = crypto.createHash('md5').update(slide.blob_name).digest('hex').slice(0, 10);
  return `/api/public/tv/media/${slide.id}?v=${version}`;
}

module.exports = {
  VIDEO_EXTENSIONS,
  MAX_VIDEO_BYTES,
  canTranscode,
  enqueueVideo,
  extensionOf,
  blobName,
  processPhoto,
  mediaUrl,
};
