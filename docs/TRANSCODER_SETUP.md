# Movie preview transcoder — Azure Container Apps Job

The in-browser preview player streams a web-playable **720p H.264/AAC MP4 proxy**
generated from each master. Masters are often ProRes/x265/high-bitrate and won't
play in a browser, so a background worker transcodes them once and stores the
proxy back in the movie's Drive folder.

Transcoding runs **outside the web app** in an Azure Container Apps (ACA) Job,
triggered by a message on an Azure Storage Queue. The app only inserts a job row
and enqueues `{job_id}`; the worker does the ffmpeg work, updates progress in
PostgreSQL, and scales to zero when the queue is empty.

```
App Service ──insert row──> PostgreSQL <──progress── ACA Job (worker)
   └─enqueue {job_id}──> Storage Queue ──KEDA──> spawn ffmpeg, upload proxy → Drive
```

The same worker and queue also handle **subtitle sync jobs** (message
`{job_id, type: 'subtitle_sync'}`): the worker extracts mono audio from the
proxy (or master), re-times a subtitle track to it with
[alass](https://github.com/kaegi/alass), and uploads the synced SRT as a new
`{slug}.{lang}.synced.srt` file next to the untouched original. No extra Azure
resources are needed — the image bundles the alass binary, and messages without
a `type` field remain transcodes.

For **local development** of subtitle sync, install alass (`cargo install
alass-cli` on macOS — there is no prebuilt mac binary) or point `ALASS_PATH` at
a binary; a missing binary fails the job with a clear error message. Optional
worker knobs: `ALASS_NO_SPLIT=true` disables alass's cut detection,
`ALASS_SPLIT_PENALTY` tunes it, and `SUBTITLE_SYNC_ENABLED=false` disables
enqueueing app-side.

The queue's third message type is **database backups** (message
`{type: 'db_backup', retain}`): the app's nightly scheduler (production only,
`DB_BACKUP_CRON`, default 3 AM Europe/Prague) enqueues it, and the worker runs
`pg_dump --format=custom` against `DATABASE_URL`, uploads the dump to the
shared drive's top-level `Backups` folder, and permanently deletes all but the
newest `retain` (default 7) `festival_db_*.dump` files. The image bundles
`postgresql-client-17` from the PGDG apt repo (pg_dump must be ≥ the server
major — bump the pin in `worker/Dockerfile` if the Azure server is upgraded
past 17). A backup can be triggered manually with `POST /api/db-backup`;
`DB_BACKUP_ENABLED=false` disables the feature app-side.

## Prerequisites

- Google Drive service account already set up (see `GOOGLE_DRIVE_SETUP.md`).
- Azure CLI logged in (`az login`), `containerapp` extension
  (`az extension add --name containerapp`).
- A resource group and (ideally) a **test** Shared Drive to validate against first.

## 1. Storage account + queue

```bash
RG=irmf-cz
LOC=polandcentral
STORAGE=irmftranscode           # globally unique, lowercase

az storage account create -g $RG -n $STORAGE -l $LOC --sku Standard_LRS
CONN=$(az storage account show-connection-string -g $RG -n $STORAGE -o tsv)
az storage queue create --name movie-transcodes --connection-string "$CONN"
```

Set `AZURE_STORAGE_CONNECTION_STRING` (= `$CONN`) and
`TRANSCODE_QUEUE_NAME=movie-transcodes` in the **App Service** configuration.

## 2. Container registry + worker image

```bash
ACR=irmftranscodeacr            # globally unique, lowercase
az acr create -g $RG -n $ACR --sku Basic --admin-enabled true

# Build from the REPO ROOT (the Dockerfile copies shared server modules):
az acr build -r $ACR -t transcode-worker:latest -f worker/Dockerfile .
```

## 3. Container Apps environment + job

