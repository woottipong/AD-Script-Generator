# การตรวจสอบโค้ด ทดสอบหน้าจอ และวัดประสิทธิภาพ

เอกสารนี้รวบรวมขั้นตอนการตรวจโค้ด การรัน browser tests ด้วยข้อมูลจำลอง และการวัดประสิทธิภาพการเล่นวิดีโอในหน้าตัดต่อ

## ตรวจชนิดข้อมูล เทสต์ และ build

`check` รวมการตรวจชนิดข้อมูล (`tsc --noEmit`), unit และ integration tests ใน `src/utils` (ข้อมูลและ Gemini จำลอง รวมถึง guardrail tests ใน `repoGuardrails.test.ts`) และ `build` ไว้ในคำสั่งเดียว `bun test` ต้องใช้ Bun 1.4 ขึ้นไปเพราะ Job store ใช้ `node:sqlite` จึงรันใน dev container ได้เสมอ:

```bash
docker compose exec envisio bun run check
```

ตรวจความถูกต้องของ Docker Compose config:

```bash
docker compose config --quiet
```

## ตรวจหน้าจอด้วยข้อมูลจำลอง (Browser tests)

ต้องมี Node.js, npm และ Chromium ที่ Playwright ใช้งานได้ คำสั่ง `npx` อาจดาวน์โหลด Playwright CLI เมื่อยังไม่มีในเครื่อง การตรวจนี้จำลอง API ทุก endpoint และไม่ใช้ข้อมูลงานจริง หากยังไม่มี browser ที่ Playwright รองรับ ให้ติดตั้งตามคำแนะนำของ Playwright CLI

build หน้าเว็บใน dev container แล้วเปิด service `preview` (เสิร์ฟ `dist` ที่ `127.0.0.1:4173` ตั้ง `PREVIEW_PORT` เพื่อเปลี่ยน port):

```bash
docker compose exec envisio bun run build
docker compose --profile test up -d preview
```

แล้วรันทุก script บนเครื่อง (ระบุชื่อไฟล์เพื่อรันเฉพาะบางไฟล์ได้) คำสั่งแสดง `ok`, `FAIL` พร้อมข้อความ error หรือ `skip` เมื่อไม่มีไฟล์ตัวอย่างใน `/tmp` ที่ script นั้นต้องใช้ และจบด้วย exit code ไม่เป็นศูนย์เมื่อมีไฟล์ที่ไม่ผ่าน:

```bash
bun run test:browser
```

### ไฟล์ตัวอย่างใน `/tmp`

- `create-mode.js` ต้องมีวิดีโอ MP4 480p ที่มีแทร็ก AAC และมีช่วงไม่มีเสียงพูดอย่างน้อย 3 วินาที:

```bash
ffmpeg -f lavfi -i color=c=navy:s=854x480:r=25 -f lavfi -i anullsrc=channel_layout=mono:sample_rate=44100 -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart /tmp/ad-generate-480p.mp4
```

- `review-mode.js` ต้องมีไฟล์ตัวอย่าง (ไม่ใส่ `+faststart` โดยตั้งใจ เพื่อทดสอบไฟล์ที่ `moov` อยู่ท้ายไฟล์) `/tmp/ad-review-1080p.mp4` และ `/tmp/ad-review.srt`:

```bash
ffmpeg -f lavfi -i color=c=navy:s=1920x1080:r=25 -f lavfi -i sine=frequency=220:sample_rate=48000 -t 12 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/ad-review-1080p.mp4
```

```bash
printf '1\n00:00:01,000 --> 00:00:03,000\n<i>ชายเปิดประตู</i>\n\n2\n00:00:02,500 --> 00:00:04,000\nทับบรรทัดแรก\n\n3\n00:00:05,000 --> 00:00:07,500\nหญิงยิ้ม\nแล้วเดินออกไป\n\n4\n00:00:09,000 --> 00:00:09,300\nสั้น\n\n5\n00:00:10,000 --> 00:00:10,000\nไม่มีความยาว\n\n6\n00:00:20,000 --> 00:00:21,000\nเลยท้ายวิดีโอ\n' > /tmp/ad-review.srt
```

- `review-mode-url.js` ใช้วิดีโอตัวอย่างจริงบนอินเทอร์เน็ต (71 MB ยาว 24:43) ต้องต่อเน็ต และใช้เวลาราวครึ่งนาที

หยุด preview ด้วย `docker compose --profile test stop preview` เมื่อเสร็จ การตอบ HTTP 500 ในการทดสอบ Job เป็นข้อผิดพลาดจำลองสำหรับตรวจปุ่มลองใหม่

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
