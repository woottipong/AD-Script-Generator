# 04: ย้าย Job store ไปเก็บใน SQLite

Status: resolved

Blocked by: 01, 03

อ้างอิง: [spec](../spec.md) หัวข้อ "Storage layout", "Schema" และ `src/utils/jobStore.ts` และ [ADR-0003](../../../docs/adr/0003-sqlite-job-store-and-url-addressed-jobs.md)

**What to build:** เปลี่ยนที่เก็บ Job จาก `job.json` เป็น `.data/envisio.db` (ผ่าน `node:sqlite`) แล้วแยก VAD output เป็นไฟล์ `vad_output.json` ที่เขียนครั้งเดียว ผู้ใช้ต้องไม่เห็นความแตกต่างใดๆ และ API contract ไม่เปลี่ยน ไม่ต้องย้ายข้อมูลเก่า ให้ล้าง `.data` ทิ้งก่อนเริ่ม

- [x] `createJobStore(dataDir)` รับ `.data` แล้วเปิด DB ด้วย PRAGMA และ schema ตาม spec (ตาราง `jobs` ที่มี `title` และตาราง `job_spots`)
- [x] `save` เขียน `vad_output.json` แบบ atomic เฉพาะตอนที่ไฟล์ยังไม่มีหรือส่ง `overwriteVad` มา แล้วใน transaction เดียว upsert `jobs` และเขียน `job_spots` ใหม่ทั้งชุดตามลำดับใน array ถ้า error ให้ rollback แล้ว throw
- [x] `load` คืน `null` เมื่อไม่มีแถว หรือ `vad_output.json` หายหรือเสีย ส่วน `loadMeta` อ่านแค่แถวใน `jobs` และใช้ใน `GET /api/jobs/:jobId/video`
- [x] เพิ่ม `exists` (ใช้ใน `POST /api/upload/chunk` แทนการเช็ค `job.json`), `rename`, `deleteJob` (ลบแถวก่อนแล้วค่อยลบโฟลเดอร์) และ `close` แล้วลบ `filesDir` ออก
- [x] `list` query จาก DB รวมกับ Unfinished Upload ที่ได้จากการสแกน `jobsDir` และคงการกัน symlink หรือ path traversal ไว้
- [x] `server.ts` เปิด store ที่ `.data` และดัก `SIGINT` กับ `SIGTERM` แล้วเรียก `store.close()`
- [x] `jobStore.test.ts` ครอบ 5 กลุ่มตามหัวข้อ Tests ใน spec และเรียก `store.close()` หลังจบ test
- [x] `npm run lint`, `node --test src/utils/*.test.ts` และ browser tests ทั้งหมดผ่าน
- [x] คำสั่ง `docker run` ของ production ใน README mount `.data` ทั้งโฟลเดอร์ และ `docs/agents/system-constraints.md` กับ README อธิบาย storage layout ใหม่ รวมถึงการบันทึก spot แบบใครบันทึกทีหลังชนะ
- [x] รันใน Docker (`node:22-slim`): สร้างงาน Generate Mode หนึ่งงานและ Review Mode หนึ่งงาน restart container แล้วงานยังอยู่ใน Job List ลบงานแล้วไม่มี `.tmp` หรือแถวกำพร้าเหลือ

## Comments

- Implementation deviation: `save(job, { overwriteVad })` was not built. No caller changes VAD output after creation (a rescan creates a new Job), so `save` writes `vad_output.json` only on the first save.
- Fixes from review:
  - If the first save fails, the VAD file just written is removed, so no orphan file is left.
  - `deleteJob` deletes the folder before the row.
  - `load` returns null only when the VAD file is missing or broken; database errors propagate as a 500.
  - `busy_timeout` is set before the other PRAGMAs.
  - Startup recovery doesn't block startup when storage can't be read.
- The local Bun is 1.3.9, which lacks `node:sqlite`, so `bun test` runs in the dev container (Bun 1.4.4): 92 pass.
- Docker check on a production image (`node:22-slim`, Node 22.23.5) with a temporary `.data`: created one Generate Mode Job and one Review Mode Job, restarted the container, and both were still there with titles and spots intact. After deleting them, nothing was left in `jobs/` (no `.tmp`, no orphan rows).
- Not yet verified: `review-mode-url.js`, which needs a real external video link.
