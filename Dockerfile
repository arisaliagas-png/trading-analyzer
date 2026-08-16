# Fly.io Dockerfile — build context is the repo root.
# backend/ holds the server + the prebuilt frontend in backend/public/ (copied from frontend/dist).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY backend/public ./public

EXPOSE 5000
CMD ["node", "server.js"]
