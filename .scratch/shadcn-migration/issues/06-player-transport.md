# 06: Transport และ tooltip ของ player

Status: ready-for-agent

Blocked by: 01

อ้างอิง: [spec](../spec.md) แถว `VideoPreviewTimeline.tsx` และ DESIGN.md › Left Pane

**What to build:** แถบควบคุมการเล่นและแถบ zoom ของไทม์ไลน์ใช้ `Button` icon, `Toggle` และ `Tooltip` ส่วน canvas คลื่นเสียง, แทร็ก, playhead และ CC pill ไม่แตะ

- [ ] ปุ่ม -5s, -1s, เล่น/หยุด, +1s, +5s, ช่วงก่อน/ถัดไป และ zoom เป็น `Button` ขนาด `icon-sm` (32px) บนเดสก์ท็อป
- [ ] Loop, CC และ Mute เป็น `Toggle` ที่มี `aria-pressed` และ soft-active ตาม DESIGN
- [ ] `title` ทั้ง 17 จุดเปลี่ยนเป็น `Tooltip` ที่บอกคีย์ลัดด้วย และ `aria-label` ของปุ่มยังอยู่
- [ ] คีย์ลัดของ player ทุกตัวทำงานเหมือนเดิม และ tooltip ไม่บังไทม์ไลน์ตอนลาก
- [ ] `editor.js` และ `job-lifecycle.js` ผ่าน
