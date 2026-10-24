import { BarcodeDetector as ZXingBarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Camera scanner for badges and tickets.
//
// The scan region is decoded at the camera's full resolution. html5-qrcode,
// used before, first scaled it down to its on-screen size (about 350 px wide
// on a phone), so a Code128 had to fill most of the frame to be readable.
//
// Decoding uses the browser's BarcodeDetector where it reads both formats
// (Chrome on Android), elsewhere (iPhone) the zxing-cpp WebAssembly build of
// the same API. The .wasm is served from our origin, not the default CDN.

// Badges and one-time tickets are Code128, GoOut and box-office tickets a QR code
const FORMATS = ['code_128', 'qr_code'];

// Decoding a frame takes a few tens of ms; don't run it more often than this
const FRAME_INTERVAL_MS = 66;

const VIDEO_CONSTRAINTS = { width: { ideal: 1920 }, height: { ideal: 1080 } };

// Zoom lets staff hold the phone further away, beyond the lens' minimum focus distance
const ZOOM = 2;

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path)
  }
});

// Wide scan area for 1D barcodes, still tall enough for a QR code (video pixels)
const scanRegion = (width, height) => {
  const w = Math.floor(width * 0.9);
  const h = Math.floor(Math.min(height * 0.8, w * 0.55));
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
};

const createDetector = async () => {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (FORMATS.every(f => supported.includes(f))) {
        return new window.BarcodeDetector({ formats: FORMATS });
      }
    } catch (err) {
      console.warn('Native BarcodeDetector unavailable:', err);
    }
  }
  return new ZXingBarcodeDetector({ formats: FORMATS });
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class CodeScanner {
  // onDecode(text) is called for every frame with a code while not paused
  constructor(container, onDecode) {
    this.container = container;
    this.onDecode = onDecode;
    this.stream = null;
    this.session = null;
    this.paused = false;
    this.detectorPromise = createDetector();

    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.video.style.cssText = 'display:block;width:100%;';
    this.video.addEventListener('resize', () => this.placeOverlay());

    // Box over the scan region, the rest of the picture shaded
    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:absolute;border:2px solid rgba(255,255,255,0.85);border-radius:4px;' +
      'box-shadow:0 0 0 9999px rgba(0,0,0,0.45);pointer-events:none;display:none;';

    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d', { willReadFrequently: true });

    container.style.position = 'relative';
    container.append(this.video, this.overlay);
  }

  // Back and front cameras with labels. Opening a camera first triggers the
  // permission prompt; browsers hide the labels until it's granted.
  static async getCameras() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    stream.getTracks().forEach(track => track.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'videoinput')
      .map(d => ({ id: d.deviceId, label: d.label }));
  }

  // deviceId null picks the browser's default back camera
  async start(deviceId) {
    await this.stop();
    const session = {};
    this.session = session;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
        ...VIDEO_CONSTRAINTS
      }
    });
    // Stopped while the camera was opening
    if (this.session !== session) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.placeOverlay();

    await this.tuneCamera();

    this.paused = false;
    this.scanLoop(session);
  }

  async stop() {
    this.session = null;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.overlay.style.display = 'none';
  }

  // The picture keeps running while paused, only decoding stops
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  // Continuous autofocus and zoom where the camera supports them
  async tuneCamera() {
    const track = this.stream?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.();
    if (!capabilities) return;

    if (capabilities.focusMode?.includes('continuous')) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (err) {
        console.warn('Could not enable continuous focus:', err);
      }
    }

    if (capabilities.zoom) {
      const zoom = Math.min(ZOOM, capabilities.zoom.max);
      if (zoom > capabilities.zoom.min) {
        try {
          await track.applyConstraints({ advanced: [{ zoom }] });
        } catch (err) {
          console.warn('Could not set zoom:', err);
        }
      }
    }
  }

  placeOverlay() {
    const { videoWidth, videoHeight } = this.video;
    if (!videoWidth || !videoHeight) return;
    const r = scanRegion(videoWidth, videoHeight);
    Object.assign(this.overlay.style, {
      display: 'block',
      left: `${(r.x / videoWidth) * 100}%`,
      top: `${(r.y / videoHeight) * 100}%`,
      width: `${(r.width / videoWidth) * 100}%`,
      height: `${(r.height / videoHeight) * 100}%`
    });
  }

  async scanLoop(session) {
    const detector = await this.detectorPromise;
    let reportedError = false;

    while (this.session === session) {
      const startedAt = performance.now();
      if (!this.paused && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const codes = await detector.detect(this.grabRegion());
          if (this.session === session && !this.paused && codes.length > 0) {
            this.onDecode(codes[0].rawValue);
          }
        } catch (err) {
          // e.g. the .wasm failed to load; keep trying, log once
          if (!reportedError) console.error('Barcode detection failed:', err);
          reportedError = true;
        }
      }
      await sleep(Math.max(0, FRAME_INTERVAL_MS - (performance.now() - startedAt)));
    }
  }

  // Scan region of the current frame, pixel for pixel
  grabRegion() {
    const r = scanRegion(this.video.videoWidth, this.video.videoHeight);
    if (this.canvas.width !== r.width || this.canvas.height !== r.height) {
      this.canvas.width = r.width;
      this.canvas.height = r.height;
    }
    this.context.drawImage(this.video, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    return this.context.getImageData(0, 0, r.width, r.height);
  }
}
