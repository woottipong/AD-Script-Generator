import dotenv from 'dotenv';
dotenv.config();

import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from 'vite';
import { ApiError, GoogleGenAI, MediaProcessing, MediaResolution, ThinkingLevel, Type } from '@google/genai';
import {
  ADAnalysisSettings,
  ADSpot,
  AnalysisBatch,
  type AiGenerationAvailability,
  DEFAULT_AD_ANALYSIS_SETTINGS,
  JOB_SCHEMA_VERSION,
  PersistedJobState,
  ServerConfig,
  VADConfig,
  VADOutput,
  VideoMetadata,
} from './src/types/ad';
import {
  DEFAULT_ANALYSIS_BATCH_SECONDS,
  buildAnalysisBatches,
  formatTimestampDisplay,
} from './src/utils/formatters';
import { completedAnalysisSpotIds, mergeProcessingState } from './src/utils/jobProcessing';
import { resolveJobTitle, validateEditedSpots, validateJobInitialization, validateReviewJobCreation } from './src/utils/jobValidation';
import { createJobStore, isJobId, type JobMeta } from './src/utils/jobStore';
import { BatchSpotResult, buildBatchPrompt, parseBatchResponse, parseGeminiError } from './src/utils/geminiBatch';
import { mountAuth, readAuthConfig, type AuthConfig } from './src/utils/auth';
import { fetchGoogleDriveSrt, GoogleDriveSrtError } from './src/utils/googleDriveSrt';
import type { AuthorSession } from './src/utils/session';
import type { JobProgress } from './src/utils/jobPolling';

