import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ADSpot } from '../types/ad';
import { computeClampedSpotDrag, validateSpotTimestampEdit } from './spotTiming';

const speech = [
  { start_ms: 0, end_ms: 1000 },
  { start_ms: 6000, end_ms: 8000 },
];

const spot: ADSpot = {
  spot_id: 's1',
  start_ms: 2000,
  end_ms: 5000,
  duration_ms: 3000,
  original_start_ms: 1000,
  original_end_ms: 6000,
  decision: 'generate',
  text: '',
  is_edited: false,
};

test('accepts an edit inside the Non-Speech Gap that is at least 500 ms long', () => {
  assert.equal(validateSpotTimestampEdit(spot, 1000, 6000, speech, 10000).valid, true);
  assert.equal(validateSpotTimestampEdit(spot, 3000, 3500, speech, 10000).valid, true);
});

test('rejects edits that break the AD Spot timing rules', () => {
  const reject = (start: number, end: number) =>
    assert.equal(validateSpotTimestampEdit(spot, start, end, speech, 10000).valid, false, `${start}-${end}`);
  reject(NaN, 3000);
  reject(-1, 3000);
  reject(2000, 10001);
  reject(3000, 3000);
  reject(3000, 3499);
  reject(998, 3000);
  reject(2000, 6002);
  reject(2000, 6500);
});

test('Trim and Move clamp to the Non-Speech Gap, 500 ms minimum, and 50 ms snap', () => {
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', -480, speech, 10000), { start_ms: 1500, end_ms: 5000, duration_ms: 3500 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', -2500, speech, 10000), { start_ms: 1000, end_ms: 5000, duration_ms: 4000 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', 2900, speech, 10000), { start_ms: 4500, end_ms: 5000, duration_ms: 500 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-end', 3000, speech, 10000), { start_ms: 2000, end_ms: 6000, duration_ms: 4000 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-end', -2900, speech, 10000), { start_ms: 2000, end_ms: 2500, duration_ms: 500 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'move', 2500, speech, 10000), { start_ms: 3000, end_ms: 6000, duration_ms: 3000 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'move', -2500, speech, 10000), { start_ms: 1000, end_ms: 4000, duration_ms: 3000 });
});

test('Trim stops at a Speech Segment inside the original gap', () => {
  const speechInsideGap = [...speech, { start_ms: 1200, end_ms: 1600 }];
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', -1500, speechInsideGap, 10000), { start_ms: 1600, end_ms: 5000, duration_ms: 3400 });
});

test('every clamped result passes validation', () => {
  for (const mode of ['trim-start', 'trim-end', 'move'] as const) {
    for (let delta = -4000; delta <= 4000; delta += 130) {
      const next = computeClampedSpotDrag(spot, mode, delta, speech, 10000);
      assert.equal(validateSpotTimestampEdit(spot, next.start_ms, next.end_ms, speech, 10000).valid, true, `${mode} ${delta}`);
    }
  }
});
