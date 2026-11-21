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

## Review Mode

Review Mode opens an existing video and SRT. `src/utils/videoValidator.ts` (with `mode: 'review'`) skips the upload size, H.264, and 480p checks and allows up to `REVIEW_MAX_DURATION_MS` (60 minutes); an AAC audio track is still required. `src/utils/srtImport.ts` decodes UTF-8 (BOM allowed) or falls back to Windows-874, keeps multi-line cue text, strips `<i>`, `<b>`, `<u>`, and `<font>` tags, and leaves out cues that start after the video ends. The video can also be an `http(s)` `.mp4` link: `src/utils/byteSource.ts` gives the validator and the VAD worker one reader with two adapters, a local `File` and a URL read with `HEAD` (size) plus `Range` requests sent `cache: 'no-store'`; a link without CORS or Range support fails with `UrlNotReadableError`, and playback uses the link as the `<video>` source. The worker allows one rewind so MP4s whose `moov` box follows `mdat` still decode audio. Restoring a Review Mode job on reload reuses its saved `vad_output` without rescanning; a `url` source plays at once, and a `local_file` source asks the author to pick the same file again, matched by name and size. `POST /api/jobs/review` stores the job with no video copy; Gemini routes return HTTP 409 for it. The spec and remaining tickets live in `.scratch/review-mode/`.

## Voice activity detection pipeline

VAD runs in `src/workers/vad.worker.ts` and post-processes in `src/utils/vadPostProcess.ts`:

- Model: Silero VAD v6.2 at `public/models/silero_vad.onnx`, run with ONNX Runtime Web (WASM). Each call takes `input` (64 context samples + 512 new samples), `state` (`[2, 1, 128]`), and `sr`, and returns `output` and `stateN`. A replacement model must keep this interface.
- Audio format: 16,000 Hz, 1 channel (mono), Float32 PCM.
- Frame size: 512 samples (32 ms per frame).
- Default speech threshold: 0.50 (adjusted automatically between 0.48 and 0.55 based on noise floor).
- Default minimum speech duration: 250 ms.
- Default minimum silence duration: 400 ms.
- Default speech padding: 200 ms applied to the start and end of detected speech.
- Candidate gap threshold: Non-speech intervals equal to or exceeding 3000 ms. Intervals shorter than 3000 ms are dropped from candidate spot generation.

Signal analysis can recommend different speech, silence, and padding values before the gaps are recalculated.

The worker also builds the Waveform Envelope (`src/utils/waveform.ts`): one peak byte per 20 ms bucket, stored base64-encoded in `vad_output.waveform`. Job initialization accepts `sampleIntervalMs` from 10 to 1000 and at most 200,000 base64 characters. [ADR-0001](../adr/0001-custom-canvas-waveform-and-peaks-storage.md) records why the timeline draws it on its own canvas.

## Processing feedback

`src/utils/processingFeedback.ts` turns job status, progress, and batches into the status shown to authors. It branches on `ProcessingProgress.phase` (`finalizing-detection`, `saving-edits`); `stage` text is display-only, so stage wording can change freely. The worker's PROGRESS message is typed against `ProcessingProgress`, so a misspelled phase fails `tsc`.

## Gemini analysis pipeline

Batching runs in `src/utils/formatters.ts`. Prompt building and response validation run in `src/utils/geminiBatch.ts`, the narration character budget in `src/utils/narrationBudget.ts`, and the Gemini calls with retry and fallback in `server.ts`:

