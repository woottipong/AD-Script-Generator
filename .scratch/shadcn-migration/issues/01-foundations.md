# 01: พื้นฐาน: ขนาดปุ่ม, Alert warning, ขนาดบนจอสัมผัส

Status: resolved

Blocked by: None (can start immediately)

อ้างอิง: [spec](../spec.md) แถว "ขนาดปุ่ม" และ "variant สีเตือน" ในตารางการตัดสินใจ และ DESIGN.md › Layout (Touch & Pointer Rhythm), Components › Buttons

**What to build:** ปรับ component ของ shadcn ที่ติดตั้งแล้วให้ขนาดตรง DESIGN ก่อนที่หน้าอื่นจะเริ่มใช้ ผู้ใช้ต้องไม่เห็นความต่างในหน้าเดิม ยกเว้นหน้ารายการงานที่ปุ่มจะสูงตาม DESIGN

- [x] `button.tsx`: ขนาดปกติ 36px, `lg` 40px, `icon` 36px, `icon-sm` 32px (ใช้กับ transport) โดยแก้ที่ variant ไม่ใช่ที่ call site
- [x] บน `@media (pointer: coarse)` ปุ่มและช่องกรอกของ shadcn สูงอย่างน้อย 44px เหมือนกฎเดิมของแอป
- [x] ลบกฎ `button, input, select { min-height }` และ `button { min-width }` ใน `@layer base` แล้วตรวจว่าปุ่มเดิมทุกหน้ายังสูงเท่าเดิม (ปุ่มที่ไม่ได้ใช้ shadcn ต้องมีความสูงของตัวเอง)
- [x] `alert.tsx` เพิ่ม variant `warning` (amber surface, ink, border ตาม DESIGN › Semantic States)
- [x] focus ring ของ component shadcn ตรงกับ DESIGN: 2px `studio-cerulean-active` เห็นชัดบนพื้นขาวและพื้น cerulean tint
- [x] screenshot หน้ารายการงาน, editor และ intake ที่ 1440px และ 390px ไม่เพี้ยน และ browser tests ผ่านทั้งหมด
- [x] DESIGN.md อธิบายขนาดปุ่มและ variant `warning` ของ Alert

## Comments

- การเบี่ยงจากใบที่ตั้งใจ: ไม่ได้ลบกฎ `min-height`/`min-width` เดิมทิ้ง แต่จำกัดให้ใช้กับ `:not([data-slot])` เพราะถ้าลบตอนนี้ ปุ่มในหน้าที่ยังไม่ย้ายจะหด การลบจริงย้ายไปทำในใบ 08
- แก้ตาม review:
  - กฎ 44px บนจอสัมผัสจับจาก `button[data-size^="icon"]` แทน เพราะ trigger ของเมนูและ dialog เขียนทับ `data-slot`
  - เอา ring halo ออกจาก variant `destructive` ด้วย
  - สี amber ของ Alert กับ Badge ใช้ token ของ DESIGN ชุดเดียวกัน (amber-50, amber-200, amber-800)
- ยังไม่ได้ตรวจตอนรัน: ขนาดบน `pointer: coarse` เพราะ Playwright CLI จำลอง coarse pointer ไม่ได้ ตรวจแค่ว่า selector จับปุ่ม ⋯ ได้
