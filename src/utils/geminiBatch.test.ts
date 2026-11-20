import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisBatch, PersistedJobState } from '../types/ad';
import { BatchResponseError, buildBatchPrompt, parseBatchResponse, parseGeminiError } from './geminiBatch';
import { estimateThaiSpeechDurationMs, narrationCharBudget } from './narrationBudget';

const candidate = (spot_id: string, start_ms: number, end_ms: number) => ({ spot_id, start_ms, end_ms, duration_ms: end_ms - start_ms });

const batch: AnalysisBatch = {
  batch_id: 'batch_2', batch_index: 2, batch_start_ms: 240000, batch_end_ms: 480000,
  window_start_ms: 220000, window_end_ms: 490000,
  candidate_spots: [candidate('a', 250000, 253000), candidate('b', 300000, 307500)],
  status: 'pending', retry_count: 0,
} as AnalysisBatch;

const job = {
  batches: [{}, batch],
  spots: [
    { spot_id: 'early', start_ms: 10000, decision: 'generate', text: 'บทเก่า' },
    { spot_id: 'late', start_ms: 260000, decision: 'generate', text: 'บทหลังเริ่ม batch' },
  ],
} as unknown as PersistedJobState;

const answer = (spots: unknown[]) => JSON.stringify({ spots });

test('narration budget subtracts both safety buffers and the onset margin, with 85% headroom', () => {
  assert.deepEqual(narrationCharBudget(3000, 11.5, 250), { usableDurationMs: 2500, maxChars: 21, maxWords: 5 });
  assert.deepEqual(narrationCharBudget(7500, 11.5, 250), { usableDurationMs: 7000, maxChars: 65, maxWords: 14 });
  assert.deepEqual(narrationCharBudget(400, 11.5, 250), { usableDurationMs: 500, maxChars: 8, maxWords: 3 });
});

test('speech estimate counts Thai base characters only, plus the onset margin', () => {
  assert.equal(estimateThaiSpeechDurationMs('   '), 0);
  assert.equal(estimateThaiSpeechDurationMs('กา'), estimateThaiSpeechDurationMs('ก้า'));
  assert.equal(estimateThaiSpeechDurationMs('ที่ นี่'), estimateThaiSpeechDurationMs('ทน'));
  assert.ok(estimateThaiSpeechDurationMs('กข') > estimateThaiSpeechDurationMs('ก'));
  assert.equal(estimateThaiSpeechDurationMs('ก'.repeat(23)), 2000 + 350);
});

test('prompt covers the clip window, every candidate budget, and only earlier narration', () => {
  const prompt = buildBatchPrompt(job, batch);
  assert.equal(prompt.startOffsetSeconds, 220);
  assert.equal(prompt.endOffsetSeconds, 490);
  assert.match(prompt.promptText, /spot_id: "a".*ห้ามเกิน ~21 ตัวอักษร \/ ~5 คำ/);
  assert.match(prompt.promptText, /spot_id: "b".*ห้ามเกิน ~65 ตัวอักษร \/ ~14 คำ/);
  assert.match(prompt.promptText, /ครบทั้ง 2 รายการ/);
  assert.match(prompt.promptText, /บทเก่า/);
  assert.doesNotMatch(prompt.promptText, /บทหลังเริ่ม batch/);
  assert.match(prompt.systemInstruction, /11\.5 ตัวอักษร\/วินาที/);
});

test('response parsing keeps batch spots, trims text, and defaults a skip reason', () => {
  const results = parseBatchResponse(answer([
    { spot_id: 'a', decision: 'generate', text: '  ชายเปิดประตู  ' },
    { spot_id: 'b', decision: 'skip', text: '' },
    { spot_id: 'outside', decision: 'generate', text: 'ignored' },
  ]), batch);
  assert.deepEqual([...results.keys()], ['a', 'b']);
  assert.deepEqual(results.get('a'), { decision: 'generate', text: 'ชายเปิดประตู', reason: undefined });
  assert.equal(results.get('b')?.reason, 'ไม่มีเหตุการณ์สำคัญที่ต้องบรรยาย');
});

test('response parsing rejects answers the batch cannot use', () => {
  assert.throws(() => parseBatchResponse('  ', batch));
  assert.throws(() => parseBatchResponse('{not json', batch));
  assert.throws(() => parseBatchResponse(answer([{ spot_id: 'a', decision: 'maybe', text: '' }]), batch));
  assert.throws(() => parseBatchResponse(answer([
    { spot_id: 'a', decision: 'generate', text: '   ' },
    { spot_id: 'b', decision: 'skip', text: '' },
  ]), batch));
  assert.throws(() => parseBatchResponse(answer([{ spot_id: 'a', decision: 'skip', text: '' }]), batch), /ขาด: b/);
});

test('an unusable answer naming spot_500 is not treated as a transient Gemini failure', () => {
  const numbered = { ...batch, candidate_spots: [candidate('spot_429', 1000, 4000), candidate('spot_500', 5000, 9000)] } as AnalysisBatch;
  let thrown: unknown;
  try {
    parseBatchResponse(answer([{ spot_id: 'spot_429', decision: 'skip', text: '' }]), numbered);
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof BatchResponseError);
  assert.match((thrown as Error).message, /spot_500/);
  const classified = parseGeminiError(thrown);
  assert.equal(classified.isTransient, false);
  assert.equal(classified.isRateLimit, false);
  assert.equal(classified.isHighDemand503, false);
});

test('real Gemini failures keep their classification', () => {
  assert.equal(parseGeminiError(new Error('503 UNAVAILABLE: high demand')).isHighDemand503, true);
  assert.equal(parseGeminiError(new Error('429 RESOURCE_EXHAUSTED')).statusCode, 429);
  assert.equal(parseGeminiError(new Error('API key not valid')).statusCode, 401);
  assert.equal(parseGeminiError(new Error('fetch failed')).isTransient, true);
});
