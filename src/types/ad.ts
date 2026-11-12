import { z } from 'zod';

export type JobStatus =
  | 'IDLE'
  | 'VIDEO_READY'
  | 'DETECTING'
  | 'VAD_READY'
  | 'ANALYZING'
  | 'READY'
  | 'FAILED';

export interface VADConfig {
  speechThreshold: number;
  minSpeechDurationMs: number;
  minSilenceDurationMs: number;
  speechPaddingMs: number;
  minAdGapMs: number;
}

/**
 * Optimal baseline VAD configuration tuned for Thai Audio Description
 */
export const DEFAULT_VAD_CONFIG: VADConfig = {
  speechThreshold: 0.5,
  minSpeechDurationMs: 250,
  minSilenceDurationMs: 400,
  speechPaddingMs: 200,
  minAdGapMs: 3000,
};

export interface VADPreset {
  id: string;
  name: string;
  description: string;
  config: VADConfig;
}

export const VAD_PRESETS: VADPreset[] = [
  {
    id: 'optimal_standard',
    name: 'มาตรฐานบรรยายภาพไทย (Optimal Default)',
    description: 'สมดุลที่สุดสำหรับวิดีโอทั่วไป ตรวจจับเสียงพูดแม่นยำ เว้นระยะขอบเสียง 200ms และคัดช่องว่าง ≥ 3.0 วินาที',
    config: {
      speechThreshold: 0.5,
      minSpeechDurationMs: 250,
      minSilenceDurationMs: 400,
      speechPaddingMs: 200,
      minAdGapMs: 3000,
    },
  },
  {
    id: 'drama_bgm',
    name: 'ละคร / ภาพยนตร์ที่มีดนตรีคลอ (Drama & BGM)',
    description: 'เพิ่ม Threshold เป็น 0.55 และ Padding 250ms เพื่อลดการเข้าใจผิดว่าเสียงดนตรีประกอบเป็นเสียงพูด',
    config: {
      speechThreshold: 0.55,
      minSpeechDurationMs: 260,
      minSilenceDurationMs: 420,
      speechPaddingMs: 250,
      minAdGapMs: 3000,
    },
  },
  {
    id: 'documentary_clear',
    name: 'สารคดี / เสียงบรรยายชัดเจน (Documentary)',
    description: 'ไวต่อเสียงพูดที่นุ่มหรือเบา (Threshold 0.45) เหมาะกับสารคดีหรือสื่อการสอนที่ห้องอัดเงียบ',
    config: {
      speechThreshold: 0.45,
      minSpeechDurationMs: 220,
      minSilenceDurationMs: 380,
      speechPaddingMs: 200,
      minAdGapMs: 3000,
    },
  },
  {
    id: 'action_sfx',
    name: 'ฉากแอ็กชัน / เสียงเอฟเฟกต์ดัง (Action & SFX)',
    description: 'คัดเฉพาะเสียงพูดที่ชัดเจน (Threshold 0.58) และเว้นช่องว่างขั้นต่ำ 3.2 วินาทีเพื่อหลบเสียงเอฟเฟกต์สั้นๆ',
    config: {
      speechThreshold: 0.58,
      minSpeechDurationMs: 280,
      minSilenceDurationMs: 450,
      speechPaddingMs: 250,
      minAdGapMs: 3200,
    },
  },
];

export type ADContentGenre = 'auto_cinema' | 'drama_series' | 'documentary' | 'action_thriller';

export interface ADAnalysisSettings {
  contentGenre: ADContentGenre;
  narrationPaceCharsPerSec: number; // Default 11.5 base Thai chars/sec
  safetyBufferMs: number;           // Default 250ms breathing margin before/after spot
  avoidCameraJargon: boolean;       // Avoid technical terms like "กล้องแพน/ซูม"
  prioritizeCharacterActions: boolean;
}

export const DEFAULT_AD_ANALYSIS_SETTINGS: ADAnalysisSettings = {
  contentGenre: 'auto_cinema',
  narrationPaceCharsPerSec: 11.5,
  safetyBufferMs: 250,
  avoidCameraJargon: true,
  prioritizeCharacterActions: true,
};

export interface AudioSignalAnalysis {
  rmsDbFs: number;
  peakDbFs: number;
  noiseFloorDbFs: number;
  avgSpeechProbability: number;
  highConfidenceFrameRatio: number;
  acousticProfileLabel: string;
  recommendedConfig: VADConfig;
  recommendationReason: string;
}

export interface SpeechSegment {
  start_ms: number;
  end_ms: number;
}

export interface CandidateSpot {
  spot_id: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
}

export interface VADOutput {
  duration_ms: number;
  speech_segments: SpeechSegment[];
  candidate_spots: CandidateSpot[];
  signal_analysis?: AudioSignalAnalysis;
}

export interface ADSpot {
  spot_id: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  decision: 'generate' | 'skip' | 'pending';
  text: string;
  reason?: string;
  is_edited: boolean;
  // Original non-speech gap boundaries for strict timestamp editing validation
  original_start_ms: number;
  original_end_ms: number;
}

export interface VideoMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
  videoCodec: string;
  audioCodec: string;
  hasAudioTrack: boolean;
  sampleRate?: number;
  channelCount?: number;
}

export interface VideoValidationIssue {
  field: 'format' | 'resolution' | 'codec' | 'duration' | 'size' | 'audio' | 'browser';
  severity: 'error' | 'warning';
  message: string;
}

export interface AnalysisBatch {
  batch_index: number;
  batch_id: string;
  batch_start_ms: number;
  batch_end_ms: number;
  window_start_ms: number; // Including Context Before (20s)
  window_end_ms: number;   // Including Context After (10s)
  candidate_spots: CandidateSpot[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  retry_count: number;
}

export interface ServerConfig {
  geminiModel: string;
  maxVideoDurationSeconds: number;
  maxUploadSizeMb: number;
  vadThreshold: number;
  minAdGapMs: number;
  analysisBatchSeconds: number;
  contextBeforeSeconds: number;
  contextAfterSeconds: number;
}

export interface PersistedJobState {
  job_id: string;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  video_metadata: VideoMetadata;
  vad_config: VADConfig;
  ad_settings?: ADAnalysisSettings;
  vad_output: VADOutput;
  gemini_file_uri?: string;
  gemini_file_name?: string;
  gemini_file_mime_type?: string;
  gemini_file_expires_at?: string;
  local_file_path?: string;
  batches: AnalysisBatch[];
  spots: ADSpot[];
  progress_stage?: string;
  progress_percent?: number;
  active_model?: string;
  error_message?: string;
}

// Zod Schema for Gemini Output Validation (Section 06)
export const GeminiSpotResultSchema = z.object({
  spot_id: z.string().min(1),
  decision: z.enum(['generate', 'skip']),
  text: z.string(),
  reason: z.string().optional(),
});

export const GeminiBatchResponseSchema = z.object({
  spots: z.array(GeminiSpotResultSchema),
});

export type GeminiSpotResult = z.infer<typeof GeminiSpotResultSchema>;
export type GeminiBatchResponse = z.infer<typeof GeminiBatchResponseSchema>;
