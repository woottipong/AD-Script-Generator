# 02: Job List เป็นหน้าแรก

Status: resolved

Blocked by: 01

อ้างอิง: [spec](../spec.md) หัวข้อ "การตัดสินใจที่ตกลงกันแล้ว" (แถวใน Job List, Unfinished Upload, ลบงาน) และหัวข้อ Frontend

**What to build:** เข้าเว็บแล้วเจอ Job List ทุกครั้ง แต่ละแถวบอกว่างานคืออะไร แก้ล่าสุดเมื่อไร และมีปุ่มกดกลับไปทำต่อหรือลบ ปุ่ม "งานใหม่" พาไปหน้าเลือกโหมดที่ `/new` ส่วน dropdown `JobStorageManager` ถูกลบออก ใบนี้แสดงชื่อไฟล์วิดีโอเป็นชื่อหลักของแถวไปก่อน จนกว่าใบที่ 03 จะเพิ่ม Job Title

- [x] `GET /api/jobs` เพิ่ม `mode` และ `status` ให้แถวงาน (แถว Unfinished Upload ไม่มีสองค่านี้) และเรียงตาม `updated_at` ใหม่สุดก่อน
- [x] `src/components/JobList.tsx` ที่ `/` แสดงต่อแถว: ชื่อ, tag โหมด, สถานะ (เช่น กำลังวิเคราะห์ / พร้อมแก้ / ผิดพลาด), แก้ล่าสุด, ขนาดบนดิสก์, ปุ่ม "ทำต่อ" ไป `/jobs/:jobId` และปุ่ม "ลบ"
- [x] Unfinished Upload แสดงเป็นแถว "อัปโหลดไม่เสร็จ" ที่มีปุ่มลบอย่างเดียว
- [x] ปุ่มลบของงานที่กำลังวิเคราะห์หรืออัปโหลดกดไม่ได้ การลบใช้ `window.confirm` ถ้าลบไม่สำเร็จให้แสดง error ที่ server ส่งมา
- [x] มี empty state พร้อมปุ่ม "งานใหม่" รวมถึง loading และ error ตอนโหลดรายการ
- [x] หน้าเลือกโหมดย้ายไปที่ `/new` ขั้นตอน intake กับสามขั้นตอนเหมือนเดิม และ header ของ editor มีทางกลับ Job List
- [x] ลบ `JobStorageManager.tsx` และที่ใช้ทั้ง 4 จุด
- [x] UI สร้างจาก shared classes ใน `DESIGN.md` ใช้งานบน desktop ได้เต็มที่ ส่วนบนมือถือต้องอ่านได้และกดเปิดหรือลบได้
- [x] `tests/browser/job-storage.js` เปลี่ยนเป็น `job-list.js` ที่ครอบ: รายการ, ทำต่อ, ปุ่ม back, ลบ, ปุ่มลบของงานที่กำลังวิเคราะห์กดไม่ได้, empty state
- [x] README (ส่วนวิธีใช้งานและหน้าแรก), `PRODUCT.md` และ `docs/API.md` ตรงกับหน้าใหม่

## Comments

- Ways back to the Job List: the logo (ctrl/cmd-click opens a new tab), "รายการงาน" in the management menu, and the back button on the mode picker.
- "เริ่มงานใหม่" from within a Job moves to `/new`.
- Leaving with unsaved work asks first. This covers a local-only project and saves still in flight or failed, whether the author leaves via the logo, the menu, or browser Back. Declining puts the URL back.
- The "งานใหม่" button stays visible even when the list fails to load.
- Not yet verified: `review-mode-url.js`, which needs a real external video link.
