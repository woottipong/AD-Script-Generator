# 01: ต้อง login ก่อนใช้ Envisio

**What to build:** Author ที่ยังไม่ได้ login ถูกพาไปหน้า login ของ Keycloak (client `envisio-dev`) ก่อนเข้าทุกหน้า login แล้วกลับมาหน้าเดิม header แสดง email ที่ login อยู่พร้อมปุ่มออกจากระบบ ซึ่งออกจาก Keycloak ด้วย session อยู่ได้ 7 วัน ใน ticket นี้ทุกคนที่ login แล้วยังเห็นทุก Job (ownership อยู่ใน 02) ดู [spec](../spec.md) หัวข้อ Sign-in flow, Session cookie, Configuration, Route protection, Client และ [ADR-0004](../../../docs/adr/0004-keycloak-sign-in-with-server-session-cookie.md)

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] เซิร์ฟเวอร์ไม่ start และบอกชัดว่าขาดอะไรเมื่อไม่มี `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `SESSION_SECRET` (อย่างน้อย 32 ตัวอักษร) หรือ `APP_URL`; start ได้แม้ติดต่อ Keycloak ไม่ได้
- [x] `/auth/login?returnTo=` → Keycloak (code flow + PKCE S256 + state ผ่าน `openid-client`), `/auth/callback` สร้าง session แล้วกลับไป `returnTo` ที่เป็น path ในเว็บเดียวกันเท่านั้น, `/auth/logout` ลบ session แล้วไป `end_session_endpoint`
- [x] session cookie `envisio_session` httpOnly, SameSite=Lax, Secure เมื่อ `APP_URL` เป็น https, อายุ 7 วันไม่ต่ออายุ, ปิดผนึกด้วย AES-256-GCM จาก `node:crypto`; เก็บ `sub`, `email` (หรือ `preferred_username`), `allJobs` (จาก `groups` เทียบ `AUTH_ALL_JOBS_GROUPS` ตัด `/` นำหน้า), `id_token`, เวลาหมดอายุ; cookie ที่ถูกแก้หรือหมดอายุนับว่ายังไม่ login
- [x] `/api/*` ตอบ 401 `{ error, code: 'UNAUTHENTICATED' }` เมื่อไม่มี session ยกเว้น `/api/config`; การเปิดหน้าเว็บ (GET ที่รับ `text/html`) โดยไม่มี session redirect ไป `/auth/login?returnTo=<path>`; ไฟล์ static และ module ของ Vite เปิดได้
- [x] `GET /api/me` ตอบ `{ email, allJobs }`; header แสดง email และปุ่มออกจากระบบ
- [x] client ที่ได้ 401 จาก `/api` ใดก็ตามพาไป `/auth/login?returnTo=<path ปัจจุบัน>` จากจุดเดียว
- [x] integration tests ของเซิร์ฟเวอร์ใช้ session ที่ปิดผนึกด้วย `SESSION_SECRET` ของ test และมี test สำหรับ 401, `/api/config` ที่เปิด, `/api/me`, cookie ที่ถูกแก้หรือหมดอายุ, redirect หน้าเว็บ และการ start ที่ขาด env; browser tests mock `/api/me`
- [x] README, `.env.example`, API docs และ system constraints อธิบายการ login และ env ใหม่
