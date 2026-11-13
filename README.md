# AD Script Generator: ระบบสร้างบทบรรยายภาพภาษาไทยอัตโนมัติ

เว็บแอปพลิเคชันสร้างบทบรรยายภาพภาษาไทย (Audio Description หรือ AD) จากวิดีโอ MP4 ความละเอียด 480p โดยอัตโนมัติ ทำงานร่วมกันสองส่วน:

1. ตรวจจับเสียงพูดบนเบราว์เซอร์ด้วย Silero VAD v5 (ONNX Runtime Web และ WebCodecs AudioDecoder) ใน Web Worker เพื่อระบุช่วงว่างไร้เสียงพูด (Candidate AD Spots)
2. วิเคราะห์ภาพและเสียงช่วงว่างบนเซิร์ฟเวอร์ด้วย Gemini Files API (`gemini-3.8-flash` เป็นหลัก และสลับไป `gemini-3.5-flash-lite` เมื่อเกิดข้อผิดพลาดชั่วคราว) เพื่อสร้างบทบรรยายภาษาไทยที่มีความยาวและจังหวะเหมาะสม

---

## ข้อกำหนดระบบและไฟล์

### ข้อกำหนดเบราว์เซอร์

- แนะนำ Google Chrome หรือ Microsoft Edge เวอร์ชันล่าสุดบนคอมพิวเตอร์
- เบราว์เซอร์ต้องรองรับ WebCodecs `AudioDecoder` (codec `mp4a.40.2`), Web Workers และ WebAssembly หากไม่รองรับ ระบบจะแสดงข้อความแจ้งเตือนและระงับการตรวจจับเสียง

### ข้อกำหนดไฟล์วิดีโอ

ระบบตรวจสอบโครงสร้างไฟล์ MP4 ผ่าน `mp4box.js` (`src/utils/videoValidator.ts`) และปฏิเสธไฟล์ที่ไม่ผ่านเกณฑ์:

- คอนเทนเนอร์: MP4 เท่านั้น
- โคเดกวิดีโอ: H.264 (`avc1` หรือ `avc3`)
- โคเดกเสียง: AAC (`mp4a.40.2`)
- ความละเอียด: ความสูง 480 พิกเซล (มาตรฐาน 854 × 480 พิกเซล)
- ความยาว: ไม่เกิน 30 นาที (1,800 วินาที)
- ขนาดไฟล์: ไม่เกิน 2,000 MB (2 GB)
- แทร็ก: ต้องมีทั้งแทร็กวิดีโอและแทร็กเสียงอย่างน้อยอย่างละ 1 แทร็ก

---

## ค่าพารามิเตอร์เริ่มต้น

### Silero VAD (ONNX Runtime Web บนเบราว์เซอร์)

- สัญญาณเสียง: `16,000 Hz` โมโน Float32 PCM (512 ตัวอย่าง หรือ 32 ms ต่อเฟรม)
- Speech threshold: `0.50` (ปรับอัตโนมัติตามระดับเสียงรบกวนพื้นหลังระหว่าง 0.48 ถึง 0.55)
- Min speech duration: `250 ms`
- Min silence duration: `400 ms`
- Speech padding: `200 ms`
- Minimum AD gap: `3,000 ms` (ตัดช่วงว่างที่สั้นกว่า 3 วินาทีออกจากการสร้างบทบรรยาย)

### Gemini video analysis

- โมเดลหลัก: `gemini-3.8-flash` (`thinkingLevel: LOW` และ `mediaResolution: MEDIA_RESOLUTION_LOW`)
- โมเดลสำรอง: `gemini-3.5-flash-lite` (ทำงานเมื่อโมเดลหลักติดข้อผิดพลาดชั่วคราวหรือ HTTP 503 โดยพักการใช้โมเดลหลัก 10 นาที)
- ช่วงเวลาต่อชุด: 240 วินาที
- กรอบบริบท: ดึงวิดีโอล่วงหน้า 20 วินาที และหลังชุด 10 วินาที เพื่อให้โมเดลเข้าใจความต่อเนื่อง
- อัตราความเร็วเสียงพูด: `11.5 ตัวอักษรฐานต่อวินาที`
- ระยะปลอดภัยขอบเสียง: หักออกหัวท้ายข้างละ `250 ms` ก่อนคำนวณความยาวข้อความบรรยาย

