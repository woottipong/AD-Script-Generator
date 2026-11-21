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

For local setup, Docker hot reload, dependency or environment changes, production builds, and verification, follow [README.md - การรันโปรเจกต์](README.md#การรันโปรเจกต์). Keep executable setup instructions there; consult `package.json` for available scripts.

Maintain `bun.lock` (lockfileVersion 2) with Bun 1.4 or newer, and change `package.json` and `bun.lock` together; Docker installs with `--frozen-lockfile`. When the local Bun is older, run the dependency command inside the dev container (`docker exec -w /app <container> bun add …`), which ships Bun 1.4. With npm, use `npm install --legacy-peer-deps` because of the Vite/esbuild peer dependency conflict.

Compose uses `Dockerfile.Dev` for development; `Dockerfile` builds production. The project root is bind mounted to `/app`, and jobs persist directly in `.data/jobs` on both the host and the container.

## Verification

Exercise UI flows with the browser scripts in `tests/browser/` (they mock every API route; the README shows how to run them). In a running app with real data, keep to read-only checks: changing the video, rescanning audio, and starting a new job all call `DELETE /api/jobs/:jobId`, which detaches the author's active Job.

## UX conventions

For interface changes, preserve the mode choice, guided intake, and [three-step workflow](README.md#วิธีใช้งานและคีย์ลัด). Build UI from the shared classes and brand rules in [DESIGN.md](DESIGN.md#components) (defined in `src/index.css`) so menus, buttons, fields, and tags stay one system. Prioritize desktop editing; keep mobile readable and usable for basic actions. Reveal technical processing details on demand. Save feedback must reflect server acknowledgement and distinguish local-only edits from persisted work.

## System contracts

Before changing video validation, VAD, Gemini analysis, Job persistence, API error handling, concurrency, spot editing, or exports, read [system constraints and contracts](docs/agents/system-constraints.md). It names the module that owns each rule; change a rule in its owning module. For endpoint requests and responses, read [API documentation](docs/API.md).
