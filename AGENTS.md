# Agent guide

Guidance for automated agents working on the AD Script Generator repository.

## Agent skills

### Issue tracker

For specs, tickets, and wayfinding, use local Markdown in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

For triage, use the standard status vocabulary in `docs/agents/triage-labels.md`.

### Domain docs

Before exploring a domain, read the single-context glossary and relevant ADRs as described in `docs/agents/domain.md`.

## Project overview

AD Script Generator is an automated Thai Audio Description (AD) script authoring application. It processes 480p MP4 videos through a two-tier architecture: client-side Voice Activity Detection (VAD) and server-side video understanding with Google Gemini.

1. Client demuxes and decodes audio locally using `mp4box.js` and `WebCodecs AudioDecoder`.
2. Client runs Silero VAD v5 via ONNX Runtime Web inside a dedicated Web Worker to identify non-speech gaps.
3. Server receives candidate spots and uploads the video file to the Gemini Files API.
4. Server analyses 240-second timeline batches sequentially using `gemini-4-hydrogen` (with fallback to `gemini-3.5-flash-lite`).
5. Client renders an NLE workstation timeline and script editor for review, time adjustment, and export to SRT.

## Development workflow

For local setup, Docker hot reload, dependency or environment changes, production builds, and verification, follow [README.md - การรันโปรเจกต์](README.md#การรันโปรเจกต์). Keep executable setup instructions there; consult `package.json` for available scripts.

Use Bun (version 1.4 or higher) to maintain `bun.lock` (lockfileVersion 2). Docker installs with `--frozen-lockfile`. Keep dependency changes in `package.json` and `bun.lock` together. Plain `npm install` fails due to the Vite/esbuild peer dependency conflict; run `npm install --legacy-peer-deps` when using npm.

Compose uses `Dockerfile.Dev` for development; `Dockerfile` builds production. The project root is bind mounted to `/app`, and jobs persist directly in `.data/jobs` on both the host and the container.

## UX conventions

For interface changes, preserve the guided intake and [three-step workflow](README.md#วิธีใช้งานและคีย์ลัด). Prioritize desktop editing; keep mobile readable and usable for basic actions. Reveal technical processing details on demand. Save feedback must reflect server acknowledgement and distinguish local-only edits from persisted work.

## System contracts

Before changing video validation, VAD, Gemini analysis, Job persistence, API error handling, concurrency, spot editing, or exports, read [system constraints and contracts](docs/agents/system-constraints.md). For endpoint requests and responses, read [API documentation](docs/API.md).

For implementation ownership, inspect `server.ts`, `src/App.tsx`, `src/components/`, `src/utils/`, `src/workers/`, and `src/types/` as relevant to the change.
