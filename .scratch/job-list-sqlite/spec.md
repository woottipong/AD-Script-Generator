# Job List และย้าย Job ไปเก็บใน SQLite

Status: ready-for-agent

ใช้คำตาม [GLOSSARY.md](../../GLOSSARY.md) (Job, Job Title, Job List, Unfinished Upload, Generate Mode, Review Mode, AD Spot, Analysis Batch) และการตัดสินใจใน [ADR-0003](../../docs/adr/0003-sqlite-job-store-and-url-addressed-jobs.md)

## เป้าหมายและเหตุผล

ตอนนี้ server เก็บ Job เป็น `job.json` และจำ active Job ได้ทีละงานสำหรับทุกคน ถ้ามีสองคนเปิดเว็บพร้อมกันก็จะแย่งงานกัน และผู้เขียนเปิดงานเก่าขึ้นมาทำต่อไม่ได้ งานนี้ย้าย Job ไปเก็บใน SQLite แล้วให้หน้าแรกเป็น Job List ผู้เขียนกดเปิดงานไหนก็ได้ และหลายคนหรือหลาย tab ทำงานคนละงานพร้อมกันได้ ฟีเจอร์ถัดไปคือ login ที่ผูก Job กับผู้ใช้

## Goals

- เข้าเว็บแล้วเจอ Job List ก่อนทุกครั้ง แต่ละแถวบอกว่างานคืออะไร แก้ล่าสุดเมื่อไร และมีปุ่มกดกลับไปทำต่อหรือลบ
- Job มี Job Title ที่ตั้งจากชื่อไฟล์วิดีโอเป็นค่าเริ่มต้น แก้ได้ตอนสร้างงานและเปลี่ยนชื่อทีหลังได้
- งานที่เปิดอยู่ถูกกำหนดด้วย URL `/jobs/:jobId` reload แล้วกลับมาที่งานเดิม และหลาย tab เปิดคนละงานได้โดยไม่กระทบกัน
- Job metadata, Analysis Batch และ AD Spot เก็บใน `.data/envisio.db` ส่วน VAD output เก็บใน `.data/jobs/<job_id>/vad_output.json`

## Non-goals

- ยังไม่ทำ login และยังไม่มี `user_id` หรือตาราง `user_active_jobs` (ทำในฟีเจอร์ login)
- ไม่ย้ายข้อมูลจาก `job.json` หรือ `active_job.json` เดิม ล้าง `.data` ทิ้ง และลบโค้ดอ่าน schema v1 (`upgrade()`) ออก
- ไม่มีช่องค้นหา ตัวกรอง หรือการแบ่งหน้าใน Job List
- ไม่ทำคิววิเคราะห์ Gemini เพราะยังวิเคราะห์ได้ทีละงานทั้ง server
- ไม่กันการแก้งานเดียวกันพร้อมกัน ใครบันทึกทีหลังชนะ (ดู ADR-0003)
- ไม่เพิ่ม dependency ทั้ง router และ SQLite package

## Anti-goals

- ห้ามให้ reload ระหว่างแก้งานเด้งกลับไปที่ Job List
- ห้ามเขียน `vad_output.json` ทับทุกครั้งที่บันทึก spot หรือสถานะ
- ห้ามให้ route อ่านหรือเขียนไฟล์ Job หรือ DB เอง ทุกอย่างต้องผ่าน `jobStore`
- ห้ามทำให้ขั้นตอนการเลือกโหมด, guided intake และสามขั้นตอนของ Generate Mode กับ Review Mode เปลี่ยนไป นอกจากจะเริ่มจาก `/new`

## การตัดสินใจที่ตกลงกันแล้ว

