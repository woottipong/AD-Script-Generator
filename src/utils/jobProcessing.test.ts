import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VAD_CONFIG } from '../types/ad';
import type { ADSpot, PersistedJobState } from '../types/ad';
import { mergeProcessingState } from './jobProcessing';

function spot(id: string, start: number): ADSpot {
  return {
    spot_id: id,
    start_ms: start + 200,
    end_ms: start + 3800,
    duration_ms: 3600,
    original_start_ms: start,
    original_end_ms: start + 4000,
    decision: 'generate',
    text: 'original narration',
    is_edited: true,
  };
}

function job(spots: ADSpot[]): PersistedJobState {
  return {
    schema_version: 3,
    job_id: 'job_test',
    title: 'test',
    mode: 'generate',
    video_source: { kind: 'server_copy', local_file_path: '/tmp/source_video.mp4' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    status: 'ANALYZING',
    video_metadata: {
      fileName: 'sample.mp4', fileSize: 1, mimeType: 'video/mp4',
      width: 854, height: 480, durationMs: 20000,
      videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true,
    },
    vad_config: DEFAULT_VAD_CONFIG,
    vad_output: { duration_ms: 20000, speech_segments: [], candidate_spots: [] },
    batches: [],
    spots,
  };
}

test('progress and failure updates retain the latest user edits', () => {
  const processing = job([spot('a', 1000)]);
  const edited = { ...spot('a', 1000), start_ms: 1400, text: 'บทที่แก้ไข' };
  const latest = job([edited]);

  const progress = mergeProcessingState({ ...processing, progress_percent: 50 }, latest);
  assert.equal(progress.progress_percent, 50);
  assert.deepEqual(progress.spots, [edited]);

  const failure = mergeProcessingState({ ...processing, status: 'FAILED', error_message: 'failed' }, latest);
  assert.equal(failure.status, 'FAILED');
  assert.equal(failure.error_message, 'failed');
  assert.deepEqual(failure.spots, [edited]);
});

test('batch results replace matching spots and preserve edits to other spots', () => {
  const processing = job([spot('a', 1000), spot('b', 7000)]);
  const editedOther = { ...spot('b', 7000), text: 'บทที่แก้ไข', start_ms: 7400 };
  const latest = job([{ ...spot('a', 1000), text: 'previous edit' }, editedOther]);
  const results = new Map([['a', { decision: 'skip' as const, text: '', reason: 'ไม่มีภาพสำคัญ' }]]);

  const merged = mergeProcessingState(processing, latest, results);
  assert.deepEqual(merged.spots[0], {
    ...latest.spots[0], start_ms: 1000, end_ms: 5000, duration_ms: 4000,
    decision: 'skip', text: '', reason: 'ไม่มีภาพสำคัญ',
  });
  assert.deepEqual(merged.spots[1], editedOther);
  assert.equal(latest.spots[0].text, 'previous edit');
});
