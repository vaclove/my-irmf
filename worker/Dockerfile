# Movie transcode worker image. Build from the REPO ROOT so the shared server
# modules can be copied in:
#   docker build -f worker/Dockerfile -t irmf-transcode-worker .
FROM node:20-slim

# ffmpeg + ffprobe for transcoding and audio extraction; pg_dump for DB
# backups. Debian bookworm's stock postgresql-client is 15, which cannot dump
# a newer Azure server, so install a pinned major from apt.postgresql.org
# (pg_dump 17 handles servers up to 17).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl gnupg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y curl gnupg \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# alass for subtitle timing alignment (static linux binary, pinned release).
ADD https://github.com/kaegi/alass/releases/download/v2.0.0/alass-linux64 /usr/local/bin/alass
RUN chmod 0755 /usr/local/bin/alass
# alass shells out to ffmpeg/ffprobe for audio decoding.
ENV ALASS_FFMPEG_PATH=/usr/bin/ffmpeg \
    ALASS_FFPROBE_PATH=/usr/bin/ffprobe

WORKDIR /app

RUN groupadd -r worker && useradd -r -g worker worker

# Install worker deps at the image root so /app/server/* modules resolve them
# (Node walks up from /app/server to /app/node_modules).
COPY worker/package.json ./package.json
RUN npm install --omit=dev

# Shared server modules the worker reuses (relative ../server requires).
COPY server/models/database.js ./server/models/database.js
COPY server/services/googleDrive.js ./server/services/googleDrive.js
COPY server/services/driveMediaProxy.js ./server/services/driveMediaProxy.js
COPY server/services/driveChunkedUpload.js ./server/services/driveChunkedUpload.js
COPY server/utils/movieFileNaming.js ./server/utils/movieFileNaming.js
COPY server/utils/subtitles.js ./server/utils/subtitles.js

# Worker code.
COPY worker/index.js ./worker/index.js

RUN chown -R worker:worker /app
USER worker

ENV NODE_ENV=production
CMD ["node", "worker/index.js"]