// Without its sign-in settings the server would serve every Job to anyone, so it refuses to start.
let authConfig: AuthConfig;
try {
  authConfig = readAuthConfig(process.env);
} catch (err) {
  console.error(`Cannot start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const store = createJobStore(path.resolve(process.cwd(), '.data'));

const ANOTHER_JOB_ANALYZING_ERROR = 'มีงานอื่นกำลังวิเคราะห์อยู่ ลองใหม่เมื่อเสร็จ';
/** Every `:jobId` route answers a missing Job, and a Job the Author may not open, with this same body. */
const JOB_NOT_FOUND = 'ไม่พบงานนี้';

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

const REVIEW_MODE_GEMINI_ERROR = 'งานตรวจแก้ SRT ไม่ใช้การสร้างบทด้วย Gemini';
const FALLBACK_GEMINI_MODEL = 'gemini-3.5-flash-lite';
let primaryModelCooldownUntil = 0;
const verifiedActiveFileNames = new Set<string>();
const configuredAiLimit = Number(process.env.AI_DAILY_JOB_LIMIT);
const aiDailyLimit = Number.isSafeInteger(configuredAiLimit) && configuredAiLimit > 0 ? configuredAiLimit : 3;
const thailandDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', dateStyle: 'short' });

function geminiApiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key !== 'MY_GEMINI_API_KEY' ? key : undefined;
}

function allowAiGeneration(res: Response, confirmed: unknown, jobId: string): boolean {
  const author = res.locals.author as AuthorSession;
  if (!author.canGenerateAi) {
    res.status(401).json({ code: 'AI_ACCESS_REQUIRED', error: 'เฉพาะผู้ดูแลและหัวหน้างานที่สร้างบทด้วย AI ได้' });
  } else if (!geminiApiKey()) {
    res.status(500).json({ code: 'AI_NOT_CONFIGURED', error: 'ระบบยังไม่ได้ตั้งค่า Gemini' });
  } else if (confirmed !== true) {
    res.status(400).json({ code: 'AI_CONFIRMATION_REQUIRED', error: 'กรุณายืนยันค่าใช้จ่ายก่อนเริ่มวิเคราะห์' });
  } else if (!store.reserveAiUsage(author.sub, thailandDay.format(), jobId, aiDailyLimit)) {
    res.status(429).json({ code: 'AI_DAILY_QUOTA_EXHAUSTED', error: 'ใช้โควตาสร้างบท AI ครบแล้ววันนี้' });
  } else {
    return true;
  }
  return false;
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
  const apiKey = geminiApiKey();
  if (!apiKey) {
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

function saveProcessingProgress(job: PersistedJobState): void {
  if (!store.saveProgress(job.job_id, job)) throw new Error('ไม่สามารถอ่านสถานะงานล่าสุดได้');
}

function saveProcessingState(
  job: PersistedJobState,
  results?: ReadonlyMap<string, { decision: 'generate' | 'skip'; text: string; reason?: string }>,
): void {
  const latest = store.load(job.job_id);
  if (!latest) throw new Error('ไม่สามารถอ่านสถานะงานล่าสุดได้');
  job.spots = mergeProcessingState(job, latest, results).spots;
  // The author may rename the Job while it is analysed; analysis never changes the title.
  job.title = latest.title;
  if (latest.status === 'STOPPING' && job.status === 'ANALYZING') job.status = 'STOPPING';
  store.save(job);
}

// Single-job concurrency lock (MVP rule: process 1 Gemini job at a time)
type ProcessingLock = {
  jobId: string;
  stop: AbortController;
  finished: Promise<void>;
  release: () => void;
};
let activeProcessingLock: ProcessingLock | null = null;
const uploadActivity = new Map<string, number | 'abandoned'>();
const ACTIVE_UPLOAD_IDLE_MS = Number(process.env.ACTIVE_UPLOAD_IDLE_MS) || 5 * 60 * 1000;

function isUploadActive(uploadId: string): boolean {
  const lastActivityMs = uploadActivity.get(uploadId);
  if (typeof lastActivityMs !== 'number') return false;
  if (Date.now() - lastActivityMs <= ACTIVE_UPLOAD_IDLE_MS) return true;
  uploadActivity.delete(uploadId);
  return false;
}
/**
 * Who started each Unfinished Upload, until it is deleted or becomes a Job. Kept in memory only: after a restart an
 * upload has no known uploader and only Authors with All-Jobs Access can reach it (ADR-0004).
 */
const uploadOwners = new Map<string, string>();

function canUseUpload(uploadId: string, author: AuthorSession): boolean {
  return author.allJobs || uploadOwners.get(uploadId) === author.sub;
}

function createProcessingLock(jobId: string): ProcessingLock {
  let release!: () => void;
  const finished = new Promise<void>((resolve) => { release = resolve; });
  return { jobId, stop: new AbortController(), finished, release };
}

function finishStoppedAnalysis(job: PersistedJobState): void {
  for (const batch of job.batches) {
    if (batch.status === 'processing') {
      batch.status = 'pending';
      batch.error = undefined;
    }
  }
  job.status = job.batches.every((batch) => batch.status === 'completed') ? 'READY' : 'STOPPED';
  if (job.status === 'READY') job.progress_percent = 100;
  job.progress_stage = undefined;
  job.active_model = undefined;
  job.error_message = undefined;
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

async function clearStoppedGeminiFile(ai: GoogleGenAI, job: PersistedJobState): Promise<void> {
  if (!(await deleteJobGeminiFile(ai, job))) {
    throw new GeminiFileDeletionError('ยังลบวิดีโอจากการวิเคราะห์ครั้งก่อนบน Gemini ไม่สำเร็จ กรุณาลองทำต่ออีกครั้ง');
  }
  saveProcessingState(job);
}

/**
 * Ensures the job has a valid, non-expired Gemini File URI.
 * If the URI has expired and the local source MP4 still exists, re-uploads it automatically (Section 06 Rule 7).
 */
/** Server path of the Job's video copy; null when the video is not stored on this server. */
function serverVideoPath(job: JobMeta): string | null {
  return job.video_source.kind === 'server_copy' ? job.video_source.local_file_path : null;
}

async function ensureActiveGeminiFileUri(
  uploadAi: GoogleGenAI,
  job: PersistedJobState,
  signal: AbortSignal,
  onProgressStage?: (stage: string) => void
): Promise<{ uri: string; mimeType: string }> {
  signal.throwIfAborted();
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

  const videoPath = serverVideoPath(job);
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error('File URI บน Gemini หมดอายุแล้ว และไม่พบไฟล์วิดีโอสำรองบนเซิร์ฟเวอร์ กรุณาอัปโหลดวิดีโอใหม่อีกครั้ง');
  }

  if (existingName) {
    if (!(await deleteJobGeminiFile(uploadAi, job))) {
      throw new GeminiFileDeletionError('ยังลบไฟล์วิดีโอเดิมบน Gemini ไม่สำเร็จ กรุณารอสักครู่แล้วกดทำต่อจากชุดที่ค้าง');
    }
    saveProcessingState(job);
  }

  onProgressStage?.('กำลังส่งไฟล์วิดีโอไปยัง Gemini Files API...');
  signal.throwIfAborted();
  const uploaded = await uploadAi.files.upload({
    file: videoPath,
    config: {
      httpOptions: { retryOptions: { attempts: 1 } },
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
  signal.throwIfAborted();
  if (!name || !uploaded.uri) {
    throw new Error('การอัปโหลดไฟล์ไปยัง Gemini Files API ไม่สำเร็จ (ไม่ได้รับ File URI)');
  }

  let currentFile = uploaded;
  const maxPollAttempts = 90;
  for (let attempt = 1; currentFile.state === 'PROCESSING' && attempt <= maxPollAttempts; attempt++) {
    onProgressStage?.(`รอ Gemini Files API ประมวลผลไฟล์วิดีโอ (${attempt * 2} วินาที)...`);
    await delay(2000, undefined, { signal });
    currentFile = await uploadAi.files.get({ name });
  }
  signal.throwIfAborted();

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
/**
 * Runs Gemini Static Video Analysis for a single AnalysisBatch with exponential backoff retry.
 */
async function analyzeBatchWithGemini(
  fastAi: GoogleGenAI,
  uploadAi: GoogleGenAI,
  job: PersistedJobState,
  batch: AnalysisBatch,
  config: ServerConfig,
  signal: AbortSignal,
  onProgressStage?: (stage: string, activeModel?: string) => void
): Promise<Map<string, BatchSpotResult>> {
  const { uri: fileUri, mimeType } = await ensureActiveGeminiFileUri(
    uploadAi,
    job,
    signal,
    (stage) => onProgressStage?.(stage)
  );

  const { startOffsetSeconds, endOffsetSeconds, systemInstruction, promptText } = buildBatchPrompt(job, batch);

  const maxAttempts = 3;
  let lastError: unknown = null;
  let forceFallbackModel = Date.now() < primaryModelCooldownUntil;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal.throwIfAborted();
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
          automaticContinuation: false,
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

      return parseBatchResponse(response.text ?? '', batch);
    } catch (err) {
      signal.throwIfAborted();
      lastError = err;
      const classification = parseGeminiError(err);

      // If primary model is overloaded (503) or timed out, immediately switch to fast fallback model
      if (!forceFallbackModel && (classification.isHighDemand503 || classification.isTransient)) {
        primaryModelCooldownUntil = Date.now() + 10 * 60 * 1000;
        forceFallbackModel = true;
        if (attempt < maxAttempts) {
          await delay(800, undefined, { signal });
          continue;
        }
      }

      if (attempt < maxAttempts) {
        const baseDelayMs = classification.isRateLimit ? 3500 : 1500;
        const backoffMs = baseDelayMs * attempt;
        await delay(backoffMs, undefined, { signal });
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
async function runJobInBackground(jobId: string, isResumingStoppedJob = false): Promise<void> {
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

    job.status = 'ANALYZING';
    job.error_message = undefined;
    job.batches = job.batches.map((b) =>
      b.status === 'failed' || b.status === 'processing'
        ? { ...b, status: 'pending', error: undefined }
        : b
    );
    saveProcessingState(job);

    if (isResumingStoppedJob && job.gemini_file_name) await clearStoppedGeminiFile(uploadAi, job);
    // Step 1: Ensure video is uploaded & ACTIVE on Gemini Files API
    await ensureActiveGeminiFileUri(uploadAi, job, lock.stop.signal, (stage) => {
      job.progress_stage = stage;
      job.progress_percent = 12;
      saveProcessingProgress(job);
    });

    // Step 2: Process incomplete batches sequentially
    const totalBatches = job.batches.length;
    for (let i = 0; i < totalBatches; i++) {
      lock.stop.signal.throwIfAborted();
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
        FIXED_SERVER_CONFIG,
        lock.stop.signal,
        (stage, activeModel) => {
          job.progress_stage = stage;
          job.active_model = activeModel;
          saveProcessingProgress(job);
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
    if (lock.stop.signal.aborted) return;
    const parsed = parseGeminiError(err);
    const stuckBatch = job.batches.find((b) => b.status === 'processing');
    if (stuckBatch) {
      stuckBatch.status = 'failed';
      stuckBatch.error = parsed.userMessage;
    }
    job.status = isResumingStoppedJob && deletionFailed ? 'STOPPED' : 'FAILED';
    job.progress_stage = undefined;
    job.error_message = parsed.userMessage;
  } finally {
    try {
      if (!deletionFailed && (uploadAi || (allBatchesCompleted && job.gemini_file_name))) {
        await deleteJobGeminiFile(uploadAi ?? getGeminiClient({ fastFail: false }), job);
      }
      if (lock.stop.signal.aborted) finishStoppedAnalysis(job);
      if (job.status === 'READY' || job.status === 'FAILED' || job.status === 'STOPPED') saveProcessingState(job);
    } catch {
      console.error('Failed to finalize job processing');
    } finally {
      releaseProcessingLock(lock);
    }
  }
}

/** Analysis runs only in this process, so any Job still marked as analysing was cut off by a restart. */
async function recoverOrphanedJobsOnStartup(): Promise<void> {
  try {
    for (const { job_id, is_upload } of store.list()) {
      if (is_upload) continue;
      const job = store.load(job_id);
      if (!job) continue;
      const wasStopping = job.status === 'STOPPING';
      let modified = false;
      for (const b of job.batches) {
        if (b.status === 'processing') {
          b.status = 'pending';
          b.error = undefined;
          modified = true;
        }
      }
      if (job.status === 'ANALYZING' || job.status === 'STOPPING') {
        if (job.status === 'STOPPING') finishStoppedAnalysis(job);
        else {
          job.status = 'VAD_READY';
          job.progress_stage = undefined;
        }
        modified = true;
      }
      if (modified) store.save(job);
      if (wasStopping && job.gemini_file_name && geminiApiKey()) {
        if (await deleteJobGeminiFile(getGeminiClient({ fastFail: false }), job)) saveProcessingState(job);
      }
    }
  } catch (err) {
    // Unreadable storage must not keep the server from starting; the Job List reports the storage error.
    console.error('Startup recovery could not read jobs:', err);
  }
}

async function startServer() {
  await recoverOrphanedJobsOnStartup();

  const app = express();

  // Ensure /api responses are never cached by proxies or browsers
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  // Keycloak may change an Author's email; keep the Job List's owner email in step at each sign-in.
  const { sessionOf } = mountAuth(app, authConfig, (author) => store.updateOwnerEmail(author.sub, author.email));

  // `/api/config` stays public for the container healthcheck; every other API needs a signed-in Author.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/config') {
      next();
      return;
    }
    const author = sessionOf(req);
    if (!author) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบอีกครั้ง', code: 'UNAUTHENTICATED' });
      return;
    }
    res.locals.author = author;
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  // A page opened without a session goes to sign-in first, so the SPA never renders signed out.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isPage = req.method === 'GET' && Boolean(req.headers.accept?.includes('text/html')) &&
      !req.path.startsWith('/api/') && !req.path.startsWith('/auth/');
    if (!isPage || sessionOf(req)) {
      next();
      return;
    }
    res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  });

  // Another Author's Job, or one with no Job Owner, is reachable only with All-Jobs Access and otherwise
  // answers exactly like a missing Job, so its existence is never revealed. A missing Job falls through to the route.
  app.param('jobId', (_req: Request, res: Response, next: NextFunction, jobId: string) => {
    const job = store.loadMeta(jobId);
    const author = res.locals.author as AuthorSession;
    if (job && !author.allJobs && job.owner_sub !== author.sub) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }
    next();
  });

  app.get('/api/me', (_req: Request, res: Response) => {
    const { email, name, allJobs, accessGroups, canGenerateAi, sub } = res.locals.author as AuthorSession;
    const usedJobIds = canGenerateAi ? store.aiUsage(sub, thailandDay.format()) : [];
    const aiGeneration: AiGenerationAvailability = {
      enabled: Boolean(geminiApiKey()),
      limit: aiDailyLimit,
      remaining: Math.max(0, aiDailyLimit - usedJobIds.length),
      usedJobIds,
    };
    res.json({ email, name, allJobs, accessGroups, canGenerateAi: canGenerateAi === true, aiGeneration });
  });

  // 1. GET /api/config — Return server default configuration (no secrets)
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      config: FIXED_SERVER_CONFIG,
    });
  });

  app.get('/api/jobs', (_req: Request, res: Response) => {
    try {
      const author = res.locals.author as AuthorSession;
      const jobs = store.list(author.allJobs ? undefined : author.sub).map(({ owner_sub, ...job }) => ({
        ...job,
        is_owner: !job.is_upload && Boolean(owner_sub) && owner_sub === author.sub,
        is_processing: job.is_upload ? isUploadActive(job.job_id) : job.job_id === activeProcessingLock?.jobId,
      }));
      res.json({ jobs });
    } catch (err) {
      console.error('Could not list jobs:', err);
      res.status(500).json({ error: 'ไม่สามารถอ่านรายการงานได้' });
    }
  });

  app.delete('/api/jobs/:jobId/files', (req, res) => {
    try {
      // A Job's access was checked by the `jobId` param; an Unfinished Upload has no row, so check its uploader here.
      if (!store.exists(req.params.jobId) && !canUseUpload(req.params.jobId, res.locals.author as AuthorSession)) {
        res.status(404).json({ error: JOB_NOT_FOUND }); return;
      }
      if (req.params.jobId === activeProcessingLock?.jobId || isUploadActive(req.params.jobId)) {
        res.status(409).json({ error: 'ไม่สามารถลบงานที่กำลังวิเคราะห์หรืออัปโหลดอยู่' }); return;
      }
      if (!store.deleteJob(req.params.jobId)) { res.status(404).json({ error: JOB_NOT_FOUND }); return; }
      uploadActivity.delete(req.params.jobId);
      uploadOwners.delete(req.params.jobId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'ไม่สามารถลบไฟล์งานได้' });
    }
  });

  // 3. GET /api/jobs/:jobId — Fetch specific job state (used by fast client polling)
  app.get('/api/jobs/:jobId', (req, res) => {
    // Polling asks for `view=progress`, which skips reading the VAD file on every poll.
    if (req.query.view === 'progress') {
      const meta = store.loadMeta(req.params.jobId);
      if (!meta) {
        res.status(404).json({ error: JOB_NOT_FOUND });
        return;
      }
      const { job_id, status, batches, progress_stage, progress_percent, active_model, error_message } = meta;
      const job: JobProgress = {
        job_id, status, batches, spots: store.loadSpots(job_id), progress_stage, progress_percent, active_model, error_message,
      };
      res.json({ job, isRunning: activeProcessingLock?.jobId === job_id });
      return;
    }
    const job = store.load(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }
    const isRunning = Boolean(
      activeProcessingLock && activeProcessingLock.jobId === job.job_id
    );
    res.json({ job, isRunning });
  });

  // 4. GET /api/jobs/:jobId/video — Stream local MP4 file with Range support for video player recovery after refresh
  app.get('/api/jobs/:jobId/video', (req, res) => {
    const job = store.loadMeta(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }
    const filePath = serverVideoPath(job);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'ไม่พบไฟล์วิดีโอสำรองสำหรับงานนี้' });
      return;
    }

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
      uploadActivity.set(uploadId, Date.now());
      uploadOwners.set(uploadId, (res.locals.author as AuthorSession).sub);

      res.json({
        uploadId,
        fileName: safeFileName,
        fileSize: fileSize || 0,
      });
    } catch {
      res.status(500).json({ error: 'ไม่สามารถเริ่มต้นอัปโหลดได้' });
    }
  });

  app.post('/api/upload/:uploadId/abandon', (req, res) => {
    const { uploadId } = req.params;
    if (!isJobId(uploadId)) {
      res.status(400).json({ error: 'uploadId ไม่ถูกต้อง' });
      return;
    }
    if (!canUseUpload(uploadId, res.locals.author as AuthorSession)) {
      res.status(404).json({ error: 'ไม่พบการอัปโหลดนี้' });
      return;
    }
    if (!store.exists(uploadId) && fs.existsSync(path.join(store.dirOf(uploadId), 'source_video.mp4'))) {
      uploadActivity.set(uploadId, 'abandoned');
    }
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
        if (!fs.existsSync(jobDir) || !canUseUpload(uploadId, res.locals.author as AuthorSession)) {
          res.status(404).json({ error: 'ไม่พบโฟลเดอร์สำหรับ uploadId นี้' });
          return;
        }
        if (!fs.lstatSync(jobDir).isDirectory() || store.exists(uploadId)) {
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
        if (uploadActivity.get(uploadId) !== 'abandoned') uploadActivity.set(uploadId, Date.now());
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
    const autoStart = req.body?.autoStart !== false && req.body?.autoStart !== 'false';
    if (
      autoStart &&
      activeProcessingLock
    ) {
      res.status(409).json({
        error: ANOTHER_JOB_ANALYZING_ERROR,
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
        // Another Author's upload answers exactly like a missing one.
        if (!canUseUpload(jobId, res.locals.author as AuthorSession) || !fs.existsSync(localFilePath) || !fs.lstatSync(jobDir).isDirectory() || !fs.lstatSync(localFilePath).isFile() || fs.statSync(localFilePath).size === 0 || store.exists(jobId)) {
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
      const title = resolveJobTitle(req.body.title, videoMetadata.fileName);
      if (!title.success) {
        res.status(400).json({ error: title.error });
        return;
      }


      const batches = buildAnalysisBatches(
        vadOutput.candidate_spots,
        vadOutput.duration_ms,
        FIXED_SERVER_CONFIG.analysisBatchSeconds,
        FIXED_SERVER_CONFIG.contextBeforeSeconds,
        FIXED_SERVER_CONFIG.contextAfterSeconds
      );

      const initialSpots: ADSpot[] = vadOutput.candidate_spots.map((spot) => ({
        spot_id: spot.spot_id,
        start_ms: spot.start_ms,
        end_ms: spot.end_ms,
        duration_ms: spot.duration_ms,
        decision: 'pending',
        text: '',
        original_start_ms: spot.start_ms,
        original_end_ms: spot.end_ms,
      }));

      const now = new Date().toISOString();
      const willAnalyzeNow = autoStart && batches.length > 0;
      const jobState: PersistedJobState = {
        schema_version: JOB_SCHEMA_VERSION,
        job_id: jobId,
        title: title.title,
        owner_sub: (res.locals.author as AuthorSession).sub,
        owner_email: (res.locals.author as AuthorSession).email,
        mode: 'generate',
        video_source: { kind: 'server_copy', local_file_path: localFilePath },
        created_at: now,
        updated_at: now,
        status: batches.length === 0 ? 'READY' : willAnalyzeNow ? 'ANALYZING' : 'VAD_READY',
        video_metadata: videoMetadata,
        vad_config: vadConfig,
        ad_settings: adSettings,
        vad_output: vadOutput,
        batches,
        spots: initialSpots,
        progress_stage:
          willAnalyzeNow
            ? 'กำลังเตรียมส่งไฟล์วิดีโอไปยัง Gemini Files API...'
            : undefined,
        progress_percent: batches.length === 0 ? 100 : willAnalyzeNow ? 8 : undefined,
      };

      if (willAnalyzeNow && !allowAiGeneration(res, req.body?.confirmAiCost === 'true' || req.body?.confirmAiCost === true, jobId)) return;

      store.save(jobState);
      uploadActivity.delete(jobId);
      uploadOwners.delete(jobId);

      // Section 06 Rule: "หากไม่มี Candidate Spots ไม่ต้องเรียก Gemini"
      if (!willAnalyzeNow) {
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

  // POST /api/jobs/review — Register a Review Mode job: the author's SRT plus VAD output, with no video on the server
  app.post('/api/jobs/review', (req: Request, res: Response) => {
    const checked = validateReviewJobCreation(req.body);
    if (!checked.success) {
      res.status(400).json({ error: checked.error.issues[0]?.message || 'ข้อมูลงานตรวจแก้ SRT ไม่ถูกต้อง' });
      return;
    }
    const { video_metadata, vad_config, vad_output, video_source, srt_source, spots } = checked.data;
    const title = resolveJobTitle(req.body.title, video_metadata.fileName);
    if (!title.success) {
      res.status(400).json({ error: title.error });
      return;
    }
    const now = new Date().toISOString();
    const job: PersistedJobState = {
      schema_version: JOB_SCHEMA_VERSION,
      job_id: `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      title: title.title,
      owner_sub: (res.locals.author as AuthorSession).sub,
      owner_email: (res.locals.author as AuthorSession).email,
      mode: 'review',
      video_source,
      srt_source: { ...srt_source, imported_at: now },
      created_at: now,
      updated_at: now,
      status: 'READY',
      video_metadata,
      vad_config,
      vad_output,
      batches: [],
      spots,
    };
    store.save(job);
    res.json({ job, isRunning: false });
  });

  // POST /api/review/fetch-srt — Fetch a public Google Drive SRT server-side with redirect/size/format validation
  app.post('/api/review/fetch-srt', async (req: Request, res: Response) => {
    const rawUrl = req.body?.url;
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      res.status(400).json({ error: 'กรุณาวางลิงก์ไฟล์ Google Drive' });
      return;
    }
    try {
      const result = await fetchGoogleDriveSrt(rawUrl);
      res.json({
        file_name: result.fileName,
        content: result.content,
        size_bytes: result.sizeBytes,
        cue_count: result.cueCount,
      });
    } catch (err) {
      if (err instanceof GoogleDriveSrtError) {
        res.status(sanitizeApiStatusCode(err.statusCode)).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'ไม่สามารถดึงไฟล์จาก Google Drive ได้ กรุณาลองอีกครั้ง' });
    }
  });

  // 6a. POST /api/jobs/:jobId/start — Start or resume background batch processing immediately
  app.post('/api/jobs/:jobId/start', (req, res) => {
    const { jobId } = req.params;

    const job = store.load(jobId);
    if (!job) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }

    if (
      activeProcessingLock &&
      activeProcessingLock.jobId !== jobId
    ) {
      res.status(409).json({
        error: ANOTHER_JOB_ANALYZING_ERROR,
      });
      return;
    }
    if (job.mode === 'review') {
      res.status(409).json({ error: REVIEW_MODE_GEMINI_ERROR });
      return;
    }

    if (activeProcessingLock?.jobId === jobId) {
      res.json({ job, isRunning: true });
      return;
    }

    const isResumingStoppedJob = job.status === 'STOPPED';
    if (job.batches.every((b) => b.status === 'completed')) {
      job.status = 'READY';
      job.progress_stage = undefined;
      job.progress_percent = 100;
      store.save(job);
      if (!job.gemini_file_name) {
        res.json({ job, isRunning: false });
        return;
      }
      if (!(res.locals.author as AuthorSession).canGenerateAi || !geminiApiKey()) {
        res.json({ job, isRunning: false });
        return;
      }
    } else {
      if (!allowAiGeneration(res, req.body?.confirmAiCost, jobId)) return;
      job.status = 'ANALYZING';
      job.error_message = undefined;
      job.progress_stage = 'กำลังเชื่อมต่อ Gemini เพื่อเริ่มวิเคราะห์ชุดข้อมูล...';
      store.save(job);
    }

    void runJobInBackground(jobId, isResumingStoppedJob).catch(() => console.error('Failed to run job processing'));
    res.json({ job, isRunning: true });
  });

  app.post('/api/jobs/:jobId/stop', (req, res) => {
    const { jobId } = req.params;
    if (!store.exists(jobId)) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }
    const author = res.locals.author as AuthorSession;
    if (!author.canGenerateAi) {
      res.status(401).json({ code: 'AI_ACCESS_REQUIRED', error: 'เฉพาะผู้ดูแลและหัวหน้างานที่หยุดการวิเคราะห์ได้' });
      return;
    }

    const lock = activeProcessingLock;
    if (lock?.jobId !== jobId) {
      res.json({ isRunning: false });
      return;
    }
    if (!lock.stop.signal.aborted) {
      store.recordAiStop(jobId, author.sub);
      lock.stop.abort();
    }
    res.json({ isRunning: true });
  });

  // 6b. POST /api/jobs/:jobId/analyze-batch — Backward-compatible single-batch endpoint
  app.post('/api/jobs/:jobId/analyze-batch', async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { batch_id } = (req.body || {}) as { batch_id?: string };

      let job = store.load(jobId);
      if (!job) {
        res.status(404).json({ error: JOB_NOT_FOUND });
        return;
      }

      let waited = false;
      while (activeProcessingLock?.jobId === jobId) {
        const previous = activeProcessingLock;
        waited = true;
        await previous.finished;
        if (res.destroyed) return;
        if (previous.stop.signal.aborted) {
          res.status(409).json({ error: 'หยุดการวิเคราะห์แล้ว กรุณากดยืนยันเพื่อทำต่อ' });
          return;
        }
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

      if (waited) {
        job = store.load(jobId);
        if (!job) {
          res.status(404).json({ error: JOB_NOT_FOUND });
          return;
        }
      }
      if (job.mode === 'review') {
        res.status(409).json({ error: REVIEW_MODE_GEMINI_ERROR });
        return;
      }

      const batch = batch_id
        ? job.batches.find((b) => b.batch_id === batch_id)
        : job.batches.find((b) => b.status !== 'completed');

      if (!batch) {
        if (job.status !== 'STOPPED') {
          job.status = 'READY';
          store.save(job);
        }
        res.json({ job });
        return;
      }

      if (batch.status === 'completed') {
        res.json({ job, batch });
        return;
      }

      if (!allowAiGeneration(res, req.body?.confirmAiCost, jobId)) return;
      const isResumingStoppedJob = job.status === 'STOPPED';
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
        if (isResumingStoppedJob && job.gemini_file_name) await clearStoppedGeminiFile(uploadAi, job);
        const spotResults = await analyzeBatchWithGemini(
          fastAi,
          uploadAi,
          job,
          batch,
          FIXED_SERVER_CONFIG,
          lock.stop.signal
        );

        batch.status = 'completed';
        batch.error = undefined;

        const allCompleted = job.batches.every((b) => b.status === 'completed');
        if (allCompleted) {
          job.status = 'READY';
        }

        if (lock.stop.signal.aborted) finishStoppedAnalysis(job);
        saveProcessingState(job, spotResults);
        if (allCompleted || lock.stop.signal.aborted) {
          await deleteJobGeminiFile(uploadAi, job);
          if (lock.stop.signal.aborted) finishStoppedAnalysis(job);
          try {
            saveProcessingState(job);
          } catch {
            console.error('Failed to persist Gemini file cleanup');
          }
        }
        res.json({ job, batch });
      } catch (err) {
        if (lock.stop.signal.aborted) {
          finishStoppedAnalysis(job);
          if (uploadAi) await deleteJobGeminiFile(uploadAi, job);
          saveProcessingState(job);
          res.json({ job, batch });
          return;
        }
        const parsed = parseGeminiError(err);
        batch.status = 'failed';
        batch.error = parsed.userMessage;
        job.status = isResumingStoppedJob && err instanceof GeminiFileDeletionError ? 'STOPPED' : 'FAILED';
        job.error_message = parsed.userMessage;
        try {
          if (uploadAi && !(err instanceof GeminiFileDeletionError)) await deleteJobGeminiFile(uploadAi, job);
          if (lock.stop.signal.aborted) finishStoppedAnalysis(job);
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
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/jobs/:jobId — Rename a Job
  app.patch('/api/jobs/:jobId', (req, res) => {
    if (!store.exists(req.params.jobId)) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }
    const title = resolveJobTitle((req.body || {}).title);
    if (!title.success) {
      res.status(400).json({ error: title.error });
      return;
    }
    // Only the title column changes, so a rename never overwrites spots saved meanwhile.
    const job = store.rename(req.params.jobId, title.title) ? store.load(req.params.jobId) : null;
    if (!job) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }
    res.json({ job });
  });

  // 7. PATCH /api/jobs/:jobId/spots — Save user edits (text, decision skip->generate, timestamp edits) to local server JSON
  app.patch('/api/jobs/:jobId/spots', (req, res) => {
    const { jobId } = req.params;
    const { spots } = (req.body || {}) as { spots?: ADSpot[] };

    const job = store.load(jobId);
    if (!job) {
      res.status(404).json({ error: JOB_NOT_FOUND });
      return;
    }

    const checked = validateEditedSpots(spots, job);
    if (!checked.success) {
      res.status(400).json({ error: checked.error });
      return;
    }

    if (job.status === 'STOPPED') {
      const completeSpotIds = completedAnalysisSpotIds(job.batches);
      const previous = new Map(job.spots.map((spot) => [spot.spot_id, spot]));
      const changedIncompleteSpot = checked.spots.some((spot) => {
        const before = previous.get(spot.spot_id);
        return before && !completeSpotIds.has(spot.spot_id) && (
          spot.start_ms !== before.start_ms || spot.end_ms !== before.end_ms ||
          spot.text !== before.text || spot.decision !== before.decision ||
          spot.reason !== before.reason
        );
      });
      if (changedIncompleteSpot) {
        res.status(409).json({ error: 'แก้ไขได้เฉพาะบทจากชุดที่วิเคราะห์เสร็จแล้ว' });
        return;
      }
    }
    job.spots = checked.spots;
    store.save(job);
    res.json({ job });
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
    // Only request errors meant for the client (body parsing, Multer limits) keep their message; storage and
    // other internal errors could name server paths or database state.
    const exposeMessage = err instanceof multer.MulterError || err.expose === true;
    res.status(status).json({
      error: (exposeMessage && err.message) || 'เกิดข้อผิดพลาดในการประมวลผลคำขอของเซิร์ฟเวอร์',
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
    app.use((req: Request, res: Response, next: NextFunction) => {
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(req.path);
      } catch {
        res.status(404).end();
        return;
      }
      if (/(^|\/)\.data(\/|$)/i.test(decodedPath)) {
        res.status(404).end();
        return;
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use('/assets', express.static(path.join(distPath, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AD Script Generator Server listening on http://0.0.0.0:${PORT}`);
  });
}

// Close the database so its write-ahead log is checkpointed before the process exits.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    store.close();
    process.exit(0);
  });
}

startServer();
