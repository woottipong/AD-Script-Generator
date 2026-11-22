# System constraints and contracts

Each section names the module(s) that own its rules. Edit a rule in its owning module rather than duplicating checks elsewhere. For HTTP request/response shapes and status codes, see [API.md](../API.md).

## Video input and SRT import

- **Validation (`src/utils/videoValidator.ts`)**:
  - **Generate Mode (default)**: MP4 container, H.264 video (`avc1`/`avc3`), AAC audio (`mp4a` prefix; WebCodecs probes `mp4a.40.*` as-is and other `mp4a` values as `mp4a.40.2`), 480p height (standard `854×480`), duration ≤ 1,800 s (30 min), size ≤ 2,000 MiB (`2000 × 1024 × 1024` bytes), at least one video track and one audio track.
  - **Review Mode (`mode: 'review'`)**: skips upload size, H.264, and 480p checks; allows duration up to `REVIEW_MAX_DURATION_MS` (60 min); still requires an AAC audio track.
- **Byte reader (`src/utils/byteSource.ts`)**: unified reader for the validator and VAD worker with two adapters — local `File` and `http(s)` `.mp4` URL (`HEAD` for size + `Range` requests with `cache: 'no-store'`). URLs without CORS or Range support fail with `UrlNotReadableError`. Playback uses the URL directly as `<video src>`.
- **SRT import (`src/utils/srtImport.ts`)**: decodes UTF-8 (BOM allowed) with Windows-874 fallback, preserves multi-line cue text, strips `<i>`, `<b>`, `<u>`, and `<font>` tags, and drops cues that start after the video ends or have zero/negative duration (unimported cues are listed to the Author).

## Voice activity detection pipeline

Owned by `src/workers/vad.worker.ts` (decode, inference, waveform) and `src/utils/vadPostProcess.ts` (post-processing and signal analysis):

- **Model**: Silero VAD v6.2 at `public/models/silero_vad.onnx` via ONNX Runtime Web (WASM). Interface: `input` (64 context + 512 new samples), `state` (`[2, 1, 128]`), `sr` → `output`, `stateN`. Any replacement model must keep this interface.
- **Audio & framing**: 16,000 Hz mono Float32 PCM, 512 samples (32 ms) per frame. The worker allows one rewind so MP4s whose `moov` box follows `mdat` still decode audio.
- **Default parameters**: speech threshold `0.50` (auto-adjusted to `0.48`–`0.55` from noise floor), min speech `250 ms`, min silence `400 ms`, speech padding `200 ms`, candidate gap threshold `3,000 ms` (shorter gaps are dropped). Signal analysis may recommend adjusted speech, silence, and padding values before recalculating gaps.
- **Waveform Envelope (`src/utils/waveform.ts`)**: 1 peak byte per 20 ms bucket, base64-encoded in `vad_output.waveform`. Job init accepts `sampleIntervalMs` `10`–`1000` and ≤ 250,000 base64 characters. See [ADR-0001](../adr/0001-custom-canvas-waveform-and-peaks-storage.md).

## Processing feedback

Owned by `src/utils/processingFeedback.ts`: maps job status, progress, and batches to author-facing status. Logic branches on `ProcessingProgress.phase` (`finalizing-detection`, `saving-job`, `saving-edits`); `stage` text is display-only and safe to reword. Worker `PROGRESS` messages are typed against `ProcessingProgress`.

## Gemini analysis pipeline

Owned by `src/utils/formatters.ts` (batching), `src/utils/geminiBatch.ts` (prompt & schema validation), `src/utils/narrationBudget.ts` (character budget), and `server.ts` (Gemini calls, retry, fallback):

- **Models**: primary `gemini-4-hydrogen` (`thinkingLevel: LOW`, `mediaResolution: MEDIA_RESOLUTION_LOW`); fallback `gemini-3.5-flash-lite` on transient errors (rate limits, HTTP 503, timeouts, network errors), activating a 10-minute cooldown on the primary model.
- **Batching**: 240 s timeline slices grouped by spot start time; empty slices are omitted. Context window adds 20 s before and 10 s after, clamped to `[0, duration]`, expanding first to cover any spot crossing the batch boundary.
- **Narration pace & margin**: `11.5` base Thai chars/sec (`NARRATION_PACE_CHARS_PER_SEC`) + `350 ms` onset margin for both prompt budget and editor speech-duration estimate. Prompt budget subtracts `250 ms` safety margin from start and end; the editor's over-duration warning compares against full spot duration without that margin.
- **Response & error handling**: JSON validated by Zod (`GeminiBatchResponseSchema`). Every candidate spot must return `generate` (non-empty text) or `skip` (server supplies a default reason if missing; ignores unknown IDs). Unusable answers throw `BatchResponseError`, which `parseGeminiError` treats as non-transient (retried on the same model with backoff, without triggering fallback cooldown).

## Data storage and persistence

Owned by `src/utils/jobStore.ts` (DB & file layout) and `src/utils/jobValidation.ts` (`resolveJobTitle`). Route code always goes through `jobStore` and never opens SQLite or Job files directly. Keep all Job data inside `.data/`. See [ADR-0002](../adr/0002-job-mode-and-video-source.md) and [ADR-0003](../adr/0003-sqlite-job-store-and-url-addressed-jobs.md).

