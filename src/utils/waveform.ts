import type { ADSpot, SpeechSegment, WaveformEnvelope } from '../types/ad';

export const DEFAULT_WAVEFORM_SAMPLE_INTERVAL_MS = 20;
export const TIMELINE_DRAG_SNAP_MS = 50;
export const MIN_SPOT_DURATION_MS = 500;

export type SpotDragMode = 'trim-start' | 'trim-end' | 'move';

export function encodeWaveformPeaks(peaks: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < peaks.length; i += chunkSize) {
    const slice = peaks.subarray(i, Math.min(i + chunkSize, peaks.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function decodeWaveformPeaks(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  try {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

export class WaveformPeakAccumulator {
  private readonly samplesPerBucket: number;
  private readonly sampleIntervalMs: number;
  private readonly peaks: number[] = [];
  private currentPeak = 0;
  private samplesInBucket = 0;

  constructor(sampleRate: number, sampleIntervalMs = DEFAULT_WAVEFORM_SAMPLE_INTERVAL_MS) {
    this.sampleIntervalMs = sampleIntervalMs;
    this.samplesPerBucket = Math.max(1, Math.round((sampleRate * sampleIntervalMs) / 1000));
  }

  push(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i++) {
      const abs = Math.abs(chunk[i]);
      if (abs > this.currentPeak) {
        this.currentPeak = abs;
      }
      this.samplesInBucket++;
      if (this.samplesInBucket >= this.samplesPerBucket) {
        this.peaks.push(this.quantizePeak(this.currentPeak));
        this.currentPeak = 0;
        this.samplesInBucket = 0;
      }
    }
  }

  finalize(): WaveformEnvelope {
    if (this.samplesInBucket > 0) {
      this.peaks.push(this.quantizePeak(this.currentPeak));
      this.currentPeak = 0;
      this.samplesInBucket = 0;
    }
    return {
      sampleIntervalMs: this.sampleIntervalMs,
      peaksBase64: encodeWaveformPeaks(Uint8Array.from(this.peaks)),
    };
  }

  private quantizePeak(linearPeak: number): number {
    const clamped = Math.min(1, Math.max(0, linearPeak));
    // Gentle perceptual curve keeps quiet dialogue readable without flattening loud peaks
    return Math.min(255, Math.round(Math.pow(clamped, 0.7) * 255));
  }
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
