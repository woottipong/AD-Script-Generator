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
  hairline-border: "#e2e8f0"
  control-border: "#cbd5e1"
  amber-surface: "#fffbeb"
  amber-ink: "#92400e"
  amber-border: "#fde68a"
  error-surface: "#fef2f2"
  error-ink: "#991b1b"
  error-border: "#fecaca"
typography:
  headline:
    fontFamily: "'Plus Jakarta Sans', 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.875rem"
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
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
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
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.studio-cerulean-hover}"
  button-secondary:
    backgroundColor: "{colors.pure-surface}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  status-pill:
    backgroundColor: "{colors.studio-cerulean-tint}"
    textColor: "{colors.studio-cerulean-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  input-search:
    backgroundColor: "{colors.pure-surface}"
    textColor: "{colors.broadcast-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 10px 6px 32px"
    height: "36px"
  spot-card:
    backgroundColor: "{colors.pure-surface}"
    textColor: "{colors.broadcast-ink}"
    typography: "{typography.script-body}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: TCC Envisio

## Overview

**Creative North Star: "The Broadcast Desk"**

TCC Envisio is an Operate-mode desktop workstation built for Thai Audio Description authors and reviewers. The interface behaves like a calm, quiet studio desk: a dark broadcast monitor on the left holds the video frame and timeline without chrome clutter, while a bright cool-paper editorial column on the right gives Thai narration scripts room to breathe. Every pixel earns its place by serving frame accuracy, speech-gap timing, or fast text revision.

The system is intentionally flat and restrained. Structure comes from crisp 1px hairline borders, tonal contrast between the dark video stage and the light script canvas, and a single disciplined cerulean accent reserved for active states, primary actions, and playback focus. No decorative gradients, no rainbow status treatments, and no vertical banners that steal height from the video monitor or cause layout shifts during analysis.

**Key Characteristics:**
- Dark broadcast monitor stage paired with a cool-paper light editorial pane in a full-viewport (`100dvh`) desktop split.
- Single cerulean accent family (`studio-cerulean`) with semantic amber and red reserved strictly for timing warnings and errors.
- Looped Thai typography (`Sarabun`) for long-form script legibility, paired with `Plus Jakarta Sans` UI chrome and tabular `JetBrains Mono` timecodes.
- Flat 1px hairline architecture where elevation shadows appear only on floating overlays and popovers.
- Zero-shift asynchronous feedback via a compact header status pill and a 3px Material Design 3 hairline progress bar.

## Brand

- **Name:** `TCC Envisio`, always with the `TCC` house mark. `TCC` takes `brand-700`, `Envisio` takes `slate-900`, both 700 weight.
- **Tagline (navbar, page title):** `สร้างและตรวจแก้บทบรรยายภาพ`, 13px 500 `slate-600`, hidden below `sm`. It names what the app does and changes only when capabilities change (for example `เขียนบท สร้างเสียง ส่งออกงานบรรยายภาพ` once voice generation ships).
- **Slogan (README, meta description, presentations):** `ให้ทุกภาพมีเสียงเล่า`. It stays out of the working UI.
- **Logo:** a `brand-700` rounded-square tile (16px radius on a 64 grid) holding a white camera-viewfinder frame around a soundwave, with the centre bar in `sky-300` (`#7dd3fc`) marking the narration cue. `public/logo.svg` is the full mark (navbar, touch icon); `public/icon.svg` and `favicon.ico` are a simplified three-bar cut with heavier strokes so the tab icon stays legible at 16px.

## Colors

The palette pairs a single broadcast cerulean accent with cool paper and darkroom slate neutrals so the video picture and Thai script remain the visual focus.

### Primary
- **Studio Cerulean** (`studio-cerulean`): Primary interactive actions (`สร้างบทบรรยายภาพ`, `ส่งออก SRT`, active Play button, active CC/Loop toggles) and focus rings.
- **Studio Cerulean Hover** (`studio-cerulean-hover`): Hover state on primary buttons and scrollbar thumbs.
- **Studio Cerulean Active** (`studio-cerulean-active`): Progress bar fill, active input focus borders, and the `AD` badge inside the floating CC pill.
- **Studio Cerulean Tint / Soft / Border** (`studio-cerulean-tint`, `studio-cerulean-soft`, `studio-cerulean-border`): Tinted surfaces for the transport bar, active header status pill, selected spot highlight, and text selection background.
- **Studio Cerulean Ink** (`studio-cerulean-ink`): High-contrast foreground text on cerulean-tinted surfaces.

