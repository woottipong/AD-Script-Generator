# 01: พื้นฐาน: ขนาดปุ่ม, Alert warning, ขนาดบนจอสัมผัส

Status: ready-for-agent

Blocked by: None (can start immediately)

อ้างอิง: [spec](../spec.md) แถว "ขนาดปุ่ม" และ "variant สีเตือน" ในตารางการตัดสินใจ และ DESIGN.md › Layout (Touch & Pointer Rhythm), Components › Buttons

**What to build:** ปรับ component ของ shadcn ที่ติดตั้งแล้วให้ขนาดตรง DESIGN ก่อนที่หน้าอื่นจะเริ่มใช้ ผู้ใช้ต้องไม่เห็นความต่างในหน้าเดิม ยกเว้นหน้ารายการงานที่ปุ่มจะสูงตาม DESIGN

- [ ] `button.tsx`: ขนาดปกติ 36px, `lg` 40px, `icon` 36px, `icon-sm` 32px (ใช้กับ transport) โดยแก้ที่ variant ไม่ใช่ที่ call site
- [ ] บน `@media (pointer: coarse)` ปุ่มและช่องกรอกของ shadcn สูงอย่างน้อย 44px เหมือนกฎเดิมของแอป
- [ ] ลบกฎ `button, input, select { min-height }` และ `button { min-width }` ใน `@layer base` แล้วตรวจว่าปุ่มเดิมทุกหน้ายังสูงเท่าเดิม (ปุ่มที่ไม่ได้ใช้ shadcn ต้องมีความสูงของตัวเอง)
- [ ] `alert.tsx` เพิ่ม variant `warning` (amber surface, ink, border ตาม DESIGN › Semantic States)
- [ ] focus ring ของ component shadcn ตรงกับ DESIGN: 2px `studio-cerulean-active` เห็นชัดบนพื้นขาวและพื้น cerulean tint
- [ ] screenshot หน้ารายการงาน, editor และ intake ที่ 1440px และ 390px ไม่เพี้ยน และ browser tests ผ่านทั้งหมด
- [ ] DESIGN.md อธิบายขนาดปุ่มและ variant `warning` ของ Alert
