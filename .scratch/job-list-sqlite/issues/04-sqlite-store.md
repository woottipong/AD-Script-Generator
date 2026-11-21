# 04: ย้าย Job store ไปเก็บใน SQLite

Status: ready-for-agent

Blocked by: 01, 03

อ้างอิง: [spec](../spec.md) หัวข้อ "Storage layout", "Schema" และ `src/utils/jobStore.ts` และ [ADR-0003](../../../docs/adr/0003-sqlite-job-store-and-url-addressed-jobs.md)

**What to build:** เปลี่ยนที่เก็บ Job จาก `job.json` เป็น `.data/envisio.db` (ผ่าน `node:sqlite`) แล้วแยก VAD output เป็นไฟล์ `vad_output.json` ที่เขียนครั้งเดียว ผู้ใช้ต้องไม่เห็นความแตกต่างใดๆ และ API contract ไม่เปลี่ยน ไม่ต้องย้ายข้อมูลเก่า ให้ล้าง `.data` ทิ้งก่อนเริ่ม

- [ ] `createJobStore(dataDir)` รับ `.data` แล้วเปิด DB ด้วย PRAGMA และ schema ตาม spec (ตาราง `jobs` ที่มี `title` และตาราง `job_spots`)
- [ ] `save` เขียน `vad_output.json` แบบ atomic เฉพาะตอนที่ไฟล์ยังไม่มีหรือส่ง `overwriteVad` มา แล้วใน transaction เดียว upsert `jobs` และเขียน `job_spots` ใหม่ทั้งชุดตามลำดับใน array ถ้า error ให้ rollback แล้ว throw
- [ ] `load` คืน `null` เมื่อไม่มีแถว หรือ `vad_output.json` หายหรือเสีย ส่วน `loadMeta` อ่านแค่แถวใน `jobs` และใช้ใน `GET /api/jobs/:jobId/video`
- [ ] เพิ่ม `exists` (ใช้ใน `POST /api/upload/chunk` แทนการเช็ค `job.json`), `rename`, `deleteJob` (ลบแถวก่อนแล้วค่อยลบโฟลเดอร์) และ `close` แล้วลบ `filesDir` ออก
- [ ] `list` query จาก DB รวมกับ Unfinished Upload ที่ได้จากการสแกน `jobsDir` และคงการกัน symlink หรือ path traversal ไว้
- [ ] `server.ts` เปิด store ที่ `.data` และดัก `SIGINT` กับ `SIGTERM` แล้วเรียก `store.close()`
- [ ] `jobStore.test.ts` ครอบ 5 กลุ่มตามหัวข้อ Tests ใน spec และเรียก `store.close()` หลังจบ test
- [ ] `npm run lint`, `node --test src/utils/*.test.ts` และ browser tests ทั้งหมดผ่าน
- [ ] คำสั่ง `docker run` ของ production ใน README mount `.data` ทั้งโฟลเดอร์ และ `docs/agents/system-constraints.md` กับ README อธิบาย storage layout ใหม่ รวมถึงการบันทึก spot แบบใครบันทึกทีหลังชนะ
- [ ] รันใน Docker (`node:22-slim`): สร้างงาน Generate Mode หนึ่งงานและ Review Mode หนึ่งงาน restart container แล้วงานยังอยู่ใน Job List ลบงานแล้วไม่มี `.tmp` หรือแถวกำพร้าเหลือ
