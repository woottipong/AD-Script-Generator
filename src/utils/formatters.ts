import { ADSpot, AnalysisBatch, CandidateSpot, SpeechSegment, VADConfig, VideoMetadata } from '../types/ad';

export const DEFAULT_ANALYSIS_BATCH_SECONDS = 240;

/**
 * Formats milliseconds into HH:MM:SS.mmm for UI display
 */
export function formatTimestampDisplay(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Formats milliseconds into MM:SS or HH:MM:SS for compact player/timeline labels
 */
export function formatCompactTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Formats milliseconds into HH:MM:SS,mmm for SubRip (.srt) files
 */
export function formatTimestampSrt(ms: number): string {
  return formatTimestampDisplay(ms).replace('.', ',');
}

/**
 * Parses HH:MM:SS.mmm or MM:SS.mmm or HH:MM:SS into milliseconds.
 * Returns null if format is invalid.
 */
export function parseTimestampInput(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  // Match HH:MM:SS.mmm or HH:MM:SS
  const fullMatch = /^(\d{1,2}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (fullMatch) {
    const hours = parseInt(fullMatch[1], 10);
    const minutes = parseInt(fullMatch[2], 10);
    const seconds = parseInt(fullMatch[3], 10);
    const millisStr = (fullMatch[4] || '0').padEnd(3, '0');
    const millis = parseInt(millisStr, 10);
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
  }

  // Match MM:SS.mmm or MM:SS
  const shortMatch = /^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (shortMatch) {
    const minutes = parseInt(shortMatch[1], 10);
    const seconds = parseInt(shortMatch[2], 10);
    const millisStr = (shortMatch[3] || '0').padEnd(3, '0');
    const millis = parseInt(millisStr, 10);
    return minutes * 60000 + seconds * 1000 + millis;
  }

  return null;
}

/**
 * Estimates Thai Audio Description speaking duration in milliseconds.
 * Excludes combining Thai vowel/tone marks so the phonetic character count is accurate.
 * Standard Thai AD narration pace is ~11.5 base characters per second.
 */
export function estimateThaiSpeechDurationMs(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  // Strip Thai combining marks (above/below vowels and tone marks: U+0E31, U+0E34..U+0E3A, U+0E47..U+0E4E) and whitespace
  const baseChars = cleaned.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\s]/g, '');
  if (baseChars.length === 0) return 0;
  // ~88 ms per base character + 350 ms breath/onset margin
  return Math.round(baseChars.length * 88 + 350);
}

/**
 * Validates whether a proposed [startMs, endMs] for an ADSpot stays within its original
 * non-speech gap and does not overlap any speech segments.
 */
