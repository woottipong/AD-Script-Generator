import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WaveformPeakAccumulator,
  computeClampedSpotDrag,
  decodeWaveformPeaks,
  encodeWaveformPeaks,
} from './waveform';

test('encodes and decodes waveform peaks round-trip and handles invalid base64', () => {
  const original = Uint8Array.from([0, 12, 64, 128, 255]);
  const encoded = encodeWaveformPeaks(original);
  const decoded = decodeWaveformPeaks(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(original));
  assert.equal(decodeWaveformPeaks('').length, 0);
  assert.equal(decodeWaveformPeaks('!!!not-base64!!!').length, 0);
});

test('WaveformPeakAccumulator buckets streaming PCM into 50ms peaks', () => {
  const acc = new WaveformPeakAccumulator(16000, 50); // 800 samples per bucket
  const silent = new Float32Array(800);
  const loud = new Float32Array(800).fill(1.0);
  const trailing = new Float32Array(200).fill(-0.5);

  acc.push(silent);
  acc.push(loud.subarray(0, 300));
  acc.push(loud.subarray(300));
  acc.push(trailing);

  const envelope = acc.finalize();
  assert.equal(envelope.sampleIntervalMs, 50);
  const peaks = decodeWaveformPeaks(envelope.peaksBase64);
  assert.equal(peaks.length, 3);
  assert.equal(peaks[0], 0);
  assert.equal(peaks[1], 255);
  assert.ok(peaks[2] > 100 && peaks[2] < 255);
});

test('computeClampedSpotDrag enforces 50ms snap, 500ms min duration, and Non-Speech Gap hard clamp', () => {
  const spot = {
    start_ms: 2000,
    end_ms: 5000,
    original_start_ms: 1000,
    original_end_ms: 6000,
  };
  const speech = [
    { start_ms: 0, end_ms: 1000 },
    { start_ms: 6000, end_ms: 8000 },
  ];

  // Trim start earlier within bounds (snaps to 50ms)
  const trimEarlier = computeClampedSpotDrag(spot, 'trim-start', -480, speech, 10000);
  assert.deepEqual(trimEarlier, { start_ms: 1500, end_ms: 5000, duration_ms: 3500 });

  // Trim start past original_start_ms clamps hard to 1000
  const trimPastStart = computeClampedSpotDrag(spot, 'trim-start', -2500, speech, 10000);
  assert.deepEqual(trimPastStart, { start_ms: 1000, end_ms: 5000, duration_ms: 4000 });

  // Trim start too close to end enforces 500ms minimum duration
  const trimTooShort = computeClampedSpotDrag(spot, 'trim-start', 2900, speech, 10000);
  assert.deepEqual(trimTooShort, { start_ms: 4500, end_ms: 5000, duration_ms: 500 });

  // Trim end past original_end_ms clamps hard to 6000
  const trimPastEnd = computeClampedSpotDrag(spot, 'trim-end', 3000, speech, 10000);
  assert.deepEqual(trimPastEnd, { start_ms: 2000, end_ms: 6000, duration_ms: 4000 });

  // Move preserves exact 3000ms duration and clamps to gap end
  const moveRight = computeClampedSpotDrag(spot, 'move', 2500, speech, 10000);
  assert.deepEqual(moveRight, { start_ms: 3000, end_ms: 6000, duration_ms: 3000 });

  // Move left clamps to gap start
  const moveLeft = computeClampedSpotDrag(spot, 'move', -2500, speech, 10000);
  assert.deepEqual(moveLeft, { start_ms: 1000, end_ms: 4000, duration_ms: 3000 });
});
