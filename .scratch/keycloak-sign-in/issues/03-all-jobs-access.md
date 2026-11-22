# 03: All-Jobs Access สำหรับ admin และ supervisor

**What to build:** Author ในกลุ่ม admin หรือ supervisor เห็นทุก Job รวมถึงงานที่ไม่มีเจ้าของ และทำได้ทุกอย่างเหมือนเป็นเจ้าของ Job List ของคนกลุ่มนี้มีคอลัมน์ "เจ้าของ" และค้นหาจาก email เจ้าของได้ ดู [spec](../spec.md) หัวข้อ Access rule และ Client

**Blocked by:** 02

**Status:** resolved

- [x] Author ที่ `allJobs` เป็นจริงได้ทุก Job จาก `GET /api/jobs` และทุก route ที่มี `:jobId` ทำงานกับงานของใครก็ได้ รวมถึงงานที่ไม่มีเจ้าของ
- [x] Job List แสดงคอลัมน์ "เจ้าของ" (email หรือ "ไม่มีเจ้าของ") และค้นหาจาก email เจ้าของได้ เฉพาะเมื่อ `allJobs` เป็นจริง
- [x] integration tests ครอบ All-Jobs Access; browser tests ครอบคอลัมน์และการค้นหาที่ขึ้นตาม `allJobs`
