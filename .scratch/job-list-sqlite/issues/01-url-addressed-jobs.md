# 01: เปิด Job จาก URL และเลิกใช้ active Job

Status: resolved

Blocked by: None (can start immediately)

อ้างอิง: [spec](../spec.md) หัวข้อ "การตัดสินใจที่ตกลงกันแล้ว" และ "API changes" และ [ADR-0003](../../../docs/adr/0003-sqlite-job-store-and-url-addressed-jobs.md)

**What to build:** server เลิกจำ active Job แล้วให้ URL เป็นตัวบอกว่าเปิดงานไหน ใบนี้ยังเก็บข้อมูลเป็น `job.json` เหมือนเดิม และหน้าแรก `/` ยังเป็นหน้าเลือกโหมดไปก่อน (Job List อยู่ในใบที่ 02) ผู้เขียนสร้างงานแล้ว URL จะเปลี่ยนเป็น `/jobs/:jobId` reload แล้วกลับมางานเดิม และเปิดสอง tab คนละงานได้โดยไม่แย่งกัน

- [x] `jobStore` ลบ `activeJobId`, `loadActive`, `clearActive`, ไฟล์ `active_job.json` และพารามิเตอร์ `activate` ของ `save`
- [x] ลบ `GET /api/jobs/current` และ `DELETE /api/jobs/:jobId` ตัด `hasActiveJob` ออกจาก `GET /api/config` และตัด `is_active` ออกจาก `GET /api/jobs`
- [x] `DELETE /api/jobs/:jobId/files` ตอบ 409 เฉพาะงานที่กำลังวิเคราะห์หรืออัปโหลด
- [x] `recoverOrphanedJobOnStartup` recover ทุกงานที่ `status = 'ANALYZING'` หรือมี batch ที่ `processing`
- [x] ข้อความ 409 ของ `POST /api/jobs/:jobId/start` ตอนมีงานอื่นวิเคราะห์อยู่เป็น "มีงานอื่นกำลังวิเคราะห์อยู่ ลองใหม่เมื่อเสร็จ"
- [x] `App.tsx` อ่าน route จาก `location.pathname` และฟัง `popstate` เมื่อเป็น `/jobs/:jobId` ให้โหลดด้วย `GET /api/jobs/:jobId` โดยใช้ logic restore เดิม ถ้าได้ 404 ให้แสดง "ไม่พบงานนี้" พร้อมลิงก์กลับ `/`
- [x] สร้างงานสำเร็จแล้ว `pushState` ไป `/jobs/:jobId` และปุ่ม "เริ่มงานใหม่" พากลับไป `/`
- [x] ถ้ายกเลิกหลังจาก server สร้าง Job ไปแล้ว ให้ลบ Job นั้นด้วย `DELETE /api/jobs/:jobId/files` ส่วนการเปลี่ยนวิดีโอหรือสแกนเสียงใหม่ให้ Job เดิมอยู่ต่อ
- [x] `jobSaveQueue.leave()` เลิกเรียก `DELETE` แต่ยังทิ้ง save ที่ค้างในคิว
- [x] `JobStorageManager` เลิกใช้ `is_active` และปุ่มลบกดไม่ได้เฉพาะงานที่กำลังประมวลผล
- [x] Unit test และ integration test (`jobStore.test.ts`, `jobStorage.integration.test.ts`, `jobBoundary.integration.test.ts`, `jobSaveQueue.test.ts`) เลิกใช้ active Job แล้วผ่านทั้งหมด
- [x] Browser test ทุกไฟล์ที่ mock `/api/jobs/current` เปลี่ยนไปเปิด `/jobs/:jobId` และมี case ที่ reload แล้วยังอยู่งานเดิม
- [x] `docs/API.md`, `docs/agents/system-constraints.md`, `AGENTS.md` (ส่วน Verification) และ README (ส่วน `active_job.json`) ตรงกับพฤติกรรมใหม่

## Comments

- Implementation deviations:
  - `jobSaveQueue.leave()` was deleted. Once it no longer sends `DELETE` it does exactly what `invalidate()` does, so callers use `invalidate()`.
  - `POST /api/jobs/review` no longer returns 409 while another Job is analysing, because Review Mode doesn't use Gemini and there are now several authors. `POST /api/jobs/init` still returns 409 and uses the same message as `/start`.
- Added to the original scope:
  - A loading state ("กำลังเปิดงาน…") and a "เปิดงานไม่สำเร็จ" state for non-404 failures, so errors aren't silent.
  - `resetWorkspace` also terminates the VAD worker, so back navigation can't let an old scan finish into the new view.
  - Startup recovery logs the error and carries on if storage can't be listed.
- Not yet verified: `review-mode-url.js`, which needs a real external video link.
