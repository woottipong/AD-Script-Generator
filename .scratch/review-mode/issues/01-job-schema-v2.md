# 01: Job รุ่นใหม่ที่บันทึกโหมดและที่มาของวิดีโอ

Status: resolved

Blocked by: None (can start immediately)

อ้างอิง: [spec](../spec.md) หัวข้อ "โครงสร้าง Job (schema version 2)" และ [ADR-0002](../../../docs/adr/0002-job-mode-and-video-source.md)

**What to build:** เป็นการปรับโครงสร้างก่อนเริ่มฟีเจอร์ ทุก Job บันทึกว่ามาจากโหมดไหน และวิดีโอมาจากไหน เพื่อให้ Review Mode ใช้รูปแบบ Job เดียวกันได้ และเตรียมย้ายเข้าฐานข้อมูลในอนาคต ผู้ใช้ Generate Mode ต้องไม่เห็นความแตกต่างใดๆ ส่วนงานที่บันทึกไว้แล้วต้องยังเปิด เล่น และวิเคราะห์ต่อได้

รูปแบบที่ต้องได้ (คัดมาจาก spec):

```ts
type JobMode = 'generate' | 'review';
type VideoSource =
  | { kind: 'server_copy'; local_file_path: string }
  | { kind: 'url'; url: string }
  | { kind: 'local_file'; file_name: string; file_size: number };
// PersistedJobState เพิ่ม: schema_version: 2, mode: JobMode, video_source: VideoSource, srt_source?: {...}
// และนำ local_file_path ที่อยู่ชั้นบนสุดออก
```

- [x] งานใหม่จาก Generate Mode บันทึก `schema_version: 2`, `mode: 'generate'` และ `video_source.kind: 'server_copy'`
- [x] งานที่ไม่มี `schema_version` ถูกอ่านเป็น Generate Mode ที่มี `server_copy` และถูกเขียนเป็นรูปแบบใหม่ในครั้งถัดไปที่บันทึกงานนั้น ตัวแปลงอยู่ใน Job store ที่เดียว
- [x] ทุกจุดที่เคยอ่าน `local_file_path` ย้ายไปอ่านจาก `video_source` ได้แก่การสตรีมวิดีโอ และการอัปโหลดซ้ำให้ Gemini
- [x] Unit test ของ Job store ครอบคลุมการแปลงงานรุ่นเก่า และการบันทึกงานรุ่นใหม่
- [x] Integration test เดิมผ่านทั้งหมด และงานเก่าใน `.data/jobs` ยังเปิด เล่น และส่งออกได้
- [x] `docs/API.md` และ `docs/agents/system-constraints.md` อธิบาย field ใหม่
