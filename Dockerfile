# syntax=docker/dockerfile:1
# check=error=true
# Self-hosted Node.js Dockerfile for TCC Envisio
# Supports streaming MP4 uploads up to 2 GB and long-running sequential Gemini analysis batches

ARG NODE_VERSION=22-bookworm-slim
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS bun

FROM node:${NODE_VERSION} AS base
WORKDIR /app
ENV PORT=3000
EXPOSE 3000

FROM base AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS development
ENV NODE_ENV=development
COPY . .
RUN mkdir -p /app/.data/jobs
CMD ["./node_modules/.bin/tsx", "watch", "--clear-screen=false", "server.ts"]

FROM deps AS build
COPY . .
RUN bun run build

FROM base AS prod-deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

FROM base AS production
ENV NODE_ENV=production

COPY --from=prod-deps --link /app/node_modules ./node_modules
COPY --from=build --link /app/dist ./dist
COPY --link package.json server.ts ./
COPY --link public ./public
COPY --link src/types ./src/types
COPY --link src/utils ./src/utils
RUN mkdir -p /app/.data/jobs

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Run tsx directly (not through npx) so a stop signal reaches the server and it closes the database cleanly
CMD ["./node_modules/.bin/tsx", "server.ts"]
