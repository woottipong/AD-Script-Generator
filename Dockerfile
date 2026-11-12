# Self-hosted Node.js Dockerfile for AD Script Generator MVP v1.1
# Supports streaming MP4 uploads up to 2 GB and long-running sequential Gemini analysis batches

FROM node:22-slim AS base
WORKDIR /app

# Copy package manifests and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy application source and static assets (including Silero VAD ONNX model & ORT WASM)
COPY . .

# Build frontend production bundle
RUN npm run build

# Create persistent local directory for temporary jobs and batch state
RUN mkdir -p /app/.data/jobs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Run full-stack Node.js server via tsx / node
CMD ["npx", "tsx", "server.ts"]