- **Layout**: SQLite at `.data/envisio.db` (`node:sqlite`, WAL mode) with tables `jobs` (one row per Job; Analysis Batches in `batches_json`) and `job_spots` (ordered by `position`, cascade-deleted with Job). Per-Job files live under `.data/jobs/<job_id>/` (`job_` + `[A-Za-z0-9_-]+`):
  - `vad_output.json`: written once on Job creation (`.tmp` then rename), never rewritten.
  - `source_video.mp4`: Generate Mode (`server_copy`) only; used for `/api/jobs/:jobId/video` range streaming and Gemini re-upload after file TTL expiry.
- **Job schema & title**: `schema_version` is `3` (pre-v3 `.data` has no migration; wipe `.data` on upgrade). `title` is 1–120 chars, defaulting to the video filename without extension. `mode` is `generate` or `review`; `video_source` is `server_copy`, `url`, or `local_file`. Review Mode stores no video copy (`POST /api/jobs/review`); Gemini routes return HTTP 409 for Review Mode Jobs.
- **Migrations**: `MIGRATIONS` in `jobStore.ts` is append-only, tracked by `PRAGMA user_version`. Each missing migration runs in its own transaction on startup; the store refuses a database newer than the code. Add a new entry rather than editing a released migration.
- **Reads, writes & reload**: saves upsert the `jobs` row and replace `job_spots` in one transaction (last write wins across tabs). Renames update only `title`. `load` treats a missing row or unreadable `vad_output.json` as missing; `loadMeta` reads the row only. There is no active Job — `/jobs/:jobId` addresses the open Job. On startup, `ANALYZING` Jobs reset to `VAD_READY` and `processing` batches reset to `pending`. Reloading a Review Mode Job reuses saved `vad_output` without rescanning (`url` plays immediately; `local_file` prompts to re-pick the file matched by name and size).

## Sign-in, sessions, and access control

Owned by `src/utils/auth.ts` (required env config via `readAuthConfig`, `/auth/*` Keycloak OIDC PKCE routes, request session reading), `src/utils/session.ts` (AES-256-GCM `envisio_session` cookie, key derived from `SESSION_SECRET` per purpose, fixed 7-day TTL, stateless), and `server.ts` (middleware & ownership checks). See [ADR-0004](../adr/0004-keycloak-sign-in-with-server-session-cookie.md).

- **Auth gate**: `server.ts` returns HTTP 401 `code: "UNAUTHENTICATED"` for every `/api/*` route except `GET /api/config`, and redirects unauthenticated HTML page requests to `/auth/login`. Mount all new routes behind this middleware.
- **Client re-auth**: a single `fetch` wrapper in `src/main.tsx` triggers sign-in only on `code: "UNAUTHENTICATED"`; other 401s (including remapped 403s) pass through to callers.
- **All-Jobs Access**: computed once at sign-in from the token's `groups` (or `group`) claim (ignoring leading `/`) against `AUTH_ALL_JOBS_GROUPS`, stored in session as `allJobs` and `accessGroups`.
- **Job Owner & access rule**: Job-creation routes record `owner_sub` and `owner_email`; `jobStore.save` preserves them, and sign-in refreshes `owner_email` for the Author's Jobs (pre-auth Jobs have no owner). `app.param('jobId')` allows access only to the Job Owner or All-Jobs Access and answers unauthorized Jobs with the same HTTP 404 as missing Jobs. `GET /api/jobs` filters via `store.list(ownerSub)`. New routes addressing a Job without `:jobId` must enforce the same check.
- **Unfinished Uploads**: `uploadOwners` in `server.ts` tracks uploaders in memory until deletion, Job creation, or server restart. Only the uploader or All-Jobs Access can access chunks, abandon, init a Job from `uploadId`, or delete (others receive the missing-upload response). Uploads become inactive after five minutes of inactivity by default. Explicitly abandoned uploads stay inactive even if a late chunk arrives. After a restart, only All-Jobs Access can reach an Unfinished Upload.
- **Testing**: there is no sign-in bypass; integration tests seal cookies with a test `SESSION_SECRET` via `src/utils/authTestHelpers.ts`.

## API error sanitization and concurrency

Owned by `server.ts`:

- **Status sanitization**: `sanitizeApiStatusCode` remaps HTTP `403 → 401` and `502/503/504 → 500` so Cloud Run / Nginx reverse proxies do not replace JSON error bodies with HTML pages. Apply it on all API error paths.
- **Concurrency lock**: `activeProcessingLock` enforces one Gemini analysis Job at a time per server process; concurrent start requests return HTTP 409.

## Editing and validation rules

Owned by `src/utils/spotTiming.ts` (shared by typed timestamps, timeline Trim/Move, ±0.2 s nudges, and `PATCH /api/jobs/:jobId/spots`). Callers pass `SpotTimingContext` (`generate` or `review`):

- **Generate Mode**: timestamps stay within `[original_start_ms, original_end_ms]`, never overlap any `vad_output.speech_segments`, and last ≥ `500 ms` (`MIN_SPOT_DURATION_MS`).
- **Review Mode**: retimed spots stay within video duration, last ≥ `500 ms`, and never overlap another non-`skip` spot; speech overlap is allowed. `PATCH` checks timing only for Review Mode spots whose `start_ms` or `end_ms` changed; dragging or nudging an overlapping imported spot pulls it out of overlap.
- **Warnings (`findSpotIssues`)**: flags Review Mode spots that overlap speech, overlap another non-`skip` spot, last < 500 ms, or end after video duration. Shown as non-blocking warnings in the editor/timeline and grouped in the `ต้องตรวจ` menu with over-duration estimates (informational in both modes because Extended AD may pause picture).
- **Export (`src/utils/formatters.ts`)**: SubRip (`.srt`) includes only spots where `decision === 'generate'` and text is non-empty, sorted by start time.
