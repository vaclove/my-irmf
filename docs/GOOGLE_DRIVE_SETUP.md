# Google Shared Drive setup (movie files)

The movie-files feature stores movie files and subtitles in a Google **Shared
Drive** and keeps classified pointers in PostgreSQL. Authentication uses a
**service account** (no user OAuth, no domain-wide delegation). This document
walks through provisioning that service account and wiring it to the app.

When these steps are not completed, the app still runs: all Drive endpoints
return HTTP `503 {error: 'Google Drive is not configured'}` and the UI shows a
"not configured" banner. Everything else (movie CRUD, the detail page, the
table indicators) works.

## 1. Create a GCP project

1. Go to <https://console.cloud.google.com/> and create a new project
   (e.g. `irmf-drive`).
2. Enable the **Google Drive API** for the project:
   APIs & Services → Library → search "Google Drive API" → Enable.

## 2. Create a service account + JSON key

1. APIs & Services → Credentials → **Create credentials → Service account**.
2. Give it a name (e.g. `irmf-drive-sa`). No project roles are required —
   access is granted at the Shared Drive level, not via IAM.
3. **Do not** enable domain-wide delegation.
4. Open the created service account → **Keys → Add key → Create new key →
   JSON**. A JSON file downloads. Keep it secret.

## 3. Encode the key for the app

The app reads the key as base64 (single-line, easy to store in an env var):

```bash
base64 -i path/to/drive-service-account.json | tr -d '\n'
```

Set the output as `GOOGLE_SERVICE_ACCOUNT_KEY`. (Alternatively, point
`GOOGLE_SERVICE_ACCOUNT_KEY_PATH` at the JSON file on disk.)

## 4. Grant the service account access to the Shared Drive

1. In the JSON key, copy the `client_email` value
   (e.g. `irmf-drive-sa@irmf-drive.iam.gserviceaccount.com`).
2. Open the **IRMF Shared Drive** in Google Drive.
3. Manage members → add the service-account email as **Content manager**
   (needs create/rename/trash rights).

> A service account has **no storage quota of its own** — files it creates live
> in the Shared Drive's storage, which is why Content-manager membership on the
> Shared Drive (not "My Drive") is required.

## 5. Find the Shared Drive id

Open the Shared Drive in the browser. The URL looks like:

```
https://drive.google.com/drive/folders/0AAbbccDDeeFFGGhhIIjj
                                        ^^^^^^^^^^^^^^^^^^^^^^ this is the drive id
```

Set it as `GOOGLE_SHARED_DRIVE_ID`.

## 6. Configure the app

Add to your environment (`.env` locally, App Service settings in Azure):

```
GOOGLE_SERVICE_ACCOUNT_KEY=<base64 from step 3>
GOOGLE_SHARED_DRIVE_ID=<id from step 5>
MOVIE_SCAN_CRON=*/45 * * * *
MOVIE_SCAN_ENABLED=true
```

Restart the server. The migration runs automatically; Drive endpoints now
respond instead of returning 503.

## Folder layout

The app auto-creates, per movie:

```
IRMF Shared Drive
└── {edition_year}
    └── Filmy
        └── {movie name}
            ├── {slug}.mkv          movie file
            ├── {slug}.cs.srt       Czech subtitles
            └── {slug}.en.srt       English subtitles
```

The movie folder id is stored on `movies.drive_folder_id`; lookups are by id,
so renaming a movie or a folder does not break the link.

## Quotas & limits

- **Upload quota: ~750 GB/day per service account.** This covers both browser
  resumable uploads and server-side download jobs. Roughly ~7 large (100 GB)
  movies per day. When exceeded, uploads/jobs fail with a quota error and can be
  retried the next day.
- Browser uploads use a **resumable session** and require the tab to stay open
  for the duration (sessions are valid ~1 week; cross-reload resume is out of
  scope).

## Safety notes

- Deleting a movie in the app cascades the DB pointer rows but **does not touch
  the Drive folder or its files** — large assets are never auto-deleted.
- Removing a file through the app **trashes** it in Drive (recoverable), never
  hard-deletes.
