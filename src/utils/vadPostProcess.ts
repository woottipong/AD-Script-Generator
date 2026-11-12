import {
  AudioSignalAnalysis,
  CandidateSpot,
  SpeechSegment,
  VADConfig,
  VADOutput,
} from '../types/ad';

/**
 * Analyzes frame-level Silero VAD probabilities and 16kHz PCM RMS energy to determine
 * the video's acoustic profile and recommend the optimal VAD parameters for this video.
 */
export function analyzeAudioSignalAndRecommendVad(
  probabilities: Float32Array | number[],
  frameRmsValues: Float32Array | number[]
): AudioSignalAnalysis {
  const numFrames = probabilities.length;
  if (numFrames === 0) {
    return {
      rmsDbFs: -60,
      peakDbFs: -60,
      noiseFloorDbFs: -60,
      avgSpeechProbability: 0,
      highConfidenceFrameRatio: 0,
      acousticProfileLabel: 'ไม่มีสัญญาณเสียง',
      recommendedConfig: {
        speechThreshold: 0.5,
        minSpeechDurationMs: 250,
        minSilenceDurationMs: 400,
        speechPaddingMs: 200,
        minAdGapMs: 3000,
      },
      recommendationReason: 'ใช้ค่ามาตรฐานเริ่มต้นสำหรับวิดีโอทั่วไป',
    };
  }

  let sumProb = 0;
  let highConfCount = 0;
  let midConfCount = 0;

  for (let i = 0; i < numFrames; i++) {
    const p = probabilities[i];
    sumProb += p;
    if (p >= 0.6) highConfCount++;
    else if (p >= 0.25 && p < 0.6) midConfCount++;
  }

  const avgSpeechProbability = sumProb / numFrames;
  const highConfidenceFrameRatio = highConfCount / numFrames;
  const ambiguousFrameRatio = midConfCount / numFrames;

  // Analyze RMS energy distribution in dBFS
  const dbValues: number[] = [];
  let sumSquareRms = 0;
  let maxRms = 0;

  for (let i = 0; i < frameRmsValues.length; i++) {
    const rms = frameRmsValues[i];
    sumSquareRms += rms * rms;
    if (rms > maxRms) maxRms = rms;
    const db = rms > 1e-6 ? Math.max(-80, 20 * Math.log10(rms)) : -80;
    dbValues.push(db);
  }

  dbValues.sort((a, b) => a - b);
  const overallRms = frameRmsValues.length > 0 ? Math.sqrt(sumSquareRms / frameRmsValues.length) : 0;
  const rmsDbFs = overallRms > 1e-6 ? Math.max(-80, Number((20 * Math.log10(overallRms)).toFixed(1))) : -80;
  const peakDbFs = maxRms > 1e-6 ? Math.max(-80, Number((20 * Math.log10(maxRms)).toFixed(1))) : -80;
  const p20Idx = Math.min(dbValues.length - 1, Math.max(0, Math.floor(dbValues.length * 0.2)));
  const noiseFloorDbFs = dbValues.length > 0 ? Number(dbValues[p20Idx].toFixed(1)) : -80;

  // Determine optimal VAD parameters from signal characteristics
  let recommendedConfig: VADConfig = {
    speechThreshold: 0.5,
    minSpeechDurationMs: 250,
    minSilenceDurationMs: 400,
    speechPaddingMs: 200,
    minAdGapMs: 3000,
  };
  let acousticProfileLabel = 'เสียงพูดสมดุล มาตรฐาน (Balanced Dialogue)';
  let recommendationReason =
    'สัญญาณเสียงพูดแยกจากช่วงเงียบได้ชัดเจน เหมาะกับค่ามาตรฐาน Optimal Default (Threshold 0.50, Padding 200ms)';

  if (noiseFloorDbFs > -36 || ambiguousFrameRatio > 0.14) {
    // Noticeable background music / ambient sound / SFX
    recommendedConfig = {
      speechThreshold: 0.55,
      minSpeechDurationMs: 260,
      minSilenceDurationMs: 420,
      speechPaddingMs: 240,
      minAdGapMs: 3000,
    };
    acousticProfileLabel = 'มีดนตรีประกอบหรือเสียงบรรยากาศต่อเนื่อง (BGM / Ambient Rich)';
    recommendationReason =
      'ตรวจพบเสียงพื้นหลังหรือดนตรีคลอในระดับปานกลาง–สูง แนะนำปรับ Threshold เป็น 0.55 และ Padding 240ms เพื่อป้องกันเสียงดนตรีถูกนับเป็นเสียงพูด';
  } else if (noiseFloorDbFs <= -52 && highConfidenceFrameRatio < 0.35) {
    // Very clean studio / quiet narration
    recommendedConfig = {
      speechThreshold: 0.48,
      minSpeechDurationMs: 240,
      minSilenceDurationMs: 380,
      speechPaddingMs: 200,
      minAdGapMs: 3000,
    };
    acousticProfileLabel = 'เสียงพูดชัดเจน พื้นหลังเงียบมาก (Clean Studio / Quiet Floor)';
    recommendationReason =
      'พื้นหลังเงียบมาก (Noise Floor ต่ำกว่า -52 dBFS) แนะนำใช้ Threshold 0.48 และ Min Silence 380ms เพื่อเก็บหางเสียงพูดที่แผ่วเบาได้ครบถ้วน';
  }

  return {
    rmsDbFs,
    peakDbFs,
    noiseFloorDbFs,
    avgSpeechProbability: Number(avgSpeechProbability.toFixed(3)),
    highConfidenceFrameRatio: Number(highConfidenceFrameRatio.toFixed(3)),
    acousticProfileLabel,
    recommendedConfig,
    recommendationReason,
  };
}

