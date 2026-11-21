# TCC Envisio

ให้ทุกภาพมีเสียงเล่า · สร้างและตรวจแก้บทบรรยายภาพ

เว็บแอปทำบทบรรยายภาพภาษาไทย (Audio Description หรือ AD) มีสองโหมด:

- **สร้างบทบรรยาย (Generate Mode):** รับวิดีโอ MP4 480p ตรวจจับเสียงพูดบนเบราว์เซอร์ด้วย Silero VAD v6.2 (ONNX Runtime Web และ WebCodecs) ใน Web Worker เพื่อหาช่วงว่างไร้เสียงพูด แล้วส่งวิดีโอไปยัง Gemini Files API ให้เขียนบทบรรยายภาษาไทยในช่วงเหล่านั้น เซิร์ฟเวอร์ใช้ `gemini-4-hydrogen` เป็นหลัก และสลับไป `gemini-3.5-flash-lite` เมื่อเกิดข้อผิดพลาดชั่วคราว
- **แก้ไข SRT ที่มีอยู่ (Review Mode):** เปิดวิดีโอ MP4 ทุกความละเอียด (ไฟล์บนเครื่องหรือลิงก์) คู่กับไฟล์ SRT เดิม สแกนเสียงพูดบนเครื่อง แล้วชี้บรรทัดที่ต้องตรวจ โหมดนี้ไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์และไม่ใช้ Gemini

ทั้งสองโหมดตรวจและแก้บทกับเวลาในไทม์ไลน์เดียวกัน แล้วส่งออกเป็น SRT ตรวจผลกับวิดีโอต้นฉบับก่อนนำไปใช้งาน

## เริ่มต้นใช้งาน