```bash
ENV=irmf-transcode-env
az containerapp env create -g $RG -n $ENV -l $LOC

ACR_SERVER=$(az acr show -n $ACR --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n $ACR --query username -o tsv)
ACR_PASS=$(az acr credential show -n $ACR --query 'passwords[0].value' -o tsv)

az containerapp job create \
  -g $RG -n movie-transcoder --environment $ENV \
  --trigger-type Event \
  --replica-timeout 28800 \
  --replica-retry-limit 0 \
  --parallelism 1 \
  --replica-completion-count 1 \
  --polling-interval 30 \
  --min-executions 0 --max-executions 1 \
  --cpu 4 --memory 8Gi \
  --image $ACR_SERVER/transcode-worker:latest \
  --registry-server $ACR_SERVER --registry-username $ACR_USER --registry-password $ACR_PASS \
  --secrets "storage-conn=$CONN" "db-url=<DATABASE_URL>" "drive-key=<GOOGLE_SERVICE_ACCOUNT_KEY>" \
  --scale-rule-name queue \
  --scale-rule-type azure-queue \
  --scale-rule-metadata "queueName=movie-transcodes" "queueLength=1" \
  --scale-rule-auth "connection=storage-conn" \
  --env-vars \
    "AZURE_STORAGE_CONNECTION_STRING=secretref:storage-conn" \
    "TRANSCODE_QUEUE_NAME=movie-transcodes" \
    "DATABASE_URL=secretref:db-url" \
    "GOOGLE_SERVICE_ACCOUNT_KEY=secretref:drive-key" \
    "GOOGLE_SHARED_DRIVE_ID=<drive id>" \
    "MOVIE_TRANSCODE_HEIGHT=720" "MOVIE_TRANSCODE_CRF=23" "MOVIE_TRANSCODE_PRESET=veryfast"
```

Notes:
- **`--parallelism 1` + `--max-executions 1`** ⇒ one film transcoded at a time.
  Raise both to transcode N films concurrently later.
- **`--replica-timeout 28800`** (8h) matches the worker's queue visibility
  timeout; a hung ffmpeg is killed and the message redelivers (poison guard caps
  retries at 3).
- The worker connects **directly to PostgreSQL** — enable *"Allow Azure services
  and resources to access this server"* on the Azure PostgreSQL firewall (or use
  a VNet).
- 480p is faster/smaller: set `MOVIE_TRANSCODE_HEIGHT=480`. Subtitle readability
  is unaffected (rendered by the browser, not burned in).

### Movie storage (Azure Blob)

Since BE v1.22 the worker reads masters from and writes previews/subtitles to
the `irmfmovies` storage account (container `movies`; masters Cold, previews
and subtitles Hot, blob soft delete 14 days). It also runs the Drive <-> Azure
copy jobs (`file_transfer` messages: imports of Drive files, Drive backups of
masters). Give the job the account's connection string:

```bash
MOVIES_CONN=$(az storage account show-connection-string -n irmfmovies -g $RG --query connectionString -o tsv)
az containerapp job secret set -g $RG -n movie-transcoder --secrets "movies-conn=$MOVIES_CONN"
az containerapp job update -g $RG -n movie-transcoder \
  --set-env-vars "MOVIE_STORAGE_CONNECTION_STRING=secretref:movies-conn" "MOVIE_STORAGE_CONTAINER=movies"
```

The app needs the same `MOVIE_STORAGE_CONNECTION_STRING` (App Service setting).
The account's blob CORS rules must allow `PUT` from the app origins — browsers
upload masters straight to Blob Storage through short-lived SAS URLs.

### Screening exports (burned-in subtitles)

`subtitle_burn` messages render the master with CS/EN subtitles burned into
the picture (Files tab → *Screening export*): a ~60 s preview clip or the full
movie, 1920x1080 (3840x2160 for 4K masters), H.264 CRF 18 with the original
audio (AAC/AC-3/E-AC-3/MP3 copied, anything else re-encoded to AAC). The
worker crops a letterbox baked into the master, pushes a wider-than-16:9
picture up so the subtitles sit in the black band below it. The output is a
regular MP4 (VLC seeks fragmented MP4 badly: seconds of grey smear after a
jump), rendered onto an Azure Files scratch volume — a feature film does not
fit the replica's ~8 GB ephemeral disk — and then uploaded to Blob Storage.
Rough render times on 4 vCPU: 1–2 h for an HD feature,
several hours in 4K (`SUBTITLE_BURN_UHD_PRESET` defaults to `faster` to stay
inside the 8 h replica timeout). Knobs: `SUBTITLE_BURN_PRESET`/`_CRF`,
`SUBTITLE_BURN_UHD_PRESET`/`_CRF`; `SUBTITLE_BURN_ENABLED=false` disables it
app-side.

