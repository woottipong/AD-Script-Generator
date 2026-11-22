---
name: TCC Envisio
description: Thai Audio Description (AD) NLE workstation pairing a dark broadcast video monitor with a calm, high-legibility Thai script editor.
colors:
  studio-cerulean: "oklch(50% 0.134 242.749)"
  studio-cerulean-hover: "oklch(44.3% 0.11 240.79)"
  studio-cerulean-active: "oklch(58.8% 0.158 241.966)"
  studio-cerulean-tint: "oklch(97.7% 0.013 236.62)"
  studio-cerulean-soft: "oklch(95.1% 0.026 236.824)"
  studio-cerulean-border: "oklch(90.1% 0.058 230.902)"
  studio-cerulean-ink: "oklch(29.3% 0.066 243.157)"
  cool-paper-canvas: "oklch(97.2% 0.008 250)"
  pure-surface: "#ffffff"
  broadcast-slate: "#020617"
  broadcast-ink: "#0f172a"
  muted-ink: "#475569"
  subtle-ink: "#64748b"
  placeholder-ink: "oklch(65% 0.036 257)"
  hairline-border: "#e2e8f0"
  control-border: "#cbd5e1"
  speech-indigo-wash: "#eef2ff"
  speech-indigo-capsule: "#e0e7ff"
  speech-indigo-border: "#a5b4fc"
  speech-indigo-dot: "#6366f1"
  speech-indigo-peak: "#4f46e5"
  amber-surface: "#fffbeb"
  amber-ink: "#92400e"
  amber-border: "#fde68a"
  error-surface: "#fef2f2"
  error-ink: "#991b1b"
  error-border: "#fecaca"
typography:
  headline:
    fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  script-body:
    fontFamily: "'Sarabun', 'IBM Plex Sans Thai', Tahoma, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0em"
  body:
    fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0em"
  timecode:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0em"
rounded:
  xs: "4.8px"
  sm: "6.4px"
  md: "8px"
  lg: "11.2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.studio-cerulean}"
    textColor: "{colors.pure-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.studio-cerulean-hover}"
  button-secondary:
    backgroundColor: "{colors.pure-surface}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  status-pill:
    backgroundColor: "{colors.studio-cerulean-tint}"
    textColor: "{colors.studio-cerulean-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  input-search:
    backgroundColor: "{colors.pure-surface}"
    textColor: "{colors.broadcast-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 10px 6px 32px"
    height: "36px"
  spot-card:
    backgroundColor: "{colors.pure-surface}"
    textColor: "{colors.broadcast-ink}"
    typography: "{typography.script-body}"
    rounded: "0px"
    padding: "14px 16px"
---

# Design System: TCC Envisio

## Overview

**Creative North Star: "The Broadcast Desk"**

TCC Envisio is an Operate-mode desktop workstation built for Thai Audio Description authors and reviewers. The interface behaves like a calm, quiet studio desk: a dark broadcast monitor on the left holds the video frame and timeline without chrome clutter, while a bright cool-paper editorial column on the right gives Thai narration scripts room to breathe. Every pixel earns its place by serving frame accuracy, speech-gap timing, or fast text revision.

The system is intentionally flat and restrained. Structure comes from crisp 1px hairline borders, tonal contrast between the dark video stage and the light script canvas, and a disciplined cerulean UI accent paired with a timeline-only soft indigo channel for detected speech. No decorative gradients, no rainbow status treatments, and no vertical banners that steal height from the video monitor or cause layout shifts during analysis.

**Key Characteristics:**
- Dark broadcast monitor stage paired with a cool-paper light editorial pane in a full-viewport (`100dvh`) desktop split.
- Single cerulean UI accent family (`studio-cerulean`), a deliberate timeline-only Soft Indigo semantic channel for Speech Segments, and semantic amber/red reserved strictly for timing warnings and errors.
- Looped Thai typography (`Sarabun`) for long-form script legibility, paired with `Plus Jakarta Sans` UI chrome and tabular `JetBrains Mono` timecodes.
- Flat 1px hairline architecture where elevation shadows appear only on floating overlays and popovers.
- Zero-shift asynchronous feedback via a compact header status pill and a 3px Material Design 3 hairline progress bar.

## Brand

- **Name:** `TCC Envisio`, always with the `TCC` house mark. `TCC` takes `brand-700`, `Envisio` takes `slate-900`, both 700 weight.
- **Tagline (Job List and intake navbar, page title):** `สร้างและตรวจแก้บทบรรยายภาพ`, 13px 500 `slate-600`, hidden below `sm`. It names what the app does and changes only when capabilities change (for example `เขียนบท สร้างเสียง ส่งออกงานบรรยายภาพ` once voice generation ships).
- **Slogan (README, meta description, presentations):** `ให้ทุกภาพมีเสียงเล่า`. It stays out of the working UI.
- **Logo:** a `brand-700` rounded-square tile (16px radius on a 64 grid) holding a white camera-viewfinder frame around a soundwave, with the centre bar in `sky-300` (`#7dd3fc`) marking the narration cue. `public/logo.svg` is the full mark (navbar, touch icon); `public/icon.svg` and `favicon.ico` are a simplified three-bar cut with heavier strokes so the tab icon stays legible at 16px.

