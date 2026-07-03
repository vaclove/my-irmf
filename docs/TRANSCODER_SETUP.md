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

## Prerequisites

- Google Drive service account already set up (see `GOOGLE_DRIVE_SETUP.md`).
- Azure CLI logged in (`az login`), `containerapp` extension
  (`az extension add --name containerapp`).
- A resource group and (ideally) a **test** Shared Drive to validate against first.

## 1. Storage account + queue

```bash
RG=my-irmf-rg
LOC=westeurope
STORAGE=myirmftranscode         # globally unique, lowercase

az storage account create -g $RG -n $STORAGE -l $LOC --sku Standard_LRS
CONN=$(az storage account show-connection-string -g $RG -n $STORAGE -o tsv)
az storage queue create --name movie-transcodes --connection-string "$CONN"
```

Set `AZURE_STORAGE_CONNECTION_STRING` (= `$CONN`) and
`TRANSCODE_QUEUE_NAME=movie-transcodes` in the **App Service** configuration.

## 2. Container registry + worker image

```bash
ACR=myirmfacr                   # globally unique, lowercase
az acr create -g $RG -n $ACR --sku Basic --admin-enabled true

# Build from the REPO ROOT (the Dockerfile copies shared server modules):
az acr build -r $ACR -t transcode-worker:latest -f worker/Dockerfile .
```

## 3. Container Apps environment + job

```bash
ENV=myirmf-aca-env
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