/**
 * Implements Section 05 Detection Rules (Steps 3–9) on sequential 32ms frame probabilities (512 samples @ 16kHz).
 */
export function computeVadOutputFromProbabilities(
  probabilities: Float32Array | number[],
  durationMs: number,
  config: VADConfig,
  frameSamples = 512,
  sampleRate = 16000,
  signalAnalysis?: AudioSignalAnalysis
): VADOutput {
  const frameDurationMs = (frameSamples / sampleRate) * 1000; // 32 ms
  const {
    speechThreshold,
    minSpeechDurationMs,
    minSilenceDurationMs,
    speechPaddingMs,
    minAdGapMs,
  } = config;

  const rawSpeechSegments: SpeechSegment[] = [];
  let triggered = false;
  let currentSpeechStartMs = 0;
  let silenceStartMs: number | null = null;

  for (let i = 0; i < probabilities.length; i++) {
    const prob = probabilities[i];
    const frameStartMs = i * frameDurationMs;
    const frameEndMs = Math.min(durationMs, (i + 1) * frameDurationMs);

    if (prob >= speechThreshold) {
      if (!triggered) {
        triggered = true;
        currentSpeechStartMs = frameStartMs;
      }
      silenceStartMs = null;
    } else if (triggered) {
      if (silenceStartMs === null) {
        silenceStartMs = frameStartMs;
      }
      const silenceDuration = frameEndMs - silenceStartMs;
      if (silenceDuration >= minSilenceDurationMs) {
        const speechDuration = silenceStartMs - currentSpeechStartMs;
        if (speechDuration >= minSpeechDurationMs) {
          rawSpeechSegments.push({
            start_ms: Math.round(currentSpeechStartMs),
            end_ms: Math.round(silenceStartMs),
          });
        }
        triggered = false;
        silenceStartMs = null;
      }
    }
  }

  // Handle speech active at the end of the file
  if (triggered) {
    const finalEndMs = silenceStartMs !== null ? silenceStartMs : durationMs;
    if (finalEndMs - currentSpeechStartMs >= minSpeechDurationMs) {
      rawSpeechSegments.push({
        start_ms: Math.round(currentSpeechStartMs),
        end_ms: Math.round(Math.min(durationMs, finalEndMs)),
      });
    }
  }

  // Step 5: Add Speech Padding
  const paddedSegments: SpeechSegment[] = rawSpeechSegments.map((seg) => ({
    start_ms: Math.max(0, Math.round(seg.start_ms - speechPaddingMs)),
    end_ms: Math.min(durationMs, Math.round(seg.end_ms + speechPaddingMs)),
  }));

  // Step 6: Sort and merge overlapping or adjacent speech segments
  paddedSegments.sort((a, b) => a.start_ms - b.start_ms);
  const mergedSpeechSegments: SpeechSegment[] = [];
  for (const seg of paddedSegments) {
    if (mergedSpeechSegments.length === 0) {
      mergedSpeechSegments.push({ ...seg });
    } else {
      const prev = mergedSpeechSegments[mergedSpeechSegments.length - 1];
      if (seg.start_ms <= prev.end_ms) {
        prev.end_ms = Math.max(prev.end_ms, seg.end_ms);
      } else {
        mergedSpeechSegments.push({ ...seg });
      }
    }
  }

  // Step 7: Calculate Non-Speech Gaps from complement across [0, durationMs]
  const rawGaps: { start_ms: number; end_ms: number }[] = [];

  if (mergedSpeechSegments.length === 0) {
    if (durationMs > 0) {
      rawGaps.push({ start_ms: 0, end_ms: Math.round(durationMs) });
    }
  } else {
    // Gap before first speech segment
    if (mergedSpeechSegments[0].start_ms > 0) {
      rawGaps.push({
        start_ms: 0,
        end_ms: mergedSpeechSegments[0].start_ms,
      });
    }

    // Gaps between consecutive speech segments
    for (let i = 0; i < mergedSpeechSegments.length - 1; i++) {
      const gapStart = mergedSpeechSegments[i].end_ms;
      const gapEnd = mergedSpeechSegments[i + 1].start_ms;
      if (gapEnd > gapStart) {
        rawGaps.push({ start_ms: gapStart, end_ms: gapEnd });
      }
    }

    // Gap after last speech segment until end of video
    const lastSpeechEnd = mergedSpeechSegments[mergedSpeechSegments.length - 1].end_ms;
    if (lastSpeechEnd < durationMs) {
      rawGaps.push({
        start_ms: lastSpeechEnd,
        end_ms: Math.round(durationMs),
      });
    }
  }

  // Step 8 & 9: Filter gaps >= minAdGapMs and create Candidate AD Spots with Unique IDs
  const candidateSpots: CandidateSpot[] = [];
  for (const gap of rawGaps) {
    const gapDuration = gap.end_ms - gap.start_ms;
    if (gapDuration >= minAdGapMs) {
      const spotIndex = candidateSpots.length + 1;
      candidateSpots.push({
        spot_id: `spot_${String(spotIndex).padStart(3, '0')}`,
        start_ms: gap.start_ms,
        end_ms: gap.end_ms,
        duration_ms: gapDuration,
      });
    }
  }

  return {
    duration_ms: Math.round(durationMs),
    speech_segments: mergedSpeechSegments,
    candidate_spots: candidateSpots,
    signal_analysis: signalAnalysis,
  };
}
