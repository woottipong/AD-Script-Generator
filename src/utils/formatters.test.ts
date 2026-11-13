import assert from 'node:assert/strict';
import test from 'node:test';
import type { CandidateSpot } from '../types/ad';
import { buildAnalysisBatches } from './formatters';

function spot(id: string, start: number, end: number): CandidateSpot {
  return { spot_id: id, start_ms: start, end_ms: end, duration_ms: end - start };
}

test('groups a 30 minute timeline into fewer planned analysis requests', () => {
  const spots = Array.from({ length: 15 }, (_, index) =>
    spot(`spot_${index}`, index * 120_000 + 1_000, index * 120_000 + 5_000)
  );
  const batches = buildAnalysisBatches(spots, 1_800_000);

  assert.equal(batches.length, 8);
  assert.equal(buildAnalysisBatches(spots, 1_800_000, 120).length, 15);
  assert.deepEqual(batches.flatMap((batch) => batch.candidate_spots.map((item) => item.spot_id)),
    spots.map((item) => item.spot_id));
});

test('assigns a spot at the boundary to the next batch', () => {
  const batches = buildAnalysisBatches([
    spot('before', 235_000, 239_000),
    spot('boundary', 240_000, 243_000),
  ], 480_000);

  assert.deepEqual(batches.map((batch) => batch.candidate_spots.map((item) => item.spot_id)), [
    ['before'],
    ['boundary'],
  ]);
  assert.deepEqual(batches.map((batch) => [batch.window_start_ms, batch.window_end_ms]), [
    [0, 250_000],
    [220_000, 480_000],
  ]);
});

test('covers a crossing spot, clips context at video ends, and omits empty buckets', () => {
  const spots = [
    spot('first', 1_000, 5_000),
    spot('crossing', 239_000, 260_000),
    spot('next', 270_000, 274_000),
    spot('last', 756_000, 760_000),
  ];
  const batches = buildAnalysisBatches(spots, 760_000);

  assert.deepEqual(batches.map((batch) => [batch.batch_start_ms, batch.batch_end_ms]), [
    [0, 240_000], [240_000, 480_000], [720_000, 760_000],
  ]);
  assert.deepEqual(batches.map((batch) => [batch.window_start_ms, batch.window_end_ms]), [
    [0, 270_000], [220_000, 490_000], [700_000, 760_000],
  ]);
  assert.deepEqual(batches.flatMap((batch) => batch.candidate_spots.map((item) => item.spot_id)),
    spots.map((item) => item.spot_id));
  for (const batch of batches) {
    for (const item of batch.candidate_spots) {
      assert.ok(batch.window_start_ms <= item.start_ms && batch.window_end_ms >= item.end_ms);
    }
  }
});

test('produces no batches when there are no candidate spots', () => {
  assert.deepEqual(buildAnalysisBatches([], 1_800_000), []);
});
