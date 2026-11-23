import assert from 'node:assert/strict';
import test from 'node:test';
import type { ADSpot, CandidateSpot } from '../types/ad';
import { buildAnalysisBatches, enableSpotNarration, generateSrtContent } from './formatters';

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

const skippedSpot: ADSpot = {
  ...spot('skipped', 1_000, 8_000),
  original_start_ms: 1_000,
  original_end_ms: 8_000,
  decision: 'skip',
  text: '',
  reason: 'เด็กหญิงวางตุ๊กตาผึ้งลงในช่องกระดาษ',
};

test('enables a skipped spot with its displayed AI explanation and includes it in SRT', () => {
  const enabled = enableSpotNarration(skippedSpot);

  assert.equal(enabled.decision, 'generate');
  assert.equal(enabled.text, skippedSpot.reason);
  assert.equal(enabled.reason, skippedSpot.reason);
  assert.equal(skippedSpot.decision, 'skip');
  assert.equal(generateSrtContent([skippedSpot]), '');
  assert.equal(generateSrtContent([enabled]),
    `1\n00:00:01,000 --> 00:00:08,000\n${skippedSpot.reason}`);
});

test('keeps existing narration when enabling a skipped spot again', () => {
  const edited = { ...skippedSpot, text: 'บทบรรยายที่ผู้ใช้แก้ไข' };
  const enabled = enableSpotNarration(edited);
  const enabledAgain = enableSpotNarration({ ...enabled, decision: 'skip' });

  assert.equal(enabledAgain.text, edited.text);
  assert.equal(enabledAgain.start_ms, edited.start_ms);
  assert.equal(enabledAgain.end_ms, edited.end_ms);
});

test('leaves an intentionally empty narration empty and handles missing AI text', () => {
  assert.equal(enableSpotNarration({ ...skippedSpot, decision: 'generate' }).text, '');
  assert.equal(enableSpotNarration({ ...skippedSpot, text: '  ', reason: undefined }).text, '');
});
