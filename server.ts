import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { ApiError, GoogleGenAI, MediaProcessing, MediaResolution, ThinkingLevel, Type } from '@google/genai';
import {
  ADAnalysisSettings,
  ADSpot,
  AnalysisBatch,
  DEFAULT_AD_ANALYSIS_SETTINGS,
  GeminiBatchResponseSchema,
  PersistedJobState,
  ServerConfig,
  VADConfig,
  VADOutput,
  VideoMetadata,
} from './src/types/ad';
import {
  DEFAULT_ANALYSIS_BATCH_SECONDS,
  buildAnalysisBatches,
  formatCompactTime,
  formatTimestampDisplay,
} from './src/utils/formatters';
import { mergeProcessingState } from './src/utils/jobProcessing';
import { validateEditedSpots, validateJobInitialization } from './src/utils/jobValidation';
import { createJobStore, isJobId } from './src/utils/jobStore';

const PORT = Number(process.env.PORT) || 3000;
const store = createJobStore(path.resolve(process.cwd(), '.data', 'jobs'));

const FIXED_SERVER_CONFIG: ServerConfig = {
  geminiModel: 'gemini-4-hydrogen',
  maxVideoDurationSeconds: 1800,
  maxUploadSizeMb: 2000,
  vadThreshold: 0.5,
  minAdGapMs: 3000,
  analysisBatchSeconds: DEFAULT_ANALYSIS_BATCH_SECONDS,
  contextBeforeSeconds: 20,
  contextAfterSeconds: 10,
};

const FALLBACK_GEMINI_MODEL = 'gemini-3.5-flash-lite';
let primaryModelCooldownUntil = 0;
const verifiedActiveFileNames = new Set<string>();

function getServerConfig(): ServerConfig {
  return FIXED_SERVER_CONFIG;
}

/**
 * Prevents returning HTTP 403, 502, 503, or 504 from Express /api routes,
 * because the container Nginx proxy intercepts those status codes and replaces
 * the JSON body with HTML error/warmup pages.
 */
function sanitizeApiStatusCode(code: number): number {
  if (code === 403) return 401;
  if (code === 502 || code === 503 || code === 504) return 500;
  return code;
}

function getGeminiClient(options?: { fastFail?: boolean }): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'ไม่พบ GEMINI_API_KEY บนฝั่งเซิร์ฟเวอร์ กรุณาตั้งค่า API Key ในแผง Settings > Secrets'
    );
  }
  const fastFail = Boolean(options?.fastFail);
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: fastFail ? 75_000 : 180_000,
      retryOptions: fastFail
        ? { attempts: 1 }
        : { attempts: 2, initialDelay: 1, maxDelay: 4 },
    },
  });
}

function saveProcessingState(
  job: PersistedJobState,
  results?: ReadonlyMap<string, { decision: 'generate' | 'skip'; text: string; reason?: string }>,
): void {
  const latest = store.load(job.job_id);
  if (!latest) throw new Error('ไม่สามารถอ่านสถานะงานล่าสุดได้');
  job.spots = mergeProcessingState(job, latest, results).spots;
  store.save(job, false);
}

// Single-job concurrency lock (MVP rule: process 1 Gemini job at a time)
type ProcessingLock = {
  jobId: string;
  finished: Promise<void>;
  release: () => void;
};
let activeProcessingLock: ProcessingLock | null = null;
const activeUploads = new Set<string>();

function createProcessingLock(jobId: string): ProcessingLock {
  let release!: () => void;
  const finished = new Promise<void>((resolve) => { release = resolve; });
  return { jobId, finished, release };
}

function releaseProcessingLock(lock: ProcessingLock): void {
  if (activeProcessingLock === lock) activeProcessingLock = null;
  lock.release();
}

// Multer disk storage for streaming large MP4 uploads (up to 2 GB) directly to temporary disk
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    // Attach generated jobId to request object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).generatedJobId = jobId;
    const jobDir = store.dirOf(jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    cb(null, jobDir);
  },
  filename: (_req, _file, cb) => {
    cb(null, 'source_video.mp4');
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: FIXED_SERVER_CONFIG.maxUploadSizeMb * 1024 * 1024,
  },
});

class GeminiFileDeletionError extends Error {}

async function deleteJobGeminiFile(ai: GoogleGenAI, job: PersistedJobState): Promise<boolean> {
  const name = job.gemini_file_name;
  if (!name) return false;

  verifiedActiveFileNames.delete(name);
  if (!/^files\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(name)) {
    console.warn('Invalid Gemini file name for job', job.job_id);
    return false;
  }

  try {
    await ai.files.delete({
      name,
      config: { httpOptions: { timeout: 5_000, retryOptions: { attempts: 1 } } },
    });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      console.warn('Failed to delete Gemini file for job', job.job_id);
      return false;
    }
  }

  job.gemini_file_name = undefined;
  job.gemini_file_uri = undefined;
  job.gemini_file_mime_type = undefined;
  job.gemini_file_expires_at = undefined;
  return true;
}

/**
 * Ensures the job has a valid, non-expired Gemini File URI.
 * If the URI has expired and the local source MP4 still exists, re-uploads it automatically (Section 06 Rule 7).
 */