### Neutral
- **Cool Paper Canvas** (`cool-paper-canvas`): Scrollable backdrop behind script spot cards so white cards separate softly without heavy borders or shadows.
- **Pure Surface** (`pure-surface`): Top navigation bar, search/filter toolbar, spot cards, inputs, and floating disclosure menus.
- **Broadcast Slate** (`broadcast-slate`): Dark video monitor stage (`#020617`) and translucent Broadcast CC Pill (`rgba(2, 6, 23, 0.80)` with backdrop blur) so bright video frames never wash out captions.
- **Broadcast Ink / Muted Ink / Subtle Ink** (`broadcast-ink`, `muted-ink`, `subtle-ink`): Three-step dark slate text hierarchy for primary copy, secondary controls, and placeholders.
- **Hairline Border / Control Border** (`hairline-border`, `control-border`): 1px structural dividers between panes/cards and crisp 1px strokes on inputs and secondary buttons.

### Semantic States
- **Amber Warning** (`amber-surface`, `amber-ink`, `amber-border`): Spoken-duration overflow warnings, pending batch badges, and incomplete-job resume banners.
- **Error Red** (`error-surface`, `error-ink`, `error-border`): Blocking MP4 validation errors, failed batches, and browser compatibility alerts.

### Named Rules
**The Single-Accent Rule.** Use `studio-cerulean` exclusively for primary actions, active playback toggles, and progress signals. Never introduce rainbow gradients or competing brand hues.

**The Dark-Stage Contrast Rule.** Captions overlaid on video must sit inside a translucent dark `broadcast-slate` container (`80%` opacity + backdrop blur), never directly over raw video pixels or a fading gradient.

## Typography

**Display & UI Font:** `Plus Jakarta Sans` paired with `IBM Plex Sans Thai` (OpenType stylistic alternates `cv02, cv03, cv04, cv11` for clean geometric UI numerals and Latin labels).
**Script Editing Font:** `Sarabun` (fallback `IBM Plex Sans Thai`, `Tahoma`, sans-serif) with default Thai feature settings for unmistakable consonant loops during fast proofreading.
**Timecode / Mono Font:** `JetBrains Mono` (fallback `ui-monospace, SFMono-Regular, monospace`) with mandatory `tabular-nums`.

**Character:** Clinical and editorial at once—geometric sans keeps dense toolbar controls crisp, while looped Thai letterforms reduce eye strain when reading and trimming audio description scripts.

### Hierarchy
- **Headline** (600, `1.875rem` / 30px, line-height `1.25`): Intake screen page heading (`สร้างบทบรรยายภาพ`).
- **Title** (700, `1rem` / 16px, line-height `1.35`): Navbar wordmark (`TCC Envisio`, with `TCC` in `brand-700` and the tagline `สร้างและตรวจแก้บทบรรยายภาพ` beneath in 13px `slate-500`) and dialog/empty-state headings.
- **Script Body** (400, `1rem` / 16px, line-height `1.75`): Editable Thai AD script textareas and preview text.
- **Body** (400, `0.9375rem` / 15px, line-height `1.5`): General UI descriptions, intake guidance, and validation messages.
- **Label** (500, `0.8125rem` / 13px, line-height `1.5`): Buttons, status pills, filter selects, search inputs, and spot metadata.
- **Timecode** (500, `0.8125rem` / 13px, line-height `1.4`, `tabular-nums`): Video clock (`00:00.000 / 06:30`), spot start/end inputs, and elapsed processing timers.

### Named Rules
**The Tabular Timecode Rule.** Every timestamp, duration, percentage, and elapsed timer must render with `tabular-nums` (and `JetBrains Mono` for timecodes) so numbers never jitter horizontally during playback or live updates.

**The Looped-Script Rule.** Editable Thai AD script content always uses `Sarabun` at `1rem` (`1.75` line-height), keeping prose clearly distinct from UI chrome.

## Layout