## Colors

The palette pairs a single broadcast cerulean UI accent with cool paper and darkroom slate neutrals so the video picture and Thai script remain the visual focus.

### Primary
- **Studio Cerulean** (`studio-cerulean`, `--primary` / `brand-700`): Primary interactive actions (`สร้างบทบรรยายภาพ`, `ส่งออก SRT`, active Play button) and focus controls.
- **Studio Cerulean Hover** (`studio-cerulean-hover`, `brand-800`): Hover state on primary buttons and scrollbar thumbs.
- **Studio Cerulean Active** (`studio-cerulean-active`, `--ring` / `brand-600`): Progress bar fill, active focus rings, and the `AD` badge inside the floating CC pill.
- **Studio Cerulean Tint / Soft / Border** (`studio-cerulean-tint`, `studio-cerulean-soft`, `studio-cerulean-border`, `brand-50`/`100`/`200`): Tinted surfaces for soft-active transport toggles, active header status pill, selected spot highlight, and text selection background.
- **Studio Cerulean Ink** (`studio-cerulean-ink`, `--accent-foreground` / `brand-950`): High-contrast foreground text on cerulean-tinted surfaces.

### Neutral
- **Cool Paper Canvas** (`cool-paper-canvas`, `--color-canvas`): Scrollable backdrop behind the editorial spot list and page shells so white workspaces separate softly without heavy borders or shadows.
- **Pure Surface** (`pure-surface`, `--background` / `--card` / `--popover`): Top navigation bar, search/filter toolbar, flat spot rows, inputs, and floating disclosure menus.
- **Broadcast Slate** (`broadcast-slate`, `--stage` / `slate-950`): Dark video monitor stage (`#020617`) and translucent Broadcast CC Pill (`rgba(2, 6, 23, 0.80)` with backdrop blur) so bright video frames never wash out captions.
- **Broadcast Ink / Muted Ink / Placeholder Ink** (`broadcast-ink` `--foreground` `slate-900`, `muted-ink` `--muted-foreground` `slate-600`, `placeholder-ink` `--placeholder` `oklch(65% 0.036 257)`): Three-step slate ink hierarchy separating primary copy, secondary controls/labels, and form placeholders (applied globally via `input::placeholder, textarea::placeholder` and `placeholder:text-placeholder`). `subtle-ink` (`slate-500`) is used on timeline ruler timestamps.
- **Hairline Border / Control Border** (`hairline-border` `--border` `slate-200`, `control-border` `--input` `slate-300`): 1px structural dividers between panes and list rows, and crisp 1px strokes on inputs and secondary buttons.

### Semantic States
- **Speech-Track Soft Indigo** (`speech-indigo-*`, timeline-only): Deliberate semantic channel separating detected Speech Segments from Cerulean AD narration in the timeline — `bg-indigo-500` track label dot, `bg-indigo-50/25` track wash, flat `bg-indigo-100/90` capsules with `border-indigo-300/90`, and the speech-region waveform gradient (`rgba(165, 180, 252, 0.92)` → `rgba(79, 70, 229, 0.92)`). Never used for buttons, badges, or general UI chrome.
- **Amber Warning** (`--warning`, `--warning-foreground`, `--warning-border`, `--warning-strong`, `--warning-strong-foreground`, `--warning-strong-border`): Spoken-duration overflow warnings, timing-issue badges, pending batch badges, and incomplete-job resume notices.
- **Error Red** (`--destructive`, `--error-surface`, `--error-foreground`, `--error-border`): Blocking MP4 validation errors, failed jobs/batches, delete confirmations, and browser compatibility alerts.

### Named Rules
**The Single-Accent Rule.** Use `studio-cerulean` exclusively for interactive UI primary actions, active playback toggles, and progress signals. Reserve **Soft Indigo** strictly for Speech Segments on the timeline, and amber/red strictly for warnings and errors. Never introduce rainbow gradients or competing brand hues.

**The Dark-Stage Contrast Rule.** Captions overlaid on video must sit inside a translucent dark `broadcast-slate` container (`80%` opacity + backdrop blur), never directly over raw video pixels or a fading gradient.

## Typography

**Display & UI Font:** `Plus Jakarta Sans` paired with `IBM Plex Sans Thai` (OpenType stylistic alternates `cv02, cv03, cv04, cv11` for clean geometric UI numerals and Latin labels).
**Script Editing Font:** `Sarabun` (fallback `IBM Plex Sans Thai`, `Tahoma`, sans-serif) with default Thai feature settings for unmistakable consonant loops during fast proofreading.
**Timecode / Mono Font:** `JetBrains Mono` (fallback `ui-monospace, SFMono-Regular, monospace`) with mandatory `tabular-nums`.

