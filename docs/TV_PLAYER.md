# TV player — the screen in the festival venue

`https://my.irmf.cz/tv/` is a looping showcase for a TV in the venue: the programme of the
day, photos and videos (partner videos, trailers). It is managed in **Programme → TV Screen**
and runs on a TV box in a kiosk browser. After the first load it keeps playing without an
internet connection.

## Managing it (Programme → TV Screen)

- **Slides** are played top to bottom, then again. Drag ⋮⋮ to reorder, **Shown/Hidden**
  skips a slide without deleting it (screens keep its file cached, so showing it again
  needs no download), 🗑️ deletes it.
- **Programme of the day** is one slide (it expands into the day's overview and a slide per
  screening). It can be moved and hidden, not deleted. Below the list choose whether it
  shows *today's programme only* or *today and the following days*.
- **Add photos** — several at once; they are scaled to fit 1920×1080 on upload. Photos
  close to 16:9 fill the screen, others (portraits) are shown whole on black. Each photo
  stays 8 s unless set otherwise.
- **Add video** — uploaded straight from the browser to Azure, then the worker converts it
  to what the TV box plays smoothly (1080p H.264, ≤ 30 fps, stereo AAC, loudness −16 LUFS
  so partner videos and trailers play at the same volume). "Preparing for the TV" shows
  the progress. Any common format works (MP4, MOV, MKV, 4K, HEVC…). HEIC photos from
  iPhones are not supported — export them as JPEG.
- **Trailer of** links a video to a film: the screen then shows the film's next screening
  over the trailer ("Na festivalu · Šílený Max · Zítra · 20:00 · Velký sál"). Once the film
  has been screened, the caption disappears.
- **Reload screens** makes every screen load the player again from scratch within a
  minute — use it after a change to the player's design. Cached photos and videos stay.

Changes reach the screens within a minute (after the slide that is playing). Every photo
and video — hidden ones too — is kept offline on each box: the page shows the total; the
Mi Box S has room for about 1.5 GB, so delete what is no longer needed.

## How it works

| Piece | Where |
|---|---|
| Player (plain JS, no build step) | `client/public/tv/` → served as `/tv/` |
| Service worker (offline) | `client/public/tv/sw.js`, scope `/tv/` |
| What to play + settings | `GET /api/public/tv/manifest` (no login) |
| Files | `GET /api/public/tv/media/:id?v=…` (Range support, cached for a year — `v` changes with the file) |
| Admin API | `/api/tv/*` (@irmf.cz login) — `server/routes/tv.js` |
| Data | `tv_settings`, `tv_slides` — `server/migrations/067_create_tv_screen.sql` |
| Storage | movie storage account (`MOVIE_STORAGE_CONTAINER`), `tv/<slide id>/…` |
| Video conversion | worker job `tv_video` (`worker/index.js`, `processTvVideoJob`) |

- The player reads the manifest every minute, the programme (public programme API of the
  running or next edition) every 5 minutes.
- `app.js` downloads every asset it needs into the Cache API (`irmf-tv-assets`) one at a
  time, smallest first, and drops what is no longer used; the service worker answers
  `<video>` range requests from those cached files. Programme images come from
  `s3.irmf.cz`, which sends no CORS headers — they are cached as opaque responses (fine for
  `<img>`); CSP `connect-src` allows `s3.irmf.cz` for that.
- A new deploy of the player is picked up automatically (the ETag of `app.js` changes; the
  page reloads at the end of the loop).
- When the service worker must be reinstalled everywhere (e.g. the CSP it was installed
  with changed), bump `SHELL_CACHE` in `sw.js` — browsers keep a worker's CSP until its
  script changes.

### Testing parameters

- `?debug=1` — status box: page load time, data, slides, cache size, what is showing, errors
- `?now=2026-10-23T19:10` — pretend it is this local time (to see a festival day)

## The TV box: Mi Box S + Fully Kiosk Browser

The Mi Box S (MDZ-22-AB, Android TV 9, WebView 138) runs the player in
[Fully Kiosk Browser](https://www.fully-kiosk.com). Its Play Store does not work, so the APK
is installed over the network with `adb`:

1. On the box: *Settings → Device Preferences → About → Build* 7× (developer mode), then
   *Developer options → USB debugging* on. Note the box's IP (*Settings → Network*).
2. On a Mac in the same network: `brew install --cask android-platform-tools`,
   `adb connect <ip>:5555`, confirm the prompt on the TV ("Always allow").
3. Download the APK from fully-kiosk.com (official site only) and `adb install -r Fully-Kiosk-Browser-*.apk`.
   Start it: `adb shell monkey -p de.ozerov.fully 1`.
4. In Fully Kiosk (hold Back for the menu): **Start URL** `https://my.irmf.cz/tv/`;
   *Web Content Settings → Autoplay Videos* on; *Device Management → Keep Screen On* on,
   *Launch on Boot* on; turn off the Android TV screensaver (*Settings → Device Preferences →
   Screen saver → Never*).

Useful `adb` commands: `adb shell dumpsys webviewupdate | grep -i version` (WebView version),
`adb shell df -h /data` (free space), `adb exec-out screencap -p > screen.png` (screenshot).

The box has ~2 GB free; the browser gives the player up to 60 % of the data partition but
never more than is free, and may evict the cache when space runs out (`persist()` is
refused in WebView) — the player then simply downloads the files again. Measured on the
box: the quota counts each opaque programme image as ~6 MB (≈ 160 MB for 30 images) while
the disk holds only its real size; with a 3.2 GB quota the free disk is the real limit.

### Troubleshooting

- **No photos in a desktop browser after a deploy that changed the CSP**: the old service
  worker is still installed — DevTools → Application → Service workers → Unregister, or
  bump `SHELL_CACHE` (see above).
- **Screen shows old design**: *Reload screens* in the admin.
- **A video stays "Preparing for the TV"**: the worker (Container Apps Job
  `movie-transcoder`) did not run — see `docs/TRANSCODER_SETUP.md`. *Retry* appears when it
  failed, or after 10 minutes without progress (e.g. the message reached a worker that was
  deployed before the `tv_video` job existed).
- A classic Chromecast cannot run this offline (no storage, no service worker); use a box
  with a browser (Android TV box with Fully Kiosk, Raspberry Pi / mini PC with Chromium in
  kiosk mode).
