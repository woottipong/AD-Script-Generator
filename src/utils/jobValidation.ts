import { z } from 'zod';
import { REVIEW_MAX_DURATION_MS, type ADSpot, type PersistedJobState } from '../types/ad';
import { validateSpotTimestampEdit } from './spotTiming';

const ms = z.number().int().finite().nonnegative();
const interval = z.object({ start_ms: ms, end_ms: ms });
const candidate = interval.extend({ spot_id: z.string().min(1), duration_ms: ms });
const vadConfig = z.object({
  speechThreshold: z.number().finite().min(0).max(1),
  minSpeechDurationMs: ms, minSilenceDurationMs: ms, speechPaddingMs: ms, minAdGapMs: ms,
});
const metadata = z.object({
  fileName: z.string().min(1), fileSize: z.number().int().positive().max(2000 * 1024 * 1024),
  mimeType: z.string(), width: z.number().int().positive(), height: z.literal(480),
  durationMs: ms.positive().max(1800000),
  videoCodec: z.string().regex(/^(avc1|avc3)/i), audioCodec: z.string().regex(/^mp4a/i),
  hasAudioTrack: z.literal(true), sampleRate: z.number().positive().optional(), channelCount: z.number().int().positive().optional(),
});
const settings = z.object({
  contentGenre: z.enum(['auto_cinema', 'drama_series', 'documentary', 'action_thriller']),
  narrationPaceCharsPerSec: z.number().finite().positive(), safetyBufferMs: ms,
  avoidCameraJargon: z.boolean(), prioritizeCharacterActions: z.boolean(),
});
const vadOutput = z.object({
  duration_ms: ms.positive().max(1800000),
  speech_segments: z.array(interval), candidate_spots: z.array(candidate),
  signal_analysis: z.object({
    rmsDbFs: z.number().finite(), peakDbFs: z.number().finite(), noiseFloorDbFs: z.number().finite(),
    avgSpeechProbability: z.number().finite(), highConfidenceFrameRatio: z.number().finite(),
    acousticProfileLabel: z.string(), recommendedConfig: vadConfig, recommendationReason: z.string(),
  }).optional(),
  waveform: z.object({
    sampleIntervalMs: z.number().int().min(10).max(1000),
    peaksBase64: z.string().max(250_000),
  }).optional(),
});

const initialization = z.object({ video_metadata: metadata, vad_config: vadConfig, vad_output: vadOutput, ad_settings: settings });

export function validateJobInitialization(input: unknown) {
  return initialization.superRefine(({ vad_output, video_metadata }, ctx) => {
    const duration = vad_output.duration_ms;
    const seen = new Set<string>();
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (Math.abs(duration - video_metadata.durationMs) > 1000) invalid('ความยาวเสียงและวิดีโอไม่ตรงกัน');
    for (const seg of vad_output.speech_segments) {
      if (seg.end_ms <= seg.start_ms || seg.end_ms > duration) invalid('ช่วงเสียงพูดไม่ถูกต้อง');
    }
    const sortedSpeech = [...vad_output.speech_segments].sort((a, b) => a.start_ms - b.start_ms);
    const sortedSpots = [...vad_output.candidate_spots].sort((a, b) => a.start_ms - b.start_ms);
    let speechIndex = 0;
    let previousEnd = 0;
    for (const spot of sortedSpots) {
      if (seen.has(spot.spot_id)) invalid('spot_id ซ้ำ');
      seen.add(spot.spot_id);
      if (spot.end_ms > duration || spot.end_ms - spot.start_ms < 3000 || spot.duration_ms !== spot.end_ms - spot.start_ms || spot.start_ms < previousEnd) invalid('ช่วงบรรยายไม่ถูกต้อง');
      previousEnd = Math.max(previousEnd, spot.end_ms);
      while (speechIndex < sortedSpeech.length && sortedSpeech[speechIndex].end_ms <= spot.start_ms) speechIndex++;
      if (speechIndex < sortedSpeech.length && sortedSpeech[speechIndex].start_ms < spot.end_ms) invalid('ช่วงบรรยายทับเสียงพูด');
    }
  }).safeParse(input);
}

