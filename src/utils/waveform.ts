import type { WaveformEnvelope } from '../types/ad';

export const DEFAULT_WAVEFORM_SAMPLE_INTERVAL_MS = 20;

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
