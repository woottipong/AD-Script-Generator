# AD Script Studio: ระบบสร้างบทบรรยายภาพภาษาไทยอัตโนมัติ

เว็บแอปพลิเคชันสำหรับสร้างบทบรรยายภาพภาษาไทย (Audio Description หรือ AD) จากวิดีโอ MP4 ความละเอียด 480p โดยอัตโนมัติ สถาปัตยกรรมแบ่งเป็นสองส่วน:

1. ตรวจจับเสียงพูดบนเบราว์เซอร์ด้วย Silero VAD v5 (ONNX Runtime Web และ WebCodecs AudioDecoder) ใน Web Worker เพื่อระบุช่วงว่างไร้เสียงพูด (Candidate AD Spots)
2. วิเคราะห์ภาพและเสียงของวิดีโอช่วงเวลาว่างบนเซิร์ฟเวอร์ด้วย Google Gemini Files API (`gemini-3.8-flash` เป็นหลัก และสลับเป็น `gemini-3.1-flash-lite` เมื่อเกิดข้อผิดพลาดชั่วคราว) เพื่อสร้างบทบรรยายภาพภาษาไทยที่มีความยาวและจังหวะเหมาะสม

---

## ข้อกำหนดระบบและไฟล์วิดีโอ

### ข้อกำหนดเบราว์เซอร์

- แนะนำ Google Chrome หรือ Microsoft Edge เวอร์ชันปัจจุบันบนคอมพิวเตอร์
- เบราว์เซอร์ต้องรองรับ WebCodecs `AudioDecoder` (codec `mp4a.40.2`), Web Workers และ WebAssembly หากเบราว์เซอร์ไม่รองรับ ระบบจะแสดงแถบแจ้งเตือนและระงับการประมวลผล VAD

### ข้อกำหนดไฟล์วิดีโอ

ตัวตรวจความถูกต้องฝั่งไคลเอนต์ (`src/utils/videoValidator.ts`) ตรวจโครงสร้างไฟล์ผ่าน `mp4box.js` และปฏิเสธไฟล์ที่ไม่ตรงตามเกณฑ์ต่อไปนี้:

- Container: MP4 เท่านั้น
- Video Codec: H.264 (`avc1` หรือ `avc3`)
- Audio Codec: AAC (`mp4a.40.2`)
- Resolution: ความสูง 480 พิกเซล (สัดส่วนมาตรฐาน 854 × 480 พิกเซล)
- Duration: ไม่เกิน 30 นาที (1,800 วินาที)
- File size: ไม่เกิน 2,000 MB (2 GB)
- Track: ต้องมีทั้งแทร็กวิดีโอและแทร็กเสียงอย่างน้อยอย่างละ 1 แทร็ก

---

## ค่าพารามิเตอร์ในระบบ

### Silero VAD (ONNX Runtime Web บนเบราว์เซอร์)

- รูปแบบเสียง: `16,000 Hz` Mono Float32 PCM (512 samples / 32 ms ต่อเฟรม)
- Speech Threshold เริ่มต้น: `0.50` (ปรับจูนอัตโนมัติระหว่าง 0.48 ถึง 0.55 ตาม Noise Floor ของสัญญาณเสียง)
- Min Speech Duration: `250 ms`
- Min Silence Duration: `400 ms`
- Speech Padding: `200 ms`
- Minimum AD Gap: `3,000 ms` (3 วินาที ช่วงว่างที่สั้นกว่านี้จะไม่นำมาสร้างบทบรรยาย)

### Gemini Video Analysis

- โมเดลหลัก: `gemini-3.8-flash` (ตั้งค่า `thinkingLevel: LOW` และ `mediaResolution: MEDIA_RESOLUTION_LOW`)
- โมเดลสำรอง: `gemini-3.1-flash-lite` (ทำงานเมื่อโมเดลหลักเจอ HTTP 503, หมดเวลา หรือข้อผิดพลาดชั่วคราว พร้อมตั้ง cooldown 10 นาที)
- ขนาดชุดวิเคราะห์ (Batch): ช่วงเวลาวิดีโอ 120 วินาทีต่อชุด
- กรอบบริบท (Context Window): ดึงวิดีโอล่วงหน้า 20 วินาที และหลังชุด 10 วินาที เพื่อให้โมเดลเข้าใจเหตุการณ์ต่อเนื่อง
- อัตราความเร็วเสียงพูดภาษาไทยมาตรฐาน: `11.5 ตัวอักษรฐานต่อวินาที`
- ระยะปลอดภัยเสียงพูด: ลดเวลาหัวท้ายจุดละ `250 ms` เพื่อป้องกันเสียงบรรยายทับเสียงบทสนทนา

---

## วิธีใช้งานและคีย์ลัด

