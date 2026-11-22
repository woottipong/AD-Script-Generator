# Coding standards

Review-stage standards for TCC Envisio. Mechanical checks (`tsc --noEmit`, `node:sqlite` isolation, API status sanitization, `/api` auth-gate ordering, and Markdown link integrity) run automatically via `bun run check` (`src/utils/repoGuardrails.test.ts`); this file covers judgement calls for code review.

## Architecture and ownership

- **Owning-module discipline**: change every system rule in its owning module listed in [docs/agents/system-constraints.md](docs/agents/system-constraints.md) rather than duplicating validation, timing, or persistence logic in callers.
- **Job & upload access control**: any route that addresses a Job without `:jobId` must enforce the same Job Owner / All-Jobs Access check as `app.param('jobId')` and answer unauthorized Jobs with the same HTTP 404 as missing Jobs. Any new upload route must enforce uploader / All-Jobs Access via `canUseUpload`.
- **Append-only migrations**: `MIGRATIONS` in `src/utils/jobStore.ts` is append-only. Never modify a released migration entry; add a new migration instead.
- **Persistence safety**: route handlers go through `jobStore` and keep all Job data inside `.data/`. Preserve transactional saves (Job row + `job_spots` together) and write-once `vad_output.json`.

## UI and product behavior

- **Design system conformance**: build UI from `src/components/ui` (shadcn/ui) styled with semantic tokens in `src/index.css`. Enforce the Named Rules in [DESIGN.md](DESIGN.md) (Single-Accent, Dark-Stage Contrast, Tabular Timecode, Looped-Script, Flat-By-Default).
- **Server-acknowledged save feedback**: report save success only after the server acknowledges the write, and keep local-only edits visibly distinct from saved Jobs.
- **Zero-shift processing feedback**: keep async progress in the navbar status pill and 3px hairline track rather than adding banners or headers above the video monitor.

## Domain and documentation drift

- **Canonical terminology & ADRs**: use the domain terms in [GLOSSARY.md](GLOSSARY.md). Flag any change that contradicts an accepted decision in [docs/adr/](docs/adr/) unless the ADR is explicitly reopened.
- **Keep docs in sync with code**: when adding or changing routes, response fields, error messages, env vars, or system rules, verify that [docs/API.md](docs/API.md), [docs/agents/system-constraints.md](docs/agents/system-constraints.md), [AGENTS.md](AGENTS.md) context pointers, and [README.md](README.md) (`.env` and UI workflow) are updated in the same change.
