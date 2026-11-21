# 08: ลบ class กลางและอัปเดตเอกสาร

Status: ready-for-agent

Blocked by: 02, 03, 04, 05, 06, 07

อ้างอิง: [spec](../spec.md) ส่วน Anti-goals

**What to build:** เมื่อทุกหน้าย้ายแล้ว แอปเหลือ UI ระบบเดียว ลบ class กลางที่ไม่มีใครใช้ และให้เอกสารบอกแค่วิธีเดียว

- [ ] ลบ `.btn-primary`, `.field`, `.tag`, `.banner-warning`, `.alert-error`, `.menu-panel`, `.menu-item`, `.menu-select` และ `.compact-action` ออกจาก `src/index.css` หลังจากตรวจด้วย grep ว่าไม่มีที่ใช้แล้ว
- [ ] DESIGN.md › Components เขียนใหม่โดยอ้าง component ของ shadcn และ variant ของแบรนด์ แทนรายการ class กลาง แล้วรัน `/impeccable document` เพื่ออัปเดต `.impeccable/design.json`
- [ ] AGENTS.md เอาประโยค "screens built before shadcn keep the shared classes" ออก
- [ ] screenshot ทุกหน้าที่ 1440px และ 390px, browser tests ทั้งหมด และ `impeccable detect` บน `src/` ผ่าน
