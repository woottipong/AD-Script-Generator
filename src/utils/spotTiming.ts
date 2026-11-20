import type { ADSpot, SpeechSegment } from '../types/ad';
import { formatTimestampDisplay } from './formatters';

export const MIN_SPOT_DURATION_MS = 500;
export const TIMELINE_DRAG_SNAP_MS = 50;

export type SpotDragMode = 'trim-start' | 'trim-end' | 'move';

/**
 * Validates whether a proposed [startMs, endMs] for an ADSpot stays within its original
 * non-speech gap and does not overlap any speech segments.
 */
export function validateSpotTimestampEdit(
  spot: ADSpot,
  newStartMs: number,
  newEndMs: number,
  speechSegments: SpeechSegment[],
  videoDurationMs: number
): { valid: boolean; error?: string } {
  if (isNaN(newStartMs) || isNaN(newEndMs)) {
    return { valid: false, error: 'รูปแบบเวลาไม่ถูกต้อง (ใช้ HH:MM:SS.mmm)' };
  }
  if (newStartMs < 0 || newEndMs > videoDurationMs) {
    return { valid: false, error: 'เวลาต้องอยู่ในช่วงความยาวของวิดีโอ' };
  }
  if (newEndMs <= newStartMs) {
    return { valid: false, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
  }
  if (newEndMs - newStartMs < MIN_SPOT_DURATION_MS) {
    return { valid: false, error: `ความยาวของช่วงบรรยายต้องไม่น้อยกว่า ${MIN_SPOT_DURATION_MS / 1000} วินาที` };
  }

  // Must stay within original non-speech gap (with 1ms tolerance for rounding)
  if (newStartMs < spot.original_start_ms - 1 || newEndMs > spot.original_end_ms + 1) {
    return {
      valid: false,
      error: `แก้ไขเวลาได้เฉพาะภายในช่วงว่างต้นทาง (${formatTimestampDisplay(spot.original_start_ms)} – ${formatTimestampDisplay(spot.original_end_ms)})`,
    };
  }

  // Must not overlap any detected speech segment
  for (const seg of speechSegments) {
    if (newStartMs < seg.end_ms && newEndMs > seg.start_ms) {
      return {
        valid: false,
        error: `เวลาทับซ้อนกับช่วงที่มีเสียงพูด (${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)})`,
      };
    }
  }

  return { valid: true };
}

function snapToStep(ms: number, stepMs: number): number {
  if (stepMs <= 1) return Math.round(ms);
  return Math.round(ms / stepMs) * stepMs;
}

/**
 * Computes hard-clamped start/end timestamps for Trim or Move on the timeline,
 * preserving the spot's Non-Speech Gap boundaries and preventing speech overlap.
 */
export function computeClampedSpotDrag(
  spot: Pick<ADSpot, 'start_ms' | 'end_ms' | 'original_start_ms' | 'original_end_ms'>,
  mode: SpotDragMode,
  deltaMs: number,
  speechSegments: SpeechSegment[],
  videoDurationMs: number,
  snapMs = TIMELINE_DRAG_SNAP_MS
): { start_ms: number; end_ms: number; duration_ms: number } {
  let minAllowedStart = Math.max(0, spot.original_start_ms);
  let maxAllowedEnd = Math.min(videoDurationMs, spot.original_end_ms);

  for (const seg of speechSegments) {
    if (seg.end_ms <= spot.start_ms && seg.end_ms > minAllowedStart) {
      minAllowedStart = seg.end_ms;
    }
    if (seg.start_ms >= spot.end_ms && seg.start_ms < maxAllowedEnd) {
      maxAllowedEnd = seg.start_ms;
    }
  }

  let nextStart = spot.start_ms;
  let nextEnd = spot.end_ms;

  if (mode === 'trim-start') {
    const rawStart = snapToStep(spot.start_ms + deltaMs, snapMs);
    const maxStart = Math.max(minAllowedStart, spot.end_ms - MIN_SPOT_DURATION_MS);
    nextStart = Math.max(minAllowedStart, Math.min(maxStart, rawStart));
  } else if (mode === 'trim-end') {
    const rawEnd = snapToStep(spot.end_ms + deltaMs, snapMs);
    const minEnd = Math.min(maxAllowedEnd, spot.start_ms + MIN_SPOT_DURATION_MS);
    nextEnd = Math.min(maxAllowedEnd, Math.max(minEnd, rawEnd));
  } else {
    const duration = spot.end_ms - spot.start_ms;
    const rawStart = snapToStep(spot.start_ms + deltaMs, snapMs);
    const maxStart = Math.max(minAllowedStart, maxAllowedEnd - duration);
    nextStart = Math.max(minAllowedStart, Math.min(maxStart, rawStart));
    nextEnd = Math.min(maxAllowedEnd, nextStart + duration);
  }

  return {
    start_ms: Math.round(nextStart),
    end_ms: Math.round(nextEnd),
    duration_ms: Math.round(nextEnd - nextStart),
  };
}
