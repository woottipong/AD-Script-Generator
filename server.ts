import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';
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
  buildAnalysisBatches,
  formatTimestampDisplay,
  validateSpotTimestampEdit,
} from './src/utils/formatters';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data', 'jobs');
const ACTIVE_JOB_POINTER = path.join(DATA_DIR, 'active_job.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const FIXED_SERVER_CONFIG: ServerConfig = {
  geminiModel: 'gemini-3.8-flash',
  maxVideoDurationSeconds: 1800,
  maxUploadSizeMb: 2000,
  vadThreshold: 0.5,
  minAdGapMs: 3000,
  analysisBatchSeconds: 120,
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

// Local JSON Persistence Helpers
function getJobDir(jobId: string): string {
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, safeId);
}

function getJobFilePath(jobId: string): string {
  return path.join(getJobDir(jobId), 'job.json');
}

function saveJobState(job: PersistedJobState): void {
  const jobDir = getJobDir(job.job_id);
  fs.mkdirSync(jobDir, { recursive: true });
  job.updated_at = new Date().toISOString();
  fs.writeFileSync(getJobFilePath(job.job_id), JSON.stringify(job, null, 2), 'utf-8');
  fs.writeFileSync(
    ACTIVE_JOB_POINTER,
    JSON.stringify({ active_job_id: job.job_id, updated_at: job.updated_at }, null, 2),
    'utf-8'
  );
}