The scratch volume is a 300 GB share in its own storage account in the job's
region, mounted at `/mnt/burn` (`SUBTITLE_BURN_TMPDIR`); the worker deletes
each render after the upload and sweeps leftovers older than 12 h:

```bash
az storage account create -g $RG -n irmfburnscratch -l $LOC --sku Standard_LRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false
az storage share-rm create -g $RG --storage-account irmfburnscratch --name burn-scratch --quota 300
KEY=$(az storage account keys list -g $RG -n irmfburnscratch --query "[0].value" -o tsv)
az containerapp env storage set -g $RG -n $ENV --storage-name burnscratch \
  --azure-file-account-name irmfburnscratch --azure-file-account-key "$KEY" \
  --azure-file-share-name burn-scratch --access-mode ReadWrite
```

Then add to the job template (e.g. `az rest --method patch` on the job with
the full `properties.template`; the CLI has no volume flags for jobs) a volume
`{name: burn-scratch, storageType: AzureFile, storageName: burnscratch,
mountOptions: "dir_mode=0777,file_mode=0777"}` (the worker runs as a non-root
user), a `volumeMounts` entry `{volumeName: burn-scratch, mountPath: /mnt/burn}`
on the container, and the env var `SUBTITLE_BURN_TMPDIR=/mnt/burn`.

Exports are temporary downloads in the private `exports` container of the
`irmfmovies` account (created on first use; override with
`MOVIE_EXPORT_CONTAINER`). A lifecycle rule deletes them — full exports after
20 days, previews after 3 (`RETENTION_DAYS` in
`server/services/exportStorage.js` must match):

```bash
cat > /tmp/exports-policy.json <<'JSON'
{
  "rules": [
    {
      "enabled": true, "name": "exports-full-20d", "type": "Lifecycle",
      "definition": {
        "actions": { "baseBlob": { "delete": { "daysAfterCreationGreaterThan": 20 } } },
        "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["exports/full/"] }
      }
    },
    {
      "enabled": true, "name": "exports-preview-3d", "type": "Lifecycle",
      "definition": {
        "actions": { "baseBlob": { "delete": { "daysAfterCreationGreaterThan": 3 } } },
        "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["exports/preview/"] }
      }
    }
  ]
}
JSON
# Replaces the account's whole policy — merge with any existing rules first
# (az storage account management-policy show ...).
az storage account management-policy create -g $RG --account-name irmfmovies --policy @/tmp/exports-policy.json
```

The rule runs about once a day, so blobs may linger a day past their expiry;
the app stops offering a download at `expires_at`. Blob soft delete keeps
deleted exports recoverable (and billed) for another 14 days.

## 4. CI (optional)

`.github/workflows/transcoder.yml` rebuilds and updates the job image on pushes
touching `worker/` or the shared server modules. It reuses the repo's existing
Azure auth; set the `ACR_NAME` / job name to match the resources above.

## Cost & quotas

- ACA consumption billing is per-second at 4 vCPU / 8 GiB; a film costs roughly
  **$0.15–0.30** to transcode. Egress of the ~2–3 GB proxy to Drive is within
  the monthly free tier.
- The proxy counts against the service account's **750 GB/day** Drive upload
  quota — negligible at a few GB per film.

## Troubleshooting

- **Job never starts:** confirm a message landed on the queue (Storage Explorer)
  and the scale rule's `connection` secret is correct.
- **Job fails immediately:** check execution logs
  (`az containerapp job execution list -g $RG -n movie-transcoder`); usual causes
  are DB firewall (worker can't reach PostgreSQL) or a bad service-account key.
- **CORS/credentials on playback** are unrelated to the worker — the app streams
  the proxy itself.
