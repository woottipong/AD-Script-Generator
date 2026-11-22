# 02: Author เห็นและแตะได้เฉพาะงานของตัวเอง

**What to build:** งานที่ Author สร้างใน Generate Mode หรือ Review Mode มี Job Owner เป็น Author คนนั้น Job List แสดงเฉพาะงานของตัวเอง และลิงก์ไปงานของคนอื่นหรืองานที่ไม่มีเจ้าของขึ้น "ไม่พบงานนี้" ดู [spec](../spec.md) หัวข้อ Ownership in the Job store และ Access rule

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] migration ใหม่ต่อท้าย `MIGRATIONS` เพิ่ม `owner_sub` และ `owner_email` ที่เป็น null ได้ งานเดิมไม่มี Job Owner
- [ ] สองเส้นทางสร้าง Job บันทึก Job Owner จาก session และการ save ภายหลังไม่เปลี่ยน owner
- [ ] `GET /api/jobs` คืนเฉพาะงานที่ `owner_sub` ตรงกับ Author พร้อม `owner_email`
- [ ] ทุก route ที่มี `:jobId` (อ่าน, video, rename, save spots, start, analyze-batch, delete) ตอบ 404 แบบเดียวกับงานที่ไม่มีอยู่ สำหรับงานของคนอื่นและงานที่ไม่มีเจ้าของ
- [ ] login แล้วอัปเดต `owner_email` ของทุกงานที่ `owner_sub` เป็นของคนนั้น
- [ ] store tests ครอบ migration, การคง owner, การกรอง และการอัปเดต email; integration tests ครอบการกรองและ 404
- [ ] API docs และ system constraints อธิบายกฎการเข้าถึง
