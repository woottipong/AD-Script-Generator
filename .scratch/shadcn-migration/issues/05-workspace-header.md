# 05: Header ของ workspace

Status: ready-for-agent

Blocked by: 01, 02

อ้างอิง: [spec](../spec.md) แถว `UploadAndVadPanel.tsx` และ DESIGN.md › Top Command Navbar, Status Pill

**What to build:** ส่วนบน workspace ที่อยู่ใน navbar (รายละเอียดงานกับฟอร์มเปลี่ยนชื่อ, status pill กับแผงรายละเอียดการทำงาน, ปุ่มสร้างบทหรือทำต่อ, ส่งออก SRT, เมนู `จัดการ`) ใช้ component ของ shadcn ลำดับ, ข้อความ และสถานะการบันทึกชื่อเหมือนเดิม

- [ ] เมนู `จัดการ` เป็น `DropdownMenu` (สร้างบทใหม่, สแกนเสียงใหม่, เปลี่ยนวิดีโอ, เริ่มงานใหม่, รายการงาน) โดยไม่ต้องเขียนปิดเมนูเอง
- [ ] รายละเอียดงานเป็น `Popover` ที่มีฟอร์มเปลี่ยนชื่อ (`Field` + `Input` + `Button`) และข้อมูลวิดีโอ ข้อความสถานะ "บันทึกชื่อบนเซิร์ฟเวอร์แล้ว / จะบันทึกเมื่อสร้างงานบนเซิร์ฟเวอร์ / error" ยังแยก local กับที่ server ตอบรับแล้ว
- [ ] status pill เป็น `Button` ที่เปิด `Collapsible` แผงรายละเอียดการทำงาน และ hairline progress bar คงเดิม
- [ ] ปุ่มหลักใช้ `Button` ขนาด `lg` โดยมีปุ่ม cerulean แค่ปุ่มเดียวใน navbar ตาม DESIGN
- [ ] แถบ error ใต้ header เป็น `Alert`
- [ ] ไม่เหลือ `.menu-panel`, `.menu-item` หรือ `.btn-primary` ใน `UploadAndVadPanel.tsx`
- [ ] `job-list.js` (เปลี่ยนชื่อจาก header), `review-mode.js` และ `resume-cancel.js` ผ่าน