Desktop-first NLE split workspace locked to the viewport (`100dvh`, `overflow-hidden` at `lg: 1024px+`) while degrading cleanly to a vertical scroll stack on smaller screens.

- **Top Command Navbar (`min-h-16` / 64px):** Sticky white bar with a 1px cerulean hairline bottom border. Left holds the logo and wordmark; right holds the video file disclosure, live Status Pill, primary project CTA (`สร้างบทบรรยายภาพ` before generation, `ส่งออก SRT` once spots exist), and the `จัดการ` menu.
- **Hairline Progress Track (`3px`):** Anchored flush to the bottom edge of the navbar (`position: absolute; top: 0`) so processing states consume `0px` of vertical workspace height and cause zero layout shift.
- **Left Pane (`6 cols` on `lg`):** Unobstructed dark video monitor starting directly beneath the navbar (no redundant pane header), floating Broadcast CC Pill at the bottom edge of the video frame, pure-white transport control bar (`-5s`, `-1s`, Play/Pause, `+1s`, `+5s`, prev/next spot, soft-active Loop/CC/Mute toggles, timecode), slim cool-slate timeline utility bar (`ช่วง X/Y`, 3-dot legend, live hover/drag timecode, Zoom controls), and an edge-to-edge 3-track timeline (`คลื่นเสียง` 56px, `เสียงพูด` 28px, `บรรยาย` 56px).
- **Right Pane (`6 cols` on `lg`):** Compact single-row Search + Filter toolbar (`44px` / `py-2`) above an edge-to-edge white editorial list (`divide-y divide-slate-200`) resting on `cool-paper-canvas` below the final item.
- **Touch & Pointer Rhythm:** Minimum interactive target height is `36px` (`2.25rem`) on desktop (`32px` for compact video transport buttons) and automatically expands to `44px` (`2.75rem`) on coarse pointers (`@media (pointer: coarse)`).

## Elevation & Depth

Surfaces are flat by default and separated by 1px hairline borders and tonal shifts (`pure-surface` cards on `cool-paper-canvas`, `broadcast-slate` monitor against white chrome). Drop shadows are reserved exclusively for elements that float above the workspace plane so users can immediately distinguish transient overlays from docked panes.