const editedSpot = z.object({
  spot_id: z.string().min(1), start_ms: ms, end_ms: ms, duration_ms: ms,
  original_start_ms: ms, original_end_ms: ms, decision: z.enum(['pending', 'generate', 'skip']),
  text: z.string(), reason: z.string().optional(), is_edited: z.boolean(),
});

const reviewDuration = ms.positive().max(REVIEW_MAX_DURATION_MS);
const reviewCreation = z.object({
  video_metadata: metadata.extend({
    fileSize: z.number().int().nonnegative(), height: z.number().int().positive(), durationMs: reviewDuration, videoCodec: z.string(),
  }),
  vad_config: vadConfig,
  vad_output: vadOutput.extend({ duration_ms: reviewDuration }),
  video_source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('url'), url: z.string().url().regex(/^https?:\/\//i) }),
    z.object({ kind: z.literal('local_file'), file_name: z.string().min(1), file_size: z.number().int().nonnegative() }),
  ]),
  srt_source: z.object({ file_name: z.string().min(1), cue_count: z.number().int().nonnegative() }),
  spots: z.array(editedSpot).min(1),
});

/** Review Mode imports the author's SRT as-is: spots may overlap speech or each other, but must start inside the video. */
export function validateReviewJobCreation(input: unknown) {
  return reviewCreation.superRefine(({ vad_output, video_metadata, spots }, ctx) => {
    const duration = vad_output.duration_ms;
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (Math.abs(duration - video_metadata.durationMs) > 1000) invalid('ความยาวเสียงและวิดีโอไม่ตรงกัน');
    const seen = new Set<string>();
    for (const spot of spots) {
      if (seen.has(spot.spot_id)) invalid('spot_id ซ้ำ');
      seen.add(spot.spot_id);
      if (spot.start_ms >= duration || spot.end_ms <= spot.start_ms || spot.duration_ms !== spot.end_ms - spot.start_ms
        || spot.original_start_ms !== spot.start_ms || spot.original_end_ms !== spot.end_ms) invalid(`บรรทัด ${spot.spot_id} ไม่ถูกต้อง`);
    }
  }).safeParse(input);
}

export function validateEditedSpots(input: unknown, job: PersistedJobState):
  { success: true; spots: ADSpot[] } | { success: false; error: string } {
  const parsed = z.array(editedSpot).safeParse(input);
  if (!parsed.success || parsed.data.length !== job.spots.length) return { success: false, error: 'ข้อมูลรายการ AD Spots ไม่ถูกต้อง' };
  const existing = new Map(job.spots.map((spot) => [spot.spot_id, spot]));
  const seen = new Set<string>();
  for (const spot of parsed.data) {
    const original = existing.get(spot.spot_id);
    if (!original || seen.has(spot.spot_id) || spot.original_start_ms !== original.original_start_ms || spot.original_end_ms !== original.original_end_ms || spot.duration_ms !== spot.end_ms - spot.start_ms) return { success: false, error: `Spot ${spot.spot_id}: ข้อมูลช่วงต้นทางไม่ถูกต้อง` };
    seen.add(spot.spot_id);
    const timingUnchanged = spot.start_ms === original.start_ms && spot.end_ms === original.end_ms;
    if (job.mode === 'review' && timingUnchanged) continue;
    const check = validateSpotTimestampEdit(original, spot.start_ms, spot.end_ms, job.mode === 'review'
      ? { mode: 'review', spots: parsed.data, videoDurationMs: job.vad_output.duration_ms }
      : { mode: 'generate', speechSegments: job.vad_output.speech_segments, videoDurationMs: job.vad_output.duration_ms });
    if (!check.valid) return { success: false, error: `Spot ${spot.spot_id}: ${check.error}` };
  }
  return { success: true, spots: parsed.data };
}