**Character:** Clinical and editorial at once—geometric sans keeps dense toolbar controls crisp, while looped Thai letterforms reduce eye strain when reading and trimming audio description scripts.

### Hierarchy
- **Headline** (600, `1.5rem` / 24px, `text-2xl`, line-height `1.25`): Page headings (`รายการงาน` and `/new` intake heading `เริ่มงานบทบรรยายภาพ`), paired with a concise `text-sm` `muted-foreground` subtitle.
- **Title** (700, `1rem` / 16px, line-height `1.35`): The editable Job Title in the editor navbar, the TCC Envisio wordmark in the Job List and intake, and dialog and empty-state headings.
- **Script Body** (400, `1rem` / 16px, line-height `1.75`): Editable Thai AD script textareas and preview text.
- **Body** (400, `0.9375rem` / 15px, line-height `1.5`): General UI descriptions, intake guidance, and validation messages.
- **Label** (500, `0.8125rem` / 13px, line-height `1.5`): Buttons, status pills, filter selects, search inputs, and spot metadata.
- **Timecode** (500, `0.8125rem` / 13px, line-height `1.4`, `tabular-nums`): Video clock (`00:00.000 / 06:30`), spot start/end inputs, and elapsed processing timers.

### Named Rules
**The Tabular Timecode Rule.** Every timestamp, duration, percentage, and elapsed timer must render with `tabular-nums` (and `JetBrains Mono` for timecodes) so numbers never jitter horizontally during playback or live updates.

**The Looped-Script Rule.** Editable Thai AD script content always uses `Sarabun` at `1rem` (`1.75` line-height), keeping prose clearly distinct from UI chrome.

## Layout

Desktop-first NLE split workspace locked to the viewport (`100dvh`, `overflow-hidden` at `lg: 1024px+`) while degrading cleanly to a vertical scroll stack on smaller screens.

- **Top Command Navbar (`min-h-16` / 64px):** A white bar with a 1px cerulean hairline bottom border. In the editor, the Job List logo link sits beside the editable Job Title and a bordered `(i)` video metadata chip (`h-7 rounded-md` showing inline duration on `sm+` and resolution height on `md+`). A quiet status disclosure pill and the `จัดการงาน` ellipsis flank the primary action (`สร้างบทบรรยายภาพ`, `ทำต่อจากชุดที่ค้าง`, or `ส่งออก SRT`). On narrow screens, the actions move to a second row and use shorter status labels.
- **Hairline Progress Track (`3px`):** Anchored flush to the bottom edge of the navbar (`position: absolute; top: 0`) so processing states consume `0px` of vertical workspace height and cause zero layout shift.
- **Left Pane (`6 cols` on `lg`):** Unobstructed dark video monitor starting directly beneath the navbar (no redundant pane header), floating Broadcast CC Pill at the bottom edge of the video frame, pure-white transport control bar (`-5s`, `-1s`, Play/Pause, `+1s`, `+5s`, prev/next spot, soft-active Loop/CC/Mute toggles, timecode), slim muted timeline utility bar (`ช่วง X/Y`, conditional `xl:flex` square decision swatches, live hover/drag timecode, conditional `ซูมช่วงนี้`/`พอดี` + zoom controls), and an edge-to-edge 3-track timeline (`คลื่นเสียง` 56px, `เสียงพูด` 28px, `บรรยาย` 56px).
- **Right Pane (`6 cols` on `lg`):** Compact single-row Search + Filter + conditional `ต้องตรวจ` toolbar (`44px` / `py-2`) above an edge-to-edge white editorial list (`divide-y divide-border`) resting on `cool-paper-canvas` below the final item.
- **Touch & Pointer Rhythm:** Minimum interactive target height is `36px` (`2.25rem`) on desktop (`32px` for compact video transport buttons) and automatically expands to `44px` (`2.75rem`) on coarse pointers (`@media (pointer: coarse)`).

## Elevation & Depth

Surfaces are flat by default and separated by 1px hairline borders and tonal shifts (`pure-surface` panes and intake cards on `cool-paper-canvas`, `broadcast-slate` monitor against white chrome). Drop shadows are reserved exclusively for elements that float above the workspace plane so users can immediately distinguish transient overlays from docked panes.