---

## วิธีใช้งานและคีย์ลัด

1. **เลือกวิดีโอ**: ลากไฟล์ MP4 มาวาง หรือกดปุ่มเลือกไฟล์ ระบบจะถอดรหัสเสียงและประมวลผล VAD ทันที
2. **สร้างบทบรรยายภาพ**: เมื่อ VAD ทำงานเสร็จ กดปุ่มสร้างบทบรรยายภาพ ระบบจะแบ่งอัปโหลดวิดีโอส่วนละ 8 MB ไปยังเซิร์ฟเวอร์ และเริ่มวิเคราะห์ทีละชุด 240 วินาทีตามลำดับ
3. **ตรวจและปรับแต่งบทบรรยาย**: ตรวจสอบข้อความบนไทม์ไลน์ NLE ปรับแก้ข้อความ หรือปรับเวลาเริ่มต้นและสิ้นสุดของช่วงบรรยาย
4. **ส่งออกข้อมูล**: ส่งออกเป็นไฟล์ SubRip (`.srt`) หรือ JSON (`.json`)

### คีย์ลัดบนหน้าตัดต่อ

- `Alt + ArrowUp`: เลือกช่วงบรรยายก่อนหน้า
- `Alt + ArrowDown`: เลือกช่วงบรรยายถัดไป
- `Alt + P`: เล่นหรือหยุดวิดีโอเฉพาะช่วงบรรยายที่เลือก

---

## การตั้งค่า `.env`

คัดลอก `.env.example` เป็น `.env` และระบุ API key:

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
```

---

## การรันโปรเจกต์

### รันบนเครื่อง

โปรเจกต์ใช้ `bun.lock` รูปแบบ lockfileVersion 2 สำหรับ Bun เวอร์ชัน 1.4 ขึ้นไป:

- **กรณีใช้ Bun (เวอร์ชัน 1.4 ขึ้นไป)**:

```bash
bun install --frozen-lockfile
npm run dev
```

- **กรณีใช้ Node.js และ npm**:

เนื่องจากมีข้อขัดแย้ง peer dependency ระหว่าง Vite 8 และ esbuild ให้ติดตั้งผ่านแฟล็ก `--legacy-peer-deps`:

```bash
npm install --legacy-peer-deps
npm run dev
```

เปิดเว็บเบราว์เซอร์ที่ `http://localhost:3000`

### รันด้วย Docker Compose สำหรับพัฒนา

ใช้ [Dockerfile.Dev](Dockerfile.Dev) และ [docker-compose.yml](docker-compose.yml) ซึ่งรองรับ Hot Module Replacement (HMR) และรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติ:

```bash
docker compose up --build -d
```

รายละเอียดระบบ:

- พอร์ต `3000`: เว็บแอปพลิเคชันและ Express API
- พอร์ต `24678`: Vite HMR WebSocket
- โฟลเดอร์โปรเจกต์ mount เข้า `/app` ในคอนเทนเนอร์
- แก้ไขไฟล์ React หรือ CSS หน้าระบบจะอัปเดตผ่าน HMR ทันที
- แก้ไข `server.ts` เครื่องมือ `tsx watch` จะรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติ
- ข้อมูลงานและวิดีโอบันทึกลงไดเรกทอรี `.data/jobs/` บนเครื่องจริง

ดูบันทึกการทำงาน:

```bash
docker compose logs -f ad-script-generator
```

หยุดการทำงาน:

```bash
docker compose down
```

เมื่อแก้ไข dependencies ใน `package.json` ให้อัปเดต lockfile แล้วสั่ง build ใหม่พร้อมล้าง anonymous volume:

```bash
docker compose up --build --renew-anon-volumes -d
```

### รันด้วย Docker สำหรับ production

ใช้ stage `production` ใน [Dockerfile](Dockerfile) เพื่อคอมไพล์โค้ดฝั่งไคลเอนต์เป็น static assets:

