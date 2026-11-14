import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AD_ANALYSIS_SETTINGS, DEFAULT_VAD_CONFIG, type PersistedJobState } from '../types/ad';
import { validateEditedSpots, validateJobInitialization } from './jobValidation';

const spot = { spot_id: 'one', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'generate' as const, text: 'บท', is_edited: false };
const input = () => ({
  video_metadata: { fileName: 'video.mp4', fileSize: 100, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
  vad_config: DEFAULT_VAD_CONFIG, ad_settings: DEFAULT_AD_ANALYSIS_SETTINGS,
  vad_output: { duration_ms: 10000, speech_segments: [{ start_ms: 6000, end_ms: 7000 }], candidate_spots: [{ spot_id: 'one', start_ms: 1000, end_ms: 5000, duration_ms: 4000 }] },
});
const job = () => ({ spots: [spot], vad_output: input().vad_output } as unknown as PersistedJobState);

test('accepts valid VAD output and rejects invalid or overlapping spots', () => {
  assert.equal(validateJobInitialization(input()).success, true);
  const duplicated = input(); duplicated.vad_output.candidate_spots.push({ ...duplicated.vad_output.candidate_spots[0] });
  assert.equal(validateJobInitialization(duplicated).success, false);
  const overlaps = input(); overlaps.vad_output.candidate_spots[0] = { spot_id: 'one', start_ms: 4000, end_ms: 8000, duration_ms: 4000 };
  assert.equal(validateJobInitialization(overlaps).success, false);
  const invalid = input(); invalid.video_metadata.height = 720;
  assert.equal(validateJobInitialization(invalid).success, false);
});

test('retains source gap and rejects forged, missing, duplicate, or inconsistent spots', () => {
  assert.equal(validateEditedSpots([{ ...spot, text: 'แก้ไข', start_ms: 1200, duration_ms: 3800 }], job()).success, true);
  for (const spots of [[], [spot, spot], [{ ...spot, spot_id: 'other' }], [{ ...spot, original_start_ms: 0 }], [{ ...spot, duration_ms: 1 }], [{ ...spot, start_ms: null }]]) {
    assert.equal(validateEditedSpots(spots, job()).success, false);
  }
});
