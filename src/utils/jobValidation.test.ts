import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AD_ANALYSIS_SETTINGS, DEFAULT_VAD_CONFIG, type PersistedJobState } from '../types/ad';
import { validateEditedSpots, validateJobInitialization, validateReviewJobCreation, resolveJobTitle } from './jobValidation';

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

const reviewSpot = { spot_id: 'cue_001', start_ms: 5500, end_ms: 6500, duration_ms: 1000, original_start_ms: 5500, original_end_ms: 6500, decision: 'generate' as const, text: 'ทับเสียงพูด', is_edited: false };
const reviewInput = () => ({
  video_metadata: { fileName: 'lesson.mp4', fileSize: 71225137, mimeType: 'video/mp4', width: 1920, height: 1080, durationMs: 2_400_000, videoCodec: 'hvc1.1.6.L120', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
  vad_config: DEFAULT_VAD_CONFIG,
  vad_output: { duration_ms: 2_400_000, speech_segments: [{ start_ms: 6000, end_ms: 7000 }], candidate_spots: [] },
  video_source: { kind: 'local_file', file_name: 'lesson.mp4', file_size: 71225137 },
  srt_source: { file_name: 'lesson.srt', cue_count: 1 },
  spots: [reviewSpot],
});

test('Review Mode creation accepts any resolution, codec, and size up to 60 minutes, and spots that overlap speech', () => {
  assert.equal(validateReviewJobCreation(reviewInput()).success, true);
  const viaUrl = reviewInput(); (viaUrl as { video_source: unknown }).video_source = { kind: 'url', url: 'https://drive.example/lesson.mp4' };
  assert.equal(validateReviewJobCreation(viaUrl).success, true);
});

test('Review Mode creation rejects videos over 60 minutes, server copies, and spots it cannot place', () => {
  const tooLong = reviewInput(); tooLong.video_metadata.durationMs = 3_600_001; tooLong.vad_output.duration_ms = 3_600_001;
  const serverCopy = reviewInput(); (serverCopy as { video_source: unknown }).video_source = { kind: 'server_copy', local_file_path: '/etc/passwd' };
  const notHttp = reviewInput(); (notHttp as { video_source: unknown }).video_source = { kind: 'url', url: 'file:///etc/passwd' };
  const beyondEnd = reviewInput(); beyondEnd.spots = [{ ...reviewSpot, start_ms: 2_400_000, end_ms: 2_401_000, original_start_ms: 2_400_000, original_end_ms: 2_401_000 }];
  const duplicate = reviewInput(); duplicate.spots = [reviewSpot, reviewSpot];
  const inconsistent = reviewInput(); inconsistent.spots = [{ ...reviewSpot, duration_ms: 5 }];
  const noSpots = reviewInput(); noSpots.spots = [];
  for (const [label, candidate] of Object.entries({ tooLong, serverCopy, notHttp, beyondEnd, duplicate, inconsistent, noSpots })) {
    assert.equal(validateReviewJobCreation(candidate).success, false, label);
  }
});

test('the waveform cap fits a 60 minute video at 20 ms buckets', () => {
  const long = input(); (long.vad_output as Record<string, unknown>).waveform = { sampleIntervalMs: 20, peaksBase64: 'A'.repeat(240_000) };
  assert.equal(validateJobInitialization(long).success, true);
  const review = reviewInput(); (review.vad_output as Record<string, unknown>).waveform = { sampleIntervalMs: 20, peaksBase64: 'A'.repeat(250_001) };
  assert.equal(validateReviewJobCreation(review).success, false);
});

test('Review Mode saves text edits on imported lines as they are, and checks retimed lines against Review Mode rules', () => {
  const reviewJob = { mode: 'review', spots: [reviewSpot], vad_output: reviewInput().vad_output } as unknown as PersistedJobState;
  assert.equal(validateEditedSpots([{ ...reviewSpot, text: 'แก้คำผิด', is_edited: true }], reviewJob).success, true);
  assert.equal(validateEditedSpots([{ ...reviewSpot, start_ms: 5600, duration_ms: 900 }], reviewJob).success, true, 'retimed line may sit over speech');
  const neighbour = { ...reviewSpot, spot_id: 'cue_002', start_ms: 8000, end_ms: 9000, duration_ms: 1000, original_start_ms: 8000, original_end_ms: 9000 };
  const twoLines = { ...reviewJob, spots: [reviewSpot, neighbour] } as PersistedJobState;
  assert.equal(validateEditedSpots([{ ...reviewSpot, end_ms: 8500, duration_ms: 3000 }, neighbour], twoLines).success, false, 'retimed line may not overlap a neighbour');
  assert.equal(validateEditedSpots([{ ...reviewSpot, end_ms: 8500, duration_ms: 3000 }, { ...neighbour, decision: 'skip' }], twoLines).success, true, 'skipped neighbours do not block');
  assert.equal(validateEditedSpots([{ ...reviewSpot, start_ms: 6200, duration_ms: 300 }], reviewJob).success, false, 'retimed line must last 500 ms');
  const generateJob = { ...reviewJob, mode: 'generate' } as PersistedJobState;
  assert.equal(validateEditedSpots([{ ...reviewSpot, text: 'แก้คำผิด' }], generateJob).success, false);
});

test('a Job Title defaults to the video file name without its extension', () => {
  assert.deepEqual(resolveJobTitle(undefined, 'สารคดี ตอนที่ 3.mp4'), { success: true, title: 'สารคดี ตอนที่ 3' });
  assert.deepEqual(resolveJobTitle('   ', 'clip.MP4'), { success: true, title: 'clip' });
  assert.deepEqual(resolveJobTitle('  ชื่อที่ตั้งเอง  ', 'clip.mp4'), { success: true, title: 'ชื่อที่ตั้งเอง' });
  assert.deepEqual(resolveJobTitle(undefined, `${'ก'.repeat(130)}.mp4`), { success: true, title: 'ก'.repeat(120) }, 'a long file name is cut to fit');
});

test('a Job Title the author types must be text of at most 120 characters', () => {
  assert.equal(resolveJobTitle('ก'.repeat(120), 'clip.mp4').success, true);
  assert.equal(resolveJobTitle('ก'.repeat(121), 'clip.mp4').success, false);
  assert.equal(resolveJobTitle(42, 'clip.mp4').success, false);
  assert.equal(resolveJobTitle('  ').success, false, 'a rename cannot clear the title');
});
