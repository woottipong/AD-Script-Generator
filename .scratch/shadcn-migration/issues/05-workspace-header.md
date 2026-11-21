# 05: Header ของ workspace

Status: resolved

Blocked by: 01, 02

อ้างอิง: [spec](../spec.md) แถว `UploadAndVadPanel.tsx` และ DESIGN.md › Top Command Navbar, Status Pill

**What to build:** ส่วนบน workspace ที่อยู่ใน navbar (รายละเอียดงานกับฟอร์มเปลี่ยนชื่อ, status pill กับแผงรายละเอียดการทำงาน, ปุ่มสร้างบทหรือทำต่อ, ส่งออก SRT, เมนู `จัดการ`) ใช้ component ของ shadcn ลำดับ, ข้อความ และสถานะการบันทึกชื่อเหมือนเดิม

- [x] เมนู `จัดการ` เป็น `DropdownMenu` (สร้างบทใหม่, สแกนเสียงใหม่, เปลี่ยนวิดีโอ, เริ่มงานใหม่, รายการงาน) โดยไม่ต้องเขียนปิดเมนูเอง
- [x] รายละเอียดงานเป็น `Popover` ที่มีฟอร์มเปลี่ยนชื่อ (`Field` + `Input` + `Button`) และข้อมูลวิดีโอ ข้อความสถานะ "บันทึกชื่อบนเซิร์ฟเวอร์แล้ว / จะบันทึกเมื่อสร้างงานบนเซิร์ฟเวอร์ / error" ยังแยก local กับที่ server ตอบรับแล้ว
- [x] status pill เป็น `Button` ที่เปิด `Collapsible` แผงรายละเอียดการทำงาน และ hairline progress bar คงเดิม
- [x] ปุ่มหลักใช้ `Button` ขนาด `lg` โดยมีปุ่ม cerulean แค่ปุ่มเดียวใน navbar ตาม DESIGN
- [x] แถบ error ใต้ header เป็น `Alert`
- [x] ไม่เหลือ `.menu-panel`, `.menu-item` หรือ `.btn-primary` ใน `UploadAndVadPanel.tsx`
- [x] `job-list.js` (เปลี่ยนชื่อจาก header), `review-mode.js` และ `resume-cancel.js` ผ่าน

## Comments

- การเบี่ยงจากใบ: status pill เปิดแผงรายละเอียดการทำงานเป็น `Popover` ไม่ใช่ `Collapsible` เพราะแผงนี้เป็นแผงลอยที่ยึดกับ pill อยู่แล้ว และ `Popover` จัดการการปิดด้วย Escape, การคลิกนอก และการคืน focus ให้ จึงลบโค้ดปิดเองทั้ง effect ออกได้
- `Alert` variant `destructive` ใช้ token error ของ DESIGN (พื้น red-50, ขอบ red-200, ตัวอักษร red-800) ทั้งแอป ตรงกับ `.alert-error` เดิม หน้ารายการงานและหน้า intake จึงได้พื้นแดงอ่อนไปด้วย
- ฟอร์มเปลี่ยนชื่ออยู่ใน `Field` ตอน error ใช้ `FieldError` และ `aria-invalid` นอกนั้นใช้ `FieldDescription role="status"` ข้อความทั้งสี่สถานะเหมือนเดิม และยังแยกงานที่อยู่ในเครื่องกับงานที่ server ตอบรับแล้ว
- focus กลับไปที่ปุ่ม "จัดการ" หลังยกเลิก dialog ที่เปิดจากเมนู ซึ่งปิดเรื่องที่ใบ 02 ฝากไว้ `resume-cancel.js` ตรวจแล้ว
- ยังเหลือใช้: `.menu-panel`/`.menu-item` ยังใช้อยู่ในเมนู "ต้องตรวจ" ของ script editor (ใบ 07)
