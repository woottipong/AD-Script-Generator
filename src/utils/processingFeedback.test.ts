import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisBatch } from '../types/ad';
import { getProcessingFeedback } from './processingFeedback';

function batch(index: number, status: AnalysisBatch['status']): AnalysisBatch {
  return {
    batch_index: index, batch_id: `batch_${index}`, status, retry_count: 0,
    batch_start_ms: 0, batch_end_ms: 240_000,
    window_start_ms: 0, window_end_ms: 250_000, candidate_spots: [],
  };
}

test('preparation and finalization do not present milestone percentages as measured progress', () => {
  for (const progress of [{ stage: 'กำลังโหลดโมเดล Silero VAD' }, { stage: 'any wording', phase: 'finalizing-detection' as const }]) {
    const feedback = getProcessingFeedback('DETECTING', { ...progress, percent: 98 }, [], null);
    assert.ok(feedback);
    assert.equal(feedback.percent, undefined);
    assert.doesNotMatch(feedback.title, /Silero|PCM|AAC/);
  }
});

test('audio progress measures processed video time rather than weighted worker milestones', () => {
  const feedback = getProcessingFeedback('DETECTING', {
    stage: 'กำลังถอดรหัส AAC เป็น PCM', percent: 82, processedMs: 30_000, totalMs: 120_000,
  }, [], null);
  assert.ok(feedback);
  assert.equal(feedback.percent, 25);
  assert.equal(feedback.detail, 'ตรวจเสียงแล้ว 00:30 จาก 02:00');
});

test('decoded frame padding cannot push the audio progress past the video duration', () => {
  const feedback = getProcessingFeedback('DETECTING', {
    stage: '', percent: 94, processedMs: 10_016, totalMs: 10_000,
  }, [], null);
  assert.ok(feedback);
  assert.equal(feedback.percent, 100);
  assert.equal(feedback.detail, 'ตรวจเสียงแล้ว 00:10 จาก 00:10');
});

test('upload completion transitions to waiting without showing a backwards overall percentage', () => {
  const upload = getProcessingFeedback('ANALYZING', {
    stage: 'กำลังอัปโหลดวิดีโอ', percent: 95, loadedBytes: 1_048_576, totalBytes: 1_048_576,
  }, [], null);
  const preparing = getProcessingFeedback('ANALYZING', {
    stage: 'รอ Gemini Files API ประมวลผลไฟล์วิดีโอ', percent: 12,
  }, [], null);
  assert.ok(upload);
  assert.ok(preparing);
  assert.equal(upload.percent, 100);
  assert.equal(upload.detail, 'ส่งแล้ว 1.00 MB จาก 1.00 MB');
  assert.equal(preparing.title, 'กำลังเตรียมวิดีโอสำหรับวิเคราะห์');
  assert.equal(preparing.percent, undefined);
});

test('generation progress reflects completed batches and identifies the current batch', () => {
  const feedback = getProcessingFeedback('ANALYZING', { stage: '', percent: 67 }, [
    batch(1, 'completed'), batch(2, 'processing'), batch(3, 'pending'),
  ], null);
  assert.ok(feedback);
  assert.equal(feedback.percent, 33);
  assert.equal(feedback.detail, 'วิเคราะห์เสร็จ 1 จาก 3 ชุด · กำลังทำชุดที่ 2');
});

test('connection loss replaces stale progress with a reconnecting message', () => {
  const feedback = getProcessingFeedback('ANALYZING', { stage: '', percent: 90 }, [batch(1, 'processing')], 'ตรวจสถานะไม่ได้');
  assert.ok(feedback);
  assert.equal(feedback.title, 'กำลังตรวจการเชื่อมต่ออีกครั้ง');
  assert.equal(feedback.percent, undefined);
});

test('completed and failed jobs stop showing the loading feedback', () => {
  for (const status of ['IDLE', 'VAD_READY', 'READY', 'FAILED'] as const) {
    assert.equal(getProcessingFeedback(status, null, [], null), null);
  }
});

test('waiting for edits to save is shown as saving, not as server preparation', () => {
  const feedback = getProcessingFeedback('ANALYZING', { stage: 'any wording', phase: 'saving-edits', percent: 15 }, [batch(1, 'pending')], null);
  assert.ok(feedback);
  assert.equal(feedback.title, 'กำลังบันทึกบทบรรยาย');
  assert.equal(feedback.percent, undefined);
});
