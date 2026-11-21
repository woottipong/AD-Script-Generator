import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ADSpot } from '../types/ad';
import { computeClampedSpotDrag, findSpotIssues, spotTimingKey, validateSpotTimestampEdit } from './spotTiming';

const gen = (speechSegments: { start_ms: number; end_ms: number }[], videoDurationMs = 10000) => ({ mode: 'generate' as const, speechSegments, videoDurationMs });

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
  assert.equal(validateSpotTimestampEdit(spot, 1000, 6000, gen(speech)).valid, true);
  assert.equal(validateSpotTimestampEdit(spot, 3000, 3500, gen(speech)).valid, true);
});

test('rejects edits that break the AD Spot timing rules', () => {
  const reject = (start: number, end: number) =>
    assert.equal(validateSpotTimestampEdit(spot, start, end, gen(speech)).valid, false, `${start}-${end}`);
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
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', -480, gen(speech)), { start_ms: 1500, end_ms: 5000, duration_ms: 3500 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', -2500, gen(speech)), { start_ms: 1000, end_ms: 5000, duration_ms: 4000 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', 2900, gen(speech)), { start_ms: 4500, end_ms: 5000, duration_ms: 500 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-end', 3000, gen(speech)), { start_ms: 2000, end_ms: 6000, duration_ms: 4000 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-end', -2900, gen(speech)), { start_ms: 2000, end_ms: 2500, duration_ms: 500 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'move', 2500, gen(speech)), { start_ms: 3000, end_ms: 6000, duration_ms: 3000 });
  assert.deepEqual(computeClampedSpotDrag(spot, 'move', -2500, gen(speech)), { start_ms: 1000, end_ms: 4000, duration_ms: 3000 });
});

test('Trim stops at a Speech Segment inside the original gap', () => {
  const speechInsideGap = [...speech, { start_ms: 1200, end_ms: 1600 }];
  assert.deepEqual(computeClampedSpotDrag(spot, 'trim-start', -1500, gen(speechInsideGap)), { start_ms: 1600, end_ms: 5000, duration_ms: 3400 });
});

test('a 200 ms nudge keeps unaligned times and stops at the 500 ms minimum', () => {
  const unaligned = { ...spot, start_ms: 2013, end_ms: 2713, duration_ms: 700 };
  assert.deepEqual(computeClampedSpotDrag(unaligned, 'trim-start', -200, gen(speech), 1), { start_ms: 1813, end_ms: 2713, duration_ms: 900 });
  assert.deepEqual(computeClampedSpotDrag(unaligned, 'trim-start', 200, gen(speech), 1), { start_ms: 2213, end_ms: 2713, duration_ms: 500 });
  assert.deepEqual(computeClampedSpotDrag(unaligned, 'trim-end', -400, gen(speech), 1), { start_ms: 2013, end_ms: 2513, duration_ms: 500 });
});

test('a nudge blocked by a Speech Segment, the video end, or the minimum leaves the times unchanged', () => {
  const speechInsideGap = [...speech, { start_ms: 1200, end_ms: 1600 }];
  const atSpeech = { ...spot, start_ms: 1600 };
  assert.deepEqual(computeClampedSpotDrag(atSpeech, 'trim-start', -200, gen(speechInsideGap), 1), { start_ms: 1600, end_ms: 5000, duration_ms: 3400 });
  const atVideoEnd = { ...spot, end_ms: 5500 };
  assert.deepEqual(computeClampedSpotDrag(atVideoEnd, 'trim-end', 200, gen([], 5500), 1), { start_ms: 2000, end_ms: 5500, duration_ms: 3500 });
  const atMinimum = { ...spot, end_ms: 2500 };
  assert.deepEqual(computeClampedSpotDrag(atMinimum, 'trim-start', 200, gen(speech), 1), { start_ms: 2000, end_ms: 2500, duration_ms: 500 });
  assert.deepEqual(computeClampedSpotDrag(atMinimum, 'trim-end', -200, gen(speech), 1), { start_ms: 2000, end_ms: 2500, duration_ms: 500 });
});

test('every clamped result passes validation', () => {
  for (const mode of ['trim-start', 'trim-end', 'move'] as const) {
    for (let delta = -4000; delta <= 4000; delta += 130) {
      const next = computeClampedSpotDrag(spot, mode, delta, gen(speech));
      assert.equal(validateSpotTimestampEdit(spot, next.start_ms, next.end_ms, gen(speech)).valid, true, `${mode} ${delta}`);
    }
  }
});