function loadJobState(jobId: string): PersistedJobState | null {
  try {
    const filePath = getJobFilePath(jobId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PersistedJobState;
  } catch {
    return null;
  }
}

function loadCurrentActiveJob(): PersistedJobState | null {
  try {
    if (!fs.existsSync(ACTIVE_JOB_POINTER)) return null;
    const pointer = JSON.parse(fs.readFileSync(ACTIVE_JOB_POINTER, 'utf-8'));
    if (!pointer?.active_job_id) return null;
    return loadJobState(pointer.active_job_id);
  } catch {
    return null;
  }
}

// Single-job concurrency lock (MVP rule: process 1 Gemini job at a time)
let activeProcessingLock: { jobId: string; batchId: string; startedAt: number } | null = null;

// Multer disk storage for streaming large MP4 uploads (up to 2 GB) directly to temporary disk
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    // Attach generated jobId to request object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).generatedJobId = jobId;
    const jobDir = getJobDir(jobId);
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

/**
 * Uploads the local MP4 file to Gemini Files API and waits until its state is ACTIVE.
 * Reuses the existing File URI across all batches unless expired.
 */
async function uploadAndAwaitGeminiFile(
  ai: GoogleGenAI,
  localFilePath: string,
  displayName: string,
  onProgressStage?: (stage: string) => void
): Promise<{ uri: string; name: string; mimeType: string; expiresAt?: string }> {
  if (!fs.existsSync(localFilePath)) {
    throw new Error('ไม่พบไฟล์วิดีโอต้นทางบนเซิร์ฟเวอร์สำหรับอัปโหลดไปยัง Gemini Files API');
  }

  onProgressStage?.('กำลังส่งไฟล์วิดีโอไปยัง Gemini Files API...');
  const uploaded = await ai.files.upload({
    file: localFilePath,
    config: {
      mimeType: 'video/mp4',
      displayName: displayName || 'source_video.mp4',
    },
  });

  if (!uploaded.name || !uploaded.uri) {
    throw new Error('การอัปโหลดไฟล์ไปยัง Gemini Files API ไม่สำเร็จ (ไม่ได้รับ File URI)');
  }

  // Poll until file state is ACTIVE
  let currentFile = uploaded;
  const maxPollAttempts = 90; // Up to ~3 minutes for large 30-min 480p video
  let attempt = 0;

  while (currentFile.state === 'PROCESSING' && attempt < maxPollAttempts) {
    attempt++;
    onProgressStage?.(
      `รอ Gemini Files API ประมวลผลไฟล์วิดีโอ (${attempt * 2} วินาที)...`
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    currentFile = await ai.files.get({ name: uploaded.name });
  }

  if (currentFile.state === 'FAILED') {
    throw new Error('Gemini Files API ไม่สามารถประมวลผลไฟล์วิดีโอนี้ได้ (State: FAILED)');
  }

  if (currentFile.state !== 'ACTIVE') {
    throw new Error(`ไฟล์วิดีโอบน Gemini Files API ยังไม่พร้อมใช้งาน (State: ${currentFile.state})`);
  }

  const finalName = currentFile.name || uploaded.name;
  verifiedActiveFileNames.add(finalName);

  return {
    uri: currentFile.uri || uploaded.uri,
    name: finalName,
    mimeType: currentFile.mimeType || 'video/mp4',
    expiresAt: currentFile.expirationTime,
  };
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
  if (job.gemini_file_name && job.gemini_file_uri) {
    const expiresMs = job.gemini_file_expires_at
      ? Date.parse(job.gemini_file_expires_at)
      : 0;
    const hasPlentyOfTtl = expiresMs > Date.now() + 15 * 60 * 1000;

    if (hasPlentyOfTtl && verifiedActiveFileNames.has(job.gemini_file_name)) {
      return {
        uri: job.gemini_file_uri,
        mimeType: job.gemini_file_mime_type || 'video/mp4',
      };
    }

    try {
      const remoteFile = await uploadAi.files.get({ name: job.gemini_file_name });
      if (remoteFile && remoteFile.state === 'ACTIVE' && remoteFile.uri) {
        verifiedActiveFileNames.add(job.gemini_file_name);
        return {
          uri: remoteFile.uri,
          mimeType: remoteFile.mimeType || 'video/mp4',
        };
      }
    } catch {
      verifiedActiveFileNames.delete(job.gemini_file_name);
      // File expired or not found on Gemini Files API; fall through to re-upload if local file exists
    }
  }

  if (!job.local_file_path || !fs.existsSync(job.local_file_path)) {
    throw new Error('File URI บน Gemini หมดอายุแล้ว และไม่พบไฟล์วิดีโอสำรองบนเซิร์ฟเวอร์ กรุณาอัปโหลดวิดีโอใหม่อีกครั้ง');
  }

  const freshUpload = await uploadAndAwaitGeminiFile(
    uploadAi,
    job.local_file_path,
    job.video_metadata.fileName,
    onProgressStage
  );
  job.gemini_file_uri = freshUpload.uri;
  job.gemini_file_name = freshUpload.name;
  job.gemini_file_mime_type = freshUpload.mimeType;
  job.gemini_file_expires_at = freshUpload.expiresAt;
  saveJobState(job);

  return {
    uri: freshUpload.uri,
    mimeType: freshUpload.mimeType,
  };
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

  // Find surrounding speech segments in this window for additional context awareness
  const nearbySpeech = job.vad_output.speech_segments.filter(
    (seg) => seg.end_ms >= batch.window_start_ms && seg.start_ms <= batch.window_end_ms
  );

  const candidateListDescription = batch.candidate_spots
    .map((spot) => {
      const durationSec = (spot.duration_ms / 1000).toFixed(1);
      // Subtract head & tail safety buffer (default 250ms * 2 = 500ms) so narration never collides with dialogue
      const usableDurationSec = Math.max(1.2, (spot.duration_ms - safetyBufferMs * 2) / 1000);
      const maxRecommendedChars = Math.max(10, Math.floor(usableDurationSec * paceCharsPerSec));
      return `- spot_id: "${spot.spot_id}" | ช่วงเวลาว่าง: ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)} (ความยาวเต็ม ${durationSec}s · เวลาพูดจริงหลังหักระยะปลอดภัย ${usableDurationSec.toFixed(1)}s · ความยาวภาษาไทยที่เหมาะสมที่สุด: ไม่เกิน ~${maxRecommendedChars} ตัวอักษร)`;
    })
    .join('\n');

  const speechContextDescription =
    nearbySpeech.length > 0
      ? nearbySpeech
          .map((s) => `${formatTimestampDisplay(s.start_ms)} - ${formatTimestampDisplay(s.end_ms)}`)
          .join(', ')
      : 'ไม่มีช่วงเสียงพูดในช่วงเวลานี้';

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
      ? '- ห้ามใช้ศัพท์เทคนิคมุมกล้อง เช่น "กล้องแพน", "กล้องซูม", "ภาพตัดไปที่" ให้บรรยายสิ่งที่ปรากฏในภาพโดยตรง (เช่น "ในห้องครัว...", "ระยะใกล้ที่มือของชายหนุ่ม...")'
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
1. เข้าใจเหตุการณ์จากทั้งภาพและเสียงในวิดีโอ
2. วิเคราะห์บริบทสิ่งที่เกิดขึ้นก่อนหน้า ระหว่าง และหลัง Candidate Spot
3. พิจารณาว่ามีเหตุการณ์สำคัญทางภาพ (เช่น การกระทำของตัวละคร การเปลี่ยนฉาก สีหน้าท่าทางที่ชัดเจน วัตถุสำคัญ หรือข้อความบนหน้าจอ) ที่ผู้ฟังไม่สามารถรับรู้ได้จากเสียงเพียงอย่างเดียวหรือไม่
4. หลีกเลี่ยงการบรรยายซ้ำกับบทพูดหรือเสียงที่อธิบายเหตุการณ์อยู่แล้ว
5. หลีกเลี่ยงการทับเสียงเหตุการณ์สำคัญ (เช่น เสียงดนตรีสำคัญหรือเสียงเอฟเฟกต์ที่ต้องฟังเพื่อเข้าใจเนื้อเรื่อง)
6. สร้างคำบรรยายภาษาไทยที่กระชับ ชัดเจน เป็นธรรมชาติ และใช้ภาษาปัจจุบัน (เช่น "ชายคนหนึ่งเปิดประตูและเดินเข้าไปในห้อง")
7. ห้ามเดาความรู้สึกภายใน ความตั้งใจ หรือข้อมูลที่ไม่ปรากฏให้เห็นชัดเจนในวิดีโอ ให้บรรยายเฉพาะสิ่งที่เห็นจริง
8. ปรับความยาวข้อความให้พูดจบได้พอดีภายในระยะเวลาของ Spot นั้นๆ ตามจำนวนตัวอักษรที่แนะนำ
9. ตอบ decision เป็น "skip" พร้อมระบุ reason ภาษาไทยสั้นๆ และให้ text เป็น "" หากไม่มีเหตุการณ์สำคัญที่ต้องบรรยาย หรือภาพนิ่ง/ต่อเนื่องไม่เปลี่ยนสาระสำคัญ
10. ห้ามสร้าง spot_id ใหม่เด็ดขาด และต้องส่งผลลัพธ์ครบทุก spot_id ที่กำหนดใน Batch นี้เท่านั้น`;

  const promptText = `ข้อมูลการวิเคราะห์ Batch ที่ ${batch.batch_index}:
- ช่วงเวลาวิดีโอที่ส่งให้วิเคราะห์ (รวมบริบทก่อน-หลัง): ${formatTimestampDisplay(batch.window_start_ms)} ถึง ${formatTimestampDisplay(batch.window_end_ms)}
- ช่วงเวลาหลักของ Batch: ${formatTimestampDisplay(batch.batch_start_ms)} ถึง ${formatTimestampDisplay(batch.batch_end_ms)}
- ช่วงเวลาที่ตรวจพบเสียงพูด (Speech Segments) ในบริเวณนี้: ${speechContextDescription}

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
          ...(modelToUse === 'gemini-3.8-flash'
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
                      description: 'Either "generate" or "skip".',
                    },
                    text: {
                      type: Type.STRING,
                      description: 'Concise Thai Audio Description script if decision is "generate", or empty string "" if "skip".',
                    },
                    reason: {
                      type: Type.STRING,
                      description: 'Reason in Thai if decision is "skip".',
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
          text: item.decision === 'generate' ? cleanedText : '',
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
  if (
    activeProcessingLock &&
    activeProcessingLock.jobId === jobId &&
    Date.now() - activeProcessingLock.startedAt < 3 * 60 * 1000
  ) {
    return;
  }

  const job = loadJobState(jobId);
  if (!job) return;

  if (job.batches.length === 0 || job.batches.every((b) => b.status === 'completed')) {
    job.status = 'READY';
    job.progress_stage = undefined;
    job.progress_percent = 100;
    saveJobState(job);
    return;
  }

  activeProcessingLock = { jobId, batchId: 'init', startedAt: Date.now() };

  try {
    const uploadAi = getGeminiClient({ fastFail: false });
    const fastAi = getGeminiClient({ fastFail: true });
    const serverConfig = getServerConfig();

    job.status = 'ANALYZING';
    job.error_message = undefined;
    job.batches = job.batches.map((b) =>
      b.status === 'failed' || b.status === 'processing'
        ? { ...b, status: 'pending', error: undefined }
        : b
    );
    saveJobState(job);

    // Step 1: Ensure video is uploaded & ACTIVE on Gemini Files API
    await ensureActiveGeminiFileUri(uploadAi, job, (stage) => {
      if (activeProcessingLock?.jobId === jobId) {
        activeProcessingLock.startedAt = Date.now();
      }
      job.progress_stage = stage;
      job.progress_percent = 12;
      saveJobState(job);
    });

    // Step 2: Process incomplete batches sequentially
    const totalBatches = job.batches.length;
    for (let i = 0; i < totalBatches; i++) {
      const batch = job.batches[i];
      if (batch.status === 'completed') {
        continue;
      }

      // Check if job was deleted/reset while running
      const latestPointerExists = loadJobState(jobId);
      if (!latestPointerExists) {
        return;
      }
      // Preserve any manual spot edits made while batches were running
      job.spots = latestPointerExists.spots;

      activeProcessingLock = { jobId, batchId: batch.batch_id, startedAt: Date.now() };
      batch.status = 'processing';
      batch.error = undefined;
      const completedSoFar = job.batches.filter((b) => b.status === 'completed').length;
      job.progress_percent = Math.min(
        96,
        Math.round(15 + (completedSoFar / totalBatches) * 80)
      );
      job.progress_stage = `กำลังวิเคราะห์ภาพและเสียง ชุดที่ ${batch.batch_index}/${totalBatches}...`;
      saveJobState(job);

      const spotResults = await analyzeBatchWithGemini(
        fastAi,
        uploadAi,
        job,
        batch,
        serverConfig,
        (stage, activeModel) => {
          if (activeProcessingLock?.jobId === jobId) {
            activeProcessingLock.startedAt = Date.now();
          }
          job.progress_stage = stage;
          job.active_model = activeModel;
          saveJobState(job);
        }
      );

      // Re-load latest spots in case user edited earlier completed spots in UI
      const freshState = loadJobState(jobId);
      const currentSpots = freshState ? freshState.spots : job.spots;

      job.spots = currentSpots.map((existingSpot) => {
        const matched = spotResults.get(existingSpot.spot_id);
        if (!matched) return existingSpot;
        return {
          ...existingSpot,
          start_ms: existingSpot.original_start_ms,
          end_ms: existingSpot.original_end_ms,
          duration_ms: existingSpot.original_end_ms - existingSpot.original_start_ms,
          decision: matched.decision,
          text: matched.text,
          reason: matched.reason,
        };
      });

      batch.status = 'completed';
      batch.error = undefined;

      const doneCount = job.batches.filter((b) => b.status === 'completed').length;
      job.progress_percent = Math.min(99, Math.round(15 + (doneCount / totalBatches) * 84));
      saveJobState(job);
    }

    job.status = 'READY';
    job.progress_stage = undefined;
    job.progress_percent = 100;
    job.error_message = undefined;
    saveJobState(job);
  } catch (err) {
    const parsed = parseGeminiError(err);
    const stuckBatch = job.batches.find((b) => b.status === 'processing');
    if (stuckBatch) {
      stuckBatch.status = 'failed';
      stuckBatch.error = parsed.userMessage;
    }
    job.status = 'FAILED';
    job.progress_stage = undefined;
    job.error_message = parsed.userMessage;
    saveJobState(job);
  } finally {
    if (activeProcessingLock?.jobId === jobId) {
      activeProcessingLock = null;
    }
  }
}

function recoverOrphanedJobOnStartup(): void {
  const activeJob = loadCurrentActiveJob();
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
    saveJobState(activeJob);
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
      hasActiveJob: Boolean(loadCurrentActiveJob()),
    });
  });

  // 2. GET /api/jobs/current — Restore active/recent job on browser refresh or reconnect
  app.get('/api/jobs/current', (_req: Request, res: Response) => {
    const job = loadCurrentActiveJob();
    if (!job) {
      res.json({ job: null, isRunning: false });
      return;
    }
    const isRunning = Boolean(
      activeProcessingLock &&
        activeProcessingLock.jobId === job.job_id &&
        Date.now() - activeProcessingLock.startedAt < 3 * 60 * 1000
    );
    res.json({ job, isRunning });
  });

  // 3. GET /api/jobs/:jobId — Fetch specific job state (used by fast client polling)
  app.get('/api/jobs/:jobId', (req: Request, res: Response) => {
    const job = loadJobState(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบข้อมูลงานประมวลผลนี้บนเซิร์ฟเวอร์' });
      return;
    }
    const isRunning = Boolean(
      activeProcessingLock &&
        activeProcessingLock.jobId === job.job_id &&
        Date.now() - activeProcessingLock.startedAt < 3 * 60 * 1000
    );
    res.json({ job, isRunning });
  });

  // 4. GET /api/jobs/:jobId/video — Stream local MP4 file with Range support for video player recovery after refresh
  app.get('/api/jobs/:jobId/video', (req: Request, res: Response) => {
    const job = loadJobState(req.params.jobId);
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
      const { fileName, fileSize } = req.body as { fileName?: string; fileSize?: number };
      const safeFileName = (fileName || 'video.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const jobDir = getJobDir(uploadId);
      fs.mkdirSync(jobDir, { recursive: true });

      const targetFilePath = path.join(jobDir, 'source_video.mp4');
      fs.writeFileSync(targetFilePath, Buffer.alloc(0));

      res.json({
        uploadId,
        fileName: safeFileName,
        fileSize: fileSize || 0,
      });
    } catch (err) {
      res.status(500).json({ error: `ไม่สามารถเริ่มต้นอัปโหลดได้: ${String(err)}` });
    }
  });

  // 5b. POST /api/upload/chunk — Receive binary chunk (<= 20MB) and append to source_video.mp4
  app.post(
    '/api/upload/chunk',
    express.raw({ type: 'application/octet-stream', limit: '25mb' }),
    (req: Request, res: Response) => {
      try {
        const uploadId = String(req.query.uploadId || req.headers['x-upload-id'] || '');
        if (!uploadId) {
          res.status(400).json({ error: 'ไม่พบ uploadId' });
          return;
        }

        const jobDir = getJobDir(uploadId);
        const targetFilePath = path.join(jobDir, 'source_video.mp4');
        if (!fs.existsSync(jobDir)) {
          res.status(404).json({ error: 'ไม่พบโฟลเดอร์สำหรับ uploadId นี้' });
          return;
        }

        const chunkBuffer = req.body;
        if (!Buffer.isBuffer(chunkBuffer) || chunkBuffer.length === 0) {
          res.status(400).json({ error: 'ข้อมูล Chunk ว่างเปล่า' });
          return;
        }

        fs.appendFileSync(targetFilePath, chunkBuffer);

        const currentSize = fs.statSync(targetFilePath).size;
        res.json({ ok: true, currentSize });
      } catch (err) {
        res.status(500).json({ error: `ไม่สามารถเขียนไฟล์ Chunk ได้: ${String(err)}` });
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
    // Check concurrency lock (clear stale locks older than 5 minutes)
    if (
      activeProcessingLock &&
      Date.now() - activeProcessingLock.startedAt < 5 * 60 * 1000
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
        const jobDir = getJobDir(jobId);
        localFilePath = path.join(jobDir, 'source_video.mp4');
        if (!fs.existsSync(localFilePath) || fs.statSync(localFilePath).size === 0) {
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

      saveJobState(jobState);

      // Section 06 Rule: "หากไม่มี Candidate Spots ไม่ต้องเรียก Gemini"
      if (batches.length === 0) {
        res.json({ job: jobState, isRunning: false });
        return;
      }

      // Kick off upload + sequential batch analysis asynchronously so HTTP responds in <50ms
      void runJobInBackground(jobId);
      res.json({ job: jobState, isRunning: true });
    } catch (err) {
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
      activeProcessingLock.jobId !== jobId &&
      Date.now() - activeProcessingLock.startedAt < 3 * 60 * 1000
    ) {
      res.status(409).json({
        error: `ขณะนี้ระบบกำลังประมวลผลอีกงานหนึ่งอยู่ (${activeProcessingLock.jobId}) กรุณารอให้งานปัจจุบันเสร็จสิ้นก่อน`,
      });
      return;
    }

    const job = loadJobState(jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบงานประมวลผล (Job) บนเซิร์ฟเวอร์' });
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
      saveJobState(job);
      res.json({ job, isRunning: false });
      return;
    }

    job.status = 'ANALYZING';
    job.error_message = undefined;
    job.progress_stage = 'กำลังเชื่อมต่อ Gemini เพื่อเริ่มวิเคราะห์ชุดข้อมูล...';
    saveJobState(job);

    void runJobInBackground(jobId);
    res.json({ job, isRunning: true });
  });

  // 6b. POST /api/jobs/:jobId/analyze-batch — Backward-compatible single-batch endpoint
  app.post('/api/jobs/:jobId/analyze-batch', async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { batch_id } = req.body as { batch_id?: string };

    if (
      activeProcessingLock &&
      activeProcessingLock.jobId !== jobId &&
      Date.now() - activeProcessingLock.startedAt < 3 * 60 * 1000
    ) {
      res.status(409).json({
        error: 'ระบบจำกัดการประมวลผล Gemini ได้ทีละหนึ่งงานใน MVP กรุณารอให้งานที่กำลังรันอยู่เสร็จสิ้น',
      });
      return;
    }

    const job = loadJobState(jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบงานประมวลผล (Job) บนเซิร์ฟเวอร์' });
      return;
    }

    const batch = batch_id
      ? job.batches.find((b) => b.batch_id === batch_id)
      : job.batches.find((b) => b.status !== 'completed');

    if (!batch) {
      job.status = 'READY';
      saveJobState(job);
      res.json({ job });
      return;
    }

    if (batch.status === 'completed') {
      res.json({ job, batch });
      return;
    }

    activeProcessingLock = { jobId, batchId: batch.batch_id, startedAt: Date.now() };
    batch.status = 'processing';
    batch.error = undefined;
    job.status = 'ANALYZING';
    job.error_message = undefined;
    saveJobState(job);

    try {
      const uploadAi = getGeminiClient({ fastFail: false });
      const fastAi = getGeminiClient({ fastFail: true });
      const serverConfig = getServerConfig();
      const spotResults = await analyzeBatchWithGemini(
        fastAi,
        uploadAi,
        job,
        batch,
        serverConfig
      );

      job.spots = job.spots.map((existingSpot) => {
        const matched = spotResults.get(existingSpot.spot_id);
        if (!matched) return existingSpot;
        return {
          ...existingSpot,
          start_ms: existingSpot.original_start_ms,
          end_ms: existingSpot.original_end_ms,
          duration_ms: existingSpot.original_end_ms - existingSpot.original_start_ms,
          decision: matched.decision,
          text: matched.text,
          reason: matched.reason,
        };
      });

      batch.status = 'completed';
      batch.error = undefined;

      const allCompleted = job.batches.every((b) => b.status === 'completed');
      if (allCompleted) {
        job.status = 'READY';
      }

      saveJobState(job);
      res.json({ job, batch });
    } catch (err) {
      const parsed = parseGeminiError(err);
      batch.status = 'failed';
      batch.error = parsed.userMessage;
      job.status = 'FAILED';
      job.error_message = parsed.userMessage;
      saveJobState(job);

      res.status(sanitizeApiStatusCode(parsed.statusCode)).json({
        error: parsed.userMessage,
        isRateLimit: parsed.isRateLimit,
        job,
        batch,
      });
    } finally {
      activeProcessingLock = null;
    }
  });

  // 7. PATCH /api/jobs/:jobId/spots — Save user edits (text, decision skip->generate, timestamp edits) to local server JSON
  app.patch('/api/jobs/:jobId/spots', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { spots } = req.body as { spots?: ADSpot[] };

    const job = loadJobState(jobId);
    if (!job) {
      res.status(404).json({ error: 'ไม่พบข้อมูลงานประมวลผล' });
      return;
    }

    if (!Array.isArray(spots)) {
      res.status(400).json({ error: 'ข้อมูลรายการ AD Spots ไม่ถูกต้อง' });
      return;
    }

    // Validate timestamp edits against original non-speech gaps and speech segments
    for (const updatedSpot of spots) {
      const check = validateSpotTimestampEdit(
        updatedSpot,
        updatedSpot.start_ms,
        updatedSpot.end_ms,
        job.vad_output.speech_segments,
        job.vad_output.duration_ms
      );
      if (!check.valid) {
        res.status(400).json({
          error: `Spot ${updatedSpot.spot_id}: ${check.error}`,
        });
        return;
      }
    }

    job.spots = spots;
    saveJobState(job);
    res.json({ job });
  });

  // 8. DELETE /api/jobs/:jobId — Clear active job pointer when resetting
  app.delete('/api/jobs/:jobId', (req: Request, res: Response) => {
    try {
      if (fs.existsSync(ACTIVE_JOB_POINTER)) {
        const ptr = JSON.parse(fs.readFileSync(ACTIVE_JOB_POINTER, 'utf-8'));
        if (ptr?.active_job_id === req.params.jobId) {
          fs.unlinkSync(ACTIVE_JOB_POINTER);
        }
      }
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

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AD Script Generator Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
