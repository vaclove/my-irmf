# Movie Files — Google Shared Drive integration

## Context

The festival needs oversight of whether each movie has three assets stored in the Google Shared Drive: the **movie file**, **Czech subtitles**, and **English subtitles**. Today the Movies section only stores metadata; files live (or don't) in Drive with no link to the app. This feature adds per-movie Drive folder tracking, visual indicators in the movies table, manual upload (movie files can be ~100GB), a server-side downloader (public Google Drive link, FTP), and a background sync so files added/removed directly in Drive are reflected.

**User decisions:**
- Folder auto-creation: `IRMF Shared Drive → {edition_year} → Filmy → {movie name}`; folder id stored on the movie
- New dedicated detail page `/movies/:id` with stacked sections (future: preview player, subtitle translator)
- Strict naming convention on upload through the app; files dropped into Drive manually are importable via UI (classify + optional rename to convention)
- Periodic node-cron scan (~45 min) + manual "Rescan" button

**Hard constraints (verified):**
- Azure App Service: ~230s request timeout, 50MB `express.json` limit, ephemeral disk → **100GB uploads cannot pass through the backend**. Browser uploads go directly to Google via a resumable upload session created server-side. The downloader streams source→Drive chunk-by-chunk with bounded memory, never touching disk.
- Azure PostgreSQL: use `gen_random_uuid()`, never `uuid-ossp`.
- Drive auth: **service account** (new GCP project, Drive API enabled), its email added as Content manager member of the IRMF Shared Drive. Every Drive call needs `supportsAllDrives: true`; every `files.list` also `includeItemsFromAllDrives: true, corpora: 'drive', driveId`.

## Architecture

- **Drive holds the bytes; PostgreSQL holds classified pointers** (`movie_files` table) so the movies list renders 3-asset status without Drive calls. Unclassified files in a folder are fetched live on detail-page load (not persisted) for the import UI.
- **Big uploads:** backend creates a Drive resumable session (POST `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true` with `Origin` header = app origin — this is what makes Google echo CORS headers on the browser's chunk PUTs), returns session URI; browser PUTs 32 MiB chunks (multiples of 256 KiB mandatory) directly to googleusercontent. Subtitles (tiny) go through the backend as base64, like images do today.
- **Downloader:** `movie_download_jobs` table + in-process runner (max 2 concurrent). Streams source into 32 MiB buffers, PUTs sequentially into a server-created resumable session, updates `bytes_transferred` per chunk, cancel flag checked between chunks. On boot, stale `pending/running` jobs → `interrupted` (retryable).
- **Scan:** per-movie `files.list`, keyed on stored `drive_file_id` (stable against renames). Auto-classifies only convention-named new files. Cron every 45 min + manual rescan.

## Naming convention

- Slug from `name_en || name_cs`: strip diacritics (NFD), lowercase, non-alphanumeric runs → `-`, cap ~80 chars.
- Movie: `{slug}.{ext}` (mp4/mkv/mov/avi/m4v/ts); CZ subs: `{slug}.cs.{srt|vtt}`; EN subs: `{slug}.en.{srt|vtt}`.
- Folder name: raw `name_cs` with `/ \ : * ? " < > |` → `-`, whitespace collapsed, cap ~100 chars.
- Scan auto-classification (conservative): `*.cs.(srt|vtt)` → subtitles_cs; `*.en.(srt|vtt)` → subtitles_en; movie only when the folder has exactly one video file. Everything else → unclassified (importable).

## Implementation steps

### 1. Migration `server/migrations/047_add_movie_files.sql` (next free number after 046)
- `ALTER TABLE movies ADD COLUMN drive_folder_id TEXT;`
- `movie_files`: id UUID PK `gen_random_uuid()`, movie_id FK→movies ON DELETE CASCADE, `file_kind TEXT CHECK IN ('movie','subtitles_cs','subtitles_en')`, drive_file_id TEXT NOT NULL, file_name, file_size BIGINT, mime_type, md5_checksum, drive_modified_at, last_synced_at, created_at/updated_at, **UNIQUE (movie_id, file_kind)**, index on movie_id. TEXT+CHECK, not PG enum.
- `movie_download_jobs`: id, movie_id FK CASCADE, file_kind, `source_type CHECK IN ('gdrive','ftp')`, source_url, `status CHECK IN ('pending','running','completed','failed','cancelled','interrupted')` default 'pending', bytes_total, bytes_transferred BIGINT default 0, target_file_name, drive_file_id, error_message, created_by, started_at/finished_at, created_at/updated_at, indexes on movie_id and status.
- `updated_at` triggers per the pattern in `013_create_movies_table.sql`.
- **Modify `server/routes/movies.js`** GET queries (`/`, `/edition/:editionId`, `/:id`, `/section/:section`): add `LEFT JOIN (SELECT movie_id, BOOL_OR(file_kind='movie') AS has_movie_file, BOOL_OR(file_kind='subtitles_cs') AS has_subtitles_cs, BOOL_OR(file_kind='subtitles_en') AS has_subtitles_en FROM movie_files GROUP BY movie_id) mf ON mf.movie_id = m.id` and select the three booleans with `COALESCE(..., false)`. One query, no N+1.

### 2. Google Drive service + config + docs
- Install `googleapis` (root package.json).
- **New `server/services/googleDrive.js`**: `GoogleAuth` from `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 JSON) or `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, scope `https://www.googleapis.com/auth/drive`. Export `isConfigured()`; Drive endpoints return 503 `{error: 'Google Drive is not configured'}` when false. Functions: `findOrCreateChildFolder(parentId, name)` (**escape `'` in query names** — `L'amour` breaks queries otherwise), `ensureMovieFolder(movie)` (root → year → Filmy → name; in-memory cache for year/Filmy levels; persists `movies.drive_folder_id`; if stored id 404s, null + recreate), `listFolderChildren(folderId)` (fields id,name,mimeType,size,md5Checksum,modifiedTime; paginate), `getFileMetadata`, `renameFile`, `trashFile` (trash, never hard-delete — safety for 100GB assets), `downloadFileStream(fileId)` (`alt=media`, stream), `uploadSmallFile`, `createResumableSession({folderId, name, mimeType, size, origin})` (raw POST with Bearer token, `Origin`, `X-Upload-Content-Type/Length`, body `{name, parents:[folderId]}`; return `Location` header).
- **New `server/utils/movieFileNaming.js`**: `slugifyMovieName`, `sanitizeFolderName`, `conventionFileName(movie, fileKind, ext)`, `classifyByName(name, mimeType)` — pure, unit-testable.
- **New `docs/GOOGLE_DRIVE_SETUP.md`**: GCP project → enable Drive API → service account (no domain-wide delegation) → JSON key → base64 → add SA email as Content manager to IRMF Shared Drive → drive id from URL. Note the **750 GB/day upload quota** per service account (~7 large movies/day).
- Append to `.env.example` + `.env.production`: `GOOGLE_SERVICE_ACCOUNT_KEY=`, `GOOGLE_SHARED_DRIVE_ID=`, `MOVIE_SCAN_CRON=*/45 * * * *`, `MOVIE_SCAN_ENABLED=true`.

### 3. Scanner service + files routes
- **New `server/services/movieFileScanner.js`**: `scanMovie(movieId)` — skip if no folder; list children; existing `movie_files` rows: update metadata if drive_file_id still present, DELETE row if gone; auto-classify unoccupied kinds per convention (`ON CONFLICT (movie_id, file_kind) DO UPDATE`); return `{files, unclassified}`. `scanAll()` — sequential loop over movies with `drive_folder_id`, ~150ms delay, backoff on 403/429, winston summary.
- **New `server/routes/movieFiles.js`** (`express.Router({mergeParams: true})`), mounted in `server/index.js` (~line 146) as `app.use('/api/movies/:movieId/files', requireIrmfDomain, movieFilesRoutes)`:
  - `GET /` → `{files, folder, unclassified, drive_configured}`; on Drive error still return DB rows + `drive_error` flag
  - `POST /folder` → ensureMovieFolder
  - `POST /rescan` → scanMovie
  - `POST /upload-session` `{file_kind, file_name, file_size, mime_type}` → ensure folder, convention name computed server-side, `createResumableSession` with `origin: req.get('origin') || process.env.APP_URL` → `{upload_url, target_name}`
  - `POST /upload-complete` `{file_kind, drive_file_id}` → verify metadata in Drive, upsert row
  - `POST /subtitles` `{file_kind, file_name, content_base64}` → validate kind ∈ subtitles, ext ∈ srt/vtt; uploadSmallFile under convention name; upsert
  - `POST /import` `{drive_file_id, file_kind, rename, replace}` → verify parent is the movie folder; optional rename to convention; 409 if kind occupied unless replace (re-point row; old file becomes unclassified)
  - `DELETE /:fileKind?remove_from_drive=` → delete row; optionally trashFile
  - Audit: `auditMiddleware('movie_files')` — note `captureOriginalData` resolves `req.params.id`, not `movieId`; verify its fallback chain during implementation or skip audit for reads.

### 4. Frontend: detail page skeleton, route, table column
- **Extract edit modal** from `client/src/pages/Movies.jsx` (Modal JSX at line ~446–707 + `formData` state at line 39 + `handleImageUpload` at 203) into **new `client/src/components/MovieFormModal.jsx`** with props `{isOpen, movie, editions, sections, onClose, onSaved, onDelete}`. Pure relocation — isolate as its own commit, click-test create/edit/delete.
- **New `client/src/pages/MovieDetail.jsx`**: `useParams` + `movieApi.getById`; header (poster `image_urls.medium`, names, director/year/section badge, Back link, Edit button → MovieFormModal); sections from a local registry array `[{id:'files', title:'Files', Component: MovieFilesSection}]` stacked in `bg-white shadow rounded-lg` cards — future Preview/Translator sections are new entries.
- **`client/src/App.jsx`**: add `<Route path="/movies/:id" element={<MovieDetail />} />`.
- **`client/src/utils/api.js`** (movieApi at line 129): add `movieFileApi` (getFiles, ensureFolder, rescan, createUploadSession, completeUpload, uploadSubtitles, importFile, deleteFile) and `movieDownloadApi` (create, getForMovie, getById, cancel, retry).
- **`client/src/pages/Movies.jsx`**: add `files` to `visibleColumns` (line 26) + column-settings list; cell renders three compact badges (film icon, "CS", "EN") — `bg-green-100 text-green-800` present / `bg-gray-100 text-gray-400` missing (existing badge pattern); cell click → `navigate('/movies/'+id)`; add "Detail" link in Actions. Keep name-click → edit modal unchanged.

### 5. Files section UI
- **New `client/src/components/movie-files/MovieFilesSection.jsx`**: loads `movieFileApi.getFiles`; `drive_configured===false` → info banner. Three asset rows (status badge, file name, human size via new `formatBytes` helper, last_synced_at; actions: Upload, Download from link, Remove with confirm + "also move to Drive trash" checkbox). Unclassified list with "Import as…" (kind select + rename-to-convention checkbox). Rescan button; "Create Drive folder" button when folder is null. Subtitle upload via FileReader base64 (same pattern as `handleImageUpload`). All feedback via `useToast`.

### 6. Browser resumable upload (movie file)
- **New `client/src/utils/driveUpload.js`**: `uploadToDriveSession(file, sessionUrl, {onProgress, shouldCancel})` — loop `file.slice()` 32 MiB chunks, PUT via **bare `axios.create()`** (no cookies, no JSON content-type — target is googleusercontent), `Content-Range: bytes {start}-{end-1}/{size}`; **HTTP 308 = chunk OK** (`validateStatus` must allow 308; parse `Range` header for next offset); 200/201 = done → return file id. On network error: probe committed offset with empty `PUT Content-Range: bytes */{size}`, resume, retry with backoff. Cancel checked between chunks.
- **New `client/src/components/movie-files/FileUploadModal.jsx`** (existing Modal): pick file → createUploadSession → upload with progress bar → completeUpload → toast + refresh. `beforeunload` warning while uploading ("keep tab open").
- Pitfall: CORS failure on first chunk = `Origin` at session creation didn't exactly match page origin (scheme+host+port).

### 7. Download jobs
- Install `basic-ftp`.
- **New `server/services/movieDownloader.js`**: singleton, queue max 2 concurrent, in-memory cancel flags. `runJob`: gdrive — extract fileId (`/file/d/{id}`, `?id={id}`), metadata via SA (works for anyone-with-link), `alt=media` stream; ftp — parse `ftp://[user:pass@]host[:port]/path`, `client.size()`, stream `downloadTo(Writable)`. Sink: resumable session, accumulate 32 MiB buffers, sequential PUTs (`bytes X-Y/*` when total unknown), pause source while PUTting (backpressure), update `bytes_transferred` per chunk. Success → upsert `movie_files`, status completed; error → failed + message. `markInterruptedJobs()` on boot.
- **New `server/routes/movieDownloads.js`** mounted `app.use('/api/movie-downloads', requireIrmfDomain, ...)`: `POST /` (validate URL, ensureMovieFolder, insert job with `created_by=req.user.email`, enqueue), `GET /movie/:movieId`, `GET /:id` (poll), `POST /:id/cancel`, `POST /:id/retry` (clone as new pending job).
- **New `client/src/components/movie-files/DownloadFromLinkModal.jsx`**: URL input (auto-detect drive.google.com vs ftp://), creates job. MovieFilesSection polls active jobs every 3–5s (only while non-terminal job exists; clear on unmount), progress bar, Cancel/Retry, refresh files on completion.

### 8. Cron scheduler + wiring + versions
- **New `server/services/movie-file-scan-scheduler.js`** modeled on `server/services/goout-token-scheduler.js`: `cron.schedule(process.env.MOVIE_SCAN_CRON || '*/45 * * * *')` → `scanAll()`; guard `MOVIE_SCAN_ENABLED !== 'false'` && `isConfigured()`; no immediate scan on boot. Wire `.start()` + `movieDownloader.markInterruptedJobs()` into `startServer()` in `server/index.js` (next to `gooutTokenScheduler.start()`, line ~223).
- Movie deletion: FK cascades DB rows; **Drive folder intentionally untouched** (data safety). Folder not auto-renamed on movie rename (lookups are by stored id) — document both.
- Version bumps: root `package.json` 1.8.10 → **1.9.0** (BE minor), `client/package.json` 0.5.10 → **0.6.0** (FE minor). Include both package-lock.json files.

## Files summary

**New backend:** `server/migrations/047_add_movie_files.sql`, `server/services/googleDrive.js`, `server/services/movieFileScanner.js`, `server/services/movieDownloader.js`, `server/services/movie-file-scan-scheduler.js`, `server/utils/movieFileNaming.js`, `server/routes/movieFiles.js`, `server/routes/movieDownloads.js`, `docs/GOOGLE_DRIVE_SETUP.md`
**Modified backend:** `server/routes/movies.js` (status JOIN), `server/index.js` (mounts + startup wiring), `package.json` (+googleapis, +basic-ftp, version), `.env.example`, `.env.production`
**New frontend:** `client/src/pages/MovieDetail.jsx`, `client/src/components/MovieFormModal.jsx` (extracted), `client/src/components/movie-files/{MovieFilesSection,FileUploadModal,DownloadFromLinkModal}.jsx`, `client/src/utils/driveUpload.js`
**Modified frontend:** `client/src/pages/Movies.jsx` (Files column, navigation, modal extraction), `client/src/App.jsx` (route), `client/src/utils/api.js` (two new API wrappers), `client/package.json` (version)

**Reuse:** `requireIrmfDomain`, `auditMiddleware`, pg pool from `server/models/database.js`, winston logger, node-cron scheduler pattern (`goout-token-scheduler.js`), `Modal`, `useToast`, badge pattern, FileReader base64 pattern.

## Verification

**With a real service account** (follow docs, ideally against a test Shared Drive first), `npm run dev`:
1. Create movie → detail page → Create Drive folder → verify `IRMF/{year}/Filmy/{name}` in Drive UI
2. Upload ~100MB video via chunked upload (temporarily set 8 MiB chunks to exercise multi-chunk 308 handling)
3. Upload .srt for both subtitle kinds → names follow convention in Drive
4. Drop a random file into the folder in Drive UI → Rescan → appears unclassified → Import as movie with rename
5. Delete a file in Drive UI → Rescan → indicator goes gray
6. Download job from a public Drive link and a public FTP file → progress advances → kill server mid-job → restart → job `interrupted` → Retry works
7. Cancel a running job
8. Table indicators render, column toggle + condensed view still work
9. Regression: edit modal works from both list and detail page after extraction

**Without credentials:** `isConfigured()` false → Drive endpoints 503, UI shows "not configured" banner; migration/routes/page/table still testable. Unit-test `movieFileNaming.js` pure functions.

## Risks

- **750 GB/day Drive upload quota** on the service account (covers both browser sessions and downloader) — documented; jobs fail with quota error, retry next day.
- **App Service restarts** kill in-flight download jobs → `interrupted` + retry-from-zero (offset resume is a future enhancement).
- **Browser upload needs the tab open** for the duration (session valid ~1 week; cross-reload resume out of scope).
- **CORS on resumable session** — exact-match Origin + treating 308 as success are the classic failure points.
- Edit-modal extraction is pure-refactor risk — isolated commit + click-test.