const cue = (spot_id: string, start_ms: number, end_ms: number, decision: ADSpot['decision'] = 'generate'): ADSpot => ({
  spot_id, start_ms, end_ms, duration_ms: end_ms - start_ms, original_start_ms: start_ms, original_end_ms: end_ms, decision, text: spot_id, is_edited: false,
});
const reviewContext = (spots: ADSpot[], videoDurationMs = 10000) => ({ mode: 'review' as const, spots, videoDurationMs });

test('Review Mode accepts times anywhere in the video, over speech, with at least 500 ms', () => {
  const a = cue('a', 1000, 2000);
  const ctx = reviewContext([a, cue('b', 5000, 6000)]);
  assert.equal(validateSpotTimestampEdit(a, 0, 4999, ctx).valid, true);
  assert.equal(validateSpotTimestampEdit(a, 100, 599, ctx).valid, false);
  assert.equal(validateSpotTimestampEdit(a, 9000, 10001, ctx).valid, false);
});

test('Review Mode rejects overlapping a neighbour but ignores neighbours set to skip', () => {
  const a = cue('a', 1000, 2000);
  assert.equal(validateSpotTimestampEdit(a, 1000, 5200, reviewContext([a, cue('b', 5000, 6000)])).valid, false);
  assert.equal(validateSpotTimestampEdit(a, 1000, 5200, reviewContext([a, cue('b', 5000, 6000, 'skip')])).valid, true);
});

test('Review Mode drag and nudge stop at neighbours and the video ends, not at the imported times', () => {
  const b = cue('b', 4000, 5000);
  const ctx = reviewContext([cue('a', 1000, 2000), b, cue('c', 7000, 8000)]);
  assert.deepEqual(computeClampedSpotDrag(b, 'trim-start', -5000, ctx), { start_ms: 2000, end_ms: 5000, duration_ms: 3000 });
  assert.deepEqual(computeClampedSpotDrag(b, 'trim-end', 9000, ctx), { start_ms: 4000, end_ms: 7000, duration_ms: 3000 });
  assert.deepEqual(computeClampedSpotDrag(b, 'move', 9000, ctx), { start_ms: 6000, end_ms: 7000, duration_ms: 1000 });
  assert.deepEqual(computeClampedSpotDrag(b, 'trim-end', 200, reviewContext([b], 5100), 1), { start_ms: 4000, end_ms: 5100, duration_ms: 1100 });
});

test('Review Mode pushes a line that already overlaps its neighbour out of the overlap when it is moved', () => {
  const b = cue('b', 1800, 3000);
  const ctx = reviewContext([cue('a', 1000, 2000), b]);
  assert.deepEqual(computeClampedSpotDrag(b, 'trim-end', 200, ctx, 1), { start_ms: 2000, end_ms: 3200, duration_ms: 1200 });
  const moved = computeClampedSpotDrag(b, 'move', 100, ctx, 1);
  assert.equal(validateSpotTimestampEdit(b, moved.start_ms, moved.end_ms, ctx).valid, true);
});

test('Review Mode issues flag speech overlap, neighbour overlap, short lines, and lines past the video end', () => {
  const issues = findSpotIssues([
    cue('a', 1000, 3000), cue('b', 2500, 4000), cue('c', 5500, 6500), cue('d', 9000, 9300),
    cue('e', 9500, 10500), cue('f', 2000, 2600, 'skip'),
  ], [{ start_ms: 6000, end_ms: 7000 }], 10000);
  assert.deepEqual(issues.get('a'), ['overlaps_spot']);
  assert.deepEqual(issues.get('b'), ['overlaps_spot']);
  assert.deepEqual(issues.get('c'), ['overlaps_speech']);
  assert.deepEqual(issues.get('d'), ['too_short']);
  assert.deepEqual(issues.get('e'), ['past_video_end']);
  assert.equal(issues.has('f'), false, 'skipped lines are never flagged');
});

test('a line that overlaps a later, non-adjacent line is flagged with it', () => {
  const issues = findSpotIssues([cue('long', 1000, 9000), cue('x', 2000, 3000), cue('y', 5000, 6000)], [], 10000);
  assert.deepEqual([...issues.keys()].sort(), ['long', 'x', 'y']);
});

test('the timing key ignores text edits but changes with times and skip decisions', () => {
  const spots = [cue('a', 1000, 2000), cue('b', 3000, 4000)];
  const key = spotTimingKey(spots);
  assert.equal(spotTimingKey([{ ...spots[0], text: 'แก้คำ' }, spots[1]]), key);
  assert.notEqual(spotTimingKey([{ ...spots[0], end_ms: 2100 }, spots[1]]), key);
  assert.notEqual(spotTimingKey([spots[0], { ...spots[1], decision: 'skip' }]), key);
});
