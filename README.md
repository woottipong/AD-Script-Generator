# TCC Envisio

ให้ทุกภาพมีเสียงเล่า · สร้างและตรวจแก้บทบรรยายภาพ

เว็บแอปทำบทบรรยายภาพภาษาไทย (Audio Description หรือ AD) มีสองโหมด:

- **สร้างบทบรรยาย (Generate Mode):** รับวิดีโอ MP4 480p ตรวจจับเสียงพูดบนเบราว์เซอร์ด้วย Silero VAD v6.2 (ONNX Runtime Web และ WebCodecs) ใน Web Worker เพื่อหาช่วงว่างไร้เสียงพูด แล้วส่งวิดีโอไปยัง Gemini Files API ให้เขียนบทบรรยายภาษาไทยในช่วงเหล่านั้น เซิร์ฟเวอร์ใช้ `gemini-4-hydrogen` เป็นหลัก และสลับไป `gemini-3.5-flash-lite` เมื่อเกิดข้อผิดพลาดชั่วคราว
- **ตรวจแก้ไฟล์ SRT (Review Mode):** เปิดวิดีโอ MP4 ทุกความละเอียด (ไฟล์บนเครื่องหรือลิงก์) คู่กับไฟล์ SRT เดิม สแกนเสียงพูดและเล่นวิดีโอบนเครื่อง แล้วชี้บรรทัดที่ต้องตรวจ โหมดนี้ไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์และไม่ใช้ Gemini (บันทึกเฉพาะข้อมูลงานและบทที่แก้บนเซิร์ฟเวอร์)

ทั้งสองโหมดตรวจและแก้บทกับเวลาในไทม์ไลน์เดียวกัน แล้วส่งออกเป็น SRT ตรวจผลกับวิดีโอต้นฉบับก่อนนำไปใช้งาน

## เริ่มต้นใช้งาน

