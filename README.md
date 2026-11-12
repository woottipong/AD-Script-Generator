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
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
```

---

## การรันโปรเจกต์

```bash
npm install
npm run dev
```

หรือรันผ่าน Docker:

```bash
docker compose up --build -d
```
