# 04: Unfinished Upload ผูกกับคนอัปโหลด

**What to build:** คนอัปโหลดยังยกเลิกและลบวิดีโอที่อัปโหลดค้างของตัวเองได้เหมือนเดิม Author อื่นเข้าถึง upload นั้นไม่ได้ และใน Job List มีแต่คนที่มี All-Jobs Access ที่เห็น Unfinished Upload ดู [spec](../spec.md) หัวข้อ Unfinished Uploads

**Blocked by:** 02

**Status:** resolved

- [x] `activeUploads` จำ `sub` ของคนอัปโหลดตั้งแต่ upload init
- [x] chunk, abandon และการสร้าง Job จาก `uploadId` ตอบ 404 เมื่อไม่ใช่คนอัปโหลดและไม่มี All-Jobs Access
- [x] คนอัปโหลดลบ Unfinished Upload ของตัวเองได้ รวมถึงหลัง abandon จนกว่าจะลบหรือกลายเป็น Job
- [x] Unfinished Upload อยู่ใน `GET /api/jobs` เฉพาะ Author ที่มี All-Jobs Access
- [x] integration tests ครอบทุกข้อข้างบน

## Comments

- The Job-creation route answers another Author's `uploadId` with the same HTTP 400 it gives a missing upload, not 404, so it never reveals that the upload exists. Uploader tracking is a separate `uploadOwners` map beside `activeUploads`, which keeps meaning "transfer in progress".