### Shadow Vocabulary
- **Overlay Elevation** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` with `ring-1 ring-foreground/10`): Used on floating `DropdownMenu`, `Popover`, and `Select` popups.
- **Popover / Stage Elevation** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): Used on nested `DropdownMenu` submenus and the floating Broadcast CC Pill over video.

### Named Rules
**The Flat-By-Default Rule.** Docked panes, toolbars, and script cards never carry drop shadows. Shadows appear only on floating popovers, menus, dialogs, and the video CC overlay.

## Shapes

Compact, utilitarian corner radii keep dense workstation controls crisp without looking harsh or toy-like.

- **Micro (`4px`):** Inline badges (`AD 1`), timeline blocks, and compact transport buttons.
- **Control (`6px`):** Primary/secondary buttons, status pills, search inputs, and filter selects.
- **Container (`8px`):** Script spot cards, floating Broadcast CC Pill, and header disclosure popovers.
- **Intake Card (`12px`):** Video upload dropzone and centered intake status cards.

## Components

All UI controls come from the **shadcn/ui** component library in `src/components/ui` (style `base-nova` on `@base-ui/react`), themed exclusively through the semantic CSS tokens in `src/index.css`: `--primary` (`studio-cerulean`), `--foreground` and `--muted-foreground` (slate inks), `--border` and `--input` (hairline and control strokes), `--ring` (`studio-cerulean-active`), `--destructive` (error red), and `--radius` (`0.375rem` / `6px` for `rounded-lg` controls and dialogs, `4.8px` for `rounded-md` micro-badges). Call sites pass layout classes via `className` and pick a semantic variant (with the navbar status pill's state-tinted surface in `UploadAndVadPanel` as the intentional exception). Every interactive button and link uses the app-wide 2px `studio-cerulean-active` focus outline with a 3px offset (`:focus-visible`), while text inputs and textareas keep their border-shift and ring focus.

### Buttons & Toggles
Compact, tactile controls with clear visual hierarchy between primary project actions, quiet utility controls, and stateful toggles.
- **Shape & Rhythm:** Subtle control rounding (`6px` radius). `Button` sizes: `default` and `icon` `36px` (`h-9` / `size-9`), `lg` and `icon-lg` `40px` (`h-10` / `size-10`) for navbar and intake page CTAs, `sm` and `icon-sm` `32px` (`h-8` / `size-8`) for dense rows, timestamp steppers, and video transport, `xs` and `icon-xs` `24px` (`h-6` / `size-6`); all interactive `<button>`s and inputs expand to `44px` (`2.75rem`) on `@media (pointer: coarse)`. (Inline text triggers such as Job List titles and `ช่วง N` row headers stay text-height on desktop.)
- **Button Variants:** `default` (`studio-cerulean` fill, `pure-surface` `font-medium` label, `hover:bg-primary/80`), `outline` (`pure-surface` fill, `1px` `border-border`, `muted` hover tint), `secondary` (`slate-100` fill), `ghost` (transparent until hovered; used for compact row actions like `คืนเวลาเดิม` at `size="sm"` and icon steppers at `size="icon-sm"`), `warning` (amber surface/border/ink for the `ต้องตรวจ` trigger when timing issues exist), `destructive` (error red tint for delete confirmations), and `link` (inline cerulean text action such as `ลองบันทึกอีกครั้ง`).
- **Toggles (`Toggle` & `ToggleGroup`):**
  - **Soft-Active Toggles (`Toggle` `default` / `outline`):** `size="icon"` (`32px`) for player transport states (Loop, CC, Mute), taking a soft cerulean tint (`bg-brand-100 text-brand-900 ring-1 ring-brand-300`) when `aria-pressed="true"`.
  - **Concentric Segmented Toggle (`ToggleGroup appearance="segmented"`):** `6px` outer track (`border-border/90 bg-muted p-0.5 gap-0.5`) holding `4px`-radius `ToggleGroupItem` buttons (`variant="solid-primary"` with `studio-cerulean` fill and white text for active `บรรยาย`, `variant="solid-muted"` with `slate-700` fill and white text for active `ข้าม`).

### Badges & Alerts
- **Status Micro-Badges (`Badge`):** `4.8px` rounded (`rounded-md`), 1px-bordered `20px` (`h-5`) pills for instant scanning without competing with buttons:
  - `info`: `brand-50` fill, `brand-200` border, `brand-900` ink (`บรรยาย` idle status).
  - `info-strong`: `brand-100` fill, `brand-200` border, `brand-900` ink (`กำลังวิเคราะห์` active batch).
  - `warning`: `amber-50` fill, `amber-200` border, `amber-800` ink (`รอสร้าง` / `รอวิเคราะห์`).
  - `warning-strong`: `amber-100` fill, `amber-300` border, semibold `amber-900` ink (timing issues: `ทับเสียงพูด`, `ทับบรรทัดอื่น`, `สั้นกว่า 0.5 วินาที`, `เลยท้ายวิดีโอ`).
  - `secondary`: `slate-100` fill, `border-border` (`ข้าม`, `พร้อมแก้`, `ยาวกว่าช่องว่าง`).
  - `destructive`: error red tint (`ผิดพลาด`).
  - **Passive Text States:** Non-interactive row cues stay plain text, never `Badge` pills: `แก้ไขแล้ว` in muted slate and `ตำแหน่งวิดีโอ` in cerulean text with a `6px` dot.
- **Inline & Strip Notices (`Alert`):** `variant="destructive"` (error surface, ink, and border) for blocking validation and timestamp errors; `variant="warning"` (amber surface, ink, and border) for non-blocking notices; `placement="strip"` (full-width flush bar under the navbar, paired with `Collapsible` when details expand) for unfinished analysis, local video relink prompts, and unimported SRT lines.

### Overlays, Menus & Dialogs
- **Menus (`DropdownMenu`):** White surface, `ring-1 ring-foreground/10`, Overlay Elevation shadow (`shadow-md`), keyboard navigation, Escape/outside-click dismissal, and focus return (`จัดการ` navbar menu, Job List `⋯` row actions, and editor `ต้องตรวจ` jump menu). Uses `DropdownMenuItem variant="primary"` for primary filter links and `variant="destructive"` for delete actions.
- **Disclosures (`Popover`):** White surface with Overlay Elevation shadow for structured header panels (`รายละเอียดงาน` with inline rename form and video metadata; `รายละเอียดการทำงาน` status pill queue panel). Triggers carry a `ChevronDown` that rotates 180° when open.
- **Confirmations (`AlertDialog`):** Single app-level modal confirmation dialog for destructive or navigation-interrupting prompts (delete job, leave unsaved edits, reset/replace video).
- **Tooltips (`Tooltip`):** Dark compact shortcut hints (`Alt + P`, `Alt + ↑/↓`, seek/zoom controls) replacing native browser `title` attributes across the player transport and zoom bar.

### Inputs, Search Toolbar & Forms
- **Form Fields (`Field` + `Input`):** `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` structure intake inputs and the header rename form. `Input` uses `pure-surface` fill, `1px` `border-input`, `6px` radius, `36px` (`h-9`) height, shifting border to `studio-cerulean-active` with a matching ring on focus.
- **Search & Filter Toolbar (`InputGroup` + `Select`):** Single-row `44px` editorial bar inside the right pane. `InputGroup` (`flex-1`, `36px` height) houses a leading `14px` magnifying glass `InputGroupAddon` and `InputGroupInput` (`type="search"`). Beside it sits a `Select` (`w-36 sm:w-40`, `36px` `SelectTrigger` with `SelectContent` popup) filtering spots (`ทั้งหมด`, `มีบทบรรยาย`, `รอสร้าง`, `ข้ามการบรรยาย`, `แก้ไขแล้ว`, `ต้องตรวจ`) with live counts.
- **Script Textarea (`Textarea`):** `variant="default"` uses `field-sizing-content` for standard forms; `variant="script"` enforces the Looped-Script Rule (`Sarabun` `1rem / 1.75` line-height), disables automatic field-sizing in favour of `useLayoutEffect` auto-grow with scroll compensation, softens focus to a `2px` `brand-100` ring, and renders skipped drafts in a disabled muted surface (`bg-muted/80 text-slate-400`) so authors never mistake a skipped draft for deleted work.

### Job List Table & Intake Cards
- **Job List (`Table`, `Skeleton`, `Empty`):** One dense table on a white bordered surface widened to the navbar gutters (`px-4 sm:px-6`, up to `max-w-screen-2xl`) so its left edge aligns with the logo. Columns: ชื่องาน (link opening the Job; original file name below only when renamed), โหมด, สถานะ (`Badge`), แก้ล่าสุด and ขนาด in `tabular-nums`, then a `ทำต่อ` outline `Button` and a `⋯` `DropdownMenu`. Below `sm`, โหมด moves under the title, แก้ล่าสุด and ขนาด hide, and `ทำต่อ` moves into `⋯`. Loading shows `Skeleton` rows; errors show `Alert` with retry; empty storage shows `Empty` with `งานใหม่`.
- **Mode Chooser & Intake (`Card`, `Progress`):** Mode options use interactive `Card` containers; upload/processing cards (`12px` radius) report indeterminate and determinate progress with `Progress` (Material Design 3 two-segment sweep when indeterminate).

### Status Pill & Hairline Progress Bar
Zero-shift asynchronous status indicator combining a compact header `Button` (`PopoverTrigger` opening `รายละเอียดการทำงาน`) with an edge-pinned `3px` progress line.
- **Pill Style:** Active processing uses `studio-cerulean-tint` background, `1px solid studio-cerulean-border`, `studio-cerulean-ink` text, `6px` radius, `40px` height (`size="lg"`), displaying spinner, task title, active batch index, percentage, and elapsed time in `tabular-nums`. Completed (`READY`) state steps down to calm neutral slate (`bg-slate-100 border-slate-200 text-slate-700`) so `ส่งออก SRT` remains the single cerulean CTA on the navbar.
- **Hairline Bar:** `3px` track flush beneath the navbar. Uses a Material Design 3 two-segment indeterminate sweep at `0%` / unknown progress, transitioning to a determinate cerulean gradient fill with a soft shimmer sweep and leading highlight when `> 0%`. Respects `prefers-reduced-motion: reduce`.

### Script Spot Row
Edge-to-edge editorial list item separated by `1px` horizontal dividers (`divide-y divide-slate-200`)—no outer card border or nested card header.
- **Background:** `pure-surface` at rest; `90%` `studio-cerulean-tint` with a `1px` inset `studio-cerulean-border` ring when selected; subtle `35%` `studio-cerulean-tint` wash when the video playhead is inside an unselected row; soft muted slate tint (`85%` `slate-50`) when skipped.
- **Internal Padding & Stability:** `14px 16px` vertical/horizontal padding with locked `32px` header height, `useLayoutEffect` auto-grow `Textarea variant="script"`, and click scroll-anchor compensation so expanding/collapsing rows never jump under the cursor.
- **Row Controls:** `Input` + `Button size="icon-sm"` (`±0.2s` steppers) for start/end timestamps, `ToggleGroup appearance="segmented"` for `บรรยาย | ข้าม`, `Badge` micro-badges for state/warnings, and `Button variant="ghost" size="sm"` for `คืนเวลาเดิม`.
- **Skipped State:** Existing text stays visible inside a disabled `Textarea variant="script"` with a non-destructive notice so authors never think their draft was deleted.

### Waveform Envelope & Soft Mist Loading Wave (Signature Component)
Dedicated `56px` audio waveform track above the `28px` VAD speech track and `56px` AD track.
- **Rendered Waveform:** Retina 2D `<canvas>` drawing crisp `2px` rounded micro-bars (`1px` gap, `1px` radius) auto-normalized to the clip's 98th percentile peak (`pow(norm, 1.45)`). Every bar sits in cool slate (`#475569 → #94a3b8`) and quiet valleys (`< 12%`) soften to `#cbd5e1`; the red playhead line alone marks the play position, so the waveform does not repaint during playback.
- **Soft Mist Loading Wave:** While audio is scanning, two wide (`240px` wavelength), gently blurred (`1px` / `2px`), translucent cerulean SVG mist ribbons drift smoothly in opposite directions (`5.5s` / `8.5s`) with zero hard sweep lines or spring-like zigzags, topped by a borderless translucent pill (`กำลังสแกนเสียง %`).

