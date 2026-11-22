# 06: Transport และ tooltip ของ player

Status: resolved

Blocked by: 01

อ้างอิง: [spec](../spec.md) แถว `VideoPreviewTimeline.tsx` และ DESIGN.md › Left Pane

**What to build:** แถบควบคุมการเล่นและแถบ zoom ของไทม์ไลน์ใช้ `Button` icon, `Toggle` และ `Tooltip` ส่วน canvas คลื่นเสียง, แทร็ก, playhead และ CC pill ไม่แตะ

- [x] ปุ่ม -5s, -1s, เล่น/หยุด, +1s, +5s, ช่วงก่อน/ถัดไป และ zoom เป็น `Button` ขนาด `icon-sm` (32px) บนเดสก์ท็อป
- [x] Loop, CC และ Mute เป็น `Toggle` ที่มี `aria-pressed` และ soft-active ตาม DESIGN
- [x] `title` ทั้ง 17 จุดเปลี่ยนเป็น `Tooltip` ที่บอกคีย์ลัดด้วย และ `aria-label` ของปุ่มยังอยู่
- [x] คีย์ลัดของ player ทุกตัวทำงานเหมือนเดิม และ tooltip ไม่บังไทม์ไลน์ตอนลาก
- [x] `editor.js` และ `job-lifecycle.js` ผ่าน

## Comments

- การเบี่ยงจากใบ: `title` ที่เปลี่ยนเป็น Tooltip มี 13 จุด ได้แก่ปุ่ม transport, Loop/CC/Mute และ zoom ส่วนอีก 2 จุดเป็นข้อมูลประกอบ (ตัวเลขเวลาและตำแหน่งเมาส์) ลบทิ้ง ที่เหลือ 2 จุดบนบล็อกเสียงพูดและบล็อกบรรยายในไทม์ไลน์ยังเป็น `title` ของเบราว์เซอร์ เพราะไทม์ไลน์เป็น signature component ที่ลากได้ และใบนี้กำหนดว่า tooltip ห้ามบังตอนลาก
- ปุ่ม −5s/−1s/+1s/+5s ใช้ `size="sm"` (สูง 32px แต่กว้างกว่าเพราะมีข้อความ) ส่วนปุ่มไอคอนใช้ `icon-sm`
- Toggle มี size `icon` และ `data-size` แบบเดียวกับ Button เพราะ `TooltipTrigger` เขียนทับ `data-slot` กฎ 44px บนจอสัมผัสจึงจับจาก `data-size` ตรวจแล้วว่า Loop toggle ตรงกับกฎนี้
- `TooltipProvider` (หน่วง 400ms) อยู่ที่ `main.tsx` จุดเดียว
- ปุ่มที่ disabled ไม่แสดง tooltip เพราะ `pointer-events-none` รับได้
- ปุ่ม "ซูมช่วงนี้" มีขีดเส้นใต้เฉพาะตอน hover ตาม variant `link`
