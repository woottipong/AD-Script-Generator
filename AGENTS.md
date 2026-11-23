# Agent guide

Guidance for automated agents working on the TCC Envisio repository.

## Project overview

TCC Envisio is a Keycloak-authenticated workspace for authoring Thai Audio Description (AD) scripts in two modes. Both decode audio with WebCodecs and detect Speech Segments using Silero VAD in a Web Worker. In Generate Mode (480p MP4), the Express server persists the Job, uploads the video to the Gemini Files API, and analyses Analysis Batches sequentially. In Review Mode, an existing SRT opens against a local or linked MP4 with no video upload and no Gemini. Authors edit and retime AD Spots in one timeline editor, then export SRT.

## Context pointers

Read the matching reference before working in that area:

- **Domain terms & ADRs**: before exploring a domain or naming concepts, read [docs/agents/domain.md](docs/agents/domain.md) (`GLOSSARY.md` and `docs/adr/`).
- **Local specs, tickets & triage**: for `.scratch/` specs, issues, wayfinding, or triage statuses, read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) and [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- **System contracts**: before changing video validation, SRT import, VAD, Gemini analysis, Job persistence, sign-in/sessions/access control, API error handling, concurrency, spot timing, or exports, read [docs/agents/system-constraints.md](docs/agents/system-constraints.md). Change each rule in its owning module.
- **HTTP API**: for `/auth/*` and `/api/*` requests, responses, and status codes, read [docs/API.md](docs/API.md).
- **Product & UI**: before changing user flows, copy, layout, or components, read [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md). Build UI from `src/components/ui` (shadcn/ui) themed via `src/index.css` tokens.

## Development & verification

Keep executable setup, Docker, build, and test commands in [README.md - เริ่มต้นใช้งาน](README.md#เริ่มต้นใช้งาน); consult `package.json` for scripts.

- **Dependencies & checks**: update `package.json` and `bun.lock` (`lockfileVersion 2`) together using Bun 1.4+ (Docker uses `--frozen-lockfile`; `bun test` requires Bun 1.4+ for `node:sqlite`). Add shadcn components inside the dev container with `bun x --bun shadcn@latest add <name>` so lockfiles stay in sync. Host `node_modules/` is an empty Docker mountpoint (host "Cannot find module" diagnostics are noise); run unit (`bun run test:unit` -> `src/`), integration (`bun run test:integration` -> `tests/integration/`), or full check (`bun run check`: `tsc --noEmit` + `test:unit` + `test:integration` + `vite build`) in the dev container: `docker compose exec envisio bun run check`. With npm, pass `--legacy-peer-deps`.
- **Docker**: `docker-compose.yml` (`Dockerfile` `development` stage) bind-mounts `.:/app` for development; `docker-compose.prod.yml` (`Dockerfile` `production` stage) mounts only `./.data:/app/.data`. Both persist Jobs in `.data/` (`envisio.db` + `jobs/`).
- **E2E & smoke tests**: Playwright Test specs live in `tests/e2e/` (`ui/*.spec.ts` mock `/api/**` and `/auth/**` against `tests/e2e/serve-dist.mjs` on `127.0.0.1:${PREVIEW_PORT:-4173}`; `smoke/*.spec.ts` run against an ephemeral `envisio:latest` container on `127.0.0.1:4174`). Build `dist` in the dev container (`docker compose exec envisio bun run build`), then run `bun run test:e2e` and `bun run test:smoke` on the host (setup and fixtures in [docs/testing.md](docs/testing.md)).
- **Live data guardrail**: against a running app with real data, perform read-only checks only; `DELETE /api/jobs/:jobId/files` permanently deletes a Job for every Author (and, with All-Jobs Access, can delete another Author's Job).
