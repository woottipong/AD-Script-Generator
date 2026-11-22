# 04: Unfinished Upload ผูกกับคนอัปโหลด

**What to build:** คนอัปโหลดยังยกเลิกและลบวิดีโอที่อัปโหลดค้างของตัวเองได้เหมือนเดิม Author อื่นเข้าถึง upload นั้นไม่ได้ และใน Job List มีแต่คนที่มี All-Jobs Access ที่เห็น Unfinished Upload ดู [spec](../spec.md) หัวข้อ Unfinished Uploads

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `activeUploads` จำ `sub` ของคนอัปโหลดตั้งแต่ upload init
- [ ] chunk, abandon และการสร้าง Job จาก `uploadId` ตอบ 404 เมื่อไม่ใช่คนอัปโหลดและไม่มี All-Jobs Access
- [ ] คนอัปโหลดลบ Unfinished Upload ของตัวเองได้ รวมถึงหลัง abandon จนกว่าจะลบหรือกลายเป็น Job
- [ ] Unfinished Upload อยู่ใน `GET /api/jobs` เฉพาะ Author ที่มี All-Jobs Access
- [ ] integration tests ครอบทุกข้อข้างบน