### Broadcast CC Pill (Signature Component)
Floating closed-caption preview docked `12px` above the bottom edge of the video monitor.
- **Style:** `rgba(2, 6, 23, 0.80)` dark translucent surface, `backdrop-filter: blur(4px)`, `1px solid rgba(255, 255, 255, 0.15)`, `8px` radius, max-width `min(94%, 42rem)`, `Popover / Stage Elevation` shadow (`shadow-lg`).
- **Layout:** Inline `AD N` badge (`studio-cerulean-active`, `4px` radius, `text-xs`) pinned on the left beside left-aligned full white text (no ellipsis truncation; bounded to `max-h-[48%]` with scroll only for exceptionally long blocks) with a subtle `0 1px 2px rgba(0,0,0,0.65)` text shadow.
- **Interaction:** Clicking selects that spot in the right editor pane without pausing playback; toggled on/off via the soft-active `Subtitles` (`CC`) `Toggle` in the transport bar.

## Do's and Don'ts

### Do:
- **Do** keep the left video monitor free of redundant pane titles or full-width progress banners so video height stays maximized.
- **Do** place project-level deliverables (`สร้างบทบรรยายภาพ`, `ส่งออก SRT`, `จัดการ`) in the top command navbar and reserve pane toolbars strictly for local filtering and playback.
- **Do** use `tabular-nums` on every timecode, percentage, character count, and elapsed timer.
- **Do** honor `prefers-reduced-motion: reduce` by disabling spinner and progress-bar sweep animations.
- **Do** keep Thai AD script inputs in `Sarabun` at `1rem` (`1.75` line-height) for sustained proofreading comfort.

### Don't:
- **Don't** render full-width vertical progress banners above the workspace that shift the video player or duplicate the navbar status pill.
- **Don't** overlay raw caption text on a fading black gradient over video; always use the translucent `Broadcast CC Pill` so white frames stay legible.
- **Don't** use rainbow gradients, decorative drop shadows on docked cards, or accent colors outside the cerulean/amber/red semantic set.
- **Don't** cram project export buttons into the half-width script filter bar where they clip at standard desktop widths.
