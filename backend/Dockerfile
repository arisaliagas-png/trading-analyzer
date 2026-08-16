# Fly.io Dockerfile — build context is the backend/ directory.
# frontend/dist is copied into backend/public/ before deploy (see deploy step).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install

COPY ./ ./
# Frontend (pre-built dist copied into backend/public/ before docker build)
COPY public/ ./public/

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "server.js"]
