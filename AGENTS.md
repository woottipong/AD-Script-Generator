# Agent guide

Guidance for automated agents working on the TCC Envisio repository.

## Agent skills

### Issue tracker

For specs, tickets, and wayfinding, use local Markdown in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

For triage, use the standard status vocabulary in `docs/agents/triage-labels.md`.

### Domain docs

Before exploring a domain, read the single-context glossary and relevant ADRs as described in `docs/agents/domain.md`.

## Project overview

TCC Envisio authors Thai Audio Description (AD) scripts in two modes. Both decode the audio track with WebCodecs and find Speech Segments with Silero VAD in a Web Worker. In Generate Mode (480p MP4) the Express server persists the Job, uploads the video to the Gemini Files API, and analyses Analysis Batches one at a time. In Review Mode an existing SRT is opened against a local or linked MP4 with no video upload and no Gemini. Authors review and retime AD Spots in one timeline editor, then export SRT.

## Development workflow

Keep executable setup, Docker, build, and verification commands in [README.md - การรันโปรเจกต์](README.md#การรันโปรเจกต์); consult `package.json` for scripts.

- **Dependencies and tests:** Update `package.json` and `bun.lock` (`lockfileVersion 2`) together using Bun 1.4+ (Docker installs with `--frozen-lockfile`, and `node:sqlite` requires Bun 1.4+ for `bun test`). When local Bun is older, run `docker exec -w /app <container> bun …` inside the dev container. With npm, pass `--legacy-peer-deps`.
- **Docker:** `docker-compose.yml` (`Dockerfile.Dev`) bind-mounts `.:/app` for development; `docker-compose.prod.yml` (`Dockerfile` `production` stage) mounts only `./.data:/app/.data` for deployment and updates. In both setups, Jobs persist in `.data` (`envisio.db` plus `jobs/`).

## Verification

Exercise UI flows with the browser scripts in `tests/browser/` (they mock every API route; see [README.md](README.md#คำสั่งตรวจสอบโค้ด)). In a running app with real data, keep to read-only checks: deleting from storage calls `DELETE /api/jobs/:jobId/files`, which permanently removes the Job for every Author (and, with All-Jobs Access, can remove another Author's Job).

## UX conventions

Preserve the mode choice, guided intake, [three-step workflow](README.md#วิธีใช้งานและคีย์ลัด), and product principles in [PRODUCT.md](PRODUCT.md) (desktop-first editing with basic mobile usability, on-demand processing details, and server-acknowledged save feedback). Build UI from the shadcn/ui components in `src/components/ui` themed via `src/index.css` tokens per [DESIGN.md](DESIGN.md#components); add components with `bun x --bun shadcn@latest add <name>` inside the dev container so `package.json` and `bun.lock` stay in sync.

## System contracts

Before changing video validation, VAD, Gemini analysis, Job persistence, API error handling, concurrency, spot editing, or exports, read [system constraints and contracts](docs/agents/system-constraints.md). It names the module that owns each rule; change a rule in its owning module. For endpoint requests and responses, read [API documentation](docs/API.md).
