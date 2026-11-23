# การตรวจสอบโค้ด ทดสอบหน้าจอ และวัดประสิทธิภาพ

เอกสารนี้รวบรวมขั้นตอนการตรวจโค้ด การทดสอบ 4 ระดับ (`test:unit`, `test:integration`, `test:e2e`, `test:smoke`) และการวัดประสิทธิภาพการเล่นวิดีโอในหน้าตัดต่อ

## 1. Unit และ Integration Tests (`test:unit`, `test:integration`, `check`)

`bun test` ต้องใช้ Bun 1.4 ขึ้นไปเพราะ Job store ใช้ `node:sqlite` จึงรันใน dev container เสมอ:

- `test:unit`: รัน unit tests และ repo guardrail tests ใน `src/` (รวม `src/utils/repoGuardrails.test.ts`)
- `test:integration`: รัน integration tests สำหรับ Auth, Upload chunk และ Job lifecycle/storage ใน `tests/integration/`
- `check`: รวม `tsc --noEmit`, `bun run test` (`test:unit` + `test:integration`) และ `vite build` ไว้ในคำสั่งเดียว

```bash
docker compose exec envisio bun run test:unit
docker compose exec envisio bun run test:integration
docker compose exec envisio bun run check
```

ตรวจความถูกต้องของ Docker Compose config:

```bash
docker compose config --quiet
```

## 2. UI E2E Tests ด้วย Playwright (`test:e2e`)

การทดสอบหน้าจอใน `tests/e2e/ui/*.spec.ts` ใช้ `@playwright/test` จำลอง API และ Auth routes ทุก endpoint และไม่ใช้ข้อมูลงานจริง โดย `playwright.config.ts` จะเริ่มเซิร์ฟเวอร์ Node แบบ zero-dependency (`tests/e2e/serve-dist.mjs`) เพื่อเสิร์ฟ `dist/` และ `public/` บน `127.0.0.1:${PREVIEW_PORT:-4173}` ให้อัตโนมัติ

ต้องมี Node.js, `ffmpeg` (สำหรับสร้างไฟล์วิดีโอทดสอบอัตโนมัติ) และ Chromium ของ Playwright บนเครื่อง หากยังไม่เคยติดตั้ง Chromium สำหรับ Playwright ให้รันครั้งเดียว:

```bash
npx --yes @playwright/test install chromium
```

build หน้าเว็บใน dev container แล้วรัน `test:e2e` บนเครื่อง (สามารถระบุชื่อไฟล์เพื่อรันเฉพาะ spec ได้):

```bash
docker compose exec envisio bun run build
bun run test:e2e
```

### ไฟล์ตัวอย่างอัตโนมัติ (`tests/fixtures/`)

- `tests/fixtures/ad-review.srt` มีอยู่ใน repo แล้ว (6 cues สำหรับทดสอบ Review Mode)
- `tests/e2e/fixtures.ts` (`ensureVideoFixtures()`) สร้างไฟล์ต่อไปนี้ใน `tests/fixtures/.generated/` ด้วย `ffmpeg` อัตโนมัติหากยังไม่มี:
  - `ad-generate-480p.mp4`: MP4 480p (`854x480`, AAC mono, `-movflags +faststart`) สำหรับ `generate-mode.spec.ts`
  - `ad-review-1080p.mp4`: MP4 1080p (`1920x1080`, AAC sine wave, ไม่ใส่ `+faststart` เพื่อทดสอบไฟล์ที่ `moov` อยู่ท้ายไฟล์) สำหรับ `review-mode.spec.ts` และ `review-restore.spec.ts`
- `review-mode-url.spec.ts` ใช้ `tests/fixtures/review-url-speech.mp4` ไฟล์ 1080p ยาว 14 วินาทีที่มีเสียงพูดสังเคราะห์ เซิร์ฟเวอร์ทดสอบเสิร์ฟไฟล์จากคนละ origin ผ่าน HTTP Range เพื่อให้ Chromium ตรวจเสียงพูด เปิด editor และเลื่อนตำแหน่งวิดีโอจริง

การตอบ HTTP 500 ในการทดสอบ Job เป็นข้อผิดพลาดจำลองสำหรับตรวจปุ่มลองใหม่

#### ตรวจลิงก์ MP4 ภายนอก

เคสลิงก์จริงปิดไว้ในชุดหลัก รันแยกเมื่อต้องการตรวจว่าแหล่งวิดีโอภายนอกยังรองรับการตรวจเสียงและเลื่อนตำแหน่ง ไฟล์ตัวอย่างมีขนาด 71 MB และยาว 24:43 เคสนี้ต้องต่ออินเทอร์เน็ตและให้เวลาสูงสุด 5 นาที

```bash
RUN_EXTERNAL_MP4_SMOKE=1 bun run test:e2e review-mode-url.spec.ts --grep 'external MP4 URL'
```

## 3. Production Smoke Test (`test:smoke`)

`tests/e2e/smoke/app.spec.ts` ทดสอบ container production จริง (`envisio:latest`) แบบเต็มระบบ โดยเริ่ม container ชั่วคราวบน `127.0.0.1:4174` (แยก `.data` ภายใน container และใช้ dummy env vars หรือกำหนด `SMOKE_BASE_URL` เพื่อชี้ไปยัง instance ที่รันอยู่แล้ว) แล้วตรวจ:

- `GET /api/config` คืน HTTP 200 พร้อมฟิลด์คอนฟิก (`geminiModel`, `maxUploadSizeMb`, `vadThreshold`)
- `GET /api/jobs` ที่ยังไม่เข้าสู่ระบบคืน HTTP 401 พร้อม `code: 'UNAUTHENTICATED'`
- `GET /models/silero_vad.onnx` คืน HTTP 200 พร้อม header `cross-origin-resource-policy: cross-origin`
- `GET /` แบบยังไม่เข้าสู่ระบบคืน HTTP 302 ไปยัง `/auth/login?returnTo=%2F`
- การเปิด `/` ด้วย session cookie ที่ถูกต้องใน Chromium อยู่บน `/` โดยไม่ redirect, แสดงปุ่ม `บัญชี smoke@example.com` ของ SPA และไม่มี `pageerror`

build image production หากโค้ดเปลี่ยน แล้วรันบนเครื่อง:

```bash
docker build --target production -t envisio:latest .
bun run test:smoke
```

## วัดการเล่นวิดีโอในหน้ารายการบท (Playback benchmark)

สร้าง production build ของรุ่นก่อนและรุ่นหลังแยกกัน เช่น build รุ่นก่อนจาก checkout อื่นแล้วคัดลอกเนื้อหา `dist` ไปไว้ที่ `/tmp/ad-baseline` จากนั้นรัน `bun run build` ใน checkout ปัจจุบันเพื่อสร้าง `dist` สำหรับรุ่นหลัง

เตรียมไฟล์ MP4 H.264 ที่เล่นได้อย่างน้อย 4 วินาทีไว้ที่ `/tmp/ad-benchmark.mp4` หากมี FFmpeg ที่รองรับ `libx264` สามารถสร้างไฟล์จำลองได้ดังนี้:

```bash
ffmpeg -f lavfi -i color=c=black:s=854x480:r=25 -t 10 -c:v libx264 -pix_fmt yuv420p -movflags +faststart /tmp/ad-benchmark.mp4
```

ตัววัดใช้ Job จำลอง 300 ช่วงและไม่เปิดข้อมูลงานจริง เริ่ม fixture server สองตัวใน terminal แยกกัน:

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
