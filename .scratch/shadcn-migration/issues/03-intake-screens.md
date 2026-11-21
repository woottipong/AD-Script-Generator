# 03: หน้าเลือกโหมดและ intake

Status: ready-for-agent

Blocked by: 01

อ้างอิง: [spec](../spec.md) แถว `ModeChooser.tsx`, `ReviewIntake.tsx`, `VideoProcessingStatus.tsx` และส่วน intake ของ `UploadAndVadPanel.tsx`

**What to build:** หน้าเลือกโหมดและหน้าเลือกไฟล์ของทั้งสองโหมดใช้ component ของ shadcn ขั้นตอนและข้อความเหมือนเดิม และความกว้างของเนื้อหาตรงกับหน้ารายการงาน (ขอบซ้ายตรงโลโก้)

- [ ] `ModeChooser`: การ์ดโหมดสองใบเป็น `Card` ที่กดได้ทั้งใบ (keyboard และ focus ring ครบ) ลิงก์กลับรายการงานเป็น `Button` ghost
- [ ] `ReviewIntake`: ปุ่มเลือกวิดีโอและ SRT เป็น `Button` outline, ช่องลิงก์และช่องชื่องานใช้ `Field` + `FieldLabel` + `Input` + `FieldDescription` (สถานะลิงก์ไม่ถูกต้องใช้ `data-invalid` และ `aria-invalid`), error เป็น `Alert` destructive
- [ ] intake ของ Generate Mode ใน `UploadAndVadPanel`: dropzone ยังรับการลากไฟล์ได้ ปุ่มและ error ใช้ `Button` กับ `Alert`
- [ ] `VideoProcessingStatus` ใช้ `Progress` และยังเคารพ `prefers-reduced-motion`
- [ ] ไม่เหลือ `.btn-primary`, `.field` หรือ `.alert-error` ในสามไฟล์นี้
- [ ] `review-mode.js` และ `review-mode-url.js` ผ่าน โดยแก้ selector เฉพาะที่ role หรือ label เปลี่ยน