| เรื่อง        | การตัดสินใจ                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite driver       | `node:sqlite` ที่มาในตัว Node ใช้ได้ทั้งใน container (Node 22.23.5) และบนเครื่อง (Node 26) ยอมรับ ExperimentalWarning บน Node 22                                                                                                                          |
| VAD output          | ไฟล์แยก เขียนครั้งเดียวแบบ atomic (`.tmp` แล้ว rename) ก่อน commit DB ถ้าไฟล์หายหรืออ่านไม่ได้ `load` คืน `null`                                                                                                                    |
| Active Job          | ไม่มีแล้ว ใช้ URL บอกว่าเปิดงานไหน และ server ไม่มี pointer เก็บไว้                                                                                                                                                                                        |
| URL                 | `/` คือ Job List, `/new` คือหน้าเลือกโหมดและ intake, `/jobs/:jobId` คือ editor ใช้ `history.pushState` กับ `popstate` ตรงๆ ส่วน server ใช้ SPA fallback `app.get('*')` ที่มีอยู่                                                       |
| Job Title           | ค่าเริ่มต้นคือชื่อไฟล์วิดีโอที่ตัดนามสกุลออก ใช้ทั้งสองโหมด (Review Mode ใช้ชื่อวิดีโอ ไม่ใช่ชื่อ SRT) แก้ได้ในช่องของ intake และเปลี่ยนชื่อได้ใน header ของ editor             |
| แก้ล่าสุด  | ใช้ `updated_at` ตัวเดียว ซึ่งเปลี่ยนทุกครั้งที่บันทึก รวมถึงตอนบันทึกความคืบหน้าของ Gemini                                                                                                                                     |
| แถวใน Job List | Job Title, tag โหมด, ชื่อไฟล์วิดีโอตัวเล็ก, สถานะ, แก้ล่าสุด, ขนาดบนดิสก์, ปุ่ม "ทำต่อ" และ "ลบ" เรียงตาม `updated_at` ใหม่สุดก่อน                                                                               |
| Unfinished Upload   | แสดงเป็นแถว "อัปโหลดไม่เสร็จ" ที่มีปุ่มลบอย่างเดียว เหมือนพฤติกรรมเดิม                                                                                                                                                               |
| ลบงาน          | ห้ามลบเฉพาะงานที่กำลังวิเคราะห์ (`activeProcessingLock`) หรือกำลังอัปโหลด (`activeUploads`) ซึ่งตอบ 409 ลบได้แม้มี tab อื่นเปิดงานนั้นอยู่ tab นั้นจะเห็นว่าบันทึกไม่สำเร็จ        |
| Gemini หลายคน | คงล็อกเดิมไว้ ถ้ามีคนอื่นกำลังวิเคราะห์อยู่ตอบ 409 พร้อมข้อความ "มีงานอื่นกำลังวิเคราะห์อยู่ ลองใหม่เมื่อเสร็จ" และ Job List แสดงสถานะ "กำลังวิเคราะห์" ให้เห็น |
| ออกจาก editor | กลับไป Job List แล้วการวิเคราะห์ยังทำต่อบน server เพราะ server เป็นคนวน batch เอง                                                                                                                                                                     |
| เตรียม login  | ทุกการอ่าน Job ต้องผ่าน `store.list()` และ `store.load()` ฟีเจอร์ login จะเติมการกรองตาม owner ตรงนั้น                                                                                                                                         |

### จุดที่ตัดสินแทนผู้ใช้ (ทักท้วงได้)

- **ยกเลิกระหว่างสร้างงาน** (`token.aborted` หลังจาก server สร้าง Job ไปแล้ว ใน `App.tsx`): ลบ Job นั้นทิ้งด้วย `DELETE /api/jobs/:jobId/files` แทนการ detach เพื่อไม่ให้เกิดแถวใน Job List ที่ไม่มีใครตั้งใจสร้าง
- **เปลี่ยนวิดีโอหรือสแกนเสียงใหม่**: Job เดิมยังอยู่ใน Job List ให้ผู้เขียนลบเองได้ และ Job ใหม่ได้ URL ของตัวเอง
- **schema version**: เพิ่ม `JOB_SCHEMA_VERSION` เป็น `3` เพราะมี `title` เพิ่มเข้ามา ไม่ต้องมีโค้ดอ่านเวอร์ชันเก่า เพราะเริ่ม DB ใหม่
- **ตาราง `job_spots`**: ทำตาม `note.md` (เก็บแยกแถวพร้อม `position`) ทั้งที่ Job List ไม่ได้ใช้ตัวเลขนับ spot ถ้าอยากให้ง่ายกว่านี้ เปลี่ยนเป็น column `spots_json` ใน `jobs` ได้

