# 08: ลบ class กลางและอัปเดตเอกสาร

Status: resolved

Blocked by: 02, 03, 04, 05, 06, 07

อ้างอิง: [spec](../spec.md) ส่วน Anti-goals

**What to build:** เมื่อทุกหน้าย้ายแล้ว แอปเหลือ UI ระบบเดียว ลบ class กลางที่ไม่มีใครใช้ และให้เอกสารบอกแค่วิธีเดียว

- [x] ลบ `.btn-primary`, `.field`, `.tag`, `.banner-warning`, `.alert-error`, `.menu-panel`, `.menu-item`, `.menu-select` และ `.compact-action` ออกจาก `src/index.css` หลังจากตรวจด้วย grep ว่าไม่มีที่ใช้แล้ว
- [x] DESIGN.md › Components เขียนใหม่โดยอ้าง component ของ shadcn และ variant ของแบรนด์ แทนรายการ class กลาง แล้วรัน `/impeccable document` เพื่ออัปเดต `.impeccable/design.json`
- [x] AGENTS.md เอาประโยค "screens built before shadcn keep the shared classes" ออก
- [x] screenshot ทุกหน้าที่ 1440px และ 390px, browser tests ทั้งหมด และ `impeccable detect` บน `src/` ผ่าน

## Comments

- ลบ `@layer components` (`.btn-primary`, `.field`, `.tag`, `.alert-error`, `.menu-panel`, `.menu-item`), `.menu-select`, `.video-control`, `.compact-action`, `--shadow-popover` และกฎ `:not([data-slot])` ใน `@layer base` ที่ชะลอมาจากใบ 01 ออกจาก `src/index.css` แล้ว (ตรวจด้วย grep ใน `src/` ไม่เหลือ selector เหล่านี้)
- อัปเดต `DESIGN.md` › `Elevation & Depth` และ `Components`, `.impeccable/design.json` (schemaVersion 2) และ `AGENTS.md` ให้เหลือระบบ shadcn/ui + brand variants เพียงระบบเดียว (แก้รายละเอียดรัศมี `Badge`, hover/weight ของ `Button`, และ shadow tokens ให้ตรงโค้ดจริงตาม code review)
- ตรวจครบหลังแก้ล่าสุด: `tsc --noEmit`, `bun test` (95 pass, 17 ไฟล์), `vite build`, `impeccable detect src/` (0 findings), browser tests ทั้ง 7 ไฟล์ใน `tests/browser/` ผ่านทั้งหมด, และตรวจ screenshot ทุกหน้า (Job List, Mode Chooser, Generate Intake, Review Intake, Editor) ที่ 1440×900 และ 390×844 แล้วเรียบร้อย
