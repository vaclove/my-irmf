# Movie transcode worker image. Build from the REPO ROOT so the shared server
# modules can be copied in:
#   docker build -f worker/Dockerfile -t irmf-transcode-worker .
FROM node:20-slim

# ffmpeg + ffprobe for transcoding.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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

# Worker code.
COPY worker/index.js ./worker/index.js

RUN chown -R worker:worker /app
USER worker

ENV NODE_ENV=production
CMD ["node", "worker/index.js"]