### Shadow Vocabulary
- **Overlay Elevation** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` with `ring-1 ring-foreground/10`): Used on floating `DropdownMenu`, `Popover`, `Select` popups, and the floating inline-rename error card.
- **Popover / Stage Elevation** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): Used on nested `DropdownMenu` submenus and the floating Broadcast CC Pill over video.

### Named Rules
**The Flat-By-Default Rule.** Docked panes, toolbars, and script rows never carry drop shadows. Shadows appear only on floating popovers, menus, dialogs, and the video CC overlay.

## Shapes

Compact, utilitarian corner radii keep dense workstation controls crisp without looking harsh or toy-like.

- **Micro (`4px`–`6.4px`):** `4px` for the inline `AD N` caption badge and timeline speech/AD blocks; `6.4px` (`rounded-md`, `--radius-md`) for `Badge` micro-badges, `(i)` metadata chip, and compact icon tiles.
- **Control (`8px`, `rounded-lg`, `--radius`):** Primary/secondary buttons, status pills, search/form inputs, and filter selects.
- **Container (`8px` / `0px`):** Floating Broadcast CC Pill, dialogs, and header disclosure popovers use `8px` (`rounded-lg`); docked script spot rows are flat edge-to-edge list rows (`0px` radius, `divide-y divide-border`).
- **Intake Card (`11.2px`, `rounded-xl`, `--radius-xl`):** Centered `/new` intake and processing cards (`calc(var(--radius) * 1.4)`), holding `8px` (`rounded-lg`) dropzones and buttons inside.

## Components

All UI controls come from the **shadcn/ui** component library in `src/components/ui` (style `base-nova` on `@base-ui/react`), themed exclusively through the semantic CSS tokens in `src/index.css`: `--primary` (`studio-cerulean`), `--foreground`, `--muted-foreground`, and `--placeholder` (slate inks), `--stage` (`broadcast-slate`), `--border` and `--input` (hairline and control strokes), `--ring` (`studio-cerulean-active`), `--warning*` (amber warning pair), `--destructive` and `--error-*` (error red), and `--radius` (`0.5rem` / `8px` for `rounded-lg` controls and dialogs, `6.4px` for `rounded-md` micro-badges). Call sites pass layout classes via `className` and pick a semantic variant (with the navbar status pill's state-tinted surface in `UploadAndVadPanel` as the intentional exception). Every interactive button and link uses the app-wide 2px `studio-cerulean-active` focus outline with a 3px offset (`:focus-visible`), while text inputs and textareas keep their border-shift and ring focus.

### Buttons & Toggles
Compact, tactile controls with clear visual hierarchy between primary project actions, quiet utility controls, and stateful toggles.
- **Shape & Rhythm:** `8px` (`rounded-lg`) control rounding. `Button` sizes: `default` and `icon` `36px` (`h-9` / `size-9`), `lg` and `icon-lg` `40px` (`h-10` / `size-10`) for navbar and intake page CTAs, `sm` and `icon-sm` `32px` (`h-8` / `size-8`) for dense rows, timestamp steppers, and video transport, `xs` and `icon-xs` `24px` (`h-6` / `size-6`); all interactive `<button>`s and inputs expand to `44px` (`2.75rem`) on `@media (pointer: coarse)`. (Inline text triggers such as Job List titles and `ช่วง N` row headers stay text-height on desktop.)
- **Button Variants:** `default` (`studio-cerulean` fill, `pure-surface` `font-medium` label, `hover:bg-primary/80`), `outline` (`pure-surface` fill, `1px` `border-border`, `muted` hover tint), `outline-primary` (`pure-surface` fill, `1px` `border-border`, `studio-cerulean-tint` hover fill and `brand-300` hover border for secondary actions such as file selection), `secondary` (`slate-100` fill), `ghost` (transparent until hovered; used for compact row actions like `คืนเวลาเดิม` at `size="sm"` and icon steppers at `size="icon-sm"`), `ghost-destructive` (`muted-foreground` resting ink shifting to `destructive` tint/ink on hover for row delete actions), `warning` (amber surface/border/ink for the `ต้องตรวจ` trigger when timing issues exist), `destructive` (error red tint for delete confirmations), and `link` (inline cerulean text action such as `ลองบันทึกอีกครั้ง` or `ซูมช่วงนี้`).
- **Toggles (`Toggle` & `ToggleGroup`):**
  - **Soft-Active Transport Toggles (`Toggle` `size="icon"`):** `32px` controls for Loop, CC, and Mute. While `toggle.tsx` defaults pressed state to `bg-brand-100 text-brand-900 ring-brand-300`, the video transport bar overrides `aria-pressed="true"` to a quieter cerulean tint (`bg-brand-50 text-brand-700 ring-brand-200`, hover `bg-brand-100/80`) so active transport states never compete with the primary Play button.
  - **Concentric Segmented Toggle (`ToggleGroup appearance="segmented"`):** `8px` outer track (`border-border/90 bg-muted p-0.5 gap-0.5`) holding `6px`-radius (`calc(var(--radius) - 2px)`) `ToggleGroupItem` buttons:
    - **Spot Row Decision:** `variant="solid-primary"` (`studio-cerulean` fill, white text) for active `บรรยาย`, `variant="solid-muted"` (`slate-700` fill, white text) for active `ข้าม`.
    - **Job List Mode Filter:** White active pill (`aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs`) pairing mode labels (`ทั้งหมด`, `สร้างบทบรรยาย`, `ตรวจแก้ SRT`) with live `tabular-nums` counts.

### Badges & Alerts
- **Status Micro-Badges (`Badge`):** `6.4px` rounded (`rounded-md`), 1px-bordered pills with base height `min-h-6` (`24px`, `py-1`; Job List status badges compact to `h-auto min-h-5` with wrapping). Job List status badges pair each semantic fill with a non-color Lucide icon (`CheckCircle2`, `Clock`, `AlertCircle`, `AlertTriangle`, or spinning `Loader2`) so color is never the sole channel:
  - `info`: `brand-50` fill, `brand-200` border, `brand-900` ink (`บรรยาย` idle status).
  - `info-strong`: `brand-100` fill, `brand-200` border, `brand-900` ink (`กำลังวิเคราะห์` / `กำลังอัปโหลด` active work).
  - `warning`: `amber-50` fill, `amber-200` border, `amber-800` ink (`รอสร้าง` / `รอวิเคราะห์` / `อัปโหลดไม่สมบูรณ์`).
  - `warning-strong`: `amber-100` fill, `amber-300` border, semibold `amber-900` ink (timing issues: `ทับเสียงพูด`, `ทับบรรทัดอื่น`, `สั้นกว่า 0.5 วินาที`, `เลยท้ายวิดีโอ`).
  - `secondary`: `slate-100` fill, `border-border` (`พร้อมแก้` for `READY` in the Job List, `ข้าม`, `ยาวกว่าช่องว่าง`, and Job List count badges).
  - `destructive`: `error-surface` (`#fef2f2`) fill, `error-border` (`#fecaca`) border, `error-foreground` (`#991b1b`) ink (`ผิดพลาด`, `วิเคราะห์ไม่สำเร็จ`).
  - **Passive Text States:** Non-interactive row cues stay plain text, never `Badge` pills: `แก้ไขแล้ว` in muted slate and `ตำแหน่งวิดีโอ` in cerulean text with a `6px` dot.
