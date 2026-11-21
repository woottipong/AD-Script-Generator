# ย้ายหน้าจอที่เหลือไปใช้ shadcn/ui

Status: ready-for-agent

ต่อจากงาน Job List ([job-list-sqlite](../job-list-sqlite/spec.md)) ที่ติดตั้ง shadcn/ui (style `base-nova` บน Base UI) และตั้ง token ให้ตรงแบรนด์ไว้แล้ว ใช้คำตาม [GLOSSARY.md](../../GLOSSARY.md) และกฎแบรนด์ใน [DESIGN.md](../../DESIGN.md)

## เป้าหมายและเหตุผล

ตอนนี้แอปมี UI สองระบบซ้อนกัน คือ shadcn ในหน้ารายการงาน กับ class กลางใน `src/index.css` (`.btn-primary`, `.field`, `.tag`, `.menu-panel`, `.menu-item`, `.menu-select`, `.banner-warning`, `.alert-error`, `.compact-action`) ในหน้าอื่นทั้งหมด งานนี้ย้ายหน้าที่เหลือมาใช้ component ของ shadcn ทีละส่วน จนลบ class กลางทิ้งได้ ผลที่ได้:

- เมนู, dialog, tooltip และ select ได้ keyboard และ accessibility ที่ถูกต้องจาก Base UI แทน `<details>` ที่ต้องเขียนปิดเมนูเอง
- `window.confirm` ทั้ง 6 จุดใน `App.tsx` กลายเป็น dialog ที่หน้าตาตรงแบรนด์ และทดสอบได้ด้วย role ปกติ
- ฟีเจอร์ login ที่จะทำต่อ ใช้ฟอร์มและ dialog ชุดเดียวกันได้ทันที

## Non-goals

- ไม่เปลี่ยนหน้าตาหรือ flow ที่ผู้ใช้เห็น นอกจากสิ่งที่ component ใหม่ให้มาเอง เช่น dialog แทนกล่องของเบราว์เซอร์ หรือ tooltip แทน `title`
- ไม่แตะ signature component ตาม DESIGN.md ได้แก่ Waveform Envelope (canvas), แทร็กไทม์ไลน์, Broadcast CC Pill, hairline progress bar และเวทีวิดีโอสีเข้ม
- ไม่เพิ่ม dark mode
- ไม่เปลี่ยน API, การบันทึก หรือกฎเวลาของ AD Spot

## Anti-goals

- ห้ามทำให้แถวบทใน editor กระตุก หรือ scroll กระโดดตอนกางหรือหุบ (DESIGN › Script Spot Row)
- ห้ามทำให้คีย์ลัดเดิมใช้ไม่ได้ (Alt+↑/↓, Alt+P และคีย์ของ player)
- ห้ามคง class กลางคู่กับ component ใหม่ไว้หลังจากหน้านั้นย้ายเสร็จ ย้ายส่วนไหนเสร็จต้องลบ class ที่ส่วนนั้นใช้ หรือย้ายที่ใช้ทั้งหมดของ class นั้นในใบเดียวกัน
- ห้ามแก้สีที่ call site (`className` ใช้กับ layout เท่านั้น) ถ้าต้องการสีใหม่ ให้เพิ่ม variant ใน component ที่ `src/components/ui`

## การตัดสินใจ

| เรื่อง | การตัดสินใจ |
|---|---|
| ลำดับ | วางพื้นฐานก่อน แล้วย้ายจากส่วนเสี่ยงน้อยไปเสี่ยงมาก (dialog และหน้า intake ก่อน, editor ทีหลังสุด) เพื่อให้แต่ละใบ ship และตรวจได้แยกกัน |
| ขนาดปุ่ม | ปรับ `button.tsx` ครั้งเดียวในใบที่ 01 ให้ตรง DESIGN: ปกติ 36px, `lg` 40px สำหรับ navbar, `icon-sm` 32px สำหรับปุ่ม transport และ 44px บน `pointer: coarse` แล้วลบกฎ `button { min-height }` ที่ตั้งทั้งแอปออก |
| variant สีเตือน | เพิ่ม `warning` ให้ `Alert` แบบเดียวกับที่ `Badge` มีแล้ว ใช้แทน `.banner-warning` |
| confirm | ทำ `confirm()` ตัวเดียวที่คืน `Promise<boolean>` และเรนเดอร์ `AlertDialog` ตัวเดียวใน `App` เพราะมีผู้เรียก 6 จุด รวม popstate ที่รอผลแบบ async อยู่แล้ว |
| เมนู `<details>` | เปลี่ยนเป็น `DropdownMenu` สำหรับเมนูคำสั่ง และ `Popover` สำหรับแผงข้อมูล (รายละเอียดงานที่มีฟอร์มเปลี่ยนชื่อ, รายละเอียดการทำงาน) |
| tooltip | `Tooltip` แทน `title` บนปุ่มไอคอน ซึ่งมี 17 จุดในส่วน transport และ zoom |
| dependency | Base UI เป็น package เดียว (`@base-ui/react`) ที่ติดตั้งแล้ว component ที่เพิ่มด้วย CLI จึงไม่ควรเพิ่ม dependency ใหม่ ถ้า CLI จะเพิ่ม ให้หยุดถามก่อน |
| การติดตั้ง component | `bun x --bun shadcn@latest add <name>` ใน dev container (Bun 1.4) ตาม AGENTS.md แล้วอ่านไฟล์ที่ได้ทุกครั้งก่อนใช้ |

