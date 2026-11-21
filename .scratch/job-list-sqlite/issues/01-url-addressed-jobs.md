# 01: เปิด Job จาก URL และเลิกใช้ active Job

Status: ready-for-agent

Blocked by: None (can start immediately)

อ้างอิง: [spec](../spec.md) หัวข้อ "การตัดสินใจที่ตกลงกันแล้ว" และ "API changes" และ [ADR-0003](../../../docs/adr/0003-sqlite-job-store-and-url-addressed-jobs.md)

**What to build:** server เลิกจำ active Job แล้วให้ URL เป็นตัวบอกว่าเปิดงานไหน ใบนี้ยังเก็บข้อมูลเป็น `job.json` เหมือนเดิม และหน้าแรก `/` ยังเป็นหน้าเลือกโหมดไปก่อน (Job List อยู่ในใบที่ 02) ผู้เขียนสร้างงานแล้ว URL จะเปลี่ยนเป็น `/jobs/:jobId` reload แล้วกลับมางานเดิม และเปิดสอง tab คนละงานได้โดยไม่แย่งกัน

- [ ] `jobStore` ลบ `activeJobId`, `loadActive`, `clearActive`, ไฟล์ `active_job.json` และพารามิเตอร์ `activate` ของ `save`
- [ ] ลบ `GET /api/jobs/current` และ `DELETE /api/jobs/:jobId` ตัด `hasActiveJob` ออกจาก `GET /api/config` และตัด `is_active` ออกจาก `GET /api/jobs`
- [ ] `DELETE /api/jobs/:jobId/files` ตอบ 409 เฉพาะงานที่กำลังวิเคราะห์หรืออัปโหลด
- [ ] `recoverOrphanedJobOnStartup` recover ทุกงานที่ `status = 'ANALYZING'` หรือมี batch ที่ `processing`
- [ ] ข้อความ 409 ของ `POST /api/jobs/:jobId/start` ตอนมีงานอื่นวิเคราะห์อยู่เป็น "มีงานอื่นกำลังวิเคราะห์อยู่ ลองใหม่เมื่อเสร็จ"
- [ ] `App.tsx` อ่าน route จาก `location.pathname` และฟัง `popstate` เมื่อเป็น `/jobs/:jobId` ให้โหลดด้วย `GET /api/jobs/:jobId` โดยใช้ logic restore เดิม ถ้าได้ 404 ให้แสดง "ไม่พบงานนี้" พร้อมลิงก์กลับ `/`
- [ ] สร้างงานสำเร็จแล้ว `pushState` ไป `/jobs/:jobId` และปุ่ม "เริ่มงานใหม่" พากลับไป `/`
- [ ] ถ้ายกเลิกหลังจาก server สร้าง Job ไปแล้ว ให้ลบ Job นั้นด้วย `DELETE /api/jobs/:jobId/files` ส่วนการเปลี่ยนวิดีโอหรือสแกนเสียงใหม่ให้ Job เดิมอยู่ต่อ
- [ ] `jobSaveQueue.leave()` เลิกเรียก `DELETE` แต่ยังทิ้ง save ที่ค้างในคิว
- [ ] `JobStorageManager` เลิกใช้ `is_active` และปุ่มลบกดไม่ได้เฉพาะงานที่กำลังประมวลผล
- [ ] Unit test และ integration test (`jobStore.test.ts`, `jobStorage.integration.test.ts`, `jobBoundary.integration.test.ts`, `jobSaveQueue.test.ts`) เลิกใช้ active Job แล้วผ่านทั้งหมด
- [ ] Browser test ทุกไฟล์ที่ mock `/api/jobs/current` เปลี่ยนไปเปิด `/jobs/:jobId` และมี case ที่ reload แล้วยังอยู่งานเดิม
- [ ] `docs/API.md`, `docs/agents/system-constraints.md`, `AGENTS.md` (ส่วน Verification) และ README (ส่วน `active_job.json`) ตรงกับพฤติกรรมใหม่
