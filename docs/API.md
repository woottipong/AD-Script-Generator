# AD Script Generator API reference

This document describes the HTTP REST API exposed by the AD Script Generator backend in `server.ts`.

## Base configuration and conventions

- Default base URL: `http://localhost:3000/api`
- Content type: `application/json` (except `/api/jobs/:jobId/video` for MP4 streaming and `/api/upload/chunk` for binary chunk uploads)
- Concurrency model: Single-job processing lock (`activeProcessingLock`). Only one Gemini analysis job runs at a time. Requests to start analysis while another job runs return HTTP 409.
- Status code sanitization: To prevent Nginx or Cloud Run reverse proxies from intercepting error responses and replacing JSON bodies with HTML pages, the server remaps HTTP 403 to 401, and HTTP 502, 503, and 504 to 500.

---

## Endpoints

### 1. Get server configuration

Returns fixed server thresholds, models, and active job existence.

- Method: `GET`
- Path: `/api/config`
- Headers: None required
- Success response (HTTP 200):

```json
{
  "config": {
    "geminiModel": "gemini-3.8-flash",
    "maxVideoDurationSeconds": 1800,
    "maxUploadSizeMb": 2000,
    "vadThreshold": 0.5,
    "minAdGapMs": 3000,
    "analysisBatchSeconds": 120,
    "contextBeforeSeconds": 20,
    "contextAfterSeconds": 10
  },
  "hasActiveJob": false
}
```

---

### 2. Get active job state

Returns the latest persisted job state stored in `.data/jobs/active_job.json`.

- Method: `GET`
- Path: `/api/jobs/current`
- Headers: None required
- Success response when active job exists (HTTP 200):

```json
{
  "job": {
    "job_id": "job_1794484155216_b24f1ab6",
    "created_at": "2026-11-12T13:09:15.216Z",
    "updated_at": "2026-11-12T13:12:40.100Z",
    "status": "READY",
    "video_metadata": {
      "fileName": "sample_480p.mp4",
      "fileSize": 152978,
      "mimeType": "video/mp4",
      "width": 854,
      "height": 480,
      "durationMs": 15000,
      "videoCodec": "avc1.64001f",
      "audioCodec": "mp4a.40.2",
      "hasAudioTrack": true
    },
    "batches": [],
    "spots": []
  },
  "isRunning": false
}
```

- Success response when no job exists (HTTP 200):

```json
{
  "job": null,
  "isRunning": false
}
```

---

### 3. Get specific job state

Returns state for a given `jobId`. Polled by the client while analysis runs.

- Method: `GET`
- Path: `/api/jobs/:jobId`
- Headers: None required
- Success response (HTTP 200):

```json
{
  "job": { ... },
  "isRunning": true
}
```

- Error response (HTTP 404):

```json
{
  "error": "ไม่พบข้อมูลงานประมวลผลนี้บนเซิร์ฟเวอร์"
}
```

---

### 4. Stream source video

Streams the local copy of the MP4 video stored in `.data/jobs/<jobId>/source_video.mp4`. Supports HTTP 206 partial content range requests for timeline seeking.

- Method: `GET`
- Path: `/api/jobs/:jobId/video`
- Headers: Optional `Range: bytes=start-end`
- Response:
  - HTTP 206: Returns binary video slice with `Content-Range`, `Accept-Ranges: bytes`, `Content-Length`, `Content-Type: video/mp4`.
  - HTTP 200: Returns full video stream if no `Range` header provided.
  - HTTP 404: Returns JSON error if video file is missing.

---

### 5. Initialize chunked upload

Creates a dedicated job directory under `.data/jobs/<uploadId>` and prepares an empty `source_video.mp4` file.

- Method: `POST`
- Path: `/api/upload/init`
- Headers: `Content-Type: application/json`
- Request body:

```json
{
  "fileName": "lecture_480p.mp4",
  "fileSize": 154820000,
  "totalChunks": 19
}
```

- Success response (HTTP 200):

```json
{
  "uploadId": "job_1794489000000_a1b2c3d4",
  "fileName": "lecture_480p.mp4",
  "fileSize": 154820000
}
```

---

### 6. Append upload chunk