## ส่วนของ UI ที่ต้องย้าย (สำรวจจากโค้ดปัจจุบัน)

| ไฟล์ | ของเดิม | ปลายทาง |
|---|---|---|
| `App.tsx` | `window.confirm` 6 จุด, `.banner-warning` 3 จุด (งานค้าง, เลือกวิดีโอเดิม, บรรทัด SRT ที่ไม่ได้นำเข้า), หน้าไม่พบงาน | `AlertDialog`, `Alert` warning + `Collapsible`, `Empty` |
| `ModeChooser.tsx` | การ์ดเลือกโหมด 2 ใบ | `Card` ที่กดได้ |
| `ReviewIntake.tsx` | ปุ่มเลือกไฟล์, ช่องลิงก์, ช่องชื่องาน, `.alert-error` | `Button` outline, `Field` + `Input`, `Alert` destructive |
| `VideoProcessingStatus.tsx` | progress ที่เขียนเอง | `Progress` |
| `UploadAndVadPanel.tsx` | intake, เมนู `จัดการ`, disclosure รายละเอียดงานกับฟอร์มเปลี่ยนชื่อ, status pill กับแผงคิว, ปุ่มสร้างบทและส่งออก, แถบ error | `Button`, `DropdownMenu`, `Popover` + `Field`, `Collapsible`, `Alert` |
| `VideoPreviewTimeline.tsx` | ปุ่ม transport, Loop/CC/Mute, zoom, `title` 17 จุด | `Button` icon, `Toggle`, `Tooltip` (ไทม์ไลน์และ canvas คงเดิม) |
| `AdScriptEditor.tsx` | ช่องค้นหา, `.menu-select` ตัวกรอง, เมนู `ต้องตรวจ`, สวิตช์ `บรรยาย | ข้าม`, `.tag`, `.compact-action`, ช่องเวลา, textarea | `InputGroup`, `Select`, `DropdownMenu`, `ToggleGroup`, `Badge`, `Button` ghost sm, `Input`, `Textarea` (คง Sarabun 1rem/1.75 ตาม Looped-Script Rule) |

## ลำดับ tickets

| # | ใบ | Blocked by |
|---|---|---|
| 01 | [พื้นฐาน: ขนาดปุ่ม, Alert warning, ขนาดบนจอสัมผัส](issues/01-foundations.md) | None |
| 02 | [Confirm dialog แทน `window.confirm`](issues/02-confirm-dialog.md) | 01 |
| 03 | [หน้าเลือกโหมดและ intake](issues/03-intake-screens.md) | 01 |
| 04 | [แถบเตือนและหน้าไม่พบงานใน App](issues/04-app-banners.md) | 01 |
| 05 | [Header ของ workspace](issues/05-workspace-header.md) | 01, 02 |
| 06 | [Transport และ tooltip ของ player](issues/06-player-transport.md) | 01 |
| 07 | [Script editor](issues/07-script-editor.md) | 01, 05 |
| 08 | [ลบ class กลางและอัปเดตเอกสาร](issues/08-cleanup.md) | 02–07 |

ใบที่ 02, 03, 04 และ 06 ทำพร้อมกันได้หลังใบที่ 01 เพราะแก้คนละไฟล์ ยกเว้นใบ 02 กับ 04 ที่แก้ `App.tsx` ทั้งคู่ ควรทำต่อกัน

## การตรวจของทุกใบ

1. `tsc --noEmit` และ `bun test` ผ่าน (ใน dev container จนกว่า Bun บนเครื่องจะเป็น 1.4)
2. browser tests ใน `tests/browser/` ผ่าน แก้ selector ที่เปลี่ยนเพราะ role หรือ label ของ component ใหม่ แต่ห้ามลดสิ่งที่เทสต์ตรวจ
3. ถ่าย screenshot หน้าที่แก้ที่ 1440px และ 390px เทียบกับก่อนแก้ ตรวจ focus ring, hover, disabled และสถานะว่าง
4. `impeccable detect` บนไฟล์ที่แก้ ต้องไม่มี finding
5. หน้าที่ไม่ได้แก้ต้องไม่เพี้ยน โดยเฉพาะ editor เพราะ token และกฎ base ของ shadcn มีผลทั้งแอป
