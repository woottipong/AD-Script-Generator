import type { ADSpot, SpeechSegment } from '../types/ad';
import { formatTimestampDisplay } from './formatters';

export const MIN_SPOT_DURATION_MS = 500;
export const TIMELINE_DRAG_SNAP_MS = 50;

export type SpotDragMode = 'trim-start' | 'trim-end' | 'move';

/**
 * What an AD Spot's times are checked against. Generate Mode keeps each spot inside its original
 * Non-Speech Gap and off Speech Segments; Review Mode only keeps it inside the video and off the
 * other spots that are not skipped, because an imported SRT line may legitimately sit over speech.
 */
export type SpotTimingContext =
  | { mode: 'generate'; speechSegments: SpeechSegment[]; videoDurationMs: number }
  | { mode: 'review'; spots: ADSpot[]; videoDurationMs: number };

type TimedSpot = Pick<ADSpot, 'spot_id' | 'start_ms' | 'end_ms' | 'original_start_ms' | 'original_end_ms'>;

function blockingNeighbours(spot: TimedSpot, spots: ADSpot[]): ADSpot[] {
  return spots.filter((other) => other.spot_id !== spot.spot_id && other.decision !== 'skip');
}

export function validateSpotTimestampEdit(
  spot: TimedSpot,
  newStartMs: number,
  newEndMs: number,
  context: SpotTimingContext
): { valid: boolean; error?: string } {
  if (isNaN(newStartMs) || isNaN(newEndMs)) {
    return { valid: false, error: 'รูปแบบเวลาไม่ถูกต้อง (ใช้ HH:MM:SS.mmm)' };
  }
  if (newStartMs < 0 || newEndMs > context.videoDurationMs) {
    return { valid: false, error: 'เวลาต้องอยู่ในช่วงความยาวของวิดีโอ' };
  }
  if (newEndMs <= newStartMs) {
    return { valid: false, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
  }
  if (newEndMs - newStartMs < MIN_SPOT_DURATION_MS) {
    return { valid: false, error: `ความยาวของช่วงบรรยายต้องไม่น้อยกว่า ${MIN_SPOT_DURATION_MS / 1000} วินาที` };
  }

  if (context.mode === 'review') {
    for (const other of blockingNeighbours(spot, context.spots)) {
      if (newStartMs < other.end_ms && newEndMs > other.start_ms) {
        return {
          valid: false,
          error: `เวลาทับบรรทัดอื่น (${formatTimestampDisplay(other.start_ms)} – ${formatTimestampDisplay(other.end_ms)})`,
        };
      }
    }
    return { valid: true };
  }

  // Must stay within original non-speech gap (with 1ms tolerance for rounding)
  if (newStartMs < spot.original_start_ms - 1 || newEndMs > spot.original_end_ms + 1) {
    return {
      valid: false,
      error: `แก้ไขเวลาได้เฉพาะภายในช่วงว่างต้นทาง (${formatTimestampDisplay(spot.original_start_ms)} – ${formatTimestampDisplay(spot.original_end_ms)})`,
    };
  }

  for (const seg of context.speechSegments) {
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

/** The furthest a spot may reach on each side from where it currently starts. */
function editBounds(spot: TimedSpot, context: SpotTimingContext): { minStart: number; maxEnd: number } {
  if (context.mode === 'review') {
    let minStart = 0;
    let maxEnd = context.videoDurationMs;
    for (const other of blockingNeighbours(spot, context.spots)) {
      if (other.start_ms <= spot.start_ms) minStart = Math.max(minStart, other.end_ms);
      else maxEnd = Math.min(maxEnd, other.start_ms);
    }
    return { minStart, maxEnd };
  }
  let minStart = Math.max(0, spot.original_start_ms);
  let maxEnd = Math.min(context.videoDurationMs, spot.original_end_ms);
  for (const seg of context.speechSegments) {
    if (seg.end_ms <= spot.start_ms && seg.end_ms > minStart) minStart = seg.end_ms;
    if (seg.start_ms >= spot.end_ms && seg.start_ms < maxEnd) maxEnd = seg.start_ms;
  }
  return { minStart, maxEnd };
}

/**
 * Computes hard-clamped start/end timestamps for Trim, Move, and nudges. A spot that already sits
 * outside its bounds (an imported line overlapping its neighbour) is pulled back inside.
 */
export function computeClampedSpotDrag(
  spot: TimedSpot,
  mode: SpotDragMode,
  deltaMs: number,
  context: SpotTimingContext,
  snapMs = TIMELINE_DRAG_SNAP_MS
): { start_ms: number; end_ms: number; duration_ms: number } {
  const { minStart: minAllowedStart, maxEnd: maxAllowedEnd } = editBounds(spot, context);

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

  nextStart = Math.max(nextStart, minAllowedStart);
  nextEnd = Math.min(nextEnd, maxAllowedEnd);

  return {
    start_ms: Math.round(nextStart),
    end_ms: Math.round(nextEnd),
    duration_ms: Math.round(nextEnd - nextStart),
  };
}
