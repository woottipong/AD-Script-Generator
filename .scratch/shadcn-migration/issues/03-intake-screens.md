# 03: หน้าเลือกโหมดและ intake

Status: resolved

Blocked by: 01

อ้างอิง: [spec](../spec.md) แถว `ModeChooser.tsx`, `ReviewIntake.tsx`, `VideoProcessingStatus.tsx` และส่วน intake ของ `UploadAndVadPanel.tsx`

**What to build:** หน้าเลือกโหมดและหน้าเลือกไฟล์ของทั้งสองโหมดใช้ component ของ shadcn ขั้นตอนและข้อความเหมือนเดิม และความกว้างของเนื้อหาตรงกับหน้ารายการงาน (ขอบซ้ายตรงโลโก้)

- [x] `ModeChooser`: การ์ดโหมดสองใบเป็น `Card` ที่กดได้ทั้งใบ (keyboard และ focus ring ครบ) ลิงก์กลับรายการงานเป็น `Button` ghost
- [x] `ReviewIntake`: ปุ่มเลือกวิดีโอและ SRT เป็น `Button` outline, ช่องลิงก์และช่องชื่องานใช้ `Field` + `FieldLabel` + `Input` + `FieldDescription` (สถานะลิงก์ไม่ถูกต้องใช้ `data-invalid` และ `aria-invalid`), error เป็น `Alert` destructive
- [x] intake ของ Generate Mode ใน `UploadAndVadPanel`: dropzone ยังรับการลากไฟล์ได้ ปุ่มและ error ใช้ `Button` กับ `Alert`
- [x] `VideoProcessingStatus` ใช้ `Progress` และยังเคารพ `prefers-reduced-motion`
- [x] ไม่เหลือ `.btn-primary`, `.field` หรือ `.alert-error` ในสามไฟล์นี้
- [x] `review-mode.js` และ `review-mode-url.js` ผ่าน โดยแก้ selector เฉพาะที่ role หรือ label เปลี่ยน

## Comments

- เพิ่ม `IntakeShell` ให้หน้าเลือกโหมดและหน้า intake ทั้งสองโหมดใช้ร่วมกัน ได้แก่ความกว้างเท่ากับ Job List, ปุ่มย้อนกลับ, หัวเรื่อง และคำอธิบาย บล็อกนี้เคยซ้ำอยู่สามไฟล์
- การ์ดเลือกโหมดใช้แบบ stretched link คือปุ่มอยู่ในหัวการ์ดแล้วขยายพื้นที่กดเต็มใบ HTML จึงถูกต้อง และ ring ของการ์ดแสดงทั้งตอน hover และตอน focus จากคีย์บอร์ด
- `Input` สูง 36px และ focus ใช้ขอบกับ ring 1px ตาม DESIGN ส่วน `Progress` ใช้สีแบรนด์ และสถานะ indeterminate ใช้ animation เดิมผ่าน `data-indeterminate` (ตรวจแล้วว่า Base UI ตั้งค่านี้จริง) ถ้าผู้ใช้ตั้ง reduced-motion จะไม่ขยับ
- แถบ progress แบบมีเปอร์เซ็นต์ไม่มี shimmer แล้ว
- `.btn-primary` ที่เหลือใน `UploadAndVadPanel.tsx` อยู่ใน header ของ workspace ซึ่งเป็นงานของใบ 05
- ยังไม่ได้รัน `review-mode-url.js` เพราะต้องใช้ลิงก์วิดีโอจริง ส่วนกรณีลิงก์ไม่ถูกต้องย้ายไปตรวจใน `review-mode.js` แทน
