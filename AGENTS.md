# Agent Guide

Guidance for automated agents working on the AD Script Generator repository.

## Project overview

AD Script Generator is an automated Thai Audio Description (AD) script authoring application. It processes 480p MP4 videos through a two-tier architecture: client-side Voice Activity Detection (VAD) and server-side video understanding with Google Gemini.

1. Client demuxes and decodes audio locally using `mp4box.js` and `WebCodecs AudioDecoder`.
2. Client runs Silero VAD v5 via ONNX Runtime Web inside a dedicated Web Worker to identify non-speech gaps.
3. Server receives candidate spots and uploads the video file to the Gemini Files API.
4. Server analyses 120-second timeline batches sequentially using `gemini-3.8-flash` (with fallback to `gemini-3.1-flash-lite`).
5. Client renders an NLE workstation timeline and script editor for review, time adjustment, and export to SRT or JSON.

## Development workflow

For local setup, Docker hot reload, dependency or environment changes, production builds, and verification, follow [README.md — การรันโปรเจกต์](README.md#การรันโปรเจกต์). Keep executable setup instructions there; consult `package.json` for available scripts.

Use Bun to maintain `bun.lock`; Docker installs with `--frozen-lockfile`. Keep dependency changes in `package.json` and `bun.lock` together. Plain `npm install` currently fails on the Vite/esbuild peer dependency conflict.

Compose uses `Dockerfile.Dev` for development; `Dockerfile` builds production. Preserve this separation when changing the container setup. The jobs bind mount maps host `./_data/jobs` to container `/app/.data/jobs`; refreshing the anonymous dependency volume must preserve that bind mount.

## UX conventions

For interface changes, preserve the guided intake and [three-step workflow](README.md#วิธีใช้งาน). Prioritize desktop editing; keep mobile readable and usable for basic actions. Reveal technical processing details on demand. Save feedback must reflect server acknowledgement and distinguish local-only edits from persisted work.

## System constraints

### Video input specifications

The client validator (`src/utils/videoValidator.ts`) rejects files that violate these bounds:

- Container: MP4 only.
- Video codec: H.264 (`avc1` or `avc3`).
- Audio codec: AAC (`mp4a.40.2`).
- Resolution: 480p height (standard 854x480). Non-480p heights fail validation.
- Duration: Maximum 1800 seconds (30 minutes).
- File size: Maximum 2000 MB (2 GB).
- Track count: Must contain at least one video track and one audio track.

### Voice activity detection pipeline

VAD runs in `src/workers/vad.worker.ts` and post-processes in `src/utils/vadPostProcess.ts`:

- Audio format: 16,000 Hz, 1 channel (mono), Float32 PCM.
- Frame size: 512 samples (32 ms per frame).
- Default speech threshold: 0.50 (adjusted automatically between 0.48 and 0.55 based on noise floor).
- Minimum speech duration: 250 ms.
- Minimum silence duration: 400 ms.
- Speech padding: 200 ms applied to start and end of detected speech.
- Candidate gap threshold: Non-speech intervals equal to or exceeding 3000 ms. Intervals shorter than 3000 ms are dropped from candidate spot generation.

### Gemini analysis pipeline

Batching and Gemini interaction run in `server.ts` and `src/utils/formatters.ts`:

- Primary model: `gemini-3.8-flash` with `thinkingLevel: LOW` and `mediaResolution: MEDIA_RESOLUTION_LOW`.
- Fallback model: `gemini-3.1-flash-lite`. Triggered on HTTP 503, timeouts, or transient errors, setting a 10-minute cooldown on the primary model.
- Batch interval: 120 seconds of video timeline per batch.
- Batch context window: Includes 20 seconds before batch start and 10 seconds after batch end, clamped to [0, duration].
- Narration pace standard: 11.5 base Thai characters per second.
- Safety breathing margin: 250 ms subtracted from spot start and spot end before calculating maximum allowable Thai text length.
- Response format: Strict JSON validated by Zod against `GeminiBatchResponseSchema`. Every candidate spot in the batch must receive either `generate` (with non-empty text) or `skip` (with a Thai reason). Invented spot IDs are rejected.

## Data storage and persistence

Job state persists as JSON on disk inside `.data/jobs/`:

- Path format: `.data/jobs/<job_id>/job.json`
- Active pointer: `.data/jobs/active_job.json` contains `{ "active_job_id": "<job_id>" }`
- Local video copy: `.data/jobs/<job_id>/source_video.mp4` stored during upload for range streaming (`/api/jobs/:jobId/video`) and automatic re-upload if Gemini file TTL expires.

Do not store job files outside `.data/jobs/`. Clean orphaned pointers via `DELETE /api/jobs/:jobId`.

## API contract

All server endpoints live under `/api`:

- `GET /api/config`: Returns fixed server configuration and active job existence.
- `GET /api/jobs/current`: Returns the latest persisted job state and whether processing is running.
- `GET /api/jobs/:jobId`: Returns state for a specific job.
- `GET /api/jobs/:jobId/video`: Streams local MP4 file with HTTP 206 partial content support for video seeking.
- `POST /api/upload/init`: Initializes a chunked upload session and returns `uploadId`.
- `POST /api/upload/chunk`: Appends binary chunk (up to 25 MB) to `source_video.mp4`.
- `POST /api/jobs/init`: Creates a job state from VAD output and chunked upload, then starts background analysis.
- `POST /api/jobs/:jobId/start`: Resumes incomplete batch processing asynchronously.
- `POST /api/jobs/:jobId/analyze-batch`: Analyzes a single batch synchronously (fallback route).
- `PATCH /api/jobs/:jobId/spots`: Validates and saves manual script or timestamp edits.
- `DELETE /api/jobs/:jobId`: Clears active job pointer.

### HTTP status code sanitization

Cloud Run and container Nginx reverse proxies intercept status codes 403, 502, 503, and 504, replacing JSON bodies with HTML error pages. `server.ts` uses `sanitizeApiStatusCode` to remap 403 to 401, and 502/503/504 to 500. Keep this sanitization on all API error paths.

### Concurrency model

Processing uses a single-job concurrency lock (`activeProcessingLock` in `server.ts`). Only one Gemini analysis job runs at a time. Requests to start a new job while another is active return HTTP 409.

## Editing and validation rules

When editing candidate spots in the UI or via `PATCH /api/jobs/:jobId/spots`:

- Timestamps must remain within the spot's original non-speech gap boundaries (`original_start_ms` and `original_end_ms`).
- Timestamps must never overlap any detected speech segment from `vad_output.speech_segments`.
- Spot duration must be at least 500 ms.
- Export formats: SubRip (`.srt`) includes only spots where `decision === 'generate'` with non-empty text. JSON export includes full metadata, speech segments, candidate spots, generated spots, and skipped spots.

## Codebase layout

```
AD-Script-Generator/
├── server.ts               # Express backend, Gemini Files API, batch queue, job persistence
├── Dockerfile              # Production image build
├── Dockerfile.Dev          # Development image with tsx watch
├── docker-compose.yml      # Local dev orchestration with HMR port and jobs volume
├── .dockerignore           # Excludes dependencies, build output, secrets, and jobs from images
├── vite.config.ts          # Vite build and server middleware config
├── package.json            # Scripts and dependencies
├── bun.lock                # Dependency lockfile
├── public/
│   ├── models/             # silero_vad.onnx model file
│   ├── ort/                # ONNX Runtime Web WASM binaries and loaders
│   └── samples/            # sample_480p.mp4 for quick testing
└── src/
    ├── App.tsx             # Root state machine, upload coordinator, poller, layout
    ├── index.css           # Tailwind CSS imports
    ├── types/
    │   └── ad.ts           # Shared TypeScript interfaces and Zod schemas
    ├── workers/
    │   └── vad.worker.ts   # Web Worker for WebCodecs decode and Silero ONNX inference
    ├── utils/
    │   ├── videoValidator.ts # mp4box chunked parser and codec validation
    │   ├── vadPostProcess.ts # Thresholding, padding, and candidate gap extraction
    │   └── formatters.ts     # Batch builder, timestamps, Thai duration estimator, exports
    └── components/
        ├── UploadAndVadPanel.tsx    # Upload bar, VAD status, batch monitor, actions
        ├── VideoPreviewTimeline.tsx # Video player, transport controls, multi-track canvas
        └── AdScriptEditor.tsx       # Spot list, inline Thai editor, timestamp nudger
```
