# 07: Script editor

Status: resolved

Blocked by: 01, 05

อ้างอิง: [spec](../spec.md) แถว `AdScriptEditor.tsx` และ DESIGN.md › Inputs & Search Toolbar, Script Spot Row & Micro-Badges

**What to build:** แถบค้นหาและตัวกรอง, เมนู `ต้องตรวจ` และแถวบทใน editor ใช้ component ของ shadcn นี่คือส่วนที่ผู้ใช้อยู่นานที่สุด ความรู้สึกตอนพิมพ์และเลื่อนต้องเหมือนเดิมทุกอย่าง

- [x] ช่องค้นหาเป็น `InputGroup` ที่มีไอคอนแว่นขยาย ตัวกรองเป็น `Select` (ทั้งหมด, บรรยาย, ข้าม, รอ, ต้องตรวจ และตัวเลขนับ)
- [x] เมนู `ต้องตรวจ` เป็น `DropdownMenu` ที่กระโดดไปบรรทัดที่มีปัญหาได้เหมือนเดิม Escape และคลิกนอกเมนูปิดได้
- [x] สวิตช์ `บรรยาย | ข้าม` เป็น `ToggleGroup` แบบเลือกได้อันเดียว สีตอนเลือกตาม DESIGN (cerulean สำหรับบรรยาย, slate-700 สำหรับข้าม)
- [x] ป้ายสถานะเป็น `Badge` ตาม variant ใน DESIGN ส่วน `ตำแหน่งวิดีโอ` ยังเป็นข้อความธรรมดา
- [x] `คืนเวลาเดิม` เป็น `Button` ghost ขนาดเล็ก ช่องเวลาและปุ่ม ±0.2s ใช้ `Input` กับ `Button` icon
- [x] textarea บทใช้ `Textarea` แต่คง Sarabun 1rem/1.75, การขยายความสูงอัตโนมัติ และการชดเชย scroll ตอนกางหรือหุบแถว
- [x] Alt+↑/↓ และ Alt+P ใช้ได้เหมือนเดิม และการพิมพ์ในแถวไม่ทำให้รายการ re-render จนกระตุก (ทดสอบกับ fixture 300 ช่วงใน `tests/performance/`)
- [x] ไม่เหลือ `.field`, `.menu-select`, `.tag`, `.compact-action`, `.alert-error` หรือ `.btn-primary` ใน `AdScriptEditor.tsx`
- [x] `editor.js`, `review-mode.js` และ `job-lifecycle.js` ผ่าน และผลวัดใน `tests/performance/editor-playback.js` ไม่แย่ลงจากก่อนย้าย

## Comments

- เพิ่ม variant ใน `src/components/ui` ตามกฎไม่แก้สีที่ call site: `button.tsx` (`warning`), `badge.tsx` (`info-strong`, `warning-strong`), `dropdown-menu.tsx` (`primary` item), `toggle.tsx` / `toggle-group.tsx` (`solid-primary`, `solid-muted`, `appearance="segmented"`), และ `textarea.tsx` (`variant="script"` ที่ใช้ `text-[length:var(--text-script)] leading-[var(--text-script--line-height)]` เพื่อไม่ให้ `cn` ลบ `text-script` และคง Sarabun 16px / line-height 28px ตาม Looped-Script Rule)
- ใส่ `React.memo` ให้ `SpotBlockItem` พร้อม stable callbacks (`useCallback` + refs) ใน `AdScriptEditor` และคำนวณ `nudgeTargets` เฉพาะแถวที่กางอยู่
- ผลวัดบน fixture 300 ช่วง (`tests/performance/editor-playback.js`, สลับ 5 รอบ): candidate เร็วกว่า baseline ทั้งระหว่างเล่น (`TaskDuration` เฉลี่ย `0.647s` vs `0.933s`, `ScriptDuration` เฉลี่ย `0.585s` vs `0.834s`) และตอนพิมพ์ในแถว 1 (`TaskDuration` `472–741ms` vs `1098–1967ms`)
- การตรวจหลังแก้ล่าสุด: `tsc --noEmit`, `bun test` (95 pass, 17 ไฟล์), `impeccable detect` บนไฟล์ `.tsx` ที่แก้ (0 findings), และ browser tests (`editor.js`, `review-mode.js`, `job-lifecycle.js`) ผ่านทั้งหมด