- **Inline & Strip Notices (`Alert`):** `variant="destructive"` (error surface, ink, and border) for blocking validation and timestamp errors; `variant="warning"` (amber surface, ink, and border) for non-blocking notices; `placement="strip"` (full-width flush bar under the navbar, paired with `Collapsible` when details expand) for unfinished analysis, local video relink prompts, and unimported SRT lines.

### Overlays, Menus & Dialogs
- **Menus (`DropdownMenu`):** White surface, `ring-1 ring-foreground/10`, Overlay Elevation shadow (`shadow-md`), keyboard navigation, Escape and outside-click dismissal, and focus return for the `จัดการงาน` navbar menu and `ต้องตรวจ` jump menu. Uses `DropdownMenuItem variant="primary"` for primary filter links and `variant="destructive"` for delete actions.
- **Disclosures (`Popover`) & Video Metadata `(i)` Chip:** White surface with Overlay Elevation shadow for the `ข้อมูลวิดีโอ` metadata popover and `รายละเอียดการทำงาน` queue panel. The navbar trigger is a bordered `(i)` chip (`h-7 rounded-md border-border/70 bg-muted/40`, expanding to `44px` on coarse pointers) showing the `Info` icon plus inline duration (`sm+`) and resolution height (`· 480p`, `md+`). Hover/focus previews the original filename and `duration · resolution (W × H)` in a `Tooltip`; click/tap opens the `Popover` adding file size.
- **Confirmations (`AlertDialog`):** The Job List confirms file and Job deletion in its own modal. The workspace shares an app-level confirmation for leaving unsaved edits and resetting or replacing a video.
- **Tooltips (`Tooltip`):** Dark compact shortcut hints (`Alt + P`, `Alt + ↑/↓`, seek/zoom controls, `แก้ไขชื่อ`) replacing native browser `title` attributes across the header, transport, and zoom bar.

