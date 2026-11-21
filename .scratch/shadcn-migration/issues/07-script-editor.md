# 07: Script editor

Status: ready-for-agent

Blocked by: 01, 05

อ้างอิง: [spec](../spec.md) แถว `AdScriptEditor.tsx` และ DESIGN.md › Inputs & Search Toolbar, Script Spot Row & Micro-Badges

**What to build:** แถบค้นหาและตัวกรอง, เมนู `ต้องตรวจ` และแถวบทใน editor ใช้ component ของ shadcn นี่คือส่วนที่ผู้ใช้อยู่นานที่สุด ความรู้สึกตอนพิมพ์และเลื่อนต้องเหมือนเดิมทุกอย่าง

- [ ] ช่องค้นหาเป็น `InputGroup` ที่มีไอคอนแว่นขยาย ตัวกรองเป็น `Select` (ทั้งหมด, บรรยาย, ข้าม, รอ, ต้องตรวจ และตัวเลขนับ)
- [ ] เมนู `ต้องตรวจ` เป็น `DropdownMenu` ที่กระโดดไปบรรทัดที่มีปัญหาได้เหมือนเดิม Escape และคลิกนอกเมนูปิดได้
- [ ] สวิตช์ `บรรยาย | ข้าม` เป็น `ToggleGroup` แบบเลือกได้อันเดียว สีตอนเลือกตาม DESIGN (cerulean สำหรับบรรยาย, slate-700 สำหรับข้าม)
- [ ] ป้ายสถานะเป็น `Badge` ตาม variant ใน DESIGN ส่วนสถานะที่กดไม่ได้ (`แก้ไขแล้ว`, `ตำแหน่งวิดีโอ`) ยังเป็นข้อความธรรมดา
- [ ] `คืนเวลาเดิม` เป็น `Button` ghost ขนาดเล็ก ช่องเวลาและปุ่ม ±0.2s ใช้ `Input` กับ `Button` icon
- [ ] textarea บทใช้ `Textarea` แต่คง Sarabun 1rem/1.75, การขยายความสูงอัตโนมัติ และการชดเชย scroll ตอนกางหรือหุบแถว
- [ ] Alt+↑/↓ และ Alt+P ใช้ได้เหมือนเดิม และการพิมพ์ในแถวไม่ทำให้รายการ re-render จนกระตุก (ทดสอบกับ fixture 300 ช่วงใน `tests/performance/`)
- [ ] ไม่เหลือ `.field`, `.menu-select`, `.tag`, `.compact-action`, `.alert-error` หรือ `.btn-primary` ใน `AdScriptEditor.tsx`
- [ ] `editor.js`, `review-mode.js` และ `job-lifecycle.js` ผ่าน และผลวัดใน `tests/performance/editor-playback.js` ไม่แย่ลงจากก่อนย้าย
