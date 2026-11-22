---
status: accepted
---

# Custom Canvas Waveform Overlay with Base64 Peaks in `VADOutput`

We render the timeline's Waveform Envelope using a custom 2D `<canvas>` in its own dedicated `คลื่นเสียง` (Waveform) track directly above the `เสียงพูด` (Speech) track, driven by 50 Hz (20ms bucket) peak amplitudes computed in `src/workers/vad.worker.ts` from the already-decoded 16 kHz mono PCM and persisted in `vad_output.waveform` as a base64-encoded `Uint8Array` (0–255).

## Considered Options

- **`wavesurfer.js` / `peaks.js`**: Rejected because both libraries own their own audio playback, scroll container, zoom, and playhead, which would fight the existing `<video>` element and synchronized `1x–64x` multi-track timeline.
- **Re-decoding `/api/jobs/:jobId/video` on every page reload**: Rejected because reloading a saved job would incur noticeable download and WebCodecs decode latency just to draw the waveform.
- **JSON `number[]` peaks array**: Rejected in favor of base64 `Uint8Array`, which keeps a 30-minute video's 90,000 peaks (20 ms buckets) at ~120 KB of base64 in `job.json` instead of ~300 KB+ as a JSON number array. *(Update: [ADR-0003](./0003-sqlite-job-store-and-url-addressed-jobs.md) later moved `vad_output` out of `job.json` into `.data/jobs/<job_id>/vad_output.json`.)*

## Consequences

- Zero new runtime dependencies and guaranteed pixel-exact alignment with the `<video>` clock, playhead, and `1x–64x` timeline zoom.
- Existing saved jobs without `vad_output.waveform` degrade gracefully to the speech-segment bars until re-scanned.
- Timeline Trim and Move interactions remain hard-clamped to `original_start_ms..original_end_ms` (and never overlap `speech_segments`), preserving the existing `PATCH /api/jobs/:jobId/spots` contract. *(Update: [ADR-0002](./0002-job-mode-and-video-source.md) Review Mode later relaxed the Non-Speech Gap clamp and speech-overlap prohibition for imported Review Mode spots.)*