### Inputs, Search Toolbar & Forms
- **Form Fields (`Field` + `Input`):** `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` structure intake inputs. `Input` uses `pure-surface` fill, `1px` `border-input`, `8px` radius, `36px` (`h-9`) height, `--placeholder` placeholder ink, and a cerulean focus ring.
- **Navbar Inline Rename:** Hovering the editor Job Title reveals a subtle border (`hover:border-input hover:bg-muted/50`) and the `แก้ไขชื่อ` tooltip. Activating it swaps in a CSS Grid auto-width mirror (`inline-grid` with an invisible `whitespace-pre` span + overlaid `Input`, `maxLength={120}`) in identical `text-base font-bold leading-[1.35]` typography. Enter or blur commits; Escape discards; saving displays a right-aligned `Spinner`; server acknowledgement shows a 2.5s `Check` icon; local-only titles retain a muted `ชื่ออยู่เฉพาะในหน้านี้` subtitle; save errors float beneath the navbar in a `bg-popover shadow-md` notice (zero header-height shift) with `ลองอีกครั้ง` and `ยกเลิก` actions.
- **Editor Search & Filter Toolbar (`InputGroup` + `Select` + `DropdownMenu`):** Single-row `44px` editorial bar inside the right pane. `InputGroup` (`flex-1`, `36px` height) houses a leading `14px` magnifying glass `InputGroupAddon`, `InputGroupInput` (`type="search"`), and a conditional inline-end `×` clear `InputGroupButton` (`ล้างคำค้นหา`, refocuses the input). Beside it sits a `Select` (`w-36 sm:w-40`, `36px` `SelectTrigger` with `SelectContent` popup) filtering spots (`ทั้งหมด`, `มีบทบรรยาย`, `รอสร้าง`, `ข้ามการบรรยาย`, `แก้ไขแล้ว`, `ต้องตรวจ`) with live counts, followed by a conditional `ต้องตรวจ N` `DropdownMenu` trigger (`variant="warning"` with `AlertTriangle` when timing issues exist, `variant="outline"` with `Clock` when only duration-fit checks remain) for jumping to or filtering flagged spots.
- **Script Textarea (`Textarea`):** `variant="default"` uses `field-sizing-content` for standard forms; `variant="script"` enforces the Looped-Script Rule (`Sarabun` `1rem / 1.75` line-height), disables automatic field-sizing in favour of `useLayoutEffect` auto-grow with scroll compensation, softens focus to a `2px` `brand-100` ring, and renders skipped drafts in a disabled muted surface (`disabled:border-border disabled:bg-muted/80 disabled:text-muted-foreground disabled:opacity-100`) so authors never mistake a skipped draft for deleted work.

### Job List Table & Intake Cards
- **Job List Header & Toolbar (`Table`, `InputGroup`, `ToggleGroup`, `Empty`):** The page header pairs `รายการงาน` (`text-2xl`) with a `Badge variant="secondary"` total count (`N รายการ`, or a matching `Skeleton` while loading) alongside refresh and `งานใหม่` actions. Inside the `bg-card` table container sits a toolbar combining an `InputGroup` search box (`ค้นหาชื่องานหรือชื่อไฟล์` with inline-end `×` clear button and filtered count) and a `segmented` `ToggleGroup` mode filter (`ทั้งหมด` / `สร้างบทบรรยาย` / `ตรวจแก้ SRT`) with live counts.
- **Job List Columns, Sorting & Visual States:** Job titles and original filenames wrap inside the first column with a leading `size-9` status-tinted icon tile (`@min-[42rem]`, using `FileVideo`, `FileText`, or `Upload`). At narrow widths, `ModeTag` (a `6px` dot — `bg-brand-500/80` for Generate, `bg-muted-foreground/50` for Review — plus label), status badge, and actions stack within the first cell; actions split out at `@min-[42rem]`; mode, status, and updated time split out at `@min-[54rem]`; duration and spot count appear at `@min-[66rem]`. Columns `ชื่องาน`, `ความยาว`, `บทบรรยาย`, and `แก้ล่าสุด` are sortable via `SortableColumnButton` (`aria-sort`, defaulting to `แก้ล่าสุด` descending). `เปิดงาน` uses a cerulean ghost arrow; the ghost destructive delete icon disables while processing; failed Jobs open an error `Popover` from their status badge; unfinished uploads show a short file ID, size, and timestamp; warning/error rows take subtle `bg-warning/60` or `bg-error-surface/60` tints. Results paginate at 25 rows per page and auto-refresh on tab focus and every 5 seconds while an item is processing in a visible tab. Initial load renders a 4-row `Skeleton` table matching responsive columns.
- **Unified `/new` Intake & `VideoProcessingStatus` (`IntakeShell`, `Field`, `Progress`):** A single `/new` intake flow centered in `max-w-4xl` with a page header (`text-2xl` heading plus `text-sm` `muted-foreground` subtitle) above a white `bg-card` studio container (`11.2px` `rounded-xl border border-border`; `ยกเลิก` in `IntakeFooter` returns to the job list). A full-width underline mode switcher (`สร้างบทบรรยาย` with `FileVideo` | `ตรวจแก้ไฟล์ SRT` with `FileText`; `2px` `border-primary` active indicator and `text-brand-800`) sits directly above the card body.
  - **Generate Mode:** Uses a cerulean-tinted `bg-brand-50/45` MP4 `IntakeDropzone` (`outline-brand-300`, `bg-brand-100 text-brand-700` icon badge, `outline-primary` pick button), stages the selected/dropped MP4 in a `bg-brand-50`/`outline-brand-400` region with a `bg-primary text-primary-foreground` icon badge, `เปลี่ยนไฟล์`, and `X` clear controls, auto-populates optional `ชื่องาน`, and starts local validation and VAD from a `border-border bg-muted/35` footer bar (`ตรวจเสียงและเตรียมงาน`). Failed saves can reuse the scan result.
  - **Review Mode:** Leads with an `InputGroup` `.mp4` URL field (`type="url"`) with an inline-end `×` clear `InputGroupButton` (`ล้างลิงก์วิดีโอ`), paired with an `outline` `เลือกไฟล์จากเครื่อง` button (also accepting drag-and-drop) that swaps in-place to the staged `IntakeDropzone` card when a local file is selected, above a single SRT `IntakeDropzone` and the same `bg-muted/35` footer bar (`เริ่มตรวจแก้`).
  - **`VideoProcessingStatus`:** Replaces the intake form body while validating files, displaying a `Spinner` + phase title + live `font-mono tabular-nums` elapsed timer (`เวลาที่ใช้`), filename and description, a `Progress` bar (Material Design 3 two-segment sweep when indeterminate) with detail/percentage row, a 3-column `.soft-shimmer` spec-check strip (`รูปแบบไฟล์`, `ความละเอียด`, `แทร็กเสียง`), and a `border-t border-border bg-muted/35` footer (`กำลังตรวจสอบบนเครื่องของคุณ` + `ยกเลิกการตรวจไฟล์`).

