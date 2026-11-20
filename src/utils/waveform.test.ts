import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WaveformPeakAccumulator,
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