1. เตรียม Node.js 22.12 ขึ้นไปและ Bun 1.4 ขึ้นไป หรือใช้ Docker Compose
2. คัดลอก `.env.example` เป็น `.env` แล้วตั้งค่า `GEMINI_API_KEY` และค่าการเข้าสู่ระบบ ([การตั้งค่า `.env`](#การตั้งค่า-env)) หากมี `.env` อยู่แล้ว ให้แก้ไฟล์เดิม
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

ระบบตรวจโครงสร้างไฟล์ MP4 ในเบราว์เซอร์ผ่าน `mp4box.js` ([videoValidator.ts](src/utils/videoValidator.ts)) และปฏิเสธไฟล์ที่ไม่ผ่านเกณฑ์ก่อนเข้าสู่หน้าตัดต่อ:

- **Generate Mode:** MP4 วิดีโอ H.264 (`avc1`/`avc3`) + เสียง AAC (`mp4a` ที่ WebCodecs ถอดรหัสได้), ความสูง 480p (มาตรฐาน 854×480; ความกว้างอื่นรับได้พร้อมคำเตือน), ยาวไม่เกิน 30 นาที, ขนาดไม่เกิน 2,000 MiB (UI แสดงหน่วย MB)
- **Review Mode:** MP4 ทุกความละเอียดที่มีแทร็กเสียง AAC ยาวไม่เกิน 60 นาที

ดูรายละเอียดกฎการตรวจสเปกและข้อจำกัดฝั่งเซิร์ฟเวอร์ทั้งหมดใน [system-constraints.md](docs/agents/system-constraints.md) และ [API reference](docs/API.md#validation-boundaries)

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

### รายการงาน (หน้าแรก)

- แสดงตารางงานที่บันทึกไว้ในคอลัมน์ **ชื่องาน**, **โหมด**, **สถานะ**, **ความยาว**, **บทบรรยาย**, **แก้ล่าสุด** และ **การทำงาน** (ขนาดไฟล์แสดงเฉพาะแถวอัปโหลดที่ยังไม่เสร็จและในหน้าต่างยืนยันการลบ)
- รองรับการค้นหา (**ค้นหาชื่องานหรือชื่อไฟล์**), ตัวกรองโหมดแบบปุ่มเลือก (**ทั้งหมด** / **สร้างบทบรรยาย** / **ตรวจแก้ SRT**), การเรียงลำดับคอลัมน์ (**ชื่องาน**, **ความยาว**, **บทบรรยาย**, **แก้ล่าสุด** — ค่าเริ่มต้นเรียงตามแก้ล่าสุด), การแบ่งหน้าครั้งละ 25 รายการ และรีเฟรชสถานะอัตโนมัติทุก 5 วินาทีขณะมีงานกำลังประมวลผล
- เปิดงานที่ `/jobs/<job_id>` ได้จากลิงก์ชื่องานหรือปุ่มไอคอน **เปิดงาน** และลบงานหรือไฟล์อัปโหลดที่ยังไม่เสร็จได้หลังยืนยัน (การลบย้อนกลับไม่ได้ งานที่กำลังวิเคราะห์หรือกำลังอัปโหลดจะลบไม่ได้)
- กลับมาหน้ารายการงานได้ทุกเมื่อโดยกดโลโก้ที่แถบด้านบน (**กลับรายการงาน**)

### เริ่มงานใหม่ (`/new`)

กด **งานใหม่** เพื่อเลือกแท็บ **สร้างบทบรรยาย** หรือ **ตรวจแก้ไฟล์ SRT** ทั้งสองโหมดกำหนด **ชื่องาน** เพิ่มเติมได้ตั้งแต่ขั้นเลือกไฟล์ (ค่าเริ่มต้นคือชื่อไฟล์วิดีโอแบบตัดนามสกุล สูงสุด 120 ตัวอักษร) และเปลี่ยนชื่อได้ทุกเมื่อที่แถบด้านบนของหน้าตัดต่อ

#### สร้างบทบรรยาย (Generate Mode)

1. **ตรวจเสียงและเตรียมงาน** ลากหรือเลือกไฟล์ MP4 มาเตรียมไว้ก่อน แล้วกด **ตรวจเสียงและเตรียมงาน** ระบบจะตรวจสเปกและตรวจเสียงบนเครื่อง จากนั้นส่งวิดีโอส่วนละ 8 MiB ไปเก็บบนเซิร์ฟเวอร์เพื่อบันทึกงาน (หากบันทึกไม่สำเร็จ กด **ลองบันทึกอีกครั้ง** เพื่อใช้ผลตรวจเสียงเดิม)
2. **สร้างบทบรรยายภาพ** เมื่อบันทึกงานสำเร็จและพบช่วงว่าง กด **สร้างบทบรรยายภาพ** ในหน้าตัดต่อเพื่อเริ่มวิเคราะห์ด้วย Gemini ทีละชุด 240 วินาที กดสถานะบนแถบด้านบนเพื่อดูคิวและเลือกชุดที่ต้องการตรวจ
3. **ตรวจและส่งออก** เลือกช่วงจากไทม์ไลน์หรือรายการบทบรรยาย แก้ข้อความ ปรับเวลา แล้วส่งออก SRT

#### ตรวจแก้ไฟล์ SRT (Review Mode)

- เลือกวิดีโอ MP4 จากเครื่องหรือวางลิงก์ `.mp4` (ต้องเปิดจากเบราว์เซอร์ได้/CORS และรองรับ HTTP Range) คู่กับไฟล์ `.srt` จากเครื่อง แล้วกด **เริ่มตรวจแก้**
- ระบบสแกนเสียงพูดบนเครื่องและเล่นวิดีโอจากเครื่องหรือลิงก์โดยตรงโดยไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์และไม่ใช้ Gemini ขณะที่เมทาดาตางานและบทบรรยายที่แก้บันทึกไว้บนเซิร์ฟเวอร์
- เมื่อเปิดงานกลับมาใหม่ไม่ต้องสแกนเสียงซ้ำ ถ้าวิดีโอมาจากลิงก์จะเล่นต่อได้ทันที ถ้ามาจากไฟล์บนเครื่องต้องเลือกไฟล์เดิม (ชื่อและขนาดตรงกัน) อีกครั้งก่อนเล่น ระหว่างนั้นยังแก้บทและส่งออกได้

### การแก้ไขในหน้าตัดต่อ

- เวลาเริ่มและเวลาจบใน Generate Mode ต้องอยู่ในช่วงว่างต้นทาง ไม่ทับเสียงพูด และมีความยาวอย่างน้อย 500 ms ส่วนใน Review Mode ปรับเวลาได้ตามความยาววิดีโอและช่วงข้างเคียง โดยการทับเสียงพูดแสดงเป็นคำเตือน (ดูรายละเอียดใน [system-constraints.md](docs/agents/system-constraints.md#editing-and-validation-rules))
- หาก AI เลือก **ข้าม** ให้กด **บรรยาย** เพื่อเปิดใช้ช่วงนั้น ระบบใช้บทเดิมถ้ามี หรือใช้ข้อความเหตุผลของการข้ามเป็นข้อความตั้งต้น การสลับกลับไปข้ามไม่ลบบทเดิม
- ช่องค้นหา (พร้อมปุ่ม `×` **ล้างคำค้นหา**), ตัวกรอง และปุ่ม **ต้องตรวจ** อยู่แถวบนสุดของรายการบท
- ปุ่ม **ต้องตรวจ** นับบรรทัดที่ควรดูก่อนส่งออก แยกตามชนิด กดชนิดใดเพื่อไปบรรทัดถัดไปของชนิดนั้น ใน Review Mode นับบรรทัดที่ทับเสียงพูด ทับบรรทัดอื่น สั้นกว่า 0.5 วินาที หรือเลยท้ายวิดีโอ ทั้งสองโหมดนับบรรทัดที่ข้อความน่าจะพูดนานกว่าช่วง ข้อนี้เป็นข้อมูล ไม่ใช่ข้อผิดพลาด เพราะ Extended AD ที่หยุดภาพระหว่างบรรยายใช้ช่วงยาวกว่าได้ คำเตือนทุกข้อไม่ขวางการบันทึกหรือส่งออก
- งานที่สร้างบนเซิร์ฟเวอร์บันทึกข้อความ สถานะ และเวลาให้อัตโนมัติ ข้อความ **บันทึกบนเซิร์ฟเวอร์แล้ว** แสดงหลังเซิร์ฟเวอร์ตอบรับ หากบันทึกไม่สำเร็จ ระบบเก็บสิ่งที่แก้ในหน้านั้นและมีปุ่มลองบันทึกอีกครั้ง ส่วนงานที่ยังไม่สร้างบนเซิร์ฟเวอร์อยู่ในหน้านี้เท่านั้น เมื่อปิดหรือโหลดหน้าใหม่ข้อมูลจะหายไป
- เมนู **จัดการงาน** ใน Generate Mode ใช้เปลี่ยนวิดีโอ เริ่มงานใหม่ สแกนเสียงใหม่ (เมื่อยังมีไฟล์ต้นทางในหน้านั้น) รวมถึง **ส่งออก SRT** (เมื่อปุ่มหลักเป็นเริ่มหรือทำต่อการสร้างบท) และ **สร้างบทบรรยายใหม่** ใน Review Mode มีเฉพาะเริ่มงานใหม่ การสแกนใหม่หรือสร้างบทใหม่อาจแทนข้อความและเวลาที่แก้ไว้
- หากเปลี่ยนวิดีโอหรือเริ่มงานใหม่ระหว่างอัปโหลด ผลตอบกลับของงานเดิมจะไม่เปลี่ยนหน้าจองานใหม่ หากเซิร์ฟเวอร์เริ่มประมวลผลแล้ว งานนั้นอาจทำต่อจนเสร็จ

### คีย์ลัดบนหน้าตัดต่อ

- `Alt + ArrowUp`: เลือกช่วงบรรยายก่อนหน้า
- `Alt + ArrowDown`: เลือกช่วงบรรยายถัดไป
- `Alt + P`: เล่นหรือหยุดวิดีโอ หากตำแหน่งอยู่นอกช่วงที่เลือก ระบบเริ่มเล่นจากช่วงนั้น วิดีโอเล่นต่อเมื่อพ้นช่วง เว้นแต่เปิดวนซ้ำ
- `Space` / `Enter` (เมื่อโฟกัสจอวิดีโอ): เล่นหรือหยุดวิดีโอ
- `Space` / `Enter` (เมื่อโฟกัสช่วงบรรยายบนไทม์ไลน์): เลือกช่วงบรรยายนั้นและเลื่อนเวลาไปจุดเริ่มต้นของช่วง
- `ArrowLeft` / `ArrowRight` (เมื่อโฟกัสแถบเลื่อนเวลาบนไทม์ไลน์): เลื่อนเวลาถอยหลังหรือไปข้างหน้าครั้งละ 1 วินาที (`Home` ไปต้นวิดีโอ, `End` ไปท้ายวิดีโอ)

---

## การตั้งค่า `.env`

ค่าตั้งค่าที่เกี่ยวข้องกับ [server.ts](server.ts) และ [vite.config.ts](vite.config.ts):

| ตัวแปร | การใช้งาน |
|---|---|
| `GEMINI_API_KEY` | จำเป็นเมื่อเรียก Gemini เซิร์ฟเวอร์อ่านจาก environment หรือ `.env` ผ่าน `dotenv` ค่าว่างและ `MY_GEMINI_API_KEY` ใช้งานไม่ได้ |
| `NODE_ENV` | ค่า `production` ให้เซิร์ฟเวอร์ใช้ไฟล์ใน `dist` ค่าอื่นใช้ Vite middleware |
| `DISABLE_HMR` | ค่า `true` ปิด HMR และ file watching ของ Vite ค่าอื่นเปิดไว้ โดย `docker-compose.yml` สำหรับพัฒนาตั้งเป็น `false` |
| `CHOKIDAR_USEPOLLING`, `CHOKIDAR_INTERVAL` | Docker Compose ส่งค่า `true` และ `300` ให้ file watcher ของเครื่องมือพัฒนา |
| `APP_URL` | จำเป็น origin ที่เบราว์เซอร์เปิด (`http://localhost:3003` เมื่อใช้ Docker Compose, `http://localhost:3000` เมื่อใช้ `bun run dev`) ใช้สร้าง redirect URI `<APP_URL>/auth/callback` และเปิด cookie แบบ `Secure` เมื่อเป็น https |
| `KEYCLOAK_ISSUER_URL` | จำเป็น issuer ของ realm เช่น `https://accounts.rtt.in.th/auth/realms/rtt` |
| `KEYCLOAK_CLIENT_ID` | จำเป็น client แบบ public ใน Keycloak เช่น `envisio-dev` ใช้ PKCE แทน client secret |
| `SESSION_SECRET` | จำเป็น อย่างน้อย 32 ตัวอักษร ใช้เข้ารหัส session cookie เปลี่ยนค่าแล้วรีสตาร์ตเพื่อให้ทุกคนออกจากระบบทันที |
| `AUTH_ALL_JOBS_GROUPS` | ไม่บังคับ กลุ่ม Keycloak ที่ได้ All-Jobs Access คั่นด้วยจุลภาค ค่าเริ่มต้น `admin,supervisor` |
| `PORT` | พอร์ตที่ `server.ts` ฟัง ค่าเริ่มต้นคือ `3000` และ Dockerfile กำหนดไว้ที่ `3000` |

เซิร์ฟเวอร์ไม่ยอม start หากขาดค่าที่จำเป็นของการเข้าสู่ระบบ ทุกหน้าและทุก API ยกเว้น `/api/config` ต้องเข้าสู่ระบบผ่าน Keycloak ก่อน session อยู่ได้ 7 วันนับจากเข้าสู่ระบบ ดู [ADR-0004](docs/adr/0004-keycloak-sign-in-with-server-session-cookie.md) และ [ขอบเขตของ API](docs/API.md#base-configuration-and-conventions) `GEMINI_API_KEY` ใช้ยืนยันตัวตนกับ Google เท่านั้น

ตั้งค่า client ใน Keycloak ดังนี้: ปิด Client authentication (public client) ใช้ PKCE `S256`, ลงทะเบียน Valid redirect URI `<APP_URL>/auth/callback` และ post-logout redirect `<APP_URL>/` (สำหรับพัฒนาคือ `http://localhost:3003/auth/callback` และ `http://localhost:3003/`) และเพิ่ม mapper แบบ Group Membership ที่ส่ง claim `groups` หรือ `group` มากับ token

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

ใช้ [Dockerfile.Dev](Dockerfile.Dev) และ [docker-compose.yml](docker-compose.yml) โดยเปิด Hot Module Replacement (HMR, `DISABLE_HMR=false`) และรีสตาร์ตเซิร์ฟเวอร์อัตโนมัติเมื่อแก้ backend:

```bash
docker compose up --build -d
```

รายละเอียดระบบ:

- พอร์ต `3003` บนเครื่อง (`3003:3000` ไปยังพอร์ต `3000` ในคอนเทนเนอร์): เปิดที่ [http://localhost:3003](http://localhost:3003) สำหรับเว็บแอปพลิเคชันและ Express API
- โฟลเดอร์โปรเจกต์ mount เข้า `/app` ในคอนเทนเนอร์
- แก้ไขไฟล์ React หรือ CSS แล้วหน้าเว็บอัปเดตผ่าน Vite HMR อัตโนมัติ (ไม่ต้องรีเฟรชเอง)
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

[docker-compose.prod.yml](docker-compose.prod.yml) build stage `production` ใน [Dockerfile](Dockerfile), mount `.data` ของเครื่องเข้าไปเก็บงาน, อ่านค่าจาก `.env`, เปิดที่พอร์ต 3000, รีสตาร์ตเองเมื่อเครื่องบูต และตรวจสุขภาพผ่าน `/api/config` ต้องมี `.env` ที่ใส่ `GEMINI_API_KEY` ก่อน (ดู `.env.example`)

**ขึ้นระบบครั้งแรก และอัปเดตเป็นโค้ดล่าสุด** ใช้คำสั่งเดียวกัน:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

ครั้งแรกระบบสร้าง `.data/envisio.db` และตารางให้เอง ส่วนการอัปเดตที่มีการเปลี่ยน schema ระบบจะรัน migration ที่ยังไม่ได้รันให้เองตอนเปิดเซิร์ฟเวอร์ ไม่ต้องรันคำสั่งเพิ่ม ถ้า database ใหม่กว่าโค้ด (เช่น ถอยกลับไปโค้ดเวอร์ชันเก่า) เซิร์ฟเวอร์จะไม่ยอมเปิดและแจ้งใน log แทนการเขียนทับข้อมูล

ดูสถานะ, log และหยุดระบบ:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml down
```

**สำรองข้อมูล** หยุดระบบก่อนแล้วคัดลอกโฟลเดอร์ `.data` ทั้งโฟลเดอร์ (ห้ามคัดลอกตอนระบบทำงาน เพราะ SQLite อาจกำลังเขียนไฟล์อยู่):

```bash
docker compose -f docker-compose.prod.yml stop
tar -czf "envisio-backup-$(date +%Y%m%d).tar.gz" .data
docker compose -f docker-compose.prod.yml start
```

กู้คืนด้วยการหยุดระบบ แตกไฟล์สำรองทับ `.data` แล้วเริ่มระบบใหม่ ควรสำรองก่อนอัปเดตทุกครั้ง

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

เซิร์ฟเวอร์ให้บริการ REST API ภายใต้ `/api` แบ่งเป็นกลุ่มหลัก:

- **คอนฟิกและงาน:** อ่านค่าคอนฟิก (`/api/config`), แสดงและเปิดงาน (`/api/jobs`, `/api/jobs/:jobId`), สตรีมวิดีโอแบบ HTTP Range (`/api/jobs/:jobId/video`), เปลี่ยนชื่องาน, บันทึกบทบรรยาย (`PATCH`) และลบงาน (`DELETE`)
- **อัปโหลดแบบแบ่งชิ้น:** เริ่มเซสชัน, ส่งข้อมูลทีละส่วน และยกเลิกไฟล์ค้าง (`/api/upload/*`)
- **สร้างงานและวิเคราะห์:** ลงทะเบียนงาน Generate Mode (`POST /api/jobs/init` ซึ่งรองรับ `autoStart: false` เพื่อบันทึกงานก่อนเริ่มวิเคราะห์ตามคำสั่งผู้ใช้), ลงทะเบียนงาน Review Mode (`POST /api/jobs/review`), และเริ่มหรือวิเคราะห์ชุดด้วย Gemini (`/api/jobs/:jobId/start`, `/api/jobs/:jobId/analyze-batch`)

ดูรายการ endpoint ทั้งหมด โครงสร้าง request/response และข้อจำกัดการตรวจสอบได้ที่ [docs/API.md](docs/API.md)

---

## รูปแบบการส่งออกข้อมูล

ส่งออกเป็น **SubRip Subtitle (`.srt`)** โดยรวมเฉพาะรายการที่มีการสร้างบทบรรยาย (`decision === 'generate'`) และมีข้อความ แล้วเรียงตามลำดับเวลา:

- **Generate Mode:** `<ชื่อไฟล์วิดีโอ>_thai_ad.srt`
- **Review Mode:** `<ชื่อ SRT เดิม>_edited.srt`

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
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/job-list-owners.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/create-mode.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/resume-cancel.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/review-mode.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/review-mode-url.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/review-restore.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check run-code --filename tests/browser/sign-in.js
npx --yes --package @playwright/cli playwright-cli -s=ad-check close
```

`create-mode.js` ต้องมีวิดีโอ MP4 480p ที่มีแทร็ก AAC และมีช่วงไม่มีเสียงพูดอย่างน้อย 3 วินาที สร้างได้ด้วย FFmpeg:

```bash
ffmpeg -f lavfi -i color=c=navy:s=854x480:r=25 -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart /tmp/ad-generate-480p.mp4
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
- หากพอร์ต `3000` (รันบนเครื่อง/production) หรือ `3003` (Docker Compose สำหรับพัฒนา) ถูกใช้อยู่ ให้หยุด process ที่ใช้พอร์ตนั้น เปลี่ยน host port ของ Docker หรือตั้ง `PORT` เมื่อรันบนเครื่อง
- หาก VAD ใช้งานไม่ได้ ให้ตรวจข้อความความเข้ากันได้ของเบราว์เซอร์ รวมถึงการโหลด `/models/silero_vad.onnx` และ `/ort/` จาก server เดียวกัน การเปิดไฟล์ HTML โดยตรงไม่เริ่ม API
- หากสร้างบทบรรยายไม่ได้ ให้ตรวจ `GEMINI_API_KEY` และ log ของเซิร์ฟเวอร์ การเปิดหน้าเว็บได้ไม่ได้ยืนยันว่า key มีสิทธิ์ใช้โมเดลหรือมีโควตา
- หาก backend รีสตาร์ตระหว่างวิเคราะห์ ให้เปิดงานเดิมแล้วกดทำต่อจากชุดที่ค้าง อย่าสแกนเสียงใหม่หากต้องการเก็บข้อความและเวลาที่แก้ไว้