### Loading & Skeleton States
- **`.soft-shimmer` (`@layer components` in `src/index.css`):** Shared shimmer primitive (`position: relative; overflow: hidden`) animating an `::after` cerulean-white sheen (`oklch(99.5% 0.01 236 / 0.88)`, `1.75s ease-in-out infinite`, staggered via `--shimmer-delay`). Disabled cleanly (`display: none`) under `prefers-reduced-motion: reduce`.
- **`EditorSkeleton` (`EditorHeaderTitleSkeleton`, `EditorHeaderActionsSkeleton`, `EditorWorkspaceSkeleton`):** Mirrors the full `100dvh` editor shell while loading a Job URL—header title/chip and action placeholders, dark `--stage` video monitor with spinner and indeterminate hairline track, transport bar, staggered `.soft-shimmer` timeline tracks (32 waveform bars, 5 speech capsules, 3 cerulean AD blocks), and a right-hand script pane with one expanded placeholder row above 7 bottom-faded collapsed rows.
- **`IntakeSkeleton`:** Mirrors the `/new` page header, two-tab underline switcher, dashed dropzone, title field, and `bg-muted/35` footer with staggered `.soft-shimmer` blocks.
- **`JobList` Skeleton:** Pairs the header count `Skeleton` with a 4-row `Table` skeleton matching the responsive breakpoints and icon tile.
- **`AdScriptEditor` Preparing & Analyzing States:** When `emptyState="preparing"`, renders a skeleton toolbar, a `bg-brand-50/50` status strip (`Spinner` + preparation title), 7 staggered `.soft-shimmer` spot rows with a bottom fade mask, and a footer skeleton. During active Gemini batch analysis, pending spots in the processing batch render two staggered `bg-brand-100` `.soft-shimmer` text lines inside their row.

### Status Pill & Hairline Progress Bar
Zero-shift asynchronous status indicator combining a compact header `Button` (`PopoverTrigger` opening `รายละเอียดการทำงาน`) with an edge-pinned `3px` progress line.
- **Pill Style:** `h-10` (`40px`, `Button size="lg"`) on desktop, expanding to `44px` (`pointer-coarse:h-11`) on coarse pointers. Displays the task icon or spinner, label, and available batch/percentage progress (`tabular-nums`). Active processing uses the bordered cerulean surface (`border-brand-200 bg-brand-50 text-brand-950`); errors use `border-error-border bg-error-surface text-error-foreground`; idle statuses use a bordered subtle pill (`border-border/80 bg-muted/40 text-foreground/85`).
- **Hairline Bar:** `3px` track flush beneath the navbar. Uses a Material Design 3 two-segment indeterminate sweep at `0%` / unknown progress, transitioning to a determinate cerulean gradient fill with a soft shimmer sweep and leading highlight when `> 0%`. Respects `prefers-reduced-motion: reduce`.

### Script Spot Row
Edge-to-edge editorial list item separated by `1px` horizontal dividers (`divide-y divide-border`)—no outer card border, corner radius, or nested card header.
- **Background:** `bg-card` (`pure-surface`) at rest; `bg-brand-50/90` with a `1px` inset `ring-brand-200` when selected; subtle `bg-brand-50/35` wash when the video playhead is inside an unselected row; `bg-muted/60` when skipped, shifting to `bg-muted ring-1 ring-inset ring-input` when a skipped row is selected.
- **Internal Padding & Stability:** `14px 16px` (`px-4 py-3.5`) padding with a `min-h-8 flex-wrap` header row, `useLayoutEffect` auto-grow `Textarea variant="script"`, and click scroll-anchor compensation so expanding/collapsing rows never jump under the cursor.
- **Row Controls & Fit Bar:** `Input` + `Button size="icon-sm"` (`±0.2s` steppers) for start/end timestamps, `ToggleGroup appearance="segmented"` for `บรรยาย | ข้าม`, `Badge` micro-badges for state/warnings, and `Button variant="ghost" size="sm"` for `คืนเวลาเดิม`. Expanded narration rows display an `h-1` rounded Thai speech-duration fit bar (`bg-brand-600` normal, `bg-warning-strong-border` at `> 85%`, `bg-warning-foreground` on overflow) above `tabular-nums` spoken/slot time, character count, and `แก้ไขแล้ว`.
- **Skipped State:** Existing text stays visible inside a disabled `Textarea variant="script"` (`disabled:text-muted-foreground`) with a non-destructive notice so authors never think their draft was deleted.