## Storage layout

```text
.data/
├── envisio.db                 # SQLite (WAL)
└── jobs/
    └── <job_id>/
        ├── vad_output.json    # VADOutput เขียนครั้งเดียว
        └── source_video.mp4   # เฉพาะ video_source.kind === 'server_copy'
```

## Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,                  -- 'generate' | 'review'
  status TEXT NOT NULL,
  file_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  video_source_kind TEXT NOT NULL,     -- 'server_copy' | 'url' | 'local_file'
  video_source_json TEXT NOT NULL,
  video_metadata_json TEXT NOT NULL,
  vad_config_json TEXT NOT NULL,
  ad_settings_json TEXT,
  srt_source_json TEXT,
  batches_json TEXT NOT NULL,
  gemini_file_uri TEXT,
  gemini_file_name TEXT,
  gemini_file_mime_type TEXT,
  gemini_file_expires_at TEXT,
  progress_stage TEXT,
  progress_percent REAL,
  active_model TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at DESC);

CREATE TABLE IF NOT EXISTS job_spots (
  job_id TEXT NOT NULL,
  spot_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  decision TEXT NOT NULL,
  text TEXT NOT NULL,
  reason TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  original_start_ms INTEGER NOT NULL,
  original_end_ms INTEGER NOT NULL,
  PRIMARY KEY (job_id, spot_id),
  FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_spots_order ON job_spots(job_id, position);
```

`PersistedJobState` เพิ่ม `title: string` และ `schema_version` เปลี่ยนเป็น `3`

## API changes

แก้ [docs/API.md](../../docs/API.md) ตามรายการนี้

| Endpoint                                           | สิ่งที่เปลี่ยน                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/jobs/current`                          | **ลบออก** ให้ client โหลดงานด้วย `GET /api/jobs/:jobId` จาก URL แทน                                                                                                                                                                                                      |
| `DELETE /api/jobs/:jobId`                        | **ลบออก** (เดิมใช้ล้าง pointer) ลบ caller ใน `App.tsx` กับ `jobSaveQueue.leave()` ด้วย โดย `leave()` ยังคงหน้าที่ทิ้ง save ที่ค้างอยู่ในคิว                                                                                     |
| `GET /api/config`                                | ตัด `hasActiveJob` ออก                                                                                                                                                                                                                                                                            |
| `GET /api/jobs`                                  | แต่ละแถวเพิ่ม `title`, `mode`, `status` แล้วตัด `is_active` ออก field อื่นยังเหมือนเดิม (`job_id`, `file_name`, `updated_at`, `size_bytes`, `is_upload`, `is_processing`) แถว Unfinished Upload ไม่มี `title`, `mode`, `status` |
| `PATCH /api/jobs/:jobId`                         | **ใหม่** รับ body `{ title }` ตอบ `{ job }` ถ้า title ว่างหรือยาวเกิน 120 ตัวอักษรหลัง trim ตอบ 400 และถ้าไม่พบงานตอบ 404                                                                                                           |
| `POST /api/jobs/init`, `POST /api/jobs/review` | รับ `title` แบบไม่บังคับ ถ้าไม่ส่งมาหรือว่างหลัง trim ให้ server ใช้ชื่อไฟล์ที่ตัดนามสกุลออก และถ้ายาวเกิน 120 ตัวอักษรตอบ 400                                                                              |
| `DELETE /api/jobs/:jobId/files`                  | ตอบ 409 เฉพาะงานที่กำลังวิเคราะห์หรืออัปโหลด ไม่มีเงื่อนไข "งานปัจจุบัน" แล้ว                                                                                                                                                          |
| `POST /api/jobs/:jobId/start`                    | เปลี่ยนข้อความ 409 ตอนมีงานอื่นวิเคราะห์อยู่ตามตารางการตัดสินใจ                                                                                                                                                                                 |

ทุก error ยังต้องผ่าน `sanitizeApiStatusCode`

## สิ่งที่ต้องแก้

### `src/utils/jobStore.ts`

- `createJobStore(dataDir)` รับ `.data` แล้วเปิด `<dataDir>/envisio.db` และจัดการ `<dataDir>/jobs/<job_id>/`
- คง `isJobId` และการกัน symlink หรือ path traversal (`isInsideDataDir` เปลี่ยนไปเทียบกับ `jobsDir`)
- export: `dirOf`, `exists`, `loadMeta` (อ่านแค่แถวใน `jobs` ไม่อ่านไฟล์ VAD), `load`, `save(job, options?: { overwriteVad?: boolean })`, `rename(jobId, title)`, `list`, `deleteJob`, `close`
- ลบ `activeJobId`, `loadActive`, `clearActive`, `filesDir`, `upgrade` และพารามิเตอร์ `activate` ของ `save`
- `save`: ตั้ง `updated_at` เขียน `vad_output.json` ถ้ายังไม่มีไฟล์หรือส่ง `overwriteVad` มา จากนั้นใน transaction เดียว upsert `jobs` แล้วเขียน `job_spots` ใหม่ทั้งชุดตามลำดับใน array ถ้าเกิด error ให้ rollback แล้ว throw
- `list`: query จาก `jobs` เรียงตาม `updated_at DESC` คำนวณ `size_bytes` ของโฟลเดอร์งาน (ถ้าไม่มีโฟลเดอร์เป็น 0) แล้วรวมกับ Unfinished Upload จากการสแกน `jobsDir` แบบเดิม ผลรวมทั้งหมดเรียงตาม `updated_at`
- `deleteJob`: ถ้าไม่พบทั้งแถวใน `jobs` และไม่ใช่ Unfinished Upload ที่ปลอดภัย คืน `false` ถ้าพบให้ลบแถวก่อน (cascade ไปที่ `job_spots`) แล้วค่อย `fs.rmSync` โฟลเดอร์

### `server.ts`

- `createJobStore(path.resolve(process.cwd(), '.data'))`
- `recoverOrphanedJobOnStartup` เดิม recover แค่ active Job ให้เปลี่ยนเป็นทุกงานที่ `status = 'ANALYZING'` หรือมี batch ที่ `processing`
- `saveProcessingState` เรียก `store.save(job)` (ไม่มี `activate` แล้ว)
- `GET /api/jobs/:jobId/video` ใช้ `store.loadMeta`
- `POST /api/upload/chunk` เปลี่ยนจากเช็ค `job.json` เป็น `store.exists(uploadId)`
- เปลี่ยน route ทั้งหมดตามตาราง API changes
- ดัก `SIGINT` และ `SIGTERM` แล้วเรียก `store.close()`

### Frontend

- **`src/components/JobList.tsx` (ใหม่)**: หน้า `/` สร้างจาก shared classes ใน [DESIGN.md](../../DESIGN.md#components) มีปุ่ม "งานใหม่" ไป `/new` ถ้าไม่มีงานเลยให้แสดง empty state พร้อมปุ่มเดียวกัน ลบงานผ่าน `window.confirm` แบบเดิม แสดง loading และ error เหมือน `JobStorageManager` บนมือถือต้องอ่านได้และกดเปิดหรือลบได้
- **`src/App.tsx`**: อ่าน route จาก `location.pathname` แล้วฟัง `popstate` ถ้าเป็น `/jobs/:jobId` ให้โหลดด้วย `GET /api/jobs/:jobId` โดยใช้ logic restore เดิมจาก `/api/jobs/current` ถ้าได้ 404 ให้แสดง "ไม่พบงานนี้" พร้อมลิงก์กลับ Job List เมื่อสร้างงานสำเร็จให้ `pushState` ไป `/jobs/:jobId` ใน header ของ editor มีทางกลับไป Job List และช่องเปลี่ยน Job Title (บันทึกผ่าน `PATCH /api/jobs/:jobId` แล้วแสดงสถานะตามการตอบรับของ server)
- **Intake** (`UploadAndVadPanel.tsx`, `ReviewIntake.tsx`): เพิ่มช่อง "ชื่องาน" ที่เติมค่าจากชื่อไฟล์ให้เองเมื่อเลือกวิดีโอ ถ้าผู้ใช้แก้ช่องนี้แล้ว เลือกไฟล์ใหม่จะไม่ทับชื่อที่แก้ไว้
- **ลบ `JobStorageManager.tsx`** และที่ใช้ทั้ง 4 จุด (`ModeChooser`, `ReviewIntake`, `UploadAndVadPanel` สองจุด)
- **`src/utils/jobSaveQueue.ts`**: `leave()` ไม่เรียก `DELETE` แล้ว

### Docs

- `docs/agents/system-constraints.md` แก้หัวข้อ Data storage and persistence ตาม storage layout ใหม่ ตัดเรื่อง pointer ออก และเพิ่มว่าการบันทึก spot เป็นแบบใครบันทึกทีหลังชนะ
- `docs/API.md` แก้ตามตาราง API changes
- `README.md` แก้ส่วนที่อธิบาย `.data/jobs/*`, `active_job.json` และหน้าแรก **คำสั่ง `docker run` ของ production ต้อง mount `.data` ทั้งโฟลเดอร์** (`-v "$PWD/.data:/app/.data"`) ไม่อย่างนั้น `envisio.db` จะหายเมื่อลบ container
- `AGENTS.md` แก้ส่วน Verification ที่บอกว่า `DELETE /api/jobs/:jobId` จะ detach active Job
- `PRODUCT.md` แก้บรรทัด "หน้าแรกให้เลือกโหมด" เป็น Job List แล้วตามด้วยหน้าเลือกโหมด

## Tests

- `src/utils/jobStore.test.ts`: ใช้ temp `dataDir` และเรียก `store.close()` หลังจบ test แต่ละกลุ่ม ให้ครอบ:
  1. `save`, `load`, `loadMeta`, `exists`, `rename` ทั้ง Generate Mode และ Review Mode
  2. การบันทึก spots หรือ status ซ้ำไม่เขียน `vad_output.json` ใหม่ (mtime ต้องไม่เปลี่ยน)
  3. ถ้า `save` ล้มเหลวกลาง transaction แถวเดิมใน `jobs` และ `job_spots` ต้องไม่เปลี่ยน
  4. `load` คืน `null` เมื่อ `vad_output.json` หายหรือเสีย
  5. `list` เรียงถูก และรวม Unfinished Upload ส่วน `deleteJob` ลบงานปกติและ Unfinished Upload ได้ และปฏิเสธ symlink ที่ชี้ออกนอกโฟลเดอร์
- `src/utils/jobStorage.integration.test.ts`, `jobBoundary.integration.test.ts`: เอาการใช้ `/jobs/current` และ active Job ออก แล้วทดสอบ 409 เฉพาะงานที่กำลังวิเคราะห์หรืออัปโหลด
- เพิ่ม integration case: `PATCH /api/jobs/:jobId` ด้วย title ที่ถูกต้อง, title ว่าง และ jobId ที่ไม่มี
- `tests/browser/`: เปลี่ยน mock `/api/jobs/current` ใน `editor.js`, `job-lifecycle.js`, `resume-cancel.js`, `review-mode.js`, `review-mode-url.js`, `review-restore.js` ให้เปิด `/jobs/:jobId` แทน แล้วเปลี่ยน `job-storage.js` เป็น `job-list.js` ที่ครอบ: เข้า `/` เจอรายการ, กด "ทำต่อ" ไปที่ editor, reload แล้วยังอยู่งานเดิม, ปุ่ม back กลับรายการ, ลบงาน, ปุ่มลบของงานที่กำลังวิเคราะห์กดไม่ได้, และ empty state

## Verification checklist

1. `npm run lint` ต้องผ่านโดยไม่มี error
2. `node --test src/utils/*.test.ts` ต้องผ่านทั้งหมด
3. Browser tests ใน `tests/browser/` ต้องผ่านทั้งหมด (วิธีรันดูใน README)
4. รันใน Docker (`node:22-slim`): สร้างงาน Generate Mode หนึ่งงานและ Review Mode หนึ่งงาน restart container แล้วงานยังอยู่ใน Job List ลบงานแล้วไม่มี `.tmp` หรือแถวกำพร้าเหลือ และเปิดสอง tab คนละงานแล้วไม่รบกวนกัน
