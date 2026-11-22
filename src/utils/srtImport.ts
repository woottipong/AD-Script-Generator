import type { ADSpot } from '../types/ad';

export interface SrtCue {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** Older Thai SRT files are often saved as Windows-874 (TIS-620), so decode as UTF-8 first and fall back. */
export function decodeSrtBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('windows-874').decode(bytes);
  }
}

const TIMING = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const FORMATTING_TAG = /<\/?(?:i|b|u|font)\b[^>]*>/gi;

function toMs(hours: string, minutes: string, seconds: string, fraction: string): number {
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'));
}

export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = [];
  for (const block of content.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((line) => line.trim());
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue;
    const m = TIMING.exec(lines[timingIndex])!;
    const text = lines.slice(timingIndex + 1).map((line) => line.replace(FORMATTING_TAG, '').trim()).filter(Boolean).join('\n');
    cues.push({ start_ms: toMs(m[1], m[2], m[3], m[4]), end_ms: toMs(m[5], m[6], m[7], m[8]), text });
  }
  if (cues.length === 0) throw new Error('ไม่พบบรรทัดบรรยายในไฟล์ SRT นี้ กรุณาตรวจรูปแบบไฟล์');
  return cues.sort((a, b) => a.start_ms - b.start_ms);
}

export type SkippedCue = { cue: SrtCue; reason: 'starts_after_video_end' | 'no_duration' };

/** Each cue becomes an AD Spot, except cues that cannot sit on the timeline at all. */
export function cuesToSpots(cues: SrtCue[], durationMs: number): { spots: ADSpot[]; skipped: SkippedCue[] } {
  const skipped: SkippedCue[] = [];
  const placeable: SrtCue[] = [];
  for (const cue of cues) {
    if (cue.start_ms >= durationMs) skipped.push({ cue, reason: 'starts_after_video_end' });
    else if (cue.end_ms <= cue.start_ms) skipped.push({ cue, reason: 'no_duration' });
    else placeable.push(cue);
  }
  return {
    spots: placeable.map((cue, index) => ({
      spot_id: `cue_${String(index + 1).padStart(3, '0')}`,
      start_ms: cue.start_ms,
      end_ms: cue.end_ms,
      duration_ms: cue.end_ms - cue.start_ms,
      decision: 'generate',
      text: cue.text,
      original_start_ms: cue.start_ms,
      original_end_ms: cue.end_ms,
    })),
    skipped,
  };
}