### Waveform Envelope & Timeline Loading (Signature Component)
Dedicated `56px` audio waveform track above the `28px` Soft Indigo VAD speech track (`bg-indigo-50/25`, flat `border-indigo-300/90 bg-indigo-100/90` capsules) and `56px` AD track.
- **Rendered Waveform:** Retina 2D `<canvas>` drawing crisp `1.5px` micro-bars (`1.5px` gap, `3px` integer-snapped step, `0.75px` radius for bars `> 2px`) centered on a `1px` baseline (`rgba(203, 213, 225, 0.7)`), auto-normalized to the clip's 98th percentile peak with `pow(norm, 1.55)`. Silence (`< 4%`) is omitted to preserve the continuous hairline; quiet valleys (`4%–9%`) render in `rgba(148, 163, 184, 0.35)`; ambient bars take a Cerulean vertical gradient (`rgba(125, 211, 252, 0.85)` → `rgba(3, 105, 161, 0.82)`); speech-segment bars take the Soft Indigo gradient (`rgba(165, 180, 252, 0.92)` → `rgba(79, 70, 229, 0.92)`). The red playhead line alone marks playback position so the canvas never repaints during normal playback.
- **Timeline Loading Shimmer:** While audio is scanning, the waveform track renders 32 staggered `.soft-shimmer` bars (`bg-slate-200/80`) behind a centered sticky bordered pill (`border-brand-200/80 bg-white/90 shadow-xs backdrop-blur-xs`) showing a spinner, phase label, and `tabular-nums` percentage. Concurrently, the speech track shows 5 staggered `.soft-shimmer` capsules (`bg-muted`) and the AD track shows 3 staggered cerulean `.soft-shimmer` blocks (`border-brand-200/70 bg-brand-50/80`).
- **Timeline Utility Bar:** Displays `ช่วง X/Y` (or `ไทม์ไลน์`), conditional `xl:flex` square decision swatches (`rounded-[3px]`, shown only when `> 1` decision type is present), live hover/drag timecode, and zoom controls (`-` / `%` / `+`, plus conditional `ซูมช่วงนี้` when the selected spot renders narrower than `24px` and `พอดี` whenever zoom exceeds `100%`).

### Broadcast CC Pill (Signature Component)
Floating closed-caption preview docked `12px` above the bottom edge of the video monitor.
- **Style:** `rgba(2, 6, 23, 0.80)` dark translucent surface, `backdrop-filter: blur(4px)`, `1px solid rgba(255, 255, 255, 0.15)`, `8px` radius, max-width `min(94%, 42rem)`, `Popover / Stage Elevation` shadow (`shadow-lg`).
- **Layout:** Inline `AD N` badge (`studio-cerulean-active`, `4px` radius, `text-xs`) pinned on the left beside left-aligned full white text (no ellipsis truncation; bounded to `max-h-[48%]` with scroll only for exceptionally long blocks) with a subtle `0 1px 2px rgba(0,0,0,0.65)` text shadow.
- **Interaction:** Clicking selects that spot in the right editor pane without pausing playback; toggled on/off via the soft-active `Subtitles` (`CC`) `Toggle` in the transport bar.

## Do's and Don'ts

### Do:
- **Do** keep the left video monitor free of redundant pane titles or full-width progress banners so video height stays maximized.
- **Do** place project-level commands (`สร้างบทบรรยายภาพ`, `ส่งออก SRT`, `จัดการงาน`) in the top command navbar and reserve pane toolbars strictly for local filtering and playback.
- **Do** use `tabular-nums` on every timecode, percentage, character count, and elapsed timer.
- **Do** honor `prefers-reduced-motion: reduce` by disabling spinner, shimmer, and progress-bar sweep animations.
- **Do** keep Thai AD script inputs in `Sarabun` at `1rem` (`1.75` line-height) for sustained proofreading comfort.

### Don't:
- **Don't** render full-width vertical progress banners above the workspace that shift the video player or duplicate the navbar status pill.
- **Don't** overlay raw caption text on a fading black gradient over video; always use the translucent `Broadcast CC Pill` so white frames stay legible.
- **Don't** use rainbow gradients, decorative drop shadows on docked panes/rows, or accent hues outside the cerulean UI / timeline-only Soft Indigo speech / amber warning / red error semantic set.
- **Don't** cram project export buttons into the half-width script filter bar where they clip at standard desktop widths.
