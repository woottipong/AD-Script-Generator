# TCC Envisio API reference

This reference describes the routes in [server.ts](../server.ts). Request and response types are defined in [src/types/ad.ts](../src/types/ad.ts). Installation and startup commands are in the [README](../README.md#การรันโปรเจกต์).

## Base configuration and conventions

- The default base URL is `http://localhost:3000/api`. Express listens on `0.0.0.0:3000`, or on `PORT` when it is set.
- JSON requests use `Content-Type: application/json`. The JSON parser limit is 25 MiB. Upload chunks use `application/octet-stream`. Source video responses use `video/mp4`.
- Times ending in `_ms` and `video_metadata.durationMs` are milliseconds. Configuration fields ending in `Seconds` are seconds. File sizes are bytes. Size limits use `1024 × 1024` bytes per MiB.
- The application has no HTTP authentication or per-user job isolation. `GEMINI_API_KEY` authenticates server requests to Google, not requests to this API.
- A process-local `activeProcessingLock` coordinates analysis. It is not a distributed lock. The server holds it until the running operation finishes and releases it.
- A lock belonging to another running job can produce HTTP 409. An accepted background request does not mean that Gemini analysis has succeeded. Poll the job for its result.
- API handlers set `Cache-Control: no-store, no-cache, must-revalidate`.
- Error handling remaps HTTP 403 to 401 and HTTP 502, 503, and 504 to 500. This preserves the application's JSON error response through the proxy setup this server targets. Errors from an external proxy can still arrive outside this contract.

## Shared response types

A job response contains a `job` object. The fields below describe the current TypeScript contract, not a complete runtime schema for incoming requests.

| Field | Type or values |
|---|---|
| `schema_version` | `3` |
| `job_id` | Opaque string ID |
| `title` | The Job Title, 1 to 120 characters. Defaults to the video file name without its extension |
| `mode` | `generate` or `review` |
| `video_source` | Where the video lives: `{ kind: "server_copy", local_file_path }`, `{ kind: "url", url }`, or `{ kind: "local_file", file_name, file_size }`. Generate Mode jobs use `server_copy` |
| `srt_source` | Optional imported SRT details for Review Mode: `file_name`, `cue_count`, `imported_at` |
| `created_at`, `updated_at` | ISO timestamp strings |
| `status` | `IDLE`, `VIDEO_READY`, `DETECTING`, `VAD_READY`, `ANALYZING`, `READY`, or `FAILED` |
| `video_metadata` | File name, byte size, MIME type, width, height, duration, video codec, audio codec, and `hasAudioTrack`. Optional `sampleRate` and `channelCount` |
| `vad_config` | `speechThreshold`, `minSpeechDurationMs`, `minSilenceDurationMs`, `speechPaddingMs`, and `minAdGapMs` |
| `ad_settings` | Optional analysis settings. Defaults are listed under job initialization |
| `vad_output` | `duration_ms`, `speech_segments`, and `candidate_spots`. Optional `signal_analysis` contains acoustic measurements and the recommended VAD configuration. Optional `waveform` holds the Waveform Envelope as `sampleIntervalMs` (10 to 1000) and `peaksBase64` (base64 of one byte per bucket, at most 200,000 characters) |
| `batches` | Array of analysis batches |
| `spots` | Array of `ADSpot` objects |
| `gemini_file_uri`, `gemini_file_name`, `gemini_file_mime_type`, `gemini_file_expires_at` | Optional Gemini Files API metadata |
| `progress_stage`, `progress_percent`, `active_model`, `error_message` | Optional processing feedback |

An analysis batch contains `batch_index`, `batch_id`, `batch_start_ms`, `batch_end_ms`, `window_start_ms`, `window_end_ms`, `candidate_spots`, `status`, and `retry_count`. Its status is `pending`, `processing`, `completed`, or `failed`. A failed batch can include `error`.

An `ADSpot` contains `spot_id`, `start_ms`, `end_ms`, `duration_ms`, `decision`, `text`, `is_edited`, `original_start_ms`, and `original_end_ms`. Its decision is `pending`, `generate`, or `skip`. `reason` is optional.

The server reuses the Gemini file across batches. After the last batch or a processing failure, it attempts to delete the job's Gemini file before releasing the processing lock. A successful deletion or HTTP 404 clears the Gemini file metadata. Other deletion errors leave the analysis result and file reference intact. If deletion fails before a replacement upload, the job fails and can be retried. The server keeps the local MP4 for playback and re-upload.

`isRunning` indicates whether the process-local lock belongs to the job, including during Gemini file cleanup. The browser waits for `isRunning: false` before treating the processing run as finished. `progress_percent` is stage-based progress, not a prediction of remaining time.

## Endpoints

### GET /api/config

Returns fixed server configuration. It does not validate the API key or contact Gemini.

HTTP 200 example:

```json
{
  "config": {
    "geminiModel": "gemini-4-hydrogen",
    "maxVideoDurationSeconds": 1800,
    "maxUploadSizeMb": 2000,
    "vadThreshold": 0.5,
    "minAdGapMs": 3000,
    "analysisBatchSeconds": 240,
    "contextBeforeSeconds": 20,
    "contextAfterSeconds": 10
  }
}
```

The fallback model is `gemini-3.5-flash-lite`. It is not returned by this endpoint.

### GET /api/jobs

Returns `{ jobs }` for readable saved jobs and recognizable unfinished uploads. Items are sorted by `updated_at`, most recent first. Each item contains `job_id`, `file_name`, `updated_at`, `size_bytes`, `is_upload`, and `is_processing`; saved jobs also carry `title`, `mode`, and `status`. An active upload has both `is_upload` and `is_processing` set. There is no active job: the browser opens the job named in its `/jobs/:jobId` URL.

### GET /api/jobs/:jobId

Returns HTTP 200 with `{ job, isRunning }`. The browser loads the job named in its `/jobs/:jobId` URL from this route and polls it during background analysis.

An unknown or unreadable job returns HTTP 404:

```json
{
  "error": "ไม่พบข้อมูลงานประมวลผลนี้บนเซิร์ฟเวอร์"
}
```

### GET /api/jobs/:jobId/video

Streams the job's server copy (`video_source.local_file_path`, normally `.data/jobs/<jobId>/source_video.mp4`). Jobs whose `video_source.kind` is not `server_copy` return HTTP 404.

| Request | Response |
|---|---|
| No `Range` header | HTTP 200, full file, `Content-Type: video/mp4`, and `Content-Length` |
| Valid single range such as `Range: bytes=0-1023` or `Range: bytes=1024-` | HTTP 206 with `Content-Range`, `Accept-Ranges: bytes`, `Content-Length`, and `Content-Type: video/mp4` |
| Missing job, local path, or source file | HTTP 404 with a JSON error |

The handler does not validate malformed ranges or implement a documented HTTP 416 response. Suffix ranges and multiple ranges are not supported by its parser.

### POST /api/upload/init

Creates `.data/jobs/<uploadId>/source_video.mp4` as an empty file. This creates an upload directory, not a persisted job.

JSON request example:

```json
{
  "fileName": "lecture_480p.mp4",
  "fileSize": 154820000
}
```

HTTP 200 example, with an illustrative ID:

```json
{
  "uploadId": "job_demo",
  "fileName": "lecture_480p.mp4",
  "fileSize": 154820000
}
```

`fileName` defaults to `video.mp4`. Characters outside `[a-zA-Z0-9._-]` become `_` in the response. `fileSize` must be a positive integer no larger than 2,000 MiB. The handler ignores `totalChunks`. Invalid input returns HTTP 400; initialization failures return HTTP 500.

### POST /api/upload/chunk

Writes raw bytes at the requested byte offset. The browser sends chunks sequentially at 8 MiB each. The request limit is 25 MiB and the total file limit is 2,000 MiB.

- Query parameter `uploadId` identifies the upload. Header `x-upload-id` is the fallback when the query parameter is absent.
- Query parameter `offset` is the nonnegative byte offset of the chunk.
- `Content-Type` must be `application/octet-stream`.
- The body contains binary bytes.
- The handler ignores `chunkIndex` and `totalChunks`. It rejects offsets beyond the current file and checks bytes that overlap existing data. Repeating an identical chunk is safe, including after a partial write. Conflicting bytes return HTTP 409.
- The route rejects writes to an upload that already has a saved job.

HTTP 200 example after an 8 MiB chunk:

```json
{
  "ok": true,
  "currentSize": 8388608
}
```

| Status | Condition |
|---|---|
| 400 | Missing upload ID, empty body, or body not parsed as a binary buffer |
| 404 | Upload directory not found |
| 409 | Offset skips ahead, bytes conflict, or a job already exists |
| 413 | Body or total file size exceeds the limit |
| 500 | File write failure |

Job initialization uses the accumulated file. An unfinished upload can be removed through the storage API after its session is abandoned.

### POST /api/upload/:uploadId/abandon

Marks an upload session as no longer active without deleting its files. The browser sends this after completion, failure, or cancellation when it knows the upload ID. Sessions exist in server memory and are cleared on restart. A lost initialization response or browser termination can leave a session marked active until the server restarts.

### POST /api/jobs/init

Registers a job from an uploaded file and VAD output. An optional `title` sets the Job Title; blank or missing uses the video file name without its extension, and more than 120 characters returns HTTP 400. Candidate spots become `pending` spots. The server groups them into 240-second timeline batches by spot start time and omits empty time buckets. Batch windows include 20 seconds before and 10 seconds after, extend to cover a spot crossing a batch boundary, and stay within the video duration.

The browser uses a JSON request with `uploadId`:

```json
{
  "uploadId": "job_demo",
  "video_metadata": {
    "fileName": "scene.mp4",
    "fileSize": 52428800,
    "mimeType": "video/mp4",
    "width": 854,
    "height": 480,
    "durationMs": 180000,
    "videoCodec": "avc1.64001f",
    "audioCodec": "mp4a.40.2",
    "hasAudioTrack": true
  },
  "vad_config": {
    "speechThreshold": 0.5,
    "minSpeechDurationMs": 250,
    "minSilenceDurationMs": 400,
    "speechPaddingMs": 200,
    "minAdGapMs": 3000
  },
  "ad_settings": {
    "contentGenre": "auto_cinema",
    "narrationPaceCharsPerSec": 11.5,
    "safetyBufferMs": 250,
    "avoidCameraJargon": true,
    "prioritizeCharacterActions": true
  },
  "vad_output": {
    "duration_ms": 180000,
    "speech_segments": [
      { "start_ms": 1000, "end_ms": 4500 }
    ],
    "candidate_spots": [
      {
        "spot_id": "spot_001",
        "start_ms": 4700,
        "end_ms": 12500,
        "duration_ms": 7800
      }
    ]
  }
}
```

`video_metadata`, `vad_config`, and `vad_output` are expected. Each can be a JSON object or a JSON-encoded string. `ad_settings` is optional and defaults to the values in the example. Supported `contentGenre` values are `auto_cinema`, `drama_series`, `documentary`, and `action_thriller`.

The route also accepts `multipart/form-data` with one file field named `video` and JSON-encoded text fields for the metadata, VAD configuration, VAD output, and optional analysis settings. Multer limits the file to 2,000 MiB. The browser's current workflow uses chunked upload instead.

| Status | Result |
|---|---|
| 200, candidates present | `{ job, isRunning: true }`. Initial job status is `ANALYZING`, progress is 8, and Gemini upload and sequential analysis start in the background |
| 200, no candidates | `{ job, isRunning: false }`. Status is `READY`, progress is 100, and Gemini is not called |
| 400 | No uploaded file or the chunked upload file is empty |
| 409 | An active processing lock blocks initialization |
| 401, 429, or 500 | Classified initialization or Gemini client errors, after status sanitization |

The server checks for `GEMINI_API_KEY` before saving a job with candidate spots. A missing key currently returns HTTP 500. Background failures appear later in the persisted job's status and `error_message`. A failed initialization can leave uploaded files on disk.

### POST /api/jobs/review

Registers a Review Mode job: an existing SRT script plus the browser's VAD output, with no video stored on the server. The body has `video_metadata`, `vad_config`, `vad_output` (as in job initialization), `video_source` (`{ kind: "url", url }` with an `http(s)` URL, or `{ kind: "local_file", file_name, file_size }`), `srt_source` (`{ file_name, cue_count }`), a non-empty `spots` array built from the SRT cues, and an optional `title` handled as in job initialization. Each spot must start before the video ends, end after it starts, have `duration_ms` equal to `end_ms - start_ms`, and have original times equal to its imported times. Spots may overlap speech or each other. Review Mode accepts any resolution, video codec, and file size, up to 3,600,000 ms; an AAC audio track is still required.

HTTP 200 returns `{ job, isRunning: false }` with `mode: "review"`, `status: "READY"`, `batches: []`, and `srt_source.imported_at`. Invalid input returns HTTP 400. Review Mode does not wait for another job's Gemini analysis.

### POST /api/jobs/:jobId/start

Starts or resumes background processing. Review Mode jobs return HTTP 409. No request body is required. The server resets failed or interrupted batches for another attempt and skips completed batches.

- HTTP 200 returns `{ job, isRunning: true }` when background work starts.
- If the same job already holds the lock, HTTP 200 returns its current state with `isRunning: true` without starting another runner.
- If all batches are completed and the job still has a Gemini file name, HTTP 200 returns `{ job, isRunning: true }` and retries deletion in the background. The server skips analysis and keeps the job `READY`.
- If all batches are completed and the job has no Gemini file name, HTTP 200 returns `{ job, isRunning: false }` with status `READY` and progress 100. The API key check still runs first in both cases.
- HTTP 404 means that the job was not found.
- HTTP 409 means that another job holds the lock. The error reads `มีงานอื่นกำลังวิเคราะห์อยู่ ลองใหม่เมื่อเสร็จ`.
- Classified client errors return HTTP 401, 429, or 500 with `error`.

On backend restart, recovery applies to every saved job. It changes interrupted batches from `processing` to `pending` and changes a job in `ANALYZING` to `VAD_READY`. Startup does not automatically call Gemini. This endpoint resumes the work. An expired or unavailable Gemini file can be uploaded again from the local MP4.

### POST /api/jobs/:jobId/analyze-batch

Analyzes one batch synchronously. This is a fallback route. The current browser uses background processing and polling.

Optional JSON body:

```json
{
  "batch_id": "batch_001"
}
```

If the same job is already processing, the request waits for it to finish before reloading the job and selecting a batch. If no ID is supplied, the route selects the first batch that is not completed. A successful selected batch returns HTTP 200 with `{ job, batch }`. An explicitly selected completed batch returns its saved result without calling Gemini. When an incomplete batch is analyzed, its spots receive new AI decisions, text, and reasons, and their times reset to the original gap boundaries. This can replace manual edits for that batch. The existing `is_edited` flag is retained.

If no batch matches, including an unknown explicit `batch_id`, the route sets the job status to `READY` and returns HTTP 200 with `{ job }`.

HTTP 404 means that the job was not found. HTTP 409 means that another job holds an active lock. Analysis failures return HTTP 401, 429, or 500 with `error`, `isRateLimit`, `job`, and `batch` after persisting the failed state. If the failed state cannot be saved, the route returns HTTP 500 with `error` only.

### PATCH /api/jobs/:jobId

Renames a job. The body is `{ "title": "…" }`; the title is trimmed and must be 1 to 120 characters. HTTP 200 returns `{ job }`. A blank or too-long title returns HTTP 400 and an unknown job returns HTTP 404. A rename during analysis is kept: background saves never change the title.

### PATCH /api/jobs/:jobId/spots

Replaces the job's entire `spots` array and saves the job. This endpoint does not merge individual entries. A request that omits existing spots removes those entries from the saved array.

The following request represents the complete array for a job with one spot:

```json
{
  "spots": [
    {
      "spot_id": "spot_001",
      "start_ms": 5000,
      "end_ms": 12000,
      "duration_ms": 7000,
      "decision": "generate",
      "text": "หญิงสาวเปิดประตูห้องสมุดแล้วก้าวเข้ามา",
      "reason": "",
      "is_edited": true,
      "original_start_ms": 4700,
      "original_end_ms": 12500
    }
  ]
}
```

The route checks that `spots` is an array and calls `validateSpotTimestampEdit` for every entry. For Review Mode jobs it skips that check for spots whose `start_ms` and `end_ms` match the saved job, so text or decision edits on imported lines always save; a retimed Review Mode spot must stay inside the video, last at least 500 ms, and not overlap another spot that is not `skip`, and it may overlap speech. For Generate Mode the timestamp checks require:

- Start and end values that pass the helper's `isNaN` check and fall within the video duration, with a nonnegative start and an end after the start. This is not a strict numeric-type check.
- A duration of at least 500 ms, calculated as `end_ms - start_ms`.
- Times within the submitted `original_start_ms` and `original_end_ms`, with 1 ms tolerance.
- No overlap with speech segments in the persisted VAD output.

The route validates each spot's fields, requires the same set of unique IDs as the saved job, checks original boundaries against stored values, and requires `duration_ms` to match the submitted times. HTTP 200 returns `{ job }`. An unknown job returns HTTP 404. Invalid spots or failed timestamp checks return HTTP 400 with `error`.

The browser serializes saves and shows success only after receiving an acknowledgement for the job. When a user changes `skip` to `generate`, the editor keeps existing text. If that text is blank, it uses `reason` as the starting text. Changing back to `skip` retains the text. This text selection happens in the browser, not in this endpoint.

### DELETE /api/jobs/:jobId/files

Permanently deletes a saved job directory and its video, or a recognizable unfinished upload. HTTP 200 returns `{ ok: true }`. The route returns HTTP 404 for an unknown or unsafe path, HTTP 409 while the job is being analysed or uploaded, and HTTP 500 if storage cannot be read. A job open in another tab can be deleted; that tab's next save fails. There is no automatic deletion.

## Validation boundaries

In Generate Mode the browser checks MP4 structure, H.264 codec, an audio codec with an `mp4a` prefix, 480-pixel height, a maximum duration of 1,800 seconds, and a file size of at most `2000 × 1024 × 1024` bytes. In Review Mode it requires only an MP4 with an AAC audio track and a duration of at most 3,600 seconds. Its WebCodecs support check uses the track codec for `mp4a.40.*` and substitutes `mp4a.40.2` for other `mp4a` values.

`POST /api/jobs/review` checks that the VAD duration matches the video duration within one second and that spot IDs are unique and spot times are consistent and inside the audio. Job initialization validates the declared video metadata, file size, VAD settings, speech segments, and candidate spots. It checks candidate IDs, durations, ranges, and speech overlaps. It checks the uploaded byte count against the declared size and limits uploads to 2,000 MiB. The server does not inspect the uploaded MP4 to verify its declared codecs or dimensions; browser validation remains necessary.

Gemini output passes through `GeminiBatchResponseSchema`. Every expected spot must be present. A `generate` result must contain nonblank text. Results with unknown spot IDs are ignored. A `skip` result can contain a reason, and returned text is retained if present. The prompt currently requests empty text for skipped spots.

## Errors

Most errors return an object with `error`. Depending on the route, the object can also contain `isRateLimit`, `job`, or `batch`. The final Express error handler includes `code` when provided by the error, otherwise `SERVER_ERROR`. An unmatched API route returns HTTP 404 with `code: "NOT_FOUND"`.

Example for an unmatched route:

```json
{
  "error": "ไม่พบ API Endpoint (GET /api/unknown)",
  "code": "NOT_FOUND"
}
```

## Export formats

SRT downloads are produced in the browser by [src/utils/formatters.ts](../src/utils/formatters.ts). There are no export API routes.

- SRT includes only `generate` spots with nonblank text, sorted by start time.
