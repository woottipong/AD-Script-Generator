# syntax=docker/dockerfile:1
# check=error=true
# Self-hosted Node.js Dockerfile for AD Script Generator MVP v1.1
# Supports streaming MP4 uploads up to 2 GB and long-running sequential Gemini analysis batches

FROM node:22-slim AS base
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Copy package manifests and install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source and static assets (including Silero VAD ONNX model & ORT WASM)
COPY . .

# Create persistent local directory for temporary jobs and batch state
RUN mkdir -p /app/.data/jobs

ENV PORT=3000

EXPOSE 3000

FROM base AS production
ENV NODE_ENV=production

# Build frontend production bundle
RUN npm run build

# Run full-stack Node.js server via tsx / node
CMD ["npx", "tsx", "server.ts"]
