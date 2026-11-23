# TCC Envisio

ให้ทุกภาพมีเสียงเล่า · สร้างและตรวจแก้บทบรรยายภาพ

เว็บแอปทำบทบรรยายภาพภาษาไทย (Audio Description หรือ AD) ผู้ใช้เข้าสู่ระบบด้วย Keycloak และเลือกได้สองโหมด

- **สร้างบทบรรยาย (Generate Mode).** รับวิดีโอ MP4 480p ตรวจหาช่วงไร้เสียงพูดบนเบราว์เซอร์ด้วย Silero VAD แล้วให้ Gemini เขียนบทบรรยายในช่วงเหล่านั้น
- **ตรวจแก้ไฟล์ SRT (Review Mode).** เปิดวิดีโอ MP4 จากไฟล์บนเครื่องหรือลิงก์คู่กับ SRT เดิม แล้วชี้บรรทัดที่ต้องตรวจ โหมดนี้ไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์และไม่ใช้ Gemini

ทั้งสองโหมดแก้บทและเวลาในไทม์ไลน์เดียวกัน แล้วส่งออกเป็น SRT

## เอกสาร

| เอกสาร | อ่านเมื่อ |
|---|---|
| [คู่มือการใช้งาน](docs/usage.md) | ใช้งานแต่ละโหมด ข้อกำหนดไฟล์ คีย์ลัด และไฟล์ส่งออก |
| [system-constraints.md](docs/agents/system-constraints.md) | ต้องการค่า VAD/Gemini กฎการแก้เวลา หรือโครงสร้างข้อมูลใน `.data/` |
| [API.md](docs/API.md) | เรียกหรือแก้ `/auth/*` และ `/api/*` |
| [testing.md](docs/testing.md) | ติดตั้ง Playwright เตรียมไฟล์ทดสอบ หรือวัดประสิทธิภาพการเล่นวิดีโอ |
| [GLOSSARY.md](GLOSSARY.md) และ [docs/adr/](docs/adr/) | ตั้งชื่อแนวคิดในโดเมน หรือดูเหตุผลของการตัดสินใจ |
| [AGENTS.md](AGENTS.md) | ให้ agent ทำงานกับ repo นี้ |

## สถาปัตยกรรม

| ส่วน | หน้าที่ |
|---|---|
| React และ Vite | หน้ารายการงาน ไทม์ไลน์ และตัวแก้บทใน [src/App.tsx](src/App.tsx) และ [src/components](src/components) |
| Web Worker | ถอดรหัสเสียงด้วย WebCodecs และตรวจเสียงพูดด้วย Silero VAD ใน [vad.worker.ts](src/workers/vad.worker.ts) |
| Express และ Gemini | เข้าสู่ระบบ อัปโหลด สถานะงาน และวิเคราะห์วิดีโอใน [server.ts](server.ts) |
| `.data/` | SQLite `envisio.db` และไฟล์ของแต่ละงานใต้ `jobs/<job_id>/` |

ใน Generate Mode เบราว์เซอร์ส่งวิดีโอและผลตรวจเสียงไปเก็บบนเซิร์ฟเวอร์ตอนเตรียมงาน เมื่อผู้ใช้ยืนยัน เซิร์ฟเวอร์จึงอัปโหลดวิดีโอให้ Gemini Files API และวิเคราะห์ทีละชุด

## เริ่มต้นใช้งาน

ต้องมี Docker Compose หรือ Node.js 22.12+ กับ Bun 1.4+ เพราะ `bun.lock` เป็น `lockfileVersion: 2` ซึ่ง Bun ก่อน 1.4 อ่านไม่ได้