Appends a binary slice to `source_video.mp4`. Recommended chunk size is 8 MB. Maximum payload limit is 25 MB.

- Method: `POST`
- Path: `/api/upload/chunk?uploadId=<uploadId>`
- Query parameter: `uploadId` (or header `x-upload-id`)
- Headers: `Content-Type: application/octet-stream`
- Request body: Raw binary bytes
- Success response (HTTP 200):

```json
{
  "ok": true,
  "currentSize": 8388608
}
```

- Error responses:
  - HTTP 400: Missing `uploadId` or empty body.
  - HTTP 404: Upload directory not found.
  - HTTP 500: Disk write failure.

---

### 7. Initialize job and start analysis

Registers a job with metadata and VAD output, builds 120-second timeline batches, and triggers background Gemini analysis.

- Method: `POST`
- Path: `/api/jobs/init`
- Headers: `Content-Type: application/json`
- Request body:

```json
{
  "uploadId": "job_1794489000000_a1b2c3d4",
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

- Success response (HTTP 200):

```json
{
  "job": {
    "job_id": "job_1794489000000_a1b2c3d4",
    "status": "ANALYZING",
    "batches": [ ... ],
    "spots": [ ... ],
    "progress_percent": 8,
    "progress_stage": "กำลังเตรียมส่งไฟล์วิดีโอไปยัง Gemini Files API..."
  },
  "isRunning": true
}
```

- Error response when another job is running (HTTP 409):

```json
{
  "error": "ขณะนี้ระบบกำลังประมวลผลอีกงานหนึ่งอยู่ (job_...) กรุณารอให้งานปัจจุบันเสร็จสิ้นก่อน"
}
```

---

### 8. Resume incomplete job analysis

Resumes unfinished batches for an existing job.

- Method: `POST`
- Path: `/api/jobs/:jobId/start`
- Headers: `Content-Type: application/json`
- Success response (HTTP 200): Returns updated job state with `isRunning: true`.
- Error response (HTTP 404): Job ID not found.
- Error response (HTTP 409): Another job is currently being processed.

---

### 9. Analyze single batch synchronously

Legacy or fallback endpoint to analyze a single batch synchronously.

- Method: `POST`
- Path: `/api/jobs/:jobId/analyze-batch`
- Headers: `Content-Type: application/json`
- Request body:

```json
{
  "batch_id": "batch_001"
}
```

- Success response (HTTP 200):

```json
{
  "job": { ... },
  "batch": { ... }
}
```

---

### 10. Update spot scripts and timestamps

Saves user edits (script text, decision changes, or timestamp adjustments) to `.data/jobs/<jobId>/job.json`.

- Method: `PATCH`
- Path: `/api/jobs/:jobId/spots`
- Headers: `Content-Type: application/json`
- Request body:

```json
{
  "spots": [
    {
      "spot_id": "spot_001",
      "start_ms": 5000,
      "end_ms": 12000,
      "duration_ms": 7000,
      "decision": "generate",
      "text": "หญิงสาวเปิดประตูห้องสมุดแล้วก้าวเข้ามาอย่างช้าๆ",
      "reason": "",
      "is_edited": true,
      "original_start_ms": 4700,
      "original_end_ms": 12500
    }
  ]
}
```

- Validation rules enforced by the server:
  - Adjusted `start_ms` and `end_ms` must remain within `original_start_ms` and `original_end_ms` (1 ms rounding tolerance).
  - Adjusted interval must not overlap any speech segment in `vad_output.speech_segments`.
  - Adjusted duration (`end_ms - start_ms`) must be at least 500 ms.
- Success response (HTTP 200):

```json
{
  "job": { ... }
}
```

- Validation error response (HTTP 400):

```json
{
  "error": "Spot spot_001: เวลาทับซ้อนกับช่วงที่มีเสียงพูด (00:00:01.000 – 00:00:04.500)"
}
```

---

### 11. Clear active job pointer

Removes `.data/jobs/active_job.json` if it matches the specified `jobId`. Does not delete the job folder itself.

- Method: `DELETE`
- Path: `/api/jobs/:jobId`
- Success response (HTTP 200):

```json
{
  "ok": true
}
```