1. เตรียม Node.js 22.12 ขึ้นไปและ Bun 1.4 ขึ้นไป หรือใช้ Docker Compose
2. คัดลอก `.env.example` เป็น `.env` แล้วตั้งค่า `GEMINI_API_KEY` หากมี `.env` อยู่แล้ว ให้แก้ไฟล์เดิม
3. ติดตั้งและเริ่มแอปด้วย `bun install --frozen-lockfile` แล้ว `bun run dev`
4. เปิด [แอปบนเครื่อง](http://localhost:3000) กด **งานใหม่** เลือกโหมด แล้วทำตามขั้นตอนบนหน้าจอ

ดูขั้นตอนโดยละเอียดและทางเลือก Docker ได้ที่ [การรันโปรเจกต์](#การรันโปรเจกต์) การตรวจเสียงทำในเบราว์เซอร์ทั้งสองโหมด มีเพียงการสร้างบทใน Generate Mode ที่ส่งวิดีโอไปยังเซิร์ฟเวอร์และ Gemini Files API

## สถาปัตยกรรม

| ส่วน | หน้าที่ |
|---|---|
| React และ Vite | หน้ารับวิดีโอ ไทม์ไลน์ และตัวแก้บทใน [src/App.tsx](src/App.tsx) และ [src/components](src/components) |
| Web Worker | ถอดรหัสเสียงและตรวจเสียงพูดด้วย Silero VAD ใน [vad.worker.ts](src/workers/vad.worker.ts) |
| Express และ Gemini | จัดการอัปโหลด สถานะงาน และวิเคราะห์วิดีโอใน [server.ts](server.ts) |
| ไฟล์ในเครื่อง | เก็บข้อมูลงานใน SQLite (`.data/envisio.db`) และไฟล์ของแต่ละงานไว้ใต้ `.data/jobs/` |

การตรวจไฟล์และ VAD ทำบนเครื่องผู้ใช้ เมื่อเริ่มสร้างบท เบราว์เซอร์ส่งวิดีโอและช่วงว่างไปยังเซิร์ฟเวอร์ เซิร์ฟเวอร์จึงอัปโหลดวิดีโอให้ Gemini และประมวลผลทีละชุด อ่านรายละเอียด endpoint ได้ใน [API reference](docs/API.md)

## เอกสาร

- [เริ่มต้นใช้งาน](#เริ่มต้นใช้งาน)
- [สถาปัตยกรรม](#สถาปัตยกรรม)
- [ข้อกำหนดระบบและไฟล์](#ข้อกำหนดระบบและไฟล์)
- [ค่าพารามิเตอร์เริ่มต้น](#ค่าพารามิเตอร์เริ่มต้น)
- [วิธีใช้งานและคีย์ลัด](#วิธีใช้งานและคีย์ลัด)
- [การตั้งค่า `.env`](#การตั้งค่า-env)
- [การรันโปรเจกต์](#การรันโปรเจกต์)
- [การจัดเก็บข้อมูลและสถานะงาน](#การจัดเก็บข้อมูลและสถานะงาน)
- [สรุป API](#สรุป-api)
- [รูปแบบการส่งออกข้อมูล](#รูปแบบการส่งออกข้อมูล)
- [คำสั่งตรวจสอบโค้ด](#คำสั่งตรวจสอบโค้ด)
- [แก้ปัญหาการติดตั้งและการรัน](#แก้ปัญหาการติดตั้งและการรัน)
- [API reference](docs/API.md)

## ข้อกำหนดระบบและไฟล์

### ข้อกำหนดเบราว์เซอร์

- แนะนำ Google Chrome หรือ Microsoft Edge เวอร์ชันล่าสุดบนคอมพิวเตอร์
- เบราว์เซอร์ต้องรองรับ WebCodecs `AudioDecoder` (codec `mp4a.40.2`), Web Workers และ WebAssembly หากไม่รองรับ ระบบจะแสดงข้อความแจ้งเตือนและระงับการตรวจจับเสียง

### ข้อกำหนดไฟล์วิดีโอ

ระบบตรวจสอบโครงสร้างไฟล์ MP4 ผ่าน `mp4box.js` (`src/utils/videoValidator.ts`) และปฏิเสธไฟล์ที่ไม่ผ่านเกณฑ์ เกณฑ์ด้านล่างใช้กับ Generate Mode ส่วน Review Mode ต้องการแค่ MP4 ที่มีเสียง AAC ยาวไม่เกิน 60 นาที:

- คอนเทนเนอร์: MP4 เท่านั้น
- โคเดกวิดีโอ: H.264 (`avc1` หรือ `avc3`)
- โคเดกเสียง: AAC ในตระกูล `mp4a` ที่ WebCodecs ถอดรหัสได้ ระบบตรวจการรองรับ `mp4a.40.2` ก่อนเริ่มใช้งาน เมื่อเลือกไฟล์จะตรวจ codec ในกลุ่ม `mp4a.40.*` ตามแทร็ก และใช้ `mp4a.40.2` เป็นค่าตรวจสำหรับ codec `mp4a` กลุ่มอื่น
- ความละเอียด: ความสูงต้องเป็น 480 พิกเซล ความกว้าง 854 พิกเซลเป็นค่ามาตรฐาน หากความกว้างต่างจากนี้ระบบเตือนแต่ยังรับไฟล์
- ความยาว: ไม่เกิน 30 นาที (1,800 วินาที)
- ขนาดไฟล์: ไม่เกิน `2000 × 1024 × 1024` ไบต์ หรือ 2,000 MiB โดย UI ใช้หน่วย MB
- แทร็ก: ต้องมีทั้งแทร็กวิดีโอและแทร็กเสียงอย่างน้อยอย่างละ 1 แทร็ก

การตรวจสเปกนี้ทำในเบราว์เซอร์ ไฟล์ที่มีข้อผิดพลาดจะแสดงปัญหาที่หน้าเลือกไฟล์และไม่เข้าสู่หน้าตัดต่อ รายละเอียดข้อจำกัดฝั่งเซิร์ฟเวอร์อยู่ใน [API reference](docs/API.md#validation-boundaries)

---

## ค่าพารามิเตอร์เริ่มต้น

### Silero VAD (ONNX Runtime Web บนเบราว์เซอร์)

- สัญญาณเสียง: `16,000 Hz` โมโน Float32 PCM (512 ตัวอย่าง หรือ 32 ms ต่อเฟรม)
- Speech threshold: `0.50` โดยปรับตามสัญญาณเสียงเป็น `0.48`, `0.50` หรือ `0.55`
- Min speech duration: `250 ms`
- Min silence duration: `400 ms`
- Speech padding: `200 ms`
- Minimum AD gap: `3,000 ms` (ตัดช่วงว่างที่สั้นกว่า 3 วินาทีออกจากการสร้างบทบรรยาย)

ระบบวิเคราะห์ระดับเสียงและผล VAD แล้วคำนวณช่วงว่างใหม่ด้วยค่าที่แนะนำ ค่า min speech, min silence และ padding จึงอาจต่างจากค่าเริ่มต้น ดูเงื่อนไขใน [vadPostProcess.ts](src/utils/vadPostProcess.ts)

### Gemini video analysis

- โมเดลหลัก: `gemini-4-hydrogen` (`thinkingLevel: LOW` และ `mediaResolution: MEDIA_RESOLUTION_LOW`)
- โมเดลสำรอง: `gemini-3.5-flash-lite` (ทำงานเมื่อโมเดลหลักติดข้อผิดพลาดชั่วคราวหรือ HTTP 503 โดยพักการใช้โมเดลหลัก 10 นาที)
- ช่วงเวลาต่อชุด: 240 วินาที
- กรอบบริบท: รวม 20 วินาทีก่อนชุดและ 10 วินาทีหลังชุด โดยจำกัดให้อยู่ในความยาววิดีโอ หากช่วงบรรยายข้ามขอบชุด ระบบขยายกรอบให้ครอบคลุมช่วงนั้นก่อนเพิ่มบริบท
- จัดชุดตามเวลาเริ่มของช่วงบรรยาย และไม่สร้างชุดสำหรับช่วงเวลาที่ไม่มีจุดบรรยาย
- อัตราความเร็วเสียงพูด: `11.5 ตัวอักษรฐานต่อวินาที`
- ระยะปลอดภัยขอบเสียง: หักออกหัวท้ายข้างละ `250 ms` ก่อนคำนวณความยาวข้อความบรรยาย

---

## วิธีใช้งานและคีย์ลัด

หน้าแรกเป็น **รายการงาน** ที่บันทึกไว้ เรียงตามแก้ล่าสุด แต่ละแถวบอกชื่องาน ชื่อไฟล์ โหมด สถานะ เวลาแก้ล่าสุด และขนาด กด **ทำต่อ** เพื่อเปิดงานที่ `/jobs/<job_id>` หรือ **ลบ** หลังยืนยัน ชื่องานตั้งจากชื่อไฟล์วิดีโอ แก้ได้ในขั้นเลือกไฟล์ของ Review Mode และเปลี่ยนชื่อได้ทุกเมื่อจากชื่องานบนแถบด้านบนของหน้าตัดต่อ กดโลโก้หรือเมนู **จัดการ > รายการงาน** เพื่อกลับมาหน้านี้ ปุ่ม **งานใหม่** พาไปเลือกโหมด **สร้างบทบรรยาย** (ขั้นตอนด้านล่าง) หรือ **แก้ไข SRT ที่มีอยู่** ซึ่งเลือกวิดีโอ MP4 จากเครื่องหรือวางลิงก์ `.mp4` กับไฟล์ SRT จากเครื่อง แล้วกดประมวลผล ลิงก์ต้องเปิดจากเบราว์เซอร์ได้ (CORS) และรองรับ HTTP Range ระบบเล่นวิดีโอจากลิงก์โดยตรงและดึงข้อมูลไปสแกนเสียงทีละช่วงโดยไม่เก็บลงเครื่อง เมื่อโหลดหน้าใหม่ งานกลับมาโดยไม่ต้องสแกนเสียงซ้ำ ถ้าวิดีโอมาจากลิงก์จะเล่นต่อได้ทันที ถ้ามาจากไฟล์บนเครื่องต้องเลือกไฟล์เดิม (ชื่อและขนาดตรงกัน) อีกครั้งก่อนเล่น ระหว่างนั้นยังแก้บทและส่งออกได้ ระบบสแกนเสียงบนเครื่อง เปิดบทใน SRT ในหน้าตัดต่อเดิม และส่งออกเป็น `<ชื่อไฟล์>_edited.srt` โหมดนี้ไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์และไม่ใช้ Gemini รับวิดีโอทุกความละเอียดที่มีเสียง AAC ยาวไม่เกิน 60 นาที

1. **เลือกวิดีโอ** ลากไฟล์ MP4 มาวางหรือกดเลือกไฟล์ เมื่อไฟล์ผ่านการตรวจสเปก ระบบถอดรหัสเสียงและประมวลผล VAD บนเครื่อง สถานะการทำงานแสดงโดยไม่ต้องเปิดรายละเอียด
2. **สร้างบทบรรยายภาพ** เมื่อ VAD เสร็จและพบช่วงว่าง กดสร้างบทบรรยายภาพ ระบบอัปโหลดวิดีโอส่วนละ 8 MiB ไปยังเซิร์ฟเวอร์ แล้ววิเคราะห์ทีละชุด 240 วินาที กดสถานะบน header เพื่อดูคิวและเลือกชุดที่ต้องการตรวจ
3. **ตรวจและส่งออก** เลือกช่วงจากไทม์ไลน์หรือรายการบทบรรยาย แก้ข้อความ ปรับเวลา แล้วส่งออก SRT

- เวลาเริ่มและเวลาจบต้องอยู่ในช่วงว่างต้นทาง ไม่ทับเสียงพูด และมีความยาวอย่างน้อย 500 ms
- หาก AI เลือก **ข้าม** ให้กด **บรรยาย** เพื่อเปิดใช้ช่วงนั้น ระบบใช้บทเดิมถ้ามี หรือใช้ข้อความเหตุผลของการข้ามเป็นข้อความตั้งต้น การสลับกลับไปข้ามไม่ลบบทเดิม
- ช่องค้นหา ตัวกรอง และปุ่ม **ต้องตรวจ** อยู่แถวบนสุดของรายการบท กด Escape ในช่องค้นหาเพื่อล้างคำค้น
- ปุ่ม **ต้องตรวจ** นับบรรทัดที่ควรดูก่อนส่งออก แยกตามชนิด กดชนิดใดเพื่อไปบรรทัดถัดไปของชนิดนั้น ใน Review Mode นับบรรทัดที่ทับเสียงพูด ทับบรรทัดอื่น สั้นกว่า 0.5 วินาที หรือเลยท้ายวิดีโอ ทั้งสองโหมดนับบรรทัดที่ข้อความน่าจะพูดนานกว่าช่วง ข้อนี้เป็นข้อมูล ไม่ใช่ข้อผิดพลาด เพราะ Extended AD ที่หยุดภาพระหว่างบรรยายใช้ช่วงยาวกว่าได้ คำเตือนทุกข้อไม่ขวางการบันทึกหรือส่งออก
- งานที่สร้างบนเซิร์ฟเวอร์บันทึกข้อความ สถานะ และเวลาให้อัตโนมัติ ข้อความ **บันทึกบนเซิร์ฟเวอร์แล้ว** แสดงหลังเซิร์ฟเวอร์ตอบรับ หากบันทึกไม่สำเร็จ ระบบเก็บสิ่งที่แก้ในหน้านั้นและมีปุ่มลองบันทึกอีกครั้ง
- งานที่ยังไม่สร้างบนเซิร์ฟเวอร์อยู่ในหน้านี้เท่านั้น เมื่อปิดหรือโหลดหน้าใหม่ ข้อมูลที่ยังไม่บันทึกบนเซิร์ฟเวอร์จะหายไป
- เมนู **จัดการ** ใช้เปลี่ยนวิดีโอ เริ่มงานใหม่ หรือสแกนเสียงใหม่เมื่อยังมีไฟล์ต้นทางในหน้านั้น ใน Review Mode มีเฉพาะเริ่มงานใหม่ การสแกนใหม่หรือสร้างบทใหม่อาจแทนข้อความและเวลาที่แก้ไว้
- **รายการงาน** แสดงขนาดงานที่บันทึกไว้และไฟล์อัปโหลดที่ยังไม่เสร็จ พร้อมให้เลือกลบหลังยืนยัน การลบย้อนกลับไม่ได้ งานที่กำลังวิเคราะห์และไฟล์ที่กำลังอัปโหลดจะลบไม่ได้
- หากเปลี่ยนวิดีโอหรือเริ่มงานใหม่ระหว่างอัปโหลด ผลตอบกลับของงานเดิมจะไม่เปลี่ยนหน้าจองานใหม่ หากเซิร์ฟเวอร์เริ่มประมวลผลแล้ว งานนั้นอาจทำต่อจนเสร็จ

### คีย์ลัดบนหน้าตัดต่อ

- `Alt + ArrowUp`: เลือกช่วงบรรยายก่อนหน้า
- `Alt + ArrowDown`: เลือกช่วงบรรยายถัดไป
- `Alt + P`: เล่นหรือหยุดวิดีโอ หากตำแหน่งอยู่นอกช่วงที่เลือก ระบบเริ่มเล่นจากช่วงนั้น วิดีโอเล่นต่อเมื่อพ้นช่วง เว้นแต่เปิดวนซ้ำ

---

## การตั้งค่า `.env`

ค่าตั้งค่าที่เกี่ยวข้องกับ [server.ts](server.ts) และ [vite.config.ts](vite.config.ts):

| ตัวแปร | การใช้งาน |
|---|---|
| `GEMINI_API_KEY` | จำเป็นเมื่อเรียก Gemini เซิร์ฟเวอร์อ่านจาก environment หรือ `.env` ผ่าน `dotenv` ค่าว่างและ `MY_GEMINI_API_KEY` ใช้งานไม่ได้ |
| `NODE_ENV` | ค่า `production` ให้เซิร์ฟเวอร์ใช้ไฟล์ใน `dist` ค่าอื่นใช้ Vite middleware |
| `DISABLE_HMR` | ค่า `true` ปิด HMR และ file watching ของ Vite ค่าอื่นเปิดไว้ โดย Docker Compose ตั้งเป็น `true` |
| `CHOKIDAR_USEPOLLING`, `CHOKIDAR_INTERVAL` | Docker Compose ส่งค่า `true` และ `300` ให้ file watcher ของเครื่องมือพัฒนา |
| `APP_URL` | มีใน `.env.example` แต่โค้ดแอปปัจจุบันไม่อ่านค่านี้ |
| `PORT` | พอร์ตที่ `server.ts` ฟัง ค่าเริ่มต้นคือ `3000` และ Dockerfile กำหนดไว้ที่ `3000` |

`GEMINI_API_KEY` ใช้ยืนยันตัวตนกับ Google เท่านั้น แอปไม่มีระบบล็อกอินหรือ middleware ตรวจสิทธิ์ผู้เรียก HTTP API ดู [ขอบเขตของ API](docs/API.md#base-configuration-and-conventions)

---

## การรันโปรเจกต์

### รันบนเครื่อง

ใช้ Node.js 22.12 ขึ้นไปในสาย 22 หรือเวอร์ชันใหม่กว่าที่ Vite รองรับ Dockerfile ใช้ `node:22-slim` และ Bun `1.4.4` โปรเจกต์ใช้ `bun.lock` รูปแบบ `lockfileVersion: 2` ซึ่งต้องใช้ Bun 1.4 ขึ้นไป

ก่อนรันครั้งแรก คัดลอกไฟล์ตัวอย่างแล้วตั้ง `GEMINI_API_KEY` ใน `.env` หากมี `.env` อยู่แล้ว ให้แก้ไฟล์เดิม:

```bash
test -e .env || cp .env.example .env
```

ตัวอย่างค่าที่ต้องแทนด้วย key ของคุณ:

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
```

ตรวจเวอร์ชันด้วย `node --version` และ `bun --version` ก่อนติดตั้ง

หากใช้ Bun 1.4 ขึ้นไป ให้รัน:

```bash
bun install --frozen-lockfile
bun run dev
```

หากใช้ npm ให้เพิ่ม `--legacy-peer-deps` เพื่อข้าม peer dependency conflict ระหว่าง Vite 8 และ esbuild ใช้ `--package-lock=false` เพื่อไม่สร้าง lockfile อีกชุด:

```bash
npm install --legacy-peer-deps --package-lock=false
npm run dev
```

เปิด [เว็บแอปบนเครื่อง](http://localhost:3000) เซิร์ฟเวอร์ฟังที่ `0.0.0.0:3000` ทั้งเว็บและ API ใช้พอร์ตเดียวกัน

`dev` เรียก `tsx server.ts` และ Vite HMR แต่ไม่เฝ้ารีสตาร์ต backend หากแก้ `server.ts` ให้หยุดแล้วรันใหม่ Docker Compose ใช้ `tsx watch` เพื่อรีสตาร์ต backend อัตโนมัติ

### รันด้วย Docker Compose สำหรับพัฒนา

ใช้ [Dockerfile.Dev](Dockerfile.Dev) และ [docker-compose.yml](docker-compose.yml) โดยปิด Hot Module Replacement (HMR) และรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติเมื่อแก้ backend:

```bash
docker compose up --build -d
```

รายละเอียดระบบ:

- พอร์ต `3000`: เว็บแอปพลิเคชันและ Express API
- โฟลเดอร์โปรเจกต์ mount เข้า `/app` ในคอนเทนเนอร์
- แก้ไขไฟล์ React หรือ CSS แล้วรีเฟรชหน้าเว็บเพื่อดูการเปลี่ยนแปลง
- แก้ไข `server.ts` เครื่องมือ `tsx watch` จะรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติ
- ข้อมูลงานและวิดีโอบันทึกลงไดเรกทอรี `.data/` บนเครื่องจริง

ดูบันทึกการทำงาน:

```bash
docker compose logs -f ad-script-generator
```

หยุดการทำงาน:

```bash
docker compose down
```

เมื่อแก้ dependencies ให้อัปเดต `package.json` และ `bun.lock` ด้วย Bun 1.4 ขึ้นไป แล้วสร้างคอนเทนเนอร์ใหม่พร้อมแทน anonymous volume ของ `node_modules` ข้อมูลงานยังอยู่ใน `.data/jobs` ของโปรเจกต์:

```bash
docker compose up --build --renew-anon-volumes -d
```

### รันด้วย Docker สำหรับ production

ใช้ stage `production` ใน [Dockerfile](Dockerfile) เพื่อ build หน้าเว็บ เซิร์ฟเวอร์ Express ยังต้องทำงานเพื่อให้บริการ API และวิดีโอ:

```bash
docker build --target production -t ad-script-generator:production .

mkdir -p .data
docker run --rm -d \
	--name ad-script-prod \
	--env-file .env \
	-p 3000:3000 \
	-v "$PWD/.data:/app/.data" \
	ad-script-generator:production
```

ดู log และหยุดคอนเทนเนอร์:

```bash
docker logs -f ad-script-prod
docker stop ad-script-prod
```

หากรัน production บนเครื่องโดยไม่ใช้ Docker ให้ build ก่อนแล้วเรียก `tsx`:

```bash
bun run build
NODE_ENV=production npx tsx server.ts
```

`npm start` เรียก `node server.ts` โดยตรง โค้ดปัจจุบันมี TypeScript imports ที่ไม่ระบุนามสกุล จึงใช้ `tsx` ตามตัวอย่างข้างต้น ส่วน `bun run preview` ให้บริการหน้าเว็บจาก Vite preview เท่านั้นและไม่เริ่ม Express API

---

## การจัดเก็บข้อมูลและสถานะงาน

งานประมวลผลจัดเก็บใน SQLite (`node:sqlite` ที่มากับ Node) และไฟล์ของแต่ละงาน:

- `.data/envisio.db`: ตาราง `jobs` (ชื่องาน สถานะ เมทาดาตาวิดีโอ ชุดวิเคราะห์) และ `job_spots` (รายการบทบรรยายภาพตามลำดับ)
- `.data/jobs/<job_id>/vad_output.json`: ผล VAD เขียนครั้งเดียวตอนสร้างงาน
- `.data/jobs/<job_id>/source_video.mp4`: ไฟล์วิดีโอต้นทางสำหรับสตรีมเล่นย้อนหลังและอัปโหลดซ้ำอัตโนมัติเมื่อไฟล์บน Gemini Files API หมดอายุ

แต่ละงานเปิดที่ URL `/jobs/<job_id>` ของตัวเอง การโหลดหน้าซ้ำจึงกลับมาที่งานเดิมและเล่นวิดีโอจากเซิร์ฟเวอร์ได้ และหลาย tab เปิดคนละงานพร้อมกันได้ หลังรีสตาร์ต backend ระบบกู้ทุกงานที่ค้าง โดยเปลี่ยนชุดที่ค้าง `processing` เป็น `pending` และเปลี่ยนงาน `ANALYZING` เป็น `VAD_READY` โดยยังไม่เรียก Gemini จนกว่าจะเริ่มงานต่อ

การเริ่มงานใหม่แค่ออกจากงานปัจจุบัน ไม่ลบโฟลเดอร์งานหรือวิดีโอ และไม่ใช่คำสั่งยกเลิกงานเบื้องหลัง ผู้ใช้สามารถดูและลบงานเก่าในรายการงานได้ ไม่มีการลบไฟล์เก่าอัตโนมัติ งานและ lock ใช้ร่วมกันภายในเซิร์ฟเวอร์หนึ่ง process

---

## สรุป API

เซิร์ฟเวอร์ให้บริการ REST API ภายใต้ prefix `/api`:

| Method | Path | หน้าที่ |
|---|---|---|
| `GET` | `/api/config` | อ่านค่าคอนฟิกเซิร์ฟเวอร์ |
| `GET` | `/api/jobs` | แสดงงานที่จัดเก็บและขนาดไฟล์ |
| `GET` | `/api/jobs/:jobId` | ดึงงานตาม ID เพื่อเปิดจาก URL และ client polling |
| `GET` | `/api/jobs/:jobId/video` | สตรีมไฟล์ MP4 รองรับ Range Request (HTTP 206) |
| `POST` | `/api/upload/init` | เริ่มเซสชันอัปโหลดแบบแบ่งชิ้น (Chunked Upload) |
| `POST` | `/api/upload/:uploadId/abandon` | จบเซสชันอัปโหลดเพื่อให้จัดการไฟล์ที่ค้างได้ |
| `POST` | `/api/upload/chunk` | เขียนข้อมูลไบนารีตาม byte offset จำกัด 25 MiB ต่อ request |
| `POST` | `/api/jobs/init` | ลงทะเบียนงานและเริ่มวิเคราะห์ Gemini เบื้องหลัง |
| `POST` | `/api/jobs/review` | ลงทะเบียนงานแก้ไข SRT ที่มีอยู่ โดยไม่เก็บวิดีโอ |
| `POST` | `/api/jobs/:jobId/start` | เริ่มหรือทำงานต่อจากชุดที่ค้างอยู่แบบ Asynchronous |
| `POST` | `/api/jobs/:jobId/analyze-batch` | วิเคราะห์ชุดข้อมูลทีละชุดแบบ Synchronous |
| `PATCH` | `/api/jobs/:jobId` | เปลี่ยนชื่องาน (Job Title) |
| `PATCH` | `/api/jobs/:jobId/spots` | แทนรายการบทบรรยายทั้งชุด พร้อมตรวจเวลา |
| `DELETE` | `/api/jobs/:jobId/files` | ลบไฟล์งานที่ไม่ได้กำลังวิเคราะห์หรืออัปโหลด |

อ่านรายละเอียดโครงสร้าง request, response และข้อจำกัดของ API ได้ที่ [docs/API.md](docs/API.md)

---

## รูปแบบการส่งออกข้อมูล

ส่งออกเป็น **SubRip Subtitle (`.srt`)** โดยรวมเฉพาะรายการที่มีการสร้างบทบรรยาย (`decision === 'generate'`) และมีข้อความ แล้วเรียงตามลำดับเวลา Review Mode ตั้งชื่อไฟล์เป็น `<ชื่อ SRT เดิม>_edited.srt`

---

## คำสั่งตรวจสอบโค้ด

คำสั่ง `lint` ตรวจชนิดข้อมูลด้วย `tsc --noEmit` ส่วน `bun test` รัน unit tests และ integration tests ใน `src/utils` โดย integration tests ใช้ข้อมูลและ Gemini จำลอง (`bun test` ต้องใช้ Bun 1.4 ขึ้นไปเพราะ Job store ใช้ `node:sqlite` ถ้า Bun บนเครื่องเก่ากว่าให้รันใน dev container ด้วย `docker exec -w /app <container> bun test`) `build` สร้างหน้าเว็บ และ `docker compose config --quiet` ตรวจรูปแบบ Compose:

```bash
bun run lint
bun test
bun run build
docker compose config --quiet
```

### ตรวจหน้าจอด้วยข้อมูลจำลอง

ต้องมี Node.js, npm และ Chromium ที่ Playwright ใช้งานได้ คำสั่ง `npx` อาจดาวน์โหลด Playwright CLI เมื่อยังไม่มีในเครื่อง การตรวจนี้จำลอง API ทุก endpoint และไม่ใช้ข้อมูลงานจริง หากยังไม่มี browser ที่ Playwright รองรับ ให้ติดตั้งตามคำแนะนำของ Playwright CLI

เริ่ม preview ใน terminal หนึ่ง:

```bash
bun run build
bun run preview --host 127.0.0.1 --port 4173 --strictPort
```

ในอีก terminal รัน:

```bash
npx --yes --package @playwright/cli playwright-cli -s=ad-check open http://127.0.0.1:4173/
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/job-lifecycle.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/editor.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/job-list.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/resume-cancel.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/review-mode.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/review-mode-url.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/review-restore.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check close
```

`review-mode.js` ต้องมีไฟล์ตัวอย่าง (ไม่ใส่ `+faststart` โดยตั้งใจ เพื่อทดสอบไฟล์ที่ `moov` อยู่ท้ายไฟล์) `/tmp/ad-review-1080p.mp4` และ `/tmp/ad-review.srt` สร้างได้ด้วย FFmpeg:

```bash
ffmpeg -f lavfi -i color=c=navy:s=1920x1080:r=25 -f lavfi -i sine=frequency=220:sample_rate=48000 -t 12 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/ad-review-1080p.mp4
```

```bash
printf '1\n00:00:01,000 --> 00:00:03,000\n<i>ชายเปิดประตู</i>\n\n2\n00:00:02,500 --> 00:00:04,000\nทับบรรทัดแรก\n\n3\n00:00:05,000 --> 00:00:07,500\nหญิงยิ้ม\nแล้วเดินออกไป\n\n4\n00:00:09,000 --> 00:00:09,300\nสั้น\n\n5\n00:00:10,000 --> 00:00:10,000\nไม่มีความยาว\n\n6\n00:00:20,000 --> 00:00:21,000\nเลยท้ายวิดีโอ\n' > /tmp/ad-review.srt
```

`review-mode-url.js` ใช้วิดีโอตัวอย่างจริงบนอินเทอร์เน็ต (71 MB ยาว 24:43) ต้องต่อเน็ต และใช้เวลาราวครึ่งนาที

ตรวจผล `Result` และข้อผิดพลาดของแต่ละคำสั่ง จากนั้นหยุด preview ใน terminal แรก การตอบ HTTP 500 ในการทดสอบ Job เป็นข้อผิดพลาดจำลองสำหรับตรวจปุ่มลองใหม่

### วัดการเล่นวิดีโอในหน้ารายการบท

สร้าง production build ของรุ่นก่อนและรุ่นหลังแยกกัน เช่น build รุ่นก่อนจาก checkout อื่นแล้วคัดลอกเนื้อหา `dist` ไปไว้ที่ `/tmp/ad-baseline` จากนั้นรัน `bun run build` ใน checkout ปัจจุบันเพื่อสร้าง `dist` สำหรับรุ่นหลัง

เตรียมไฟล์ MP4 H.264 ที่เล่นได้อย่างน้อย 4 วินาทีไว้ที่ `/tmp/ad-benchmark.mp4` หากมี FFmpeg ที่รองรับ `libx264` สามารถสร้างไฟล์จำลองได้ดังนี้:

```bash
ffmpeg -f lavfi -i color=c=black:s=854x480:r=25 -t 10 -c:v libx264 -pix_fmt yuv420p -movflags +faststart /tmp/ad-benchmark.mp4
```

ตัววัดใช้ Job จำลอง 300 ช่วงและไม่เปิดข้อมูลงานจริง

เริ่ม fixture server สองตัวใน terminal แยกกัน:

```bash
node tests/performance/fixture-server.cjs /tmp/ad-baseline /tmp/ad-benchmark.mp4 4174
node tests/performance/fixture-server.cjs dist /tmp/ad-benchmark.mp4 4175
```

ใน terminal ที่สาม เปิด Chromium ผ่าน Playwright CLI แล้วรันตัววัด:

```bash
npx --yes --package @playwright/cli playwright-cli -s=ad-perf open http://127.0.0.1:4174/
npx --yes --package @playwright/cli playwright-cli -s=ad-perf run-code --filename tests/performance/editor-playback.js
npx --yes --package @playwright/cli playwright-cli -s=ad-perf close
```

ตัววัดสลับ baseline กับ candidate อย่างละ 5 รอบ และตรวจจำนวนช่วงกับการเล่นจริง ผลเป็นเวลางาน main thread และ script ของทั้งหน้า ไม่ใช่เวลาเฉพาะรายการบท ตรวจช่วงค่า ภาระเครื่อง และ CPU profile ก่อนสรุปความแตกต่าง หยุด fixture server ทั้งสองเมื่อเสร็จ

## แก้ปัญหาการติดตั้งและการรัน

- หากพบ `UnknownLockfileVersion` ให้ตรวจ `bun --version` แล้วใช้ Bun 1.4 ขึ้นไป Bun 1.3.9 อ่าน lockfile เวอร์ชัน 2 ไม่ได้ อย่าสร้าง lockfile ใหม่ด้วยเวอร์ชันเก่า
- หาก npm ติด peer dependency conflict ให้ใช้คำสั่ง `--legacy-peer-deps --package-lock=false` ตามขั้นตอนด้านบน และคง `bun.lock` เป็น lockfile ของโปรเจกต์
- หาก `3000` ถูกใช้อยู่ ให้หยุด process ที่ใช้พอร์ตนั้นหรือเปลี่ยน host port ของ Docker เช่น `-p 13000:3000` หรือตั้ง `PORT` เมื่อรันบนเครื่อง
- หาก VAD ใช้งานไม่ได้ ให้ตรวจข้อความความเข้ากันได้ของเบราว์เซอร์ รวมถึงการโหลด `/models/silero_vad.onnx` และ `/ort/` จาก server เดียวกัน การเปิดไฟล์ HTML โดยตรงไม่เริ่ม API
- หากสร้างบทบรรยายไม่ได้ ให้ตรวจ `GEMINI_API_KEY` และ log ของเซิร์ฟเวอร์ การเปิดหน้าเว็บได้ไม่ได้ยืนยันว่า key มีสิทธิ์ใช้โมเดลหรือมีโควตา
- หาก backend รีสตาร์ตระหว่างวิเคราะห์ ให้เปิดงานเดิมแล้วกดทำต่อจากชุดที่ค้าง อย่าสแกนเสียงใหม่หากต้องการเก็บข้อความและเวลาที่แก้ไว้