- Primary model: `gemini-4-hydrogen` with `thinkingLevel: LOW` and `mediaResolution: MEDIA_RESOLUTION_LOW`.
- Fallback model: `gemini-3.5-flash-lite`. Triggered on HTTP 503, timeouts, or transient errors, setting a 10-minute cooldown on the primary model.
- Batch interval: 240 seconds of video timeline per batch.
- Batch context window: Includes 20 seconds before batch start and 10 seconds after batch end, clamped to [0, duration]. A window expands to cover a spot crossing the batch boundary before context is added.
- Narration pace standard: 11.5 base Thai characters per second (`NARRATION_PACE_CHARS_PER_SEC`). The prompt's character budget and the editor's speech-duration estimate both use it, with a 350 ms onset margin.
- Safety breathing margin: 250 ms subtracted from spot start and spot end before calculating maximum allowable Thai text length. The editor's over-duration warning compares against the full spot duration, without this margin.
- Response format: JSON validated by Zod against `GeminiBatchResponseSchema`. Every candidate spot must receive `generate` with non-empty text or `skip`. The server supplies a default reason when a skipped spot has none, and ignores IDs outside the batch.
- Error classification: an unusable answer throws `BatchResponseError`, which `parseGeminiError` treats as non-transient. It is retried on the same model with backoff, and only transient Gemini failures (rate limits, 503, timeouts, network errors) set the primary-model cooldown and switch to the fallback model.

## Data storage and persistence

Job state persists as JSON on disk inside `.data/jobs/`. `src/utils/jobStore.ts` owns this layout: job ID checks (`job_` followed by letters, digits, `_`, or `-`), reads, writes, the active pointer, storage listing, and deletable directories. Route code goes through the store.

Each Job records `schema_version` (currently 2), `mode` (`generate` or `review`), and `video_source` (`server_copy`, `url`, or `local_file`); see [ADR-0002](../adr/0002-job-mode-and-video-source.md). The store upgrades jobs without `schema_version` on read to Generate Mode with a `server_copy` source, and the next save writes the new shape. Only a `server_copy` source has a video file on the server.

- Path format: `.data/jobs/<job_id>/job.json`
- Active pointer: `.data/jobs/active_job.json` contains `{ "active_job_id": "<job_id>", "updated_at": "…" }`
- Local video copy: `.data/jobs/<job_id>/source_video.mp4` stored during upload for range streaming (`/api/jobs/:jobId/video`) and automatic re-upload if Gemini file TTL expires.
- Writes: `job.json` and the pointer are written to a `.tmp` file and renamed, so an interrupted save keeps the previous file.
- Reads: `load` treats any unreadable job as missing; `activeJobId` throws on a corrupt pointer so storage routes answer HTTP 500 instead of acting on bad data.

Keep job files inside `.data/jobs/`. Clean orphaned pointers via `DELETE /api/jobs/:jobId`.

## API contract

For endpoint requests, responses, and behavior, see [API.md](../API.md).

### HTTP status code sanitization

Cloud Run and container Nginx reverse proxies intercept status codes 403, 502, 503, and 504, replacing JSON bodies with HTML error pages. `server.ts` uses `sanitizeApiStatusCode` to remap 403 to 401, and 502/503/504 to 500. Keep this sanitization on all API error paths.

### Concurrency model

Processing uses a single-job concurrency lock (`activeProcessingLock` in `server.ts`). Only one Gemini analysis job runs at a time. Requests to start a new job while another is active return HTTP 409.

## Editing and validation rules

`src/utils/spotTiming.ts` is the single source for these rules. Typed timestamps, timeline Trim and Move, the ±0.2 s nudge buttons, and `PATCH /api/jobs/:jobId/spots` validation all use it:

- Timestamps must remain within the spot's original non-speech gap boundaries (`original_start_ms` and `original_end_ms`).
- Timestamps must never overlap any detected speech segment from `vad_output.speech_segments`.
- Spot duration must be at least 500 ms (`MIN_SPOT_DURATION_MS`).

Review Mode replaces the first two rules: a retimed spot stays inside the video, lasts at least 500 ms, and does not overlap another spot whose decision is not `skip`; it may overlap a Speech Segment. Callers pass a `SpotTimingContext` (`generate` or `review`) so one module decides which rules apply. `PATCH` checks only Review Mode spots whose `start_ms` or `end_ms` changed, and a drag or nudge on an imported spot that overlaps its neighbour pulls it out of the overlap. `findSpotIssues` flags Review Mode spots that overlap speech, overlap another non-skipped spot, last under 500 ms, or end after the video; these are warnings shown in the editor and timeline, never save errors. SRT cues that start after the video ends or have no duration are not imported and are listed to the author.
- SubRip (`.srt`) export includes only spots where `decision === 'generate'` with non-empty text.
