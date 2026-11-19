---
name: AD Script Generator
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
    fontFamily: "'IBM Plex Sans Thai Looped', 'IBM Plex Sans Thai', Tahoma, sans-serif"
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

# Design System: AD Script Generator

## Overview

**Creative North Star: "The Broadcast Desk"**

AD Script Generator is an Operate-mode desktop workstation built for Thai Audio Description authors and reviewers. The interface behaves like a calm, quiet studio desk: a dark broadcast monitor on the left holds the video frame and timeline without chrome clutter, while a bright cool-paper editorial column on the right gives Thai narration scripts room to breathe. Every pixel earns its place by serving frame accuracy, speech-gap timing, or fast text revision.

The system is intentionally flat and restrained. Structure comes from crisp 1px hairline borders, tonal contrast between the dark video stage and the light script canvas, and a single disciplined cerulean accent reserved for active states, primary actions, and playback focus. No decorative gradients, no rainbow status treatments, and no vertical banners that steal height from the video monitor or cause layout shifts during analysis.

**Key Characteristics:**
- Dark broadcast monitor stage paired with a cool-paper light editorial pane in a full-viewport (`100dvh`) desktop split.
- Single cerulean accent family (`studio-cerulean`) with semantic amber and red reserved strictly for timing warnings and errors.
- Looped Thai typography (`IBM Plex Sans Thai Looped`) for long-form script legibility, paired with `Plus Jakarta Sans` UI chrome and tabular `JetBrains Mono` timecodes.
- Flat 1px hairline architecture where elevation shadows appear only on floating overlays and popovers.
- Zero-shift asynchronous feedback via a compact header status pill and a 3px Material Design 3 hairline progress bar.

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
**Script Editing Font:** `IBM Plex Sans Thai Looped` (fallback `IBM Plex Sans Thai`, `Tahoma`, sans-serif) with default Thai feature settings for unmistakable consonant loops during fast proofreading.
**Timecode / Mono Font:** `JetBrains Mono` (fallback `ui-monospace, SFMono-Regular, monospace`) with mandatory `tabular-nums`.

**Character:** Clinical and editorial at once—geometric sans keeps dense toolbar controls crisp, while looped Thai letterforms reduce eye strain when reading and trimming audio description scripts.

### Hierarchy
- **Headline** (600, `1.875rem` / 30px, line-height `1.25`): Intake screen page heading (`สร้างบทบรรยายภาพ`).
- **Title** (700, `1rem` / 16px, line-height `1.35`): Navbar wordmark (`AD Script Generator`) and dialog/empty-state headings.
- **Script Body** (400, `1rem` / 16px, line-height `1.75`): Editable Thai AD script textareas and preview text.
- **Body** (400, `0.9375rem` / 15px, line-height `1.5`): General UI descriptions, intake guidance, and validation messages.
- **Label** (500, `0.8125rem` / 13px, line-height `1.5`): Buttons, status pills, filter selects, search inputs, and spot metadata.
- **Timecode** (500, `0.8125rem` / 13px, line-height `1.4`, `tabular-nums`): Video clock (`00:00.000 / 06:30`), spot start/end inputs, and elapsed processing timers.

### Named Rules
**The Tabular Timecode Rule.** Every timestamp, duration, percentage, and elapsed timer must render with `tabular-nums` (and `JetBrains Mono` for timecodes) so numbers never jitter horizontally during playback or live updates.

**The Looped-Script Rule.** Editable Thai AD script content always uses `IBM Plex Sans Thai Looped` at `1rem` (`1.75` line-height), keeping prose clearly distinct from UI chrome.

## Layout

Desktop-first NLE split workspace locked to the viewport (`100dvh`, `overflow-hidden` at `lg: 1024px+`) while degrading cleanly to a vertical scroll stack on smaller screens.

- **Top Command Navbar (`min-h-16` / 64px):** Sticky white bar with a 1px cerulean hairline bottom border. Left holds the logo and wordmark; right holds the video file disclosure, live Status Pill, primary project CTA (`สร้างบทบรรยายภาพ` before generation, `ส่งออก SRT` once spots exist), and the `จัดการ` menu.
- **Hairline Progress Track (`3px`):** Anchored flush to the bottom edge of the navbar (`position: absolute; top: 0`) so processing states consume `0px` of vertical workspace height and cause zero layout shift.
- **Left Pane (`6 cols` on `lg`):** Unobstructed dark video monitor starting directly beneath the navbar (no redundant pane header), floating Broadcast CC Pill at the bottom edge of the video frame, cerulean-tinted transport control bar (`-5s`, `-1s`, Play/Pause, `+1s`, `+5s`, prev/next spot, Loop, CC toggle, Mute, timecode), selected-spot status bar, and zoomable multi-track timeline.
- **Right Pane (`6 cols` on `lg`):** Compact single-row Search + Filter toolbar (`44px` / `py-2`) above a `cool-paper-canvas` scrollable list of AD spot cards.
- **Touch & Pointer Rhythm:** Minimum interactive target height is `36px` (`2.25rem`) on desktop (`32px` for compact video transport buttons) and automatically expands to `44px` (`2.75rem`) on coarse pointers (`@media (pointer: coarse)`).

## Elevation & Depth

Surfaces are flat by default and separated by 1px hairline borders and tonal shifts (`pure-surface` cards on `cool-paper-canvas`, `broadcast-slate` monitor against white chrome). Drop shadows are reserved exclusively for elements that float above the workspace plane so users can immediately distinguish transient overlays from docked panes.