async function ensureActiveGeminiFileUri(
  uploadAi: GoogleGenAI,
  job: PersistedJobState,
  onProgressStage?: (stage: string) => void
): Promise<{ uri: string; mimeType: string }> {
  const existingName = job.gemini_file_name;
  if (existingName) {
    const expiresMs = job.gemini_file_expires_at
      ? Date.parse(job.gemini_file_expires_at)
      : 0;
    const hasPlentyOfTtl = expiresMs > Date.now() + 15 * 60 * 1000;

    if (job.gemini_file_uri && hasPlentyOfTtl && verifiedActiveFileNames.has(existingName)) {
      return {
        uri: job.gemini_file_uri,
        mimeType: job.gemini_file_mime_type || 'video/mp4',
      };
    }

    try {
      const remoteFile = await uploadAi.files.get({ name: existingName });
      if (remoteFile && remoteFile.state === 'ACTIVE' && remoteFile.uri) {
        verifiedActiveFileNames.add(existingName);
        return {
          uri: remoteFile.uri,
          mimeType: remoteFile.mimeType || 'video/mp4',
        };
      }
    } catch {
      verifiedActiveFileNames.delete(existingName);
    }
  }

  if (!job.local_file_path || !fs.existsSync(job.local_file_path)) {
    throw new Error('File URI บน Gemini หมดอายุแล้ว และไม่พบไฟล์วิดีโอสำรองบนเซิร์ฟเวอร์ กรุณาอัปโหลดวิดีโอใหม่อีกครั้ง');
  }

  if (existingName) {
    if (!(await deleteJobGeminiFile(uploadAi, job))) {
      throw new GeminiFileDeletionError('ยังลบไฟล์วิดีโอเดิมบน Gemini ไม่สำเร็จ กรุณารอสักครู่แล้วกดทำต่อจากชุดที่ค้าง');
    }
    saveProcessingState(job);
  }

  onProgressStage?.('กำลังส่งไฟล์วิดีโอไปยัง Gemini Files API...');
  const uploaded = await uploadAi.files.upload({
    file: job.local_file_path,
    config: {
      mimeType: 'video/mp4',
      displayName: job.video_metadata.fileName || 'source_video.mp4',
    },
  });

  const name = uploaded.name;
  if (name) {
    job.gemini_file_name = name;
    job.gemini_file_uri = uploaded.uri;
    job.gemini_file_mime_type = uploaded.mimeType || 'video/mp4';
    job.gemini_file_expires_at = uploaded.expirationTime;
    saveProcessingState(job);
  }
  if (!name || !uploaded.uri) {
    throw new Error('การอัปโหลดไฟล์ไปยัง Gemini Files API ไม่สำเร็จ (ไม่ได้รับ File URI)');
  }

  let currentFile = uploaded;
  const maxPollAttempts = 90;
  for (let attempt = 1; currentFile.state === 'PROCESSING' && attempt <= maxPollAttempts; attempt++) {
    onProgressStage?.(`รอ Gemini Files API ประมวลผลไฟล์วิดีโอ (${attempt * 2} วินาที)...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    currentFile = await uploadAi.files.get({ name });
  }

  if (currentFile.state === 'FAILED') {
    throw new Error('Gemini Files API ไม่สามารถประมวลผลไฟล์วิดีโอนี้ได้ (State: FAILED)');
  }
  if (currentFile.state !== 'ACTIVE') {
    throw new Error(`ไฟล์วิดีโอบน Gemini Files API ยังไม่พร้อมใช้งาน (State: ${currentFile.state})`);
  }

  const uri = currentFile.uri || uploaded.uri;
  const mimeType = currentFile.mimeType || 'video/mp4';
  verifiedActiveFileNames.add(name);
  job.gemini_file_uri = uri;
  job.gemini_file_mime_type = mimeType;
  job.gemini_file_expires_at = currentFile.expirationTime;
  saveProcessingState(job);

  return { uri, mimeType };
}

/**
 * Helper to classify Gemini API errors and determine whether backoff/failover applies.
 */
function parseGeminiError(err: unknown): {
  isRateLimit: boolean;
  isHighDemand503: boolean;
  isTransient: boolean;
  statusCode: number;
  userMessage: string;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  const isRateLimit =
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit');

  const isHighDemand503 =
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded');

  const isAuthError =
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid');

  const isTransient =
    isRateLimit ||
    isHighDemand503 ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.includes('internal') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('timeout') ||
    lower.includes('aborted') ||
    lower.includes('fetch failed');

  if (isRateLimit) {
    return {
      isRateLimit: true,
      isHighDemand503: false,
      isTransient: true,
      statusCode: 429,
      userMessage:
        'เกินโควตาการเรียกใช้งาน Gemini API (HTTP 429 / Quota Exhausted) กรุณารอสักครู่แล้วกดทำต่อ หรือตรวจสอบโควตา API Key ใน Settings > Secrets',
    };
  }

  if (isHighDemand503) {
    return {
      isRateLimit: false,
      isHighDemand503: true,
      isTransient: true,
      statusCode: 500,
      userMessage:
        'เซิร์ฟเวอร์โมเดล Gemini มีปริมาณการใช้งานหนาแน่นชั่วคราว (503 High Demand) กรุณากดดำเนินการสร้างต่อในอีกสักครู่',
    };
  }

  if (isAuthError) {
    return {
      isRateLimit: false,
      isHighDemand503: false,
      isTransient: false,
      statusCode: 401,
      userMessage:
        'ไม่สามารถยืนยันตัวตนกับ Gemini API ได้ (Invalid API Key / Permission Denied) กรุณาตรวจสอบ GEMINI_API_KEY ในแผง Settings > Secrets',
    };
  }

  return {
    isRateLimit: false,
    isHighDemand503: false,
    isTransient,
    statusCode: 500,
    userMessage: `เกิดข้อผิดพลาดจาก Gemini API: ${rawMessage}`,
  };
}

/**
 * Runs Gemini Static Video Analysis for a single AnalysisBatch with exponential backoff retry.
 */
async function analyzeBatchWithGemini(
  fastAi: GoogleGenAI,
  uploadAi: GoogleGenAI,
  job: PersistedJobState,
  batch: AnalysisBatch,
  config: ServerConfig,
  onProgressStage?: (stage: string, activeModel?: string) => void
): Promise<Map<string, { decision: 'generate' | 'skip'; text: string; reason?: string }>> {
  const { uri: fileUri, mimeType } = await ensureActiveGeminiFileUri(
    uploadAi,
    job,
    (stage) => onProgressStage?.(stage)
  );

  const startOffsetSeconds = Math.max(0, Math.floor(batch.window_start_ms / 1000));
  const endOffsetSeconds = Math.max(
    startOffsetSeconds + 1,
    Math.ceil(batch.window_end_ms / 1000)
  );

  const adSettings: ADAnalysisSettings = job.ad_settings || DEFAULT_AD_ANALYSIS_SETTINGS;
  const paceCharsPerSec = adSettings.narrationPaceCharsPerSec || 11.5;
  const safetyBufferMs = adSettings.safetyBufferMs ?? 250;

  const clipBaseMs = startOffsetSeconds * 1000;
  const clipEndBoundaryMs = endOffsetSeconds * 1000;

  const speechOnsetMarginMs = 350;
  const candidateListDescription = batch.candidate_spots
    .map((spot) => {
      const durationSec = (spot.duration_ms / 1000).toFixed(1);
      // Subtract head & tail safety buffer (default 250ms * 2 = 500ms) and breath/onset margin (350ms)
      // plus an 85% pacing headroom so natural LLM length overshoot still fits inside the gap
      const usableDurationMs = Math.max(500, spot.duration_ms - safetyBufferMs * 2);
      const usableDurationSec = usableDurationMs / 1000;
      const speakableDurationSec = Math.max(0.5, (usableDurationMs - speechOnsetMarginMs) / 1000);
      const maxRecommendedChars = Math.max(
        8,
        Math.floor(speakableDurationSec * paceCharsPerSec * 0.85)
      );
      const maxRecommendedWords = Math.max(3, Math.round(maxRecommendedChars / 4.5));
      const clipStartMs = Math.max(0, spot.start_ms - clipBaseMs);
      const clipEndMs = Math.max(clipStartMs, spot.end_ms - clipBaseMs);
      return `- spot_id: "${spot.spot_id}" | เวลาในคลิปนี้: ${formatCompactTime(clipStartMs)}–${formatCompactTime(clipEndMs)} (เวลาเต็ม: ${formatTimestampDisplay(spot.start_ms)}–${formatTimestampDisplay(spot.end_ms)} · ความยาวเต็ม ${durationSec}s · เวลาพูดจริง ${usableDurationSec.toFixed(1)}s · ห้ามเกิน ~${maxRecommendedChars} ตัวอักษร / ~${maxRecommendedWords} คำ)`;
    })
    .join('\n');

  // Include recent generated AD lines from earlier batches for character/scene continuity
  const previousGeneratedSpots = (job.spots || [])
    .filter(
      (s) =>
        s.decision === 'generate' &&
        s.text.trim().length > 0 &&
        s.start_ms < batch.batch_start_ms
    )
    .sort((a, b) => a.start_ms - b.start_ms)
    .slice(-5);

  const continuityContextSection =
    previousGeneratedSpots.length > 0
      ? `\n- บทบรรยายช่วงล่าสุดก่อนหน้า Batch นี้ (ใช้รักษาความต่อเนื่องของชื่อตัวละคร สถานที่ และไม่บรรยายซ้ำ):\n${previousGeneratedSpots
          .map((s) => `  • [${formatTimestampDisplay(s.start_ms)}] ${s.text.trim()}`)
          .join('\n')}`
      : '';

  const genreGuidanceMap: Record<ADAnalysisSettings['contentGenre'], string> = {
    auto_cinema:
      'วิเคราะห์ประเภทเนื้อหาอัตโนมัติจากภาพและเสียง โดยเน้นการกระทำของตัวละคร การเปลี่ยนฉาก วัตถุสำคัญ และข้อความบนหน้าจอ',
    drama_series:
      'เนื้อหาประเภทละคร/ภาพยนตร์: เน้นกิริยาท่าทาง สีหน้าที่เห็นได้ชัด การเคลื่อนไหวของตัวละคร และความสัมพันธ์เชิงพื้นที่โดยไม่สปอยล์หรือคาดเดาความรู้สึกภายใน',
    documentary:
      'เนื้อหาประเภทสารคดี/รายการ: เน้นสถานที่ วัตถุ ข้อมูลกราฟิก/ตัวอักษรบนหน้าจอ และกิจกรรมที่กำลังเกิดขึ้นอย่างตรงไปตรงมา',
    action_thriller:
      'เนื้อหาประเภทแอ็กชัน/ระทึกขวัญ: ใช้ประโยคสั้น กระชับ ฉับไว เน้นการเคลื่อนไหวหลักและทิศทางโดยไม่ทับเสียงเอฟเฟกต์สำคัญ',
  };

  const styleRulesExtra = [
    adSettings.avoidCameraJargon
      ? '- ห้ามใช้ศัพท์เทคนิคมุมกล้องหรือขนาดภาพ เช่น "กล้องแพน", "กล้องซูม", "ภาพตัดไปที่", "ระยะใกล้" ให้บรรยายสิ่งที่เกิดขึ้นตรง ๆ (เช่น "ในห้องครัว...", "มือของชายหนุ่มกำกุญแจแน่น")'
      : '',
    adSettings.prioritizeCharacterActions
      ? '- ใช้โครงสร้างประโยคกรรตุวาจก (ประธาน + กริยา + กรรม) ที่กระชับและเข้าใจง่ายในครั้งเดียวที่ฟัง'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const systemInstruction = `คุณคือผู้เชี่ยวชาญด้านการเขียนบทบรรยายภาพ (Audio Description - AD) ภาษาไทยสำหรับผู้พิการทางการมองเห็นตามมาตรฐานวิชาชีพ
หน้าที่ของคุณคือวิเคราะห์ภาพและเสียงของวิดีโอในช่วงเวลาที่กำหนด และตัดสินใจสำหรับ Candidate Spot แต่ละรายการว่าจะสร้างบทบรรยายภาพ ("generate") หรือข้าม ("skip")

แนวทางเฉพาะสำหรับงานนี้ (Pre-configured Optimal Profile):
- โหมดการวิเคราะห์เนื้อหา: ${genreGuidanceMap[adSettings.contentGenre]}
- ความเร็วการพูดมาตรฐาน: ${paceCharsPerSec} ตัวอักษร/วินาที (เว้นระยะปลอดภัยก่อน-หลังเสียงพูด ${safetyBufferMs} ms)
${styleRulesExtra}

กฎการวิเคราะห์ (AI Analysis Rules):
1. อ้างอิงตำแหน่งเหตุการณ์จาก "เวลาในคลิปนี้" เป็นหลัก โดยเข้าใจเหตุการณ์จากทั้งภาพและเสียง ก่อน ระหว่าง และหลัง Candidate Spot
2. บรรยายเฉพาะเหตุการณ์สำคัญทางภาพ (เช่น การกระทำของตัวละคร การเปลี่ยนฉาก สีหน้าท่าทางที่ชัดเจน วัตถุสำคัญ หรือข้อความบนหน้าจอ) ที่ผู้ฟังไม่สามารถรับรู้ได้จากเสียงเพียงอย่างเดียว
3. หลีกเลี่ยงการบรรยายซ้ำกับบทพูดหรือเสียงที่อธิบายเหตุการณ์อยู่แล้ว และห้ามทับเสียงดนตรีสำคัญหรือเสียงเอฟเฟกต์ที่ต้องฟังเพื่อเข้าใจเนื้อเรื่อง
4. ใช้ภาษาพูดภาษาไทยที่เป็นธรรมชาติสำหรับอ่านออกเสียง เล่าแบบกาลปัจจุบัน (เหตุการณ์ที่กำลังเกิดขึ้น) กระชับ ไม่ใช้คำขึ้นต้นฟุ่มเฟือย เช่น "ภาพแสดงให้เห็น...", "ปรากฏภาพ...", "ในฉากนี้...", "เราจะเห็น..."
5. ห้ามเดาความรู้สึกภายใน เจตนา หรือข้อมูลที่ไม่ปรากฏให้เห็นชัดเจน ห้ามสปอยล์เหตุการณ์ล่วงหน้า และหากข้อความบนหน้าจอเบลอหรือไม่ชัดจนอ่านได้ไม่ครบ ห้ามเดาคำ ให้ข้ามหรือบรรยายเฉพาะสิ่งที่เห็นชัดเจน
6. รักษาความสม่ำเสมอในการเรียกตัวละคร ใช้ชื่อตัวละครเฉพาะเมื่อได้ยินในบทพูดหรือเห็นบนหน้าจอชัดเจนแล้วเท่านั้น ก่อนหน้านั้นให้ใช้ลักษณะเด่นที่คงที่ (เช่น "ชายเสื้อเชิ้ตฟ้า") ไม่เปลี่ยนคำเรียกไปมา
7. คุมความยาวให้พูดจบก่อนหมดช่วงว่างเสมอ ห้ามเขียนเกินโควตาตัวอักษร/คำที่กำหนดในแต่ละ Spot หากช่วงว่างสั้นให้เลือกบรรยายเฉพาะใจความสำคัญที่สุด 1 อย่าง (สั้นกระชับดีกว่าพูดล้นไปทับบทพูดถัดไป)
8. ตอบ decision เป็น "skip" พร้อมระบุ reason ภาษาไทยสั้นๆ และให้ text เป็น "" หากไม่มีเหตุการณ์สำคัญที่ต้องบรรยาย ภาพนิ่ง/ต่อเนื่องไม่เปลี่ยนสาระสำคัญ หรือเสียงอธิบายชัดเจนอยู่แล้ว
9. ห้ามสร้าง spot_id ใหม่เด็ดขาด และต้องส่งผลลัพธ์ครบทุก spot_id ที่กำหนดใน Batch นี้เท่านั้น

ตัวอย่างการตัดสินใจและสไตล์การเขียน (Few-shot Examples):
- ช่วงสั้น (เต็ม 3.0s · ห้ามเกิน ~21 ตัวอักษร / ~5 คำ):
  decision: "generate", text: "ชายเสื้อฟ้าเปิดประตูเข้าห้อง"
- ช่วงยาว (เต็ม 7.5s · ห้ามเกิน ~64 ตัวอักษร / ~14 คำ):
  decision: "generate", text: "หญิงสาววางแก้วน้ำลงบนโต๊ะ เธอหยิบซองจดหมายขึ้นมาพลิกดูแล้วชะงัก"
- ช่วงที่ไม่ควรบรรยาย (ภาพแช่/เสียงอธิบายแล้ว):
  decision: "skip", text: "", reason: "ภาพแช่ที่ตัวละครเดิม ไม่มีเหตุการณ์สำคัญใหม่"`;

  const promptText = `ข้อมูลการวิเคราะห์ Batch ที่ ${batch.batch_index}:
- คลิปวิดีโอที่แนบมาตัดจากช่วงเวลาเต็ม ${formatTimestampDisplay(clipBaseMs)} ถึง ${formatTimestampDisplay(clipEndBoundaryMs)} (เวลา 00:00 ของคลิปนี้ = เวลาเต็ม ${formatTimestampDisplay(clipBaseMs)})
- ช่วงเวลาหลักของ Batch: ${formatTimestampDisplay(batch.batch_start_ms)} ถึง ${formatTimestampDisplay(batch.batch_end_ms)}${continuityContextSection}

รายการ Candidate AD Spots ที่ต้องตัดสินใจและเขียนบทบรรยายภาพ (ต้องส่งคืนครบทั้ง ${batch.candidate_spots.length} รายการ):
${candidateListDescription}

ส่งผลลัพธ์เป็น JSON ตาม Schema ที่กำหนด โดยใส่เฉพาะ spot_id ที่ระบุไว้ข้างต้นครบทุกรายการ`;

  const maxAttempts = 3;
  let lastError: unknown = null;
  let forceFallbackModel = Date.now() < primaryModelCooldownUntil;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const modelToUse = forceFallbackModel ? FALLBACK_GEMINI_MODEL : config.geminiModel;

    try {
      batch.retry_count = attempt - 1;
      onProgressStage?.(
        `กำลังวิเคราะห์ภาพและเสียง ชุดที่ ${batch.batch_index}/${job.batches.length} (${formatTimestampDisplay(batch.batch_start_ms)}–${formatTimestampDisplay(batch.batch_end_ms)})...`,
        modelToUse
      );

      const response = await fastAi.models.generateContent({
        model: modelToUse,
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  fileUri,
                  mimeType,
                },
                mediaProcessing: MediaProcessing.STATIC,
                videoMetadata: {
                  startOffset: `${startOffsetSeconds}s`,
                  endOffset: `${endOffsetSeconds}s`,
                  fps: 1,
                },
              },
              {
                text: promptText,
              },
            ],
          },
        ],
        config: {
          httpOptions: {
            timeout: modelToUse === FALLBACK_GEMINI_MODEL ? 60_000 : 25_000,
            retryOptions: { attempts: 1 },
          },
          systemInstruction,
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
          ...(modelToUse === config.geminiModel
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              spots: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    spot_id: {
                      type: Type.STRING,
                      description: 'The exact spot_id from the candidate list.',
                    },
                    decision: {
                      type: Type.STRING,
                      enum: ['generate', 'skip'],
                      description: 'Either "generate" or "skip".',
                    },
                    text: {
                      type: Type.STRING,
                      description: 'Concise Thai Audio Description script if decision is "generate", or empty string "" if "skip".',
                    },
                    reason: {
                      type: Type.STRING,
                      description: 'Short reason in Thai if decision is "skip". Omit when decision is "generate".',
                    },
                  },
                  required: ['spot_id', 'decision', 'text'],
                },
              },
            },
            required: ['spots'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('Gemini ส่งผลลัพธ์ว่างเปล่า (Empty response)');
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        throw new Error('ผลลัพธ์จาก Gemini ไม่ใช่รูปแบบ JSON ที่ถูกต้อง');
      }

      const validated = GeminiBatchResponseSchema.safeParse(parsedJson);
      if (!validated.success) {
        throw new Error(`โครงสร้าง JSON ไม่ตรงตาม Schema: ${validated.error.message}`);
      }

      // Server Validation Rules (Section 06):
      // - Reject Spot IDs not in this Batch
      // - Ensure all Candidate Spot IDs in this Batch are present
      const expectedSpotIds = new Set(batch.candidate_spots.map((s) => s.spot_id));
      const resultMap = new Map<
        string,
        { decision: 'generate' | 'skip'; text: string; reason?: string }
      >();

      for (const item of validated.data.spots) {
        if (!expectedSpotIds.has(item.spot_id)) {
          continue;
        }
        const cleanedText = item.text.trim();
        if (item.decision === 'generate' && cleanedText.length === 0) {
          throw new Error(`Spot ${item.spot_id} มีสถานะ generate แต่ไม่มีข้อความบรรยาย`);
        }
        resultMap.set(item.spot_id, {
          decision: item.decision,
          text: cleanedText,
          reason: item.decision === 'skip' ? item.reason || 'ไม่มีเหตุการณ์สำคัญที่ต้องบรรยาย' : item.reason,
        });
      }

      // Verify completeness: every candidate spot in the batch must be answered
      const missingIds = batch.candidate_spots
        .map((s) => s.spot_id)
        .filter((id) => !resultMap.has(id));

      if (missingIds.length > 0) {
        throw new Error(
          `Gemini ตอบกลับไม่ครบทุก Spot ใน Batch (ขาด: ${missingIds.join(', ')})`
        );
      }

      return resultMap;
    } catch (err) {
      lastError = err;
      const classification = parseGeminiError(err);

      // If primary model is overloaded (503) or timed out, immediately switch to fast fallback model
      if (!forceFallbackModel && (classification.isHighDemand503 || classification.isTransient)) {
        primaryModelCooldownUntil = Date.now() + 10 * 60 * 1000;
        forceFallbackModel = true;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
      }

      if (attempt < maxAttempts) {
        const baseDelayMs = classification.isRateLimit ? 3500 : 1500;
        const backoffMs = baseDelayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
    }
  }

  throw lastError;
}

/**
 * Executes Gemini Files upload + sequential batch analysis asynchronously in the background
 * so HTTP requests return immediately (<50ms) and never trigger proxy/gateway timeouts.
 */
async function runJobInBackground(jobId: string): Promise<void> {
  if (activeProcessingLock) return;

  const job = store.load(jobId);
  if (!job) return;

  const allBatchesCompleted = job.batches.every((batch) => batch.status === 'completed');
  const lock = createProcessingLock(jobId);
  activeProcessingLock = lock;

  let uploadAi: GoogleGenAI | undefined;
  let deletionFailed = false;
  try {
    if (allBatchesCompleted) return;

    uploadAi = getGeminiClient({ fastFail: false });
    const fastAi = getGeminiClient({ fastFail: true });
    const serverConfig = getServerConfig();

    job.status = 'ANALYZING';
    job.error_message = undefined;
    job.batches = job.batches.map((b) =>
      b.status === 'failed' || b.status === 'processing'
        ? { ...b, status: 'pending', error: undefined }
        : b
    );
    saveProcessingState(job);

    // Step 1: Ensure video is uploaded & ACTIVE on Gemini Files API
    await ensureActiveGeminiFileUri(uploadAi, job, (stage) => {
      job.progress_stage = stage;
      job.progress_percent = 12;
      saveProcessingState(job);
    });

    // Step 2: Process incomplete batches sequentially
    const totalBatches = job.batches.length;
    for (let i = 0; i < totalBatches; i++) {
      const batch = job.batches[i];
      if (batch.status === 'completed') {
        continue;
      }

      // Check if job was deleted/reset while running
      const latestPointerExists = store.load(jobId);
      if (!latestPointerExists) {
        return;
      }
      // Preserve any manual spot edits made while batches were running
      job.spots = latestPointerExists.spots;

      batch.status = 'processing';
      batch.error = undefined;
      const completedSoFar = job.batches.filter((b) => b.status === 'completed').length;
      job.progress_percent = Math.min(
        96,
        Math.round(15 + (completedSoFar / totalBatches) * 80)
      );
      job.progress_stage = `กำลังวิเคราะห์ภาพและเสียง ชุดที่ ${batch.batch_index}/${totalBatches}...`;
      saveProcessingState(job);

      const spotResults = await analyzeBatchWithGemini(
        fastAi,
        uploadAi,
        job,
        batch,
        serverConfig,
        (stage, activeModel) => {
          job.progress_stage = stage;
          job.active_model = activeModel;
          saveProcessingState(job);
        }
      );

      batch.status = 'completed';
      batch.error = undefined;

      const doneCount = job.batches.filter((b) => b.status === 'completed').length;
      job.progress_percent = Math.min(99, Math.round(15 + (doneCount / totalBatches) * 84));
      saveProcessingState(job, spotResults);
    }

    job.status = 'READY';
    job.progress_stage = undefined;
    job.progress_percent = 100;
    job.error_message = undefined;
  } catch (err) {
    deletionFailed = err instanceof GeminiFileDeletionError;
    const parsed = parseGeminiError(err);
    const stuckBatch = job.batches.find((b) => b.status === 'processing');
    if (stuckBatch) {
      stuckBatch.status = 'failed';
      stuckBatch.error = parsed.userMessage;
    }
    job.status = 'FAILED';
    job.progress_stage = undefined;
    job.error_message = parsed.userMessage;
  } finally {
    try {
      if (!deletionFailed && (uploadAi || (allBatchesCompleted && job.gemini_file_name))) {
        await deleteJobGeminiFile(uploadAi ?? getGeminiClient({ fastFail: false }), job);
      }
      if (job.status === 'READY' || job.status === 'FAILED') saveProcessingState(job);
    } catch {
      console.error('Failed to finalize job processing');
    } finally {
      releaseProcessingLock(lock);
    }
  }
}

function recoverOrphanedJobOnStartup(): void {
  const activeJob = store.loadActive();
  if (!activeJob) return;
  let modified = false;
  for (const b of activeJob.batches) {
    if (b.status === 'processing') {
      b.status = 'pending';
      b.error = undefined;
      modified = true;
    }
  }
  if (activeJob.status === 'ANALYZING') {
    activeJob.status = 'VAD_READY';
    activeJob.progress_stage = undefined;
    modified = true;
  }
  if (modified) {
    store.save(activeJob);
  }
}

async function startServer() {
  recoverOrphanedJobOnStartup();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Ensure /api responses are never cached by proxies or browsers
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  // 1. GET /api/config — Return server default configuration (no secrets)
  app.get('/api/config', (_req: Request, res: Response) => {
    const config = getServerConfig();
    res.json({
      config,
      hasActiveJob: Boolean(store.loadActive()),
    });
  });

  // 2. GET /api/jobs/current — Restore active/recent job on browser refresh or reconnect
  app.get('/api/jobs/current', (_req: Request, res: Response) => {
    const job = store.loadActive();
    if (!job) {
      res.json({ job: null, isRunning: false });
      return;
    }
    const isRunning = Boolean(
      activeProcessingLock && activeProcessingLock.jobId === job.job_id
    );
    res.json({ job, isRunning });
  });

  app.get('/api/jobs', (_req: Request, res: Response) => {
    try {
      const activeId = store.activeJobId();
      const jobs = store.list().map((job) => ({
        ...job,
        is_active: job.job_id === activeId,
        is_processing: job.is_upload ? activeUploads.has(job.job_id) : job.job_id === activeProcessingLock?.jobId,
      }));
      res.json({ jobs });
    } catch {
      res.status(500).json({ error: 'ไม่สามารถอ่านรายการงานได้' });
    }
  });

  app.delete('/api/jobs/:jobId/files', (req: Request, res: Response) => {
    try {
      const activeId = store.activeJobId();
      const dir = store.filesDir(req.params.jobId);
      if (!dir) { res.status(404).json({ error: 'ไม่พบงาน' }); return; }
      if (req.params.jobId === activeId || req.params.jobId === activeProcessingLock?.jobId || activeUploads.has(req.params.jobId)) {
        res.status(409).json({ error: 'ไม่สามารถลบงานปัจจุบันหรืองานที่กำลังประมวลผล' }); return;
      }
      fs.rmSync(dir, { recursive: true });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'ไม่สามารถลบไฟล์งานได้' });
    }
  });

  // 3. GET /api/jobs/:jobId — Fetch specific job state (used by fast client polling)
  app.get('/api/jobs/:jobId', (req: Request, res: Response) => {
    const job = store.load(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบข้อมูลงานประมวลผลนี้บนเซิร์ฟเวอร์' });
      return;
    }
    const isRunning = Boolean(
      activeProcessingLock && activeProcessingLock.jobId === job.job_id
    );
    res.json({ job, isRunning });
  });

  // 4. GET /api/jobs/:jobId/video — Stream local MP4 file with Range support for video player recovery after refresh
  app.get('/api/jobs/:jobId/video', (req: Request, res: Response) => {
    const job = store.load(req.params.jobId);
    if (!job || !job.local_file_path || !fs.existsSync(job.local_file_path)) {
      res.status(404).json({ error: 'ไม่พบไฟล์วิดีโอสำรองสำหรับงานนี้' });
      return;
    }

    const filePath = job.local_file_path;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // 5a. POST /api/upload/init — Initialize chunked upload session for large video files
  app.post('/api/upload/init', (req: Request, res: Response) => {
    try {
      const { fileName, fileSize } = (req.body || {}) as { fileName?: string; fileSize?: number };
      if ((fileName !== undefined && typeof fileName !== 'string') || !Number.isSafeInteger(fileSize) || !fileSize || fileSize < 1 || fileSize > FIXED_SERVER_CONFIG.maxUploadSizeMb * 1024 * 1024) {
        res.status(400).json({ error: 'ชื่อหรือขนาดไฟล์ไม่ถูกต้อง' });
        return;
      }
      const safeFileName = (fileName || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const jobDir = store.dirOf(uploadId);
      fs.mkdirSync(jobDir, { recursive: true });

      const targetFilePath = path.join(jobDir, 'source_video.mp4');
      fs.writeFileSync(targetFilePath, Buffer.alloc(0));
      activeUploads.add(uploadId);

      res.json({
        uploadId,
        fileName: safeFileName,
        fileSize: fileSize || 0,
      });
    } catch {
      res.status(500).json({ error: 'ไม่สามารถเริ่มต้นอัปโหลดได้' });
    }
  });

  app.post('/api/upload/:uploadId/abandon', (req: Request, res: Response) => {
    if (!isJobId(req.params.uploadId)) {
      res.status(400).json({ error: 'uploadId ไม่ถูกต้อง' });
      return;
    }
    activeUploads.delete(req.params.uploadId);
    res.json({ ok: true });
  });

  // 5b. POST /api/upload/chunk — Write a chunk at its confirmed byte offset
  app.post(
    '/api/upload/chunk',
    express.raw({ type: 'application/octet-stream', limit: '25mb' }),
    (req: Request, res: Response) => {
      try {
        const uploadId = String(req.query.uploadId || req.headers['x-upload-id'] || '');
        if (!isJobId(uploadId)) {
          res.status(400).json({ error: 'ไม่พบ uploadId' });
          return;
        }

        const offsetParam = req.query.offset;
        if (typeof offsetParam !== 'string' || !/^(0|[1-9]\d*)$/.test(offsetParam) || !Number.isSafeInteger(Number(offsetParam))) {
          res.status(400).json({ error: 'ตำแหน่งอัปโหลดไม่ถูกต้อง' });
          return;
        }
        const offset = Number(offsetParam);

        const jobDir = store.dirOf(uploadId);
        const targetFilePath = path.join(jobDir, 'source_video.mp4');
        if (!fs.existsSync(jobDir)) {
          res.status(404).json({ error: 'ไม่พบโฟลเดอร์สำหรับ uploadId นี้' });
          return;
        }
        if (!fs.lstatSync(jobDir).isDirectory() || fs.existsSync(path.join(jobDir, 'job.json'))) {
          res.status(409).json({ error: 'ไม่สามารถอัปโหลดลงในงานนี้ได้' });
          return;
        }

        const chunkBuffer = req.body;
        if (!Buffer.isBuffer(chunkBuffer) || chunkBuffer.length === 0) {
          res.status(400).json({ error: 'ข้อมูล Chunk ว่างเปล่า' });
          return;
        }

        if (!fs.existsSync(targetFilePath)) {
          res.status(404).json({ error: 'ไม่พบไฟล์อัปโหลด' });
          return;
        }
        if (offset + chunkBuffer.length > FIXED_SERVER_CONFIG.maxUploadSizeMb * 1024 * 1024) {
          res.status(413).json({ error: 'ไฟล์มีขนาดเกินกำหนด' });
          return;
        }
        const fd = fs.openSync(targetFilePath, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
        let currentSize: number;
        try {
          currentSize = fs.fstatSync(fd).size;
          if (offset > currentSize) {
            res.status(409).json({ error: 'ตำแหน่งอัปโหลดไม่ตรงกับไฟล์' });
            return;
          }
          const overlap = Math.min(currentSize - offset, chunkBuffer.length);
          if (overlap > 0) {
            const existing = Buffer.alloc(overlap);
            const bytesRead = fs.readSync(fd, existing, 0, overlap, offset);
            if (bytesRead !== overlap || !existing.equals(chunkBuffer.subarray(0, overlap))) {
              res.status(409).json({ error: 'ข้อมูล Chunk ไม่ตรงกับไฟล์ที่อัปโหลดแล้ว' });
              return;
            }
          }
          let written = overlap;
          while (written < chunkBuffer.length) {
            const count = fs.writeSync(fd, chunkBuffer, written, chunkBuffer.length - written, offset + written);
            if (count === 0) throw new Error('Chunk write made no progress');
            written += count;
          }
          currentSize = fs.fstatSync(fd).size;
        } finally {
          fs.closeSync(fd);
        }
        res.json({ ok: true, currentSize });
      } catch {
        res.status(500).json({ error: 'ไม่สามารถเขียนไฟล์ Chunk ได้' });
      }
    }
  );

  // 5c. POST /api/jobs/init — Handles both chunked uploads (JSON with uploadId) and direct multipart uploads
  app.post('/api/jobs/init', (req: Request, res: Response, next) => {
    if (req.is('multipart/form-data')) {
      upload.single('video')(req, res, next);
    } else {
      next();
    }
  }, async (req: Request, res: Response) => {
    if (
      activeProcessingLock
    ) {
      res.status(409).json({
        error: `ขณะนี้ระบบกำลังประมวลผลอีกงานหนึ่งอยู่ (${activeProcessingLock.jobId}) กรุณารอให้งานปัจจุบันเสร็จสิ้นก่อน`,
      });
      return;
    }

    try {
      let localFilePath: string;
      let jobId: string;
      let videoMetadata: VideoMetadata;
      let vadConfig: VADConfig;
      let adSettings: ADAnalysisSettings;
      let vadOutput: VADOutput;

      if (req.body && req.body.uploadId) {
        jobId = req.body.uploadId;
        if (!isJobId(jobId)) {
          res.status(400).json({ error: 'uploadId ไม่ถูกต้อง' });
          return;
        }
        const jobDir = store.dirOf(jobId);
        localFilePath = path.join(jobDir, 'source_video.mp4');
        if (!fs.existsSync(localFilePath) || !fs.lstatSync(jobDir).isDirectory() || !fs.lstatSync(localFilePath).isFile() || fs.statSync(localFilePath).size === 0 || fs.existsSync(path.join(jobDir, 'job.json'))) {
          res.status(400).json({ error: 'ไม่พบไฟล์วิดีโอที่อัปโหลด หรือไฟล์มีขนาดเป็น 0' });
          return;
        }
        videoMetadata = typeof req.body.video_metadata === 'string'
          ? JSON.parse(req.body.video_metadata)
          : req.body.video_metadata;
        vadConfig = typeof req.body.vad_config === 'string'
          ? JSON.parse(req.body.vad_config)
          : req.body.vad_config;
        adSettings = req.body.ad_settings
          ? (typeof req.body.ad_settings === 'string' ? JSON.parse(req.body.ad_settings) : req.body.ad_settings)
          : DEFAULT_AD_ANALYSIS_SETTINGS;
        vadOutput = typeof req.body.vad_output === 'string'
          ? JSON.parse(req.body.vad_output)
          : req.body.vad_output;
      } else {
        const uploadedFile = req.file;
        if (!uploadedFile) {
          res.status(400).json({ error: 'ไม่ได้รับไฟล์วิดีโอ MP4 สำหรับการวิเคราะห์' });
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jobId = (req as any).generatedJobId || `job_${Date.now()}`;
        localFilePath = uploadedFile.path;
        videoMetadata = typeof req.body.video_metadata === 'string'
          ? JSON.parse(req.body.video_metadata)
          : req.body.video_metadata;
        vadConfig = typeof req.body.vad_config === 'string'
          ? JSON.parse(req.body.vad_config)
          : req.body.vad_config;
        adSettings = req.body.ad_settings
          ? (typeof req.body.ad_settings === 'string' ? JSON.parse(req.body.ad_settings) : req.body.ad_settings)
          : DEFAULT_AD_ANALYSIS_SETTINGS;
        vadOutput = typeof req.body.vad_output === 'string'
          ? JSON.parse(req.body.vad_output)
          : req.body.vad_output;
      }

      const validated = validateJobInitialization({ video_metadata: videoMetadata, vad_config: vadConfig, vad_output: vadOutput, ad_settings: adSettings });
      if (!validated.success || fs.statSync(localFilePath).size !== validated.data.video_metadata.fileSize) {
        res.status(400).json({ error: 'ข้อมูลวิดีโอหรือผลตรวจเสียงไม่ถูกต้อง' });
        return;
      }
      ({ video_metadata: videoMetadata, vad_config: vadConfig, vad_output: vadOutput, ad_settings: adSettings } = validated.data);

      const serverConfig = getServerConfig();

      const batches = buildAnalysisBatches(
        vadOutput.candidate_spots,
        vadOutput.duration_ms,
        serverConfig.analysisBatchSeconds,
        serverConfig.contextBeforeSeconds,
        serverConfig.contextAfterSeconds
      );

      const initialSpots: ADSpot[] = vadOutput.candidate_spots.map((spot) => ({
        spot_id: spot.spot_id,
        start_ms: spot.start_ms,
        end_ms: spot.end_ms,
        duration_ms: spot.duration_ms,
        decision: 'pending',
        text: '',
        is_edited: false,
        original_start_ms: spot.start_ms,
        original_end_ms: spot.end_ms,
      }));

      const now = new Date().toISOString();
      const jobState: PersistedJobState = {
        job_id: jobId,
        created_at: now,
        updated_at: now,
        status: batches.length === 0 ? 'READY' : 'ANALYZING',
        video_metadata: videoMetadata,
        vad_config: vadConfig,
        ad_settings: adSettings,
        vad_output: vadOutput,
        local_file_path: localFilePath,
        batches,
        spots: initialSpots,
        progress_stage:
          batches.length === 0
            ? undefined
            : 'กำลังเตรียมส่งไฟล์วิดีโอไปยัง Gemini Files API...',
        progress_percent: batches.length === 0 ? 100 : 8,
      };

      // Validate API key presence immediately so missing key fails fast before background spawn
      if (batches.length > 0) {
        getGeminiClient({ fastFail: true });
      }

      store.save(jobState);
      activeUploads.delete(jobId);

      // Section 06 Rule: "หากไม่มี Candidate Spots ไม่ต้องเรียก Gemini"
      if (batches.length === 0) {
        res.json({ job: jobState, isRunning: false });
        return;
      }

      // Kick off upload + sequential batch analysis asynchronously so HTTP responds in <50ms
      void runJobInBackground(jobId).catch(() => console.error('Failed to run job processing'));
      res.json({ job: jobState, isRunning: true });
    } catch (err) {
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: 'ข้อมูลคำขอไม่ใช่ JSON ที่ถูกต้อง' });
        return;
      }
      const parsed = parseGeminiError(err);
      res.status(sanitizeApiStatusCode(parsed.statusCode)).json({
        error: parsed.userMessage,
        isRateLimit: parsed.isRateLimit,
      });
    }
  });

  // 6a. POST /api/jobs/:jobId/start — Start or resume background batch processing immediately
  app.post('/api/jobs/:jobId/start', (req: Request, res: Response) => {
    const { jobId } = req.params;

    if (
      activeProcessingLock &&
      activeProcessingLock.jobId !== jobId
    ) {
      res.status(409).json({
        error: `ขณะนี้ระบบกำลังประมวลผลอีกงานหนึ่งอยู่ (${activeProcessingLock.jobId}) กรุณารอให้งานปัจจุบันเสร็จสิ้นก่อน`,
      });
      return;
    }

    const job = store.load(jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบงานประมวลผล (Job) บนเซิร์ฟเวอร์' });
      return;
    }

    if (activeProcessingLock?.jobId === jobId) {
      res.json({ job, isRunning: true });
      return;
    }

    try {
      getGeminiClient({ fastFail: true });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(sanitizeApiStatusCode(parsed.statusCode)).json({
        error: parsed.userMessage,
      });
      return;
    }

    if (job.batches.every((b) => b.status === 'completed')) {
      job.status = 'READY';
      job.progress_stage = undefined;
      job.progress_percent = 100;
      store.save(job);
      if (!job.gemini_file_name) {
        res.json({ job, isRunning: false });
        return;
      }
    } else {
      job.status = 'ANALYZING';
      job.error_message = undefined;
      job.progress_stage = 'กำลังเชื่อมต่อ Gemini เพื่อเริ่มวิเคราะห์ชุดข้อมูล...';
      store.save(job);
    }

    void runJobInBackground(jobId).catch(() => console.error('Failed to run job processing'));
    res.json({ job, isRunning: true });
  });

  // 6b. POST /api/jobs/:jobId/analyze-batch — Backward-compatible single-batch endpoint
  app.post('/api/jobs/:jobId/analyze-batch', async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { batch_id } = req.body as { batch_id?: string };

    while (activeProcessingLock?.jobId === jobId) {
      await activeProcessingLock.finished;
      if (res.destroyed) return;
    }

    if (
      activeProcessingLock &&
      activeProcessingLock.jobId !== jobId
    ) {
      res.status(409).json({
        error: 'ระบบจำกัดการประมวลผล Gemini ได้ทีละหนึ่งงานใน MVP กรุณารอให้งานที่กำลังรันอยู่เสร็จสิ้น',
      });
      return;
    }

    const job = store.load(jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบงานประมวลผล (Job) บนเซิร์ฟเวอร์' });
      return;
    }

    const batch = batch_id
      ? job.batches.find((b) => b.batch_id === batch_id)
      : job.batches.find((b) => b.status !== 'completed');

    if (!batch) {
      job.status = 'READY';
      store.save(job);
      res.json({ job });
      return;
    }

    if (batch.status === 'completed') {
      res.json({ job, batch });
      return;
    }

    const lock = createProcessingLock(jobId);
    activeProcessingLock = lock;
    batch.status = 'processing';
    batch.error = undefined;
    job.status = 'ANALYZING';
    job.error_message = undefined;
    let uploadAi: GoogleGenAI | undefined;
    try {
      store.save(job);
      uploadAi = getGeminiClient({ fastFail: false });
      const fastAi = getGeminiClient({ fastFail: true });
      const serverConfig = getServerConfig();
      const spotResults = await analyzeBatchWithGemini(
        fastAi,
        uploadAi,
        job,
        batch,
        serverConfig
      );

      batch.status = 'completed';
      batch.error = undefined;

      const allCompleted = job.batches.every((b) => b.status === 'completed');
      if (allCompleted) {
        job.status = 'READY';
      }

      saveProcessingState(job, spotResults);
      if (allCompleted && await deleteJobGeminiFile(uploadAi, job)) {
        try {
          saveProcessingState(job);
        } catch {
          console.error('Failed to persist Gemini file cleanup');
        }
      }
      res.json({ job, batch });
    } catch (err) {
      const parsed = parseGeminiError(err);
      batch.status = 'failed';
      batch.error = parsed.userMessage;
      job.status = 'FAILED';
      job.error_message = parsed.userMessage;
      try {
        if (uploadAi && !(err instanceof GeminiFileDeletionError)) await deleteJobGeminiFile(uploadAi, job);
        saveProcessingState(job);
      } catch {
        res.status(500).json({ error: 'ไม่สามารถบันทึกสถานะงานได้' });
        return;
      }

      res.status(sanitizeApiStatusCode(parsed.statusCode)).json({
        error: parsed.userMessage,
        isRateLimit: parsed.isRateLimit,
        job,
        batch,
      });
    } finally {
      releaseProcessingLock(lock);
    }
  });

  // 7. PATCH /api/jobs/:jobId/spots — Save user edits (text, decision skip->generate, timestamp edits) to local server JSON
  app.patch('/api/jobs/:jobId/spots', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { spots } = (req.body || {}) as { spots?: ADSpot[] };

    const job = store.load(jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบข้อมูลงานประมวลผล' });
      return;
    }

    const checked = validateEditedSpots(spots, job);
    if (!checked.success) {
      res.status(400).json({ error: checked.error });
      return;
    }

    job.spots = checked.spots;
    store.save(job);
    res.json({ job });
  });

  // 8. DELETE /api/jobs/:jobId — Clear active job pointer when resetting
  app.delete('/api/jobs/:jobId', (req: Request, res: Response) => {
    try {
      store.clearActive(req.params.jobId);
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  // Prevent unmatched /api/* routes from ever falling through to Vite SPA index.html
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({
      error: `ไม่พบ API Endpoint (${req.method} ${req.originalUrl})`,
      code: 'NOT_FOUND',
    });
  });

  // Explicit JSON error handler for all /api routes so Express/Multer never returns HTML errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('/api', (err: any, _req: Request, res: Response, _next: any) => {
    console.error('API Error handler caught:', err);
    const rawStatus = err.status || err.statusCode || 500;
    const status = sanitizeApiStatusCode(rawStatus);
    res.status(status).json({
      error: err.message || 'เกิดข้อผิดพลาดในการประมวลผลคำขอของเซิร์ฟเวอร์',
      code: err.code || 'SERVER_ERROR',
    });
  });

  const publicDir = path.resolve(process.cwd(), 'public');

  // Serve static assets in /public (ORT WASM binaries, .mjs modules, Silero ONNX models)
  // before Vite middleware to ensure dynamic import modules and wasm files bypass Vite transform query parameters (?import)
  app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/ort/') || p.startsWith('/models/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (p.endsWith('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      } else if (p.endsWith('.mjs')) {
        res.setHeader('Content-Type', 'text/javascript');
      }
    }
    next();
  });
  app.use(express.static(publicDir));

  const httpServer = http.createServer(app);

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AD Script Generator Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
