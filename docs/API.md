# TCC Envisio API reference

This reference describes the routes in [server.ts](../server.ts). Request and response types are defined in [src/types/ad.ts](../src/types/ad.ts). Installation and startup commands are in the [README](../README.md#การรันโปรเจกต์).

## Base configuration and conventions

- The default base URL is `http://localhost:3000/api`. Express listens on `0.0.0.0:3000`, or on `PORT` when it is set.
- JSON requests use `Content-Type: application/json`. The JSON parser limit is 25 MiB. Upload chunks use `application/octet-stream`. Source video responses use `video/mp4`.
- Times ending in `_ms` and `video_metadata.durationMs` are milliseconds. Configuration fields ending in `Seconds` are seconds. File sizes are bytes. Size limits use `1024 × 1024` bytes per MiB.
- Every route except `GET /api/config` needs a signed-in Author: the browser sends the `envisio_session` cookie set by [sign-in](#sign-in-routes). Without a valid session, the route answers HTTP 401 with `code: "UNAUTHENTICATED"`.
- Ownership and access control: an Author reaches only Jobs they own (`owner_sub`) unless they have All-Jobs Access; every `/api/jobs/:jobId` route answers unauthorized or ownerless Jobs with HTTP 404 `{ "error": "ไม่พบงานนี้" }` (identical to a missing Job). Unfinished Uploads follow the same rule in memory until server restart: only the uploader or All-Jobs Access can write chunks, abandon, initialize a Job from `uploadId`, or delete (others receive the missing-upload response: HTTP 404 on chunk/abandon/delete, HTTP 400 on `POST /api/jobs/init`). After a restart, only All-Jobs Access can reach an Unfinished Upload. `GEMINI_API_KEY` authenticates server requests to Google, not requests to this API.
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
| `owner_sub`, `owner_email` | Optional Job Owner Keycloak `sub` and display email (absent on pre-auth Jobs) |
| `title` | The Job Title, 1 to 120 characters. Defaults to the video file name without its extension |
| `mode` | `generate` or `review` |
| `video_source` | Where the video lives: `{ kind: "server_copy", local_file_path }`, `{ kind: "url", url }`, or `{ kind: "local_file", file_name, file_size }`. Generate Mode jobs use `server_copy` |
| `srt_source` | Optional imported SRT details for Review Mode: `file_name`, `cue_count`, `imported_at` |
| `created_at`, `updated_at` | ISO timestamp strings |
| `status` | `IDLE`, `VIDEO_READY`, `DETECTING`, `VAD_READY`, `ANALYZING`, `READY`, or `FAILED` |
| `video_metadata` | File name, byte size, MIME type, width, height, duration, video codec, audio codec, and `hasAudioTrack`. Optional `sampleRate` and `channelCount` |
| `vad_config` | `speechThreshold`, `minSpeechDurationMs`, `minSilenceDurationMs`, `speechPaddingMs`, and `minAdGapMs` |
| `ad_settings` | Optional analysis settings. Defaults are listed under job initialization |
| `vad_output` | `duration_ms`, `speech_segments`, and `candidate_spots`. Optional `signal_analysis` contains acoustic measurements and the recommended VAD configuration. Optional `waveform` holds the Waveform Envelope as `sampleIntervalMs` (10 to 1000) and `peaksBase64` (base64 of one byte per bucket, at most 250,000 characters) |
| `batches` | Array of analysis batches |
| `spots` | Array of `ADSpot` objects |
| `gemini_file_uri`, `gemini_file_name`, `gemini_file_mime_type`, `gemini_file_expires_at` | Optional Gemini Files API metadata |
| `progress_stage`, `progress_percent`, `active_model`, `error_message` | Optional processing feedback |

An analysis batch contains `batch_index`, `batch_id`, `batch_start_ms`, `batch_end_ms`, `window_start_ms`, `window_end_ms`, `candidate_spots`, `status`, and `retry_count`. Its status is `pending`, `processing`, `completed`, or `failed`. A failed batch can include `error`.

An `ADSpot` contains `spot_id`, `start_ms`, `end_ms`, `duration_ms`, `decision`, `text`, `is_edited`, `original_start_ms`, and `original_end_ms`. Its decision is `pending`, `generate`, or `skip`. `reason` is optional.

The server reuses the Gemini file across batches. After the last batch or a processing failure, it attempts to delete the job's Gemini file before releasing the processing lock. A successful deletion or HTTP 404 clears the Gemini file metadata. Other deletion errors leave the analysis result and file reference intact. If deletion fails before a replacement upload, the job fails and can be retried. The server keeps the local MP4 for playback and re-upload.

`isRunning` indicates whether the process-local lock belongs to the job, including during Gemini file cleanup. The browser waits for `isRunning: false` before treating the processing run as finished. `progress_percent` is stage-based progress, not a prediction of remaining time.

## Sign-in routes

These routes live outside `/api` and answer with redirects, not JSON. See [ADR-0004](adr/0004-keycloak-sign-in-with-server-session-cookie.md).

- `GET /auth/login?returnTo=<path>` redirects to Keycloak (authorization code with PKCE `S256`). `returnTo` must be a path on this site; anything else becomes `/`. When Keycloak cannot be reached it answers HTTP 503 with an HTML page.
- `GET /auth/callback` finishes the sign-in, sets `envisio_session` (httpOnly, `SameSite=Lax`, `Secure` when `APP_URL` is https, 7 days, never extended), and redirects to `returnTo`. A sign-in older than ten minutes starts over; a failed one answers HTTP 400 with an HTML page.
- `GET /auth/logout` clears the session and redirects to Keycloak's end-session endpoint, which returns to `APP_URL`.
- Any other page requested without a session (a GET that accepts `text/html`) redirects to `/auth/login?returnTo=<that path>`.

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

### GET /api/me

Returns the signed-in Author as `{ email, name?, allJobs, accessGroups? }`; `name` comes from the token's `name` claim and is left out when Keycloak sends none, and `accessGroups` lists the `AUTH_ALL_JOBS_GROUPS` groups that grant All-Jobs Access (left out without it). `allJobs` is true when one of the Author's Keycloak groups is listed in `AUTH_ALL_JOBS_GROUPS`; it is read once at sign-in.

### GET /api/jobs

Returns `{ jobs }` for the signed-in Author's own saved Jobs; with All-Jobs Access it returns every saved Job and recognizable unfinished upload. Items are sorted by `updated_at`, most recent first. Each item contains `job_id`, `file_name`, `updated_at`, `size_bytes`, `is_upload`, `is_owner` (boolean derived server-side from the Job's `owner_sub` and the signed-in Author's `sub`, never exposing `owner_sub`; `false` for other Authors' Jobs, ownerless Jobs, and unfinished uploads), and `is_processing`; saved jobs also carry `title`, `mode`, `status`, `duration_ms`, `spot_count`, `owner_email` (null when the Job has no Job Owner), and optional `progress_percent` and `error_message`. An active upload has both `is_upload` and `is_processing` set. There is no active job: the browser opens the job named in its `/jobs/:jobId` URL.

### GET /api/jobs/:jobId

Returns HTTP 200 with `{ job, isRunning }`. The browser loads the job named in its `/jobs/:jobId` URL from this route.

With `?view=progress`, which the browser uses to poll during background analysis, `job` holds only `job_id`, `status`, `batches`, `spots`, and the optional `progress_stage`, `progress_percent`, `active_model`, and `error_message`; the server does not read the VAD output for it.

An unknown or unreadable job returns HTTP 404:

```json
{
  "error": "ไม่พบงานนี้"
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
| 400 | Missing or invalid `uploadId`, missing or invalid `offset`, empty body, or body not parsed as a binary buffer |
| 404 | Upload directory or `source_video.mp4` not found |
| 409 | Non-directory upload path, offset skips ahead, bytes conflict, or a job already exists |
| 413 | Body or total file size exceeds the limit |
| 500 | File write failure |

Job initialization uses the accumulated file. An unfinished upload can be removed through the storage API after its session is abandoned.

### POST /api/upload/:uploadId/abandon

Marks an upload session as no longer active without deleting its files (access follows the upload ownership rule in [Base configuration and conventions](#base-configuration-and-conventions)). A late chunk retry leaves an abandoned upload inactive and removable. The browser sends this after completion, failure, or cancellation when it knows the upload ID. Upload activity is tracked in memory and expires after five minutes of inactivity by default or when the server restarts.

Returns HTTP 200 `{ "ok": true }`, or HTTP 400 `{ "error": "..." }` if `uploadId` is invalid.

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

`video_metadata`, `vad_config`, and `vad_output` are expected. Each can be a JSON object or a JSON-encoded string. `ad_settings` is optional and defaults to the values in the example. Supported `contentGenre` values are `auto_cinema`, `drama_series`, `documentary`, and `action_thriller`. Optional `autoStart` (boolean or `"false"` string, default `true`) controls whether Gemini analysis starts immediately when candidates are present.

The route also accepts `multipart/form-data` with one file field named `video` and JSON-encoded text fields for the metadata, VAD configuration, VAD output, and optional analysis settings. Multer limits the file to 2,000 MiB. The browser's current workflow uses chunked upload instead.

| Status | Result |
|---|---|
| 200, candidates present | `{ job, isRunning: true }`. Initial job status is `ANALYZING`, progress is 8, and Gemini upload and sequential analysis start in the background (or `status: "VAD_READY"` and `isRunning: false` without starting Gemini when `autoStart` is `false`) |
| 200, no candidates | `{ job, isRunning: false }`. Status is `READY`, progress is 100, and Gemini is not called |
| 400 | No uploaded file, empty chunked upload file, invalid `uploadId`, existing job, malformed JSON, invalid metadata/VAD/settings schema, `fileSize` mismatch, or invalid `title` |
| 409 | An active processing lock blocks initialization (only checked when `autoStart` is not `false`) |
| 401, 429, or 500 | Classified initialization or Gemini client errors, after status sanitization |

The server checks for `GEMINI_API_KEY` before saving a job with candidate spots when `autoStart` is not `false`. A missing key currently returns HTTP 500. Background failures appear later in the persisted job's status and `error_message`. A failed initialization can leave uploaded files on disk.

### POST /api/jobs/review

Registers a Review Mode job: an existing SRT script plus the browser's VAD output, with no video stored on the server. The body has `video_metadata`, `vad_config`, `vad_output` (as in job initialization), `video_source` (`{ kind: "url", url }` with an `http(s)` URL, or `{ kind: "local_file", file_name, file_size }`), `srt_source` (`{ file_name, cue_count }`), a non-empty `spots` array built from the SRT cues, and an optional `title` handled as in job initialization. Each spot must start before the video ends, end after it starts, have `duration_ms` equal to `end_ms - start_ms`, and have original times equal to its imported times. Spots may overlap speech or each other. Review Mode accepts any resolution, video codec, and file size, up to 3,600,000 ms; an AAC audio track is still required.

HTTP 200 returns `{ job, isRunning: false }` with `mode: "review"`, `status: "READY"`, `batches: []`, and `srt_source.imported_at`. Invalid input returns HTTP 400. Review Mode does not wait for another job's Gemini analysis.

### POST /api/review/fetch-srt

Fetches a public Google Drive `.srt` link server-side for Review Mode intake without exposing an open URL proxy ([ADR-0005](adr/0005-google-drive-srt-server-fetch.md)). The JSON body requires `{ "url": "<Google Drive link>" }`, accepting `http(s)` URLs on `drive.google.com` or `drive.usercontent.google.com` (`/file/d/<id>`, `/open?id=`, `/uc?id=`, `/download?id=`). The server requests `https://drive.usercontent.google.com/download?id=<id>&export=download` with manual redirects (up to 2 hops strictly to allowlisted `https:` Google Drive/googleusercontent hosts), enforces a 15-second timeout and 5 MiB size limit (`5 × 1024 × 1024` bytes), decodes UTF-8 or Windows-874, validates cues with `parseSrt`, and derives `file_name` from `Content-Disposition` (fallback `drive-<id prefix>.srt`).

HTTP 200 returns `{ file_name, content, size_bytes, cue_count }`.

| Status | Condition |
|---|---|
| 400 | Missing/non-Drive URL, redirect to `accounts.google.com` or non-allowlisted host, HTTP 401/403 from Drive, `text/html` response, or unreadable/empty SRT content |
| 404 | Google Drive returned HTTP 404 |
| 413 | Response `Content-Length` or streamed body exceeds 5 MiB |
| 500 | Network failure, timeout, excessive redirects, or other non-2xx upstream status (remapped from 502 via `sanitizeApiStatusCode`) |

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

HTTP 404 means that the job was not found. HTTP 409 means that another job holds an active lock or the job is in Review Mode. Analysis failures return HTTP 401, 429, or 500 with `error`, `isRateLimit`, `job`, and `batch` after persisting the failed state. If the failed state cannot be saved, the route returns HTTP 500 with `error` only.

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

The route validates `spots` strictly with Zod via `validateEditedSpots` (requiring nonnegative finite integer timestamps, the same set of unique spot IDs as the saved job, original boundaries matching stored values, and `duration_ms === end_ms - start_ms`) before running `validateSpotTimestampEdit` per the mode-specific timing rules in [system constraints](agents/system-constraints.md#editing-and-validation-rules) (for Review Mode, timing is checked only for spots whose `start_ms` or `end_ms` changed). HTTP 200 returns `{ job }`. An unknown job returns HTTP 404. Invalid spots or failed timestamp checks return HTTP 400 with `error`.

The browser serializes saves and shows success only after receiving an acknowledgement for the job.

### DELETE /api/jobs/:jobId/files

Permanently deletes a saved job directory and its video, or a recognizable unfinished upload. HTTP 200 returns `{ ok: true }`. The route returns HTTP 404 for an unknown or unsafe path, HTTP 409 while the job is being analysed or uploaded, and HTTP 500 if storage cannot be read. A job open in another tab can be deleted; that tab's next save fails. There is no automatic deletion.

## Validation boundaries

Client-side media rules, shared spot timing rules, and Gemini response schema validation (`GeminiBatchResponseSchema`) live in [system constraints](agents/system-constraints.md).

On the server, `POST /api/jobs/review` checks that the VAD duration matches the video duration within one second, spot IDs are unique, and spot times are consistent and inside the video. `POST /api/jobs/init` validates the declared video metadata, file size against the uploaded byte count (up to 2,000 MiB), VAD settings, speech segments, and candidate spots (IDs, durations, ranges, and speech overlaps). The server does not inspect the uploaded MP4 to verify its declared codecs or dimensions; browser validation remains necessary.

## Errors

Without a valid session every route but `GET /api/config` answers HTTP 401 `{ "error": "กรุณาเข้าสู่ระบบอีกครั้ง", "code": "UNAUTHENTICATED" }`. Clients sign in again only on this `code`: other errors can also arrive as 401 because 403 is remapped (see above).

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