1. สร้าง `.env` จากไฟล์ตัวอย่าง คำสั่งนี้ไม่ทับ `.env` ที่มีอยู่แล้ว

   ```bash
   test -e .env || cp .env.example .env
   ```

   ตั้ง `SESSION_SECRET` ด้วยค่าจาก `openssl rand -base64 48` แล้วตรวจ `APP_URL`, `KEYCLOAK_ISSUER_URL` และ `KEYCLOAK_CLIENT_ID` ตั้ง `GEMINI_API_KEY` เมื่อต้องการสร้างบทด้วย AI ดู[การตั้งค่า `.env`](#การตั้งค่า-env)

2. เริ่มแอปด้วยวิธีใดวิธีหนึ่ง

   | วิธี | คำสั่ง | เปิดที่ |
   |---|---|---|
   | Docker Compose (แนะนำ) | `docker compose up --build -d` | http://localhost:3003 |
   | บนเครื่อง | `bun install --frozen-lockfile` แล้ว `bun run dev` | http://localhost:3000 |

   `APP_URL` ต้องตรงกับ origin ที่เปิด และ Keycloak client ต้องมี redirect URI `<APP_URL>/auth/callback`

3. เข้าสู่ระบบ กด **งานใหม่** แล้วทำตาม[คู่มือการใช้งาน](docs/usage.md)

### Dev container

[docker-compose.yml](docker-compose.yml) ใช้ stage `development` ของ [Dockerfile](Dockerfile) และ mount โฟลเดอร์โปรเจกต์เข้า `/app` เมื่อแก้ React หรือ CSS Vite HMR จะอัปเดตหน้าเว็บ เมื่อแก้ `server.ts` คำสั่ง `tsx watch` จะรีสตาร์ต backend ข้อมูลงานอยู่ใน `.data/` บนเครื่อง

```bash
docker compose logs -f envisio
docker compose down
```

`node_modules` อยู่ใน anonymous volume ของคอนเทนเนอร์ และ `node_modules/` บนเครื่องเป็นโฟลเดอร์ว่าง จึงต้องรันคำสั่ง `bun` ผ่าน `docker compose exec envisio ...` หลังแก้ `package.json` และ `bun.lock` ให้สร้างคอนเทนเนอร์และ volume ใหม่

```bash
docker compose up --build --renew-anon-volumes -d
```

### รันบนเครื่อง

`bun run dev` ไม่รีสตาร์ต backend เอง หลังแก้ `server.ts` ให้หยุดแล้วรันใหม่

ถ้าใช้ npm แทน Bun ให้ติดตั้งด้วย `npm install --legacy-peer-deps --package-lock=false` ตัวเลือกแรกข้าม peer conflict ระหว่าง Vite 8 กับ esbuild ตัวเลือกที่สองกันไม่ให้เกิด lockfile ชุดที่สองนอกจาก `bun.lock`

## การตั้งค่า `.env`

เซิร์ฟเวอร์ไม่ start หากขาดค่าที่ระบุว่า **จำเป็น**

| ตัวแปร | การใช้งาน |
|---|---|
| `APP_URL` | **จำเป็น** origin ที่เบราว์เซอร์เปิด เซิร์ฟเวอร์ใช้สร้าง redirect URI `<APP_URL>/auth/callback` และตั้ง cookie แบบ `Secure` เมื่อเป็น https |
| `KEYCLOAK_ISSUER_URL` | **จำเป็น** issuer ของ realm เช่น `https://accounts.rtt.in.th/auth/realms/rtt` |
| `KEYCLOAK_CLIENT_ID` | **จำเป็น** public client ใน Keycloak เช่น `envisio-dev` ใช้ PKCE แทน client secret |
| `SESSION_SECRET` | **จำเป็น** อย่างน้อย 32 ตัวอักษร ใช้เข้ารหัส session cookie ซึ่งมีอายุ 7 วัน เปลี่ยนค่าแล้วรีสตาร์ตจะทำให้ทุกคนออกจากระบบ |
| `GEMINI_API_KEY` | จำเป็นเมื่อสร้างบทด้วย AI ค่าว่างและค่าตัวอย่าง `MY_GEMINI_API_KEY` นับเป็นยังไม่ได้ตั้ง |
| `AI_DAILY_JOB_LIMIT` | จำนวนงานที่แต่ละคนส่งให้ Gemini วิเคราะห์ได้ต่อวันตามเวลาไทย ค่าเริ่มต้น `3` |
| `AUTH_ALL_JOBS_GROUPS` | กลุ่ม Keycloak ที่ได้ All-Jobs Access และเห็นทุกงาน คั่นด้วยจุลภาค ค่าเริ่มต้น `admin,supervisor` |
| `NODE_ENV` | `production` ให้เซิร์ฟเวอร์ใช้ไฟล์ใน `dist/` ค่าอื่นใช้ Vite middleware |
| `DISABLE_HMR` | `true` ปิด HMR และ file watching ของ Vite |
| `PORT` | พอร์ตที่ `server.ts` ฟัง ค่าเริ่มต้น `3000` |
| `DEV_PORT` | พอร์ตบนเครื่องของ dev container ค่าเริ่มต้น `3003` และใช้ตั้ง `APP_URL` ของ dev container |
| `APP_PORT` | พอร์ตบนเครื่องของ [docker-compose.prod.yml](docker-compose.prod.yml) ค่าเริ่มต้น `3000` |
| `APP_BIND` | IP ที่ production ผูกพอร์ต เช่น `127.0.0.1` เมื่ออยู่หลัง reverse proxy |
| `IMAGE_TAG` | แท็ก image ของ production ค่าเริ่มต้น `latest` |

ตั้ง Keycloak client ดังนี้

- ปิด Client authentication เพื่อให้เป็น public client และใช้ PKCE `S256`
- ลงทะเบียน Valid redirect URI `<APP_URL>/auth/callback` และ post-logout redirect `<APP_URL>/`
- เพิ่ม mapper แบบ Group Membership ที่ส่ง claim `groups` หรือ `group` มากับ token

เหตุผลของการออกแบบอยู่ใน [ADR-0004](docs/adr/0004-keycloak-sign-in-with-server-session-cookie.md)

## Production

### ขึ้นระบบและอัปเดต

[docker-compose.prod.yml](docker-compose.prod.yml) build stage `production` เป็น image `envisio:${IMAGE_TAG:-latest}` อ่านค่าจาก `.env` mount `.data/` ของเครื่องเพื่อเก็บงาน และตรวจสุขภาพผ่าน `/api/config` การขึ้นระบบครั้งแรกและการอัปเดตใช้คำสั่งเดียวกัน

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml down
```

- เซิร์ฟเวอร์สร้างและ migrate `.data/envisio.db` เองตอน start ถ้า database ใหม่กว่าโค้ด เช่นหลังถอยไปโค้ดเก่า เซิร์ฟเวอร์จะไม่ start และแจ้งเหตุใน log
- การอัปโหลดที่ยังไม่เสร็จและ lock การวิเคราะห์อยู่ในหน่วยความจำของ process จึงรันได้ instance เดียวต่อ `.data/` หนึ่งชุด
- ระบบไม่ลบงานหรือวิดีโอเก่าเอง ผู้ใช้ต้องลบจากรายการงานในแอป

### สำรองและกู้คืน

สำรองก่อนอัปเดตทุกครั้ง หยุดระบบก่อนคัดลอก `.data/` เพราะ SQLite อาจกำลังเขียนไฟล์

```bash
docker compose -f docker-compose.prod.yml stop
tar -czf "envisio-backup-$(date +%Y%m%d).tar.gz" .data
docker compose -f docker-compose.prod.yml start
```

กู้คืนด้วยการหยุดระบบ แตกไฟล์สำรองทับ `.data/` แล้วเริ่มระบบใหม่

### Image จาก CI

[release.yml](.github/workflows/release.yml) ตรวจโค้ดแล้ว push image ไปที่ `registry.rtt.in.th` เมื่อ push tag `v*`, `feature-*`, `fix-*` หรือ `beta-*` ส่วน tag `v*` จะ push ไป Docker Hub ด้วย

### รันโดยไม่ใช้ Docker

build แล้วรันด้วย `tsx`

```bash
bun run build
NODE_ENV=production npx tsx server.ts
```

`npm start` เรียก `node server.ts` ตรง ๆ ซึ่งรันโค้ดนี้ไม่ได้ ส่วน `bun run preview` เสิร์ฟเฉพาะหน้าเว็บและไม่เริ่ม Express API

## ตรวจสอบโค้ด

```bash
docker compose exec envisio bun run check
bun run test:e2e
bun run test:smoke
```

`check` รัน `tsc --noEmit`, unit test, integration test และ `vite build` ต้องรันใน dev container `test:e2e` ทดสอบหน้าจอด้วย Playwright กับ API จำลอง ส่วน `test:smoke` ทดสอบ container production จริง สองคำสั่งนี้รันบนเครื่องหลัง build `dist/` วิธีติดตั้งและไฟล์ทดสอบอยู่ใน [testing.md](docs/testing.md)

## แก้ปัญหา

- **`UnknownLockfileVersion`.** ใช้ Bun 1.4 ขึ้นไปทั้งตอนติดตั้งและตอนสร้าง `bun.lock` ใหม่
- **พอร์ตถูกใช้.** หยุด process ที่ใช้พอร์ตนั้น หรือเปลี่ยนพอร์ตด้วย `PORT` เมื่อรันบนเครื่อง `DEV_PORT` สำหรับ dev container หรือ `APP_PORT` สำหรับ production แล้วแก้ `APP_URL` และ redirect URI ใน Keycloak ให้ตรงกัน
- **VAD ใช้งานไม่ได้.** ดูข้อความแจ้งเตือนเรื่องเบราว์เซอร์ และตรวจว่าเซิร์ฟเวอร์ของแอปเสิร์ฟ `/models/silero_vad.onnx` กับ `/ort/` ได้ ต้องเปิดแอปผ่านเซิร์ฟเวอร์ การเปิดไฟล์ HTML ตรง ๆ จะไม่มี API
- **สร้างบทไม่ได้.** ตรวจ `GEMINI_API_KEY` กลุ่ม Keycloak ของบัญชี โควตารายวัน และ log ของเซิร์ฟเวอร์ หน้าเว็บที่เปิดได้ไม่ได้ยืนยันว่า key มีสิทธิ์ใช้โมเดลหรือยังมีโควตา