### Shadow Vocabulary
- **Popover Elevation** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): Used on header disclosure menus (`จัดการ`, video metadata popover, `รายละเอียดการทำงาน` queue panel) and the floating Broadcast CC Pill over video.

### Named Rules
**The Flat-By-Default Rule.** Docked panes, toolbars, and script cards never carry drop shadows. Shadows appear only on floating popovers and the video CC overlay.

## Shapes

Compact, utilitarian corner radii keep dense workstation controls crisp without looking harsh or toy-like.

- **Micro (`4px`):** Inline badges (`AD 1`), timeline blocks, and compact transport buttons.
- **Control (`6px`):** Primary/secondary buttons, status pills, search inputs, and filter selects.
- **Container (`8px`):** Script spot cards, floating Broadcast CC Pill, and header disclosure popovers.
- **Intake Card (`12px`):** Video upload dropzone and centered intake status cards.

## Components

### Buttons
Compact, tactile controls with clear visual hierarchy between primary project actions and quiet utility controls.
- **Shape:** Subtle control rounding (`6px` radius), `40px` height in the navbar (`32px` for compact transport icon buttons).
- **Primary:** `studio-cerulean` fill, `pure-surface` bold label, `8px 16px` padding.
- **Hover / Focus:** Darkens to `studio-cerulean-hover` on hover; `2px solid studio-cerulean-active` focus ring with `3px` offset on `:focus-visible`.
- **Secondary / Outline:** `pure-surface` fill, `1px solid control-border` (or `studio-cerulean-border` when paired with a primary CTA), `muted-ink` text, light slate tint on hover.

### Status Pill & Hairline Progress Bar
Zero-shift asynchronous status indicator combining a compact header trigger with an edge-pinned progress line.
- **Pill Style:** `studio-cerulean-tint` background, `1px solid studio-cerulean-border`, `studio-cerulean-ink` text, `6px` radius, `40px` height. Displays a spinning loader, task title, active batch index (`ชุด X/Y`), percentage, and live elapsed time in `tabular-nums`. Clicking opens the `#analysis-details` popover.
- **Hairline Bar:** `3px` track flush beneath the navbar. Uses a Material Design 3 two-segment indeterminate sweep at `0%` / unknown progress, transitioning to a determinate cerulean gradient fill with a soft shimmer sweep and leading highlight when `> 0%`. Respects `prefers-reduced-motion: reduce`.

### Inputs & Search Toolbar
Single-row editorial filter controls designed to stay uncluttered inside a half-width desktop pane.
- **Style:** `pure-surface` fill, `1px solid control-border`, `6px` radius, `36px` height. Search input carries a leading `14px` magnifying glass icon (`32px` left padding) and expands (`flex: 1`) beside a fixed-width (`144px–160px`) filter select.
- **Focus:** Border shifts to `studio-cerulean-active` with a 1px matching ring.

### Script Spot Card
High-legibility container for reviewing and editing a single Audio Description gap.
- **Corner Style:** `8px` radius.
- **Background:** `pure-surface` at rest on `cool-paper-canvas`; selected card carries a `studio-cerulean` border/ring highlight.
- **Border:** `1px solid hairline-border`.
- **Internal Padding:** `12px` (`spacing.md`), housing spot header/duration, generate/skip toggle, start/end timecode steppers, looped-Thai textarea, and live spoken-duration meter.

### Broadcast CC Pill (Signature Component)
Floating closed-caption preview docked `12px` above the bottom edge of the video monitor.
- **Style:** `rgba(2, 6, 23, 0.80)` dark translucent surface, `backdrop-filter: blur(4px)`, `1px solid rgba(255, 255, 255, 0.15)`, `8px` radius, max-width `min(92%, 40rem)`, `Popover Elevation` shadow.
- **Layout:** Inline `AD N` badge (`studio-cerulean-active`, `4px` radius) pinned on the left beside left-aligned white text clamped to 2 lines (`line-clamp-2`) with a subtle `0 1px 2px rgba(0,0,0,0.65)` text shadow.
- **Interaction:** Clicking selects that spot in the right editor pane without pausing playback; toggled on/off via the `Subtitles` (`CC`) button in the transport bar.

## Do's and Don'ts

### Do:
- **Do** keep the left video monitor free of redundant pane titles or full-width progress banners so video height stays maximized.
- **Do** place project-level deliverables (`สร้างบทบรรยายภาพ`, `ส่งออก SRT`, `จัดการ`) in the top command navbar and reserve pane toolbars strictly for local filtering and playback.
- **Do** use `tabular-nums` on every timecode, percentage, character count, and elapsed timer.
- **Do** honor `prefers-reduced-motion: reduce` by disabling spinner and progress-bar sweep animations.
- **Do** keep Thai AD script inputs in `IBM Plex Sans Thai Looped` at `1rem` (`1.75` line-height) for sustained proofreading comfort.

### Don't:
- **Don't** render full-width vertical progress banners above the workspace that shift the video player or duplicate the navbar status pill.
- **Don't** overlay raw caption text on a fading black gradient over video; always use the translucent `Broadcast CC Pill` so white frames stay legible.
- **Don't** use rainbow gradients, decorative drop shadows on docked cards, or accent colors outside the cerulean/amber/red semantic set.
- **Don't** cram project export buttons into the half-width script filter bar where they clip at standard desktop widths.
