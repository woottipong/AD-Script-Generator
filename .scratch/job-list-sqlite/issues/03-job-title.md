# 03: Job Title ตั้งได้ตอนสร้างงานและเปลี่ยนชื่อได้

Status: resolved

Blocked by: 02

อ้างอิง: [spec](../spec.md) แถว "Job Title" ในตารางการตัดสินใจ และ `PATCH /api/jobs/:jobId` ใน "API changes"

**What to build:** ทุก Job มี Job Title ที่เติมให้จากชื่อไฟล์วิดีโอ ผู้เขียนแก้ชื่อได้ในขั้น intake และเปลี่ยนชื่อทีหลังได้จาก header ของ editor แล้ว Job List จะใช้ Job Title เป็นชื่อหลักของแถว โดยมีชื่อไฟล์เป็นตัวเล็กอยู่ใต้ชื่อ

- [x] `PersistedJobState` เพิ่ม `title: string` และเปลี่ยน `JOB_SCHEMA_VERSION` เป็น `3` แล้วลบ `upgrade()` ที่ใช้อ่าน schema v1
- [x] `POST /api/jobs/init` และ `POST /api/jobs/review` รับ `title` แบบไม่บังคับ ถ้าไม่ส่งหรือว่างหลัง trim ใช้ชื่อไฟล์ที่ตัดนามสกุลออก และถ้ายาวเกิน 120 ตัวอักษรตอบ 400
- [x] `PATCH /api/jobs/:jobId` รับ `{ title }` ตอบ `{ job }` ตอบ 400 เมื่อ title ว่างหรือยาวเกิน และ 404 เมื่อไม่พบงาน
- [x] ช่อง "ชื่องาน" ใน `UploadAndVadPanel` และ `ReviewIntake` เติมค่าจากชื่อไฟล์วิดีโอให้เอง ถ้าผู้ใช้แก้ช่องนี้แล้ว เลือกไฟล์ใหม่จะไม่ทับชื่อที่แก้ไว้
- [x] ช่องเปลี่ยนชื่อใน header ของ editor แสดงสถานะการบันทึกตามการตอบรับของ server
- [x] `GET /api/jobs` ส่ง `title` มาด้วย และ Job List แสดง title เป็นชื่อหลัก
- [x] Integration test ของ `PATCH` ครอบ: title ถูกต้อง, title ว่าง, title ยาวเกิน และ jobId ที่ไม่มี ส่วน unit test ครอบค่าเริ่มต้นที่ตัดนามสกุลออก
- [x] Browser test: ช่องชื่อเติมให้เองแล้วแก้ได้, เปลี่ยนชื่อใน editor แล้วชื่อใหม่ขึ้นใน Job List
- [x] `docs/API.md` อธิบาย `title` และ endpoint ใหม่

## Comments

- Implementation deviation: Generate Mode has no title field on the file-picker screen, because choosing a file opens the workspace immediately. The title comes from the file name and can be changed from the "ชื่องาน" form in the header's Job details. Before the Job exists, the title is kept in the browser and sent at init. Choosing a new file doesn't overwrite a title the author has typed.
- A title changed during the Review Mode scan is the one sent when the Job is created.
- Server: `saveProcessingState` always keeps the latest title, so renaming during analysis doesn't get overwritten (covered by an integration test).
- `upgrade()` for schema v1 was removed and `JOB_SCHEMA_VERSION` is now 3. Older Job files are not supported; clear `.data` before using this version.
