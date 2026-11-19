# System constraints and contracts

## Video input specifications

The client validator (`src/utils/videoValidator.ts`) rejects files that violate these bounds:

- Container: MP4 only.
- Video codec: H.264 (`avc1` or `avc3`).
- Audio codec: AAC with an `mp4a` prefix. WebCodecs checks `mp4a.40.*` using the track codec and other `mp4a` values using `mp4a.40.2`.
- Resolution: 480p height (standard 854x480). Non-480p heights fail validation.
- Duration: Maximum 1800 seconds (30 minutes).
- File size: Maximum 2,000 MiB (`2000 × 1024 × 1024` bytes).
- Track count: Must contain at least one video track and one audio track.

## Voice activity detection pipeline

VAD runs in `src/workers/vad.worker.ts` and post-processes in `src/utils/vadPostProcess.ts`:

- Audio format: 16,000 Hz, 1 channel (mono), Float32 PCM.
- Frame size: 512 samples (32 ms per frame).
- Default speech threshold: 0.50 (adjusted automatically between 0.48 and 0.55 based on noise floor).
- Default minimum speech duration: 250 ms.
- Default minimum silence duration: 400 ms.
- Default speech padding: 200 ms applied to the start and end of detected speech.
- Candidate gap threshold: Non-speech intervals equal to or exceeding 3000 ms. Intervals shorter than 3000 ms are dropped from candidate spot generation.

Signal analysis can recommend different speech, silence, and padding values before the gaps are recalculated.

## Gemini analysis pipeline

Batching and Gemini interaction run in `server.ts` and `src/utils/formatters.ts`:

- Primary model: `gemini-4-hydrogen` with `thinkingLevel: LOW` and `mediaResolution: MEDIA_RESOLUTION_LOW`.
- Fallback model: `gemini-3.5-flash-lite`. Triggered on HTTP 503, timeouts, or transient errors, setting a 10-minute cooldown on the primary model.
- Batch interval: 240 seconds of video timeline per batch.
- Batch context window: Includes 20 seconds before batch start and 10 seconds after batch end, clamped to [0, duration]. A window expands to cover a spot crossing the batch boundary before context is added.
- Narration pace standard: 11.5 base Thai characters per second.
- Safety breathing margin: 250 ms subtracted from spot start and spot end before calculating maximum allowable Thai text length.
- Response format: JSON validated by Zod against `GeminiBatchResponseSchema`. Every candidate spot must receive `generate` with non-empty text or `skip`. The server supplies a default reason when a skipped spot has none, and ignores IDs outside the batch.

## Data storage and persistence

Job state persists as JSON on disk inside `.data/jobs/`:

- Path format: `.data/jobs/<job_id>/job.json`
- Active pointer: `.data/jobs/active_job.json` contains `{ "active_job_id": "<job_id>" }`
- Local video copy: `.data/jobs/<job_id>/source_video.mp4` stored during upload for range streaming (`/api/jobs/:jobId/video`) and automatic re-upload if Gemini file TTL expires.

Do not store job files outside `.data/jobs/`. Clean orphaned pointers via `DELETE /api/jobs/:jobId`.

## API contract

For endpoint requests, responses, and behavior, see [API.md](../API.md).

### HTTP status code sanitization

Cloud Run and container Nginx reverse proxies intercept status codes 403, 502, 503, and 504, replacing JSON bodies with HTML error pages. `server.ts` uses `sanitizeApiStatusCode` to remap 403 to 401, and 502/503/504 to 500. Keep this sanitization on all API error paths.

### Concurrency model

Processing uses a single-job concurrency lock (`activeProcessingLock` in `server.ts`). Only one Gemini analysis job runs at a time. Requests to start a new job while another is active return HTTP 409.

## Editing and validation rules

When editing candidate spots in the UI or via `PATCH /api/jobs/:jobId/spots`:

- Timestamps must remain within the spot's original non-speech gap boundaries (`original_start_ms` and `original_end_ms`).
- Timestamps must never overlap any detected speech segment from `vad_output.speech_segments`.
- Spot duration must be at least 500 ms.
- SubRip (`.srt`) export includes only spots where `decision === 'generate'` with non-empty text.
