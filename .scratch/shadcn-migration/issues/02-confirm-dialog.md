# 02: Confirm dialog แทน window.confirm

Status: ready-for-agent

Blocked by: 01

อ้างอิง: [spec](../spec.md) แถว "confirm"

**What to build:** ทุกคำถามยืนยันใน `App.tsx` (เปลี่ยนวิดีโอ, สแกนเสียงใหม่, สร้างบทใหม่, ออกจากหน้าตอนมีงานไม่ได้บันทึก ทั้งปุ่ม back และกลับรายการงาน, เริ่มงานใหม่) ขึ้นเป็น `AlertDialog` ของแอปแทนกล่องของเบราว์เซอร์ ข้อความเดิมทุกคำ และการกดยกเลิกต้องได้ผลเหมือนเดิม

- [ ] `confirm({ title, description, confirmLabel, destructive })` คืน `Promise<boolean>` และเรนเดอร์ `AlertDialog` ตัวเดียวใน `App` ไม่มี `window.confirm` เหลือใน `src/`
- [ ] ปุ่มยืนยันของการกระทำที่ทำให้ข้อมูลหาย (ออกโดยไม่บันทึก, สแกนใหม่, สร้างบทใหม่) ใช้ variant `destructive` ส่วนที่เหลือใช้ `default`
- [ ] ปุ่ม back ที่ถูกปฏิเสธยังใส่ URL ของหน้าเดิมกลับเหมือนเดิม และ Escape หรือคลิกนอก dialog นับเป็นยกเลิก
- [ ] focus เข้า dialog ตอนเปิด และกลับไปที่ปุ่มที่กดตอนปิด
- [ ] browser tests ที่ stub `window.confirm` (`resume-cancel.js`, `job-lifecycle.js`) เปลี่ยนไปกดปุ่มใน dialog และตรวจทั้งกรณียืนยันและยกเลิก