export function validateSpotTimestampEdit(
  spot: ADSpot,
  newStartMs: number,
  newEndMs: number,
  speechSegments: SpeechSegment[],
  videoDurationMs: number
): { valid: boolean; error?: string } {
  if (isNaN(newStartMs) || isNaN(newEndMs)) {
    return { valid: false, error: 'รูปแบบเวลาไม่ถูกต้อง (ใช้ HH:MM:SS.mmm)' };
  }
  if (newStartMs < 0 || newEndMs > videoDurationMs) {
    return { valid: false, error: 'เวลาต้องอยู่ในช่วงความยาวของวิดีโอ' };
  }
  if (newEndMs <= newStartMs) {
    return { valid: false, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
  }
  if (newEndMs - newStartMs < 500) {
    return { valid: false, error: 'ความยาวของช่วงบรรยายต้องไม่น้อยกว่า 0.5 วินาที' };
  }

  // Must stay within original non-speech gap (with 1ms tolerance for rounding)
  if (newStartMs < spot.original_start_ms - 1 || newEndMs > spot.original_end_ms + 1) {
    return {
      valid: false,
      error: `แก้ไขเวลาได้เฉพาะภายในช่วงว่างต้นทาง (${formatTimestampDisplay(spot.original_start_ms)} – ${formatTimestampDisplay(spot.original_end_ms)})`,
    };
  }

  // Must not overlap any detected speech segment
  for (const seg of speechSegments) {
    if (newStartMs < seg.end_ms && newEndMs > seg.start_ms) {
      return {
        valid: false,
        error: `เวลาทับซ้อนกับช่วงที่มีเสียงพูด (${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)})`,
      };
    }
  }

  return { valid: true };
}

/**
 * Builds Analysis Batches according to Section 06:
 * - Splits timeline into 240-second intervals by default
 * - Each Candidate Spot belongs to exactly one primary batch (by start_ms)
 * - Expands reading window by Context Before (20s) and Context After (10s), clamped to [0, duration_ms]
 */
export function buildAnalysisBatches(
  candidateSpots: CandidateSpot[],
  durationMs: number,
  batchSeconds = DEFAULT_ANALYSIS_BATCH_SECONDS,
  contextBeforeSeconds = 20,
  contextAfterSeconds = 10
): AnalysisBatch[] {
  if (candidateSpots.length === 0 || durationMs <= 0) {
    return [];
  }

  const batchDurationMs = batchSeconds * 1000;
  const contextBeforeMs = contextBeforeSeconds * 1000;
  const contextAfterMs = contextAfterSeconds * 1000;
  const totalBuckets = Math.max(1, Math.ceil(durationMs / batchDurationMs));

  const batches: AnalysisBatch[] = [];

  for (let i = 0; i < totalBuckets; i++) {
    const batchStartMs = i * batchDurationMs;
    const batchEndMs = Math.min(durationMs, (i + 1) * batchDurationMs);

    const spotsInBatch = candidateSpots.filter((spot) => {
      if (i === totalBuckets - 1) {
        return spot.start_ms >= batchStartMs && spot.start_ms <= batchEndMs;
      }
      return spot.start_ms >= batchStartMs && spot.start_ms < batchEndMs;
    });

    if (spotsInBatch.length === 0) {
      continue;
    }

    // Ensure window covers all spots in the batch plus before/after context
    const earliestSpotStart = Math.min(batchStartMs, ...spotsInBatch.map((s) => s.start_ms));
    const latestSpotEnd = Math.max(batchEndMs, ...spotsInBatch.map((s) => s.end_ms));

    const windowStartMs = Math.max(0, earliestSpotStart - contextBeforeMs);
    const windowEndMs = Math.min(durationMs, latestSpotEnd + contextAfterMs);

    batches.push({
      batch_index: batches.length + 1,
      batch_id: `batch_${String(batches.length + 1).padStart(3, '0')}`,
      batch_start_ms: batchStartMs,
      batch_end_ms: batchEndMs,
      window_start_ms: windowStartMs,
      window_end_ms: windowEndMs,
      candidate_spots: spotsInBatch,
      status: 'pending',
      retry_count: 0,
    });
  }

  return batches;
}

/**
 * Generates SRT content according to Section 10:
 * Only includes spots with decision === 'generate' and non-empty text
 */
export function generateSrtContent(spots: ADSpot[]): string {
  const validSpots = spots
    .filter((spot) => spot.decision === 'generate' && spot.text.trim().length > 0)
    .sort((a, b) => a.start_ms - b.start_ms);

  return validSpots
    .map((spot, idx) => {
      const index = idx + 1;
      const start = formatTimestampSrt(spot.start_ms);
      const end = formatTimestampSrt(spot.end_ms);
      return `${index}\n${start} --> ${end}\n${spot.text.trim()}`;
    })
    .join('\n\n');
}

/**
 * Generates full JSON export payload according to Section 10:
 * Includes Video Metadata, VAD Configuration, Speech Segments,
 * Candidate AD Spots, Generated Script, Skipped Spots, Edited Timestamps
 */
export function generateJsonExportContent(params: {
  videoMetadata: VideoMetadata;
  vadConfig: VADConfig;
  durationMs: number;
  speechSegments: SpeechSegment[];
  candidateSpots: CandidateSpot[];
  spots: ADSpot[];
}): string {
  const { videoMetadata, vadConfig, durationMs, speechSegments, candidateSpots, spots } = params;

  const generatedScript = spots
    .filter((s) => s.decision === 'generate' && s.text.trim().length > 0)
    .map((s) => ({
      spot_id: s.spot_id,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      duration_ms: s.duration_ms,
      start_time: formatTimestampDisplay(s.start_ms),
      end_time: formatTimestampDisplay(s.end_ms),
      decision: s.decision,
      text: s.text.trim(),
      is_edited: s.is_edited,
    }));

  const skippedSpots = spots
    .filter((s) => s.decision === 'skip' || (s.decision === 'generate' && s.text.trim().length === 0))
    .map((s) => ({
      spot_id: s.spot_id,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      duration_ms: s.duration_ms,
      start_time: formatTimestampDisplay(s.start_ms),
      end_time: formatTimestampDisplay(s.end_ms),
      decision: 'skip' as const,
      reason: s.reason || (s.text.trim().length === 0 ? 'ไม่มีข้อความบรรยาย' : undefined),
      is_edited: s.is_edited,
    }));

  const editedTimestamps = spots
    .filter(
      (s) =>
        s.is_edited &&
        (s.start_ms !== s.original_start_ms || s.end_ms !== s.original_end_ms)
    )
    .map((s) => ({
      spot_id: s.spot_id,
      original_start_ms: s.original_start_ms,
      original_end_ms: s.original_end_ms,
      edited_start_ms: s.start_ms,
      edited_end_ms: s.end_ms,
      edited_start_time: formatTimestampDisplay(s.start_ms),
      edited_end_time: formatTimestampDisplay(s.end_ms),
    }));

  const payload = {
    schema_version: '1.1',
    exported_at: new Date().toISOString(),
    video_metadata: {
      file_name: videoMetadata.fileName,
      file_size_bytes: videoMetadata.fileSize,
      mime_type: videoMetadata.mimeType,
      width: videoMetadata.width,
      height: videoMetadata.height,
      duration_ms: durationMs,
      duration_formatted: formatTimestampDisplay(durationMs),
      video_codec: videoMetadata.videoCodec,
      audio_codec: videoMetadata.audioCodec,
      has_audio_track: videoMetadata.hasAudioTrack,
      sample_rate: videoMetadata.sampleRate,
      channel_count: videoMetadata.channelCount,
    },
    vad_configuration: {
      speech_threshold: vadConfig.speechThreshold,
      min_speech_duration_ms: vadConfig.minSpeechDurationMs,
      min_silence_duration_ms: vadConfig.minSilenceDurationMs,
      speech_padding_ms: vadConfig.speechPaddingMs,
      minimum_ad_gap_ms: vadConfig.minAdGapMs,
    },
    speech_segments: speechSegments.map((seg) => ({
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      start_time: formatTimestampDisplay(seg.start_ms),
      end_time: formatTimestampDisplay(seg.end_ms),
    })),
    candidate_spots: candidateSpots,
     spots: spots.map((s) => ({
      spot_id: s.spot_id,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      duration_ms: s.duration_ms,
      start_time: formatTimestampDisplay(s.start_ms),
      end_time: formatTimestampDisplay(s.end_ms),
      decision: s.decision,
      text: s.text,
      reason: s.reason,
      is_edited: s.is_edited,
    })),
    generated_script: generatedScript,
    skipped_spots: skippedSpots,
    edited_timestamps: editedTimestamps,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Formats bytes into human-readable MB / GB
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