```bash
# คอมไพล์ Image สำหรับ Production
docker build --target production -t ad-script-generator:production .

# รัน Container
docker run --rm -d \
  --name ad-script-prod \
  --env-file .env \
  -p 3000:3000 \
  -v "$PWD/.data/jobs:/app/.data/jobs" \
  ad-script-generator:production
```

---

## การจัดเก็บข้อมูลและสถานะงาน

งานประมวลผลจัดเก็บเป็นไฟล์ JSON ภายในไดเรกทอรี `.data/jobs/`:

- `.data/jobs/<job_id>/job.json`: เก็บสถานะงาน เมทาดาตาวิดีโอ ผล VAD รายการชุดวิเคราะห์ (Batches) และรายการบทบรรยายภาพ (Spots)
- `.data/jobs/<job_id>/source_video.mp4`: ไฟล์วิดีโอต้นทางสำหรับสตรีมเล่นย้อนหลังและอัปโหลดซ้ำอัตโนมัติเมื่อไฟล์บน Gemini Files API หมดอายุ
- `.data/jobs/active_job.json`: เก็บ pointer `{ "active_job_id": "<job_id>" }` เพื่อคืนสถานะงานเดิมเมื่อผู้ใช้โหลดหน้าเว็บใหม่

---

## สรุป API

เซิร์ฟเวอร์ให้บริการ REST API ภายใต้ prefix `/api`:

| Method | Path | หน้าที่ |
|---|---|---|
| `GET` | `/api/config` | อ่านค่าคอนฟิกเซิร์ฟเวอร์และตรวจสอบสถานะงานคงค้าง |
| `GET` | `/api/jobs/current` | อ่านสถานะงานล่าสุดจาก pointer |
| `GET` | `/api/jobs/:jobId` | ดึงสถานะงานตาม ID สำหรับ client polling |
| `GET` | `/api/jobs/:jobId/video` | สตรีมไฟล์ MP4 รองรับ Range Request (HTTP 206) |
| `POST` | `/api/upload/init` | เริ่มเซสชันอัปโหลดแบบแบ่งชิ้น (Chunked Upload) |
| `POST` | `/api/upload/chunk` | ส่งข้อมูลไบนารีชิ้นละไม่เกิน 25 MB ต่อเข้าไฟล์ |
| `POST` | `/api/jobs/init` | ลงทะเบียนงานและเริ่มวิเคราะห์ Gemini เบื้องหลัง |
| `POST` | `/api/jobs/:jobId/start` | เริ่มหรือทำงานต่อจากชุดที่ค้างอยู่แบบ Asynchronous |
| `POST` | `/api/jobs/:jobId/analyze-batch` | วิเคราะห์ชุดข้อมูลทีละชุดแบบ Synchronous |
| `PATCH` | `/api/jobs/:jobId/spots` | บันทึกการแก้ไขบทบรรยายและช่วงเวลา พร้อมตรวจความถูกต้อง |
| `DELETE` | `/api/jobs/:jobId` | ลบ pointer งานปัจจุบันออกจาก active_job.json |

อ่านรายละเอียดโครงสร้าง Payload, JSON Schema และตัวอย่างการเรียกใช้งานฉบับสมบูรณ์ได้ที่ [docs/API.md](docs/API.md)

---

## รูปแบบการส่งออกข้อมูล

ระบบรองรับการส่งออก 2 รูปแบบ:

1. **SubRip Subtitle (`.srt`)**: ส่งออกเฉพาะรายการที่มีการสร้างบทบรรยาย (`decision === 'generate'`) และมีข้อความ โดยเรียงตามลำดับเวลา
2. **JSON Schema v1.1 (`.json`)**: ส่งออกข้อมูลครบถ้วน ประกอบด้วย Video Metadata, VAD Configuration, รายการช่วงเวลาที่มีเสียงพูด (Speech Segments), Candidate Spots, บทบรรยายที่สร้าง (Generated Script), รายการที่ข้าม (Skipped Spots พร้อมเหตุผล) และประวัติการแก้ไขเวลา (Edited Timestamps)

---

## คำสั่งตรวจสอบโค้ด

```bash
# ตรวจสอบ TypeScript Types
npm run lint

# ตรวจสอบการคอมไพล์โปรดักชัน
npm run build

# ตรวจสอบความถูกต้องของ docker-compose.yml
docker compose config --quiet
```
