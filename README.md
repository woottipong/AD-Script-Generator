# AD Script Studio — ระบบสร้างบทบรรยายภาพภาษาไทยอัตโนมัติ

เว็บแอปพลิเคชันสำหรับสร้างบทบรรยายภาพภาษาไทย (**Audio Description Script**) จากวิดีโอ MP4 (480p) โดยอัตโนมัติ ใช้ **Browser-first Silero VAD** ร่วมกับ **Server-side Google Gemini Files API** โดยกำหนดค่าพารามิเตอร์ที่เหมาะสมที่สุดไว้ในระบบแล้วโดยไม่ต้องตั้งค่าเพิ่ม

---

## ค่าพารามิเตอร์ที่กำหนดไว้ในระบบแล้ว (Built-in Optimal Configuration)

- **Silero VAD (Browser ONNX Runtime Web)**:
  - Sample Rate: `16,000 Hz` Mono Float32 PCM (512 samples / 32 ms ต่อ Frame)
  - Speech Threshold: `0.50` (พร้อมระบบปรับจูนอัตโนมัติตาม Noise Floor ของเสียงในวิดีโอ)
  - Min Speech Duration: `250 ms`
  - Min Silence Duration: `400 ms`
  - Speech Padding: `200 ms`
  - Minimum AD Gap: `3,000 ms` (3 วินาที)
- **Gemini Video Analysis (`gemini-3.8-flash`)**:
  - Analysis Batch: `120 วินาที` (Context Before `20 วินาที` / Context After `10 วินาที`)
  - ความเร็วการพูดภาษาไทยมาตรฐาน: `11.5 ตัวอักษร/วินาที` (เว้นระยะปลอดภัยก่อน-หลังเสียงพูด `250 ms`)

---

## การตั้งค่า `.env`

ใช้เฉพาะ `GEMINI_API_KEY` บนฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ต้องตั้งค่าตัวแปร VAD หรือ Batch เพิ่มเติม:

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

---

## การรันโปรเจกต์

### รันบนเครื่อง

ใช้ Node.js และ Bun เวอร์ชันเดียวกับ [Dockerfile.Dev](Dockerfile.Dev) และตั้งค่า `.env` ตามด้านบน ติดตั้ง dependencies จาก `bun.lock` แล้วรันเซิร์ฟเวอร์:

```bash
bun install --frozen-lockfile
npm run dev
```

เปิดเว็บที่ `http://localhost:3000` คำสั่งนี้ใช้ Vite HMR สำหรับหน้าเว็บ เมื่อแก้โค้ด backend ให้หยุดแล้วรัน `npm run dev` ใหม่

### Docker สำหรับพัฒนา

เปิด Docker daemon และตั้งค่า `.env` ก่อนเริ่ม [docker-compose.yml](docker-compose.yml) จะ build จาก [Dockerfile.Dev](Dockerfile.Dev) และรันแอปด้วย Node.js ในโหมด development:

```bash
docker compose up --build -d
```

เปิดเว็บที่ `http://localhost:3000` โดยมีพฤติกรรมระหว่างพัฒนาดังนี้:

- โค้ดในโปรเจกต์ mount เข้า `/app` เมื่อแก้ React/CSS จะอัปเดตผ่าน Vite HMR ที่พอร์ต `24678`
- `tsx watch` รีสตาร์ต backend เมื่อแก้ `server.ts` หรือโมดูลที่เซิร์ฟเวอร์ใช้ การรีสตาร์ตจะหยุดงานวิเคราะห์ที่กำลังทำงานอยู่
- เปิด polling เพื่อให้ตรวจการเปลี่ยนไฟล์ผ่าน Docker Desktop ได้ โดยแยก `node_modules` ของ container ออกจากเครื่อง
- เก็บ jobs ไว้ที่ `./_data/jobs` บนเครื่อง ซึ่ง mount เข้า `/app/.data/jobs` และไม่ทำให้หน้าเว็บ reload เมื่อไฟล์ jobs เปลี่ยน

ดู log ระหว่างพัฒนา:

```bash
docker compose logs -f ad-script-generator
```

หยุด containers:

```bash
docker compose down
```

### เปลี่ยน dependencies หรือ environment

ทั้ง Docker สำหรับพัฒนาและ production ติดตั้ง dependencies จาก `bun.lock` ด้วย Bun เมื่อเปลี่ยน `package.json` ให้อัปเดต lockfile แล้ว build ใหม่พร้อมสร้าง anonymous volume ของ `node_modules` ใหม่:

```bash
bun install
docker compose up --build --renew-anon-volumes -d
```

คำสั่งนี้เก็บข้อมูล jobs ใน bind mount เดิมไว้ ส่วนการรันบนเครื่องติดตั้ง dependencies ด้วย `bun install` แล้วเริ่มเซิร์ฟเวอร์ใหม่

เมื่อเปลี่ยน `GEMINI_API_KEY` ใน `.env` ให้สร้าง container ใหม่เพื่อให้ Compose ส่งค่าล่าสุดเข้าเซิร์ฟเวอร์:

```bash
docker compose up -d --force-recreate ad-script-generator
```

[.dockerignore](.dockerignore) กันไฟล์ environment ที่มี secrets, jobs, `node_modules` และผล build ออกจาก image build context

### Docker สำหรับ production

[Dockerfile](Dockerfile) มี stage `production` ซึ่ง build หน้าเว็บเป็น static bundle และรันเซิร์ฟเวอร์โดยไม่มี hot reload:

```bash
docker build --target production -t ad-script-generator:production .
```

รัน image ที่ build แล้ว โดยหยุด development container ก่อนหากใช้พอร์ต `3000` เดียวกัน:

```bash
docker run --rm --env-file .env -p 3000:3000 \
  -v "$PWD/_data/jobs:/app/.data/jobs" \
  ad-script-generator:production
```

### ตรวจสอบการเปลี่ยนแปลง

ตรวจ TypeScript, build หน้าเว็บ และตรวจ Compose config:

```bash
npm run lint
npm run build
docker compose config --quiet
```

เมื่อแก้ Docker ให้ build และเปิด container จริง แล้วตรวจว่าหน้าเว็บเปิดได้ การแก้ React/CSS ส่ง HMR และการแก้ backend ทำให้เซิร์ฟเวอร์เริ่มใหม่ การ build และทดสอบใน container ต้องเปิด Docker daemon ส่วนการตรวจ Compose config ทำได้โดยไม่ต้องเปิด daemon