1. **เลือกวิดีโอ**: ลากไฟล์ MP4 มาวาง กดปุ่มเลือกไฟล์ หรือกดปุ่มเปิดวิดีโอตัวอย่าง 480p ระบบจะถอดรหัสเสียงและประมวลผล VAD บนเครื่องทันที
2. **สร้างบทบรรยายภาพ**: เมื่อ VAD ทำงานเสร็จ กดปุ่มสร้างบทบรรยายภาพ ระบบจะแบ่งอัปโหลดวิดีโอทีละส่วน (ชิ้นละ 8 MB) ไปยังเซิร์ฟเวอร์ และเริ่มวิเคราะห์ชุดข้อมูล 120 วินาทีตามลำดับ
3. **ตรวจและปรับแต่งบทบรรยาย**: ดูพรีวิวบนไทม์ไลน์ NLE ปรับแก้ข้อความภาษาไทย หรือขยับเวลาเริ่มต้นและสิ้นสุดของช่วงบรรยาย
4. **ส่งออกข้อมูล**: ส่งออกเป็นไฟล์ซับไตเติล SubRip (`.srt`) หรือโครงสร้าง JSON (`.json`)

### คีย์ลัดบนหน้าตัดต่อ

- `Alt + ArrowUp`: เลือกช่วงบรรยายก่อนหน้า
- `Alt + ArrowDown`: เลือกช่วงบรรยายถัดไป
- `Alt + P`: เล่นหรือหยุดวิดีโอเฉพาะช่วงบรรยายที่เลือก

---

## การตั้งค่า `.env`

คัดลอกไฟล์ตัวอย่าง `.env.example` ไปเป็น `.env` แล้วระบุ Gemini API Key:

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
```

---

## การรันโปรเจกต์

### รันบนเครื่อง

โปรเจกต์นี้ใช้ `bun.lock` รูปแบบ lockfileVersion 2 ซึ่งสร้างขึ้นจาก Bun เวอร์ชัน 1.4 ขึ้นไป (เช่น 1.4.4 ใน Dockerfile):

- **กรณีใช้ Bun (เวอร์ชัน 1.4 ขึ้นไป)**:

```bash
bun install --frozen-lockfile
npm run dev
```

- **กรณีใช้ Node.js และ npm (หรือ Bun รุ่นเก่า)**:

เนื่องจากมี peer dependency conflict ระหว่าง Vite 8 และ esbuild ในสภาพแวดล้อม npm ให้ติดตั้งด้วยแฟล็ก `--legacy-peer-deps`:

```bash
npm install --legacy-peer-deps
npm run dev
```

เปิดเว็บเบราว์เซอร์ที่ `http://localhost:3000`

### รันด้วย Docker Compose สำหรับพัฒนา

คำสั่งนี้ใช้ [Dockerfile.Dev](Dockerfile.Dev) และ [docker-compose.yml](docker-compose.yml) ซึ่งเปิด Hot Module Replacement (HMR) และรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติเมื่อแก้โค้ด:

```bash
docker compose up --build -d
```

รายละเอียดสภาพแวดล้อม:

- พอร์ต `3000`: เว็บแอปพลิเคชันและ Express API
- พอร์ต `24678`: Vite HMR WebSocket
- โค้ดในเครื่องจะ mount เข้า `/app` ใน container
- เมื่อแก้ไฟล์ React หรือ CSS หน้าระบบจะอัปเดตผ่าน HMR ทันที
- เมื่อแก้ `server.ts` เครื่องมือ `tsx watch` จะรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติ
- ข้อมูลงานและวิดีโอจะบันทึกลงในไดเรกทอรี `.data/jobs/` ของเครื่องผ่านการ mount โฟลเดอร์โปรเจกต์

ดูบันทึกการทำงาน (Logs):

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

คำสั่งนี้ใช้ stage `production` ใน [Dockerfile](Dockerfile) เพื่อคอมไพล์โค้ดฝั่งไคลเอนต์เป็น static assets:

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

งานประมวลผลจัดเก็บในรูปแบบไฟล์ JSON บนเซิร์ฟเวอร์ภายในไดเรกทอรี `.data/jobs/`:

- `.data/jobs/<job_id>/job.json`: เก็บสถานะงาน เมทาดาตาวิดีโอ ผล VAD รายการชุดวิเคราะห์ (Batches) และรายการบทบรรยายภาพ (Spots)
- `.data/jobs/<job_id>/source_video.mp4`: ไฟล์วิดีโอต้นทางที่อัปโหลด เพื่อใช้สตรีมดูย้อนหลังและอัปโหลดซ้ำอัตโนมัติหากไฟล์บน Gemini Files API หมดอายุ
- `.data/jobs/active_job.json`: เก็บ pointer ระบุ `{ "active_job_id": "<job_id>" }` เพื่องานที่กำลังเปิดอยู่เมื่อผู้ใช้โหลดหน้าเว็บใหม่

---

## สรุป API

เซิร์ฟเวอร์ให้บริการ REST API ภายใต้ prefix `/api`:

| Method | Path | หน้าที่ |
|---|---|---|
| `GET` | `/api/config` | อ่านค่าคอนฟิกเซิร์ฟเวอร์และตรวจว่ามีงานค้างอยู่หรือไม่ |
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
