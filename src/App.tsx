import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import {
  ADSpot,
  AnalysisBatch,
  DEFAULT_AD_ANALYSIS_SETTINGS,
  DEFAULT_VAD_CONFIG,
  JobMode,
  JobStatus,
  PersistedJobState,
  REVIEW_MAX_DURATION_MS,
  VADOutput,
  VideoMetadata,
  VideoSource,
  VideoValidationIssue,
} from './types/ad';
import {
  BrowserCompatibilityResult,
  checkBrowserCompatibility,
  validateAndInspectMp4File,
} from './utils/videoValidator';
import {
  DEFAULT_ANALYSIS_BATCH_SECONDS,
  buildAnalysisBatches,
  formatFileSize,
  formatTimestampDisplay,
  generateSrtContent,
} from './utils/formatters';
import { UploadAndVadPanel } from './components/UploadAndVadPanel';
import { ModeChooser } from './components/ModeChooser';
import { ReviewIntake } from './components/ReviewIntake';
import { cuesToSpots, decodeSrtBytes, parseSrt, type SkippedCue } from './utils/srtImport';
import { fileByteSource, openByteSource, type ByteSource, type ByteSourceInput } from './utils/byteSource';
import { VideoPreviewTimeline } from './components/VideoPreviewTimeline';
import { AdScriptEditor } from './components/AdScriptEditor';
import { getProcessingFeedback, type ProcessingProgress } from './utils/processingFeedback';
import { parseApiResponse } from './utils/apiResponse';
import { createJobSaveQueue } from './utils/jobSaveQueue';
import { pollJob } from './utils/jobPolling';

const FIXED_MAX_VIDEO_DURATION_SECONDS = 1800; // 30 minutes
const FIXED_MAX_UPLOAD_SIZE_MB = 2000;         // 2 GB
const FIXED_CONTEXT_BEFORE_SECONDS = 20;       // 20s context before
const FIXED_CONTEXT_AFTER_SECONDS = 10;        // 10s context after

/** An SRT waiting for its video's audio scan to finish before it becomes a Review Mode Job. */
type ReviewImport = { spots: ADSpot[]; srtFileName: string; videoSource: VideoSource; vadInput: ByteSourceInput; metadata: VideoMetadata };

export default function App() {
  const [browserCompat, setBrowserCompat] = useState<BrowserCompatibilityResult | null>(null);
  const [status, setStatus] = useState<JobStatus>('IDLE');
  const [jobId, setJobId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [headerActionsElement, setHeaderActionsElement] = useState<HTMLDivElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [validationIssues, setValidationIssues] = useState<VideoValidationIssue[]>([]);
  const [checkingFileName, setCheckingFileName] = useState<string | null>(null);

  const [vadOutput, setVadOutput] = useState<VADOutput | null>(null);
  const [vadProgress, setVadProgress] = useState<ProcessingProgress | null>(null);

  const [batches, setBatches] = useState<AnalysisBatch[]>([]);
  const [spots, setSpots] = useState<ADSpot[]>([]);
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoredIncompleteJob, setRestoredIncompleteJob] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved');
  const [mode, setMode] = useState<JobMode | null>(null);
  const [srtFileName, setSrtFileName] = useState<string | null>(null);
  const [importSkipped, setImportSkipped] = useState<SkippedCue[]>([]);
  /** A restored Review Mode job whose video was a local file: the author must pick the same file again. */
  const [missingLocalVideo, setMissingLocalVideo] = useState<{ file_name: string; file_size: number } | null>(null);
  const reviewImportRef = useRef<ReviewImport | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pollAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const [saveQueue] = useState(() => createJobSaveQueue(setSaveStatus));

  useEffect(() => {
    saveQueue.invalidate();
    setSaveStatus('saved');
  }, [jobId, saveQueue]);

  const createReviewJob = useCallback(async (review: ReviewImport, output: VADOutput) => {
    const token = pollAbortRef.current;
    try {
      const response = await fetch('/api/jobs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_metadata: review.metadata,
          vad_config: output.signal_analysis?.recommendedConfig || DEFAULT_VAD_CONFIG,
          vad_output: output,
          video_source: review.videoSource,
          srt_source: { file_name: review.srtFileName, cue_count: review.spots.length },
          spots: review.spots,
        }),
      });
      const data = await parseApiResponse<{ job?: PersistedJobState; error?: string }>(response);
      if (token.aborted) {
        if (data?.job?.job_id) void fetch(`/api/jobs/${encodeURIComponent(data.job.job_id)}`, { method: 'DELETE' }).catch(() => {});
        return;
      }
      if (!response.ok || !data?.job) throw new Error(data?.error || 'บันทึกงานตรวจแก้ SRT บนเซิร์ฟเวอร์ไม่สำเร็จ');
      setJobId(data.job.job_id);
    } catch (err) {
      if (token.aborted) return;
      setErrorMessage(`${err instanceof Error ? err.message : String(err)} การแก้ไขจะอยู่ในหน้านี้เท่านั้น กรุณาส่งออก SRT ก่อนปิดหน้า`);
    }
  }, []);

  // Helper to get or initialize the Browser VAD Web Worker
  const getOrCreateWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(new URL('./workers/vad.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'PROGRESS') {
        setVadProgress({
          stage: data.stage,
          phase: data.phase,
          percent: data.percent,
          processedMs: data.processedMs,
          totalMs: data.totalMs,
        });
      } else if (data.type === 'COMPLETE') {
        const output: VADOutput = data.vadOutput;
        setVadProgress(null);
        setVadOutput(output);

        const review = reviewImportRef.current;
        if (review) {
          reviewImportRef.current = null;
          setSpots(review.spots);
          setBatches([]);
          setSelectedSpotId(review.spots[0]?.spot_id || null);
          setStatus('READY');
          setErrorMessage(null);
          void createReviewJob(review, output);
          return;
        }

        const initialSpots: ADSpot[] = output.candidate_spots.map((cand) => ({
          spot_id: cand.spot_id,
          start_ms: cand.start_ms,
          end_ms: cand.end_ms,
          duration_ms: cand.duration_ms,
          decision: 'pending',
          text: '',
          is_edited: false,
          original_start_ms: cand.start_ms,
          original_end_ms: cand.end_ms,
        }));

        const computedBatches = buildAnalysisBatches(
          output.candidate_spots,
          output.duration_ms,
          DEFAULT_ANALYSIS_BATCH_SECONDS,
          FIXED_CONTEXT_BEFORE_SECONDS,
          FIXED_CONTEXT_AFTER_SECONDS
        );

        setSpots(initialSpots);
        setBatches(computedBatches);
        setSelectedSpotId(initialSpots[0]?.spot_id || null);
        setStatus('VAD_READY');
        setErrorMessage(null);
      } else if (data.type === 'ERROR') {
        setVadProgress(null);
        setStatus('FAILED');
        setErrorMessage(`เกิดข้อผิดพลาดในการวิเคราะห์เสียง: ${data.error}`);
      }
    };

    worker.onerror = (err) => {
      setVadProgress(null);
      setStatus('FAILED');
      setErrorMessage(`เกิดข้อผิดพลาดใน Web Worker: ${err.message || 'Unknown error'}`);
    };

    workerRef.current = worker;
    return worker;
  }, [createReviewJob]);

  const startVad = useCallback(
    (source: ByteSourceInput) => {
      setErrorMessage(null);
      setStatus('DETECTING');
      setVadProgress({
        stage: 'กำลังถอดรหัสเสียงและตรวจหาช่วงว่างไร้เสียงพูด...',
        percent: 2,
      });

      const worker = getOrCreateWorker();
      worker.postMessage({
        type: 'PROCESS_FILE',
        source,
        vadConfig: DEFAULT_VAD_CONFIG,
        autoTuneOptimal: true,
      });
    },
    [getOrCreateWorker]
  );

  const pollJobUntilComplete = useCallback(async (activeJobId: string, startError?: string) => {
    pollAbortRef.current.aborted = true;
    const token = { aborted: false };
    pollAbortRef.current = token;
    setStatus('ANALYZING');
    setErrorMessage(null);

    await pollJob({
      jobId: activeJobId,
      token,
      parseResponse: parseApiResponse,
      startError,
      onEvent: (event) => {
        switch (event.type) {
          case 'snapshot':
            setErrorMessage(null);
            setBatches(event.job.batches);
            setSpots(event.job.spots);
            if (event.job.progress_stage) {
              setVadProgress({ stage: event.job.progress_stage, percent: event.job.progress_percent ?? 20 });
            }
            break;
          case 'ready':
            setVadProgress(null);
            setRestoredIncompleteJob(false);
            setStatus('READY');
            setErrorMessage(null);
            break;
          case 'failed':
            setVadProgress(null);
            setStatus('FAILED');
            setErrorMessage(event.message);
            break;
          case 'start-unconfirmed':
            setErrorMessage(event.message);
            break;
          case 'disconnected':
            setVadProgress(null);
            setErrorMessage('ตรวจสถานะการวิเคราะห์ไม่ได้ กำลังลองเชื่อมต่ออีกครั้ง ระหว่างนี้ยังแก้ไขบทบรรยายไม่ได้');
        }
      },
    });
  }, []);

  // 1. Check Browser Compatibility & Active Persisted Job on Mount
  useEffect(() => {
    const clearLegacyHash = () => {
      if (['#main-workspace', '#section-upload-vad', '#section-preview-timeline', '#section-script-editor'].includes(window.location.hash)) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
    };
    clearLegacyHash();
    window.addEventListener('hashchange', clearLegacyHash);
    let mounted = true;
    const restoreToken = { aborted: false };
    pollAbortRef.current = restoreToken;

    checkBrowserCompatibility().then((res) => {
      if (mounted) {
        setBrowserCompat(res);
      }
    });

    fetch('/api/jobs/current')
      .then((r) =>
        r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null
      )
      .then((data) => {
        if (!mounted || restoreToken.aborted || !data?.job) return;
        const savedJob: PersistedJobState = data.job;
        setJobId(savedJob.job_id);
        setVideoMetadata(savedJob.video_metadata);
        setVadOutput(savedJob.vad_output);
        setBatches(savedJob.batches);
        setSpots(savedJob.spots);
        setMode(savedJob.mode ?? 'generate');
        setSrtFileName(savedJob.srt_source?.file_name ?? null);
        const source = savedJob.video_source;
        setVideoUrl(source?.kind === 'url' ? source.url : source?.kind === 'local_file' ? null : `/api/jobs/${savedJob.job_id}/video`);
        if (source?.kind === 'local_file') setMissingLocalVideo({ file_name: source.file_name, file_size: source.file_size });
        if (savedJob.spots.length > 0) {
          setSelectedSpotId(savedJob.spots[0].spot_id);
        }

        const hasIncompleteBatches = savedJob.batches.some((b) => b.status !== 'completed');
        if (data.isRunning) {
          setStatus('ANALYZING');
          if (savedJob.progress_stage) {
            setVadProgress({
              stage: savedJob.progress_stage,
              percent: savedJob.progress_percent ?? 15,
            });
          }
          void pollJobUntilComplete(savedJob.job_id);
        } else if (hasIncompleteBatches) {
          setStatus(savedJob.status === 'FAILED' ? 'FAILED' : 'VAD_READY');
          setRestoredIncompleteJob(true);
          if (savedJob.error_message) {
            setErrorMessage(savedJob.error_message);
          }
        } else {
          setStatus('READY');
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('hashchange', clearLegacyHash);
      mounted = false;
      pollAbortRef.current.aborted = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [pollJobUntilComplete]);

  const leaveCurrentJob = useCallback(() => {
    pollAbortRef.current.aborted = true;
    if (jobId) saveQueue.leave(jobId);
    setJobId(null);
    setVadOutput(null);
    setBatches([]);
    setSpots([]);
    setSelectedSpotId(null);
    setRestoredIncompleteJob(false);
  }, [jobId, saveQueue]);

  const clearVideo = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setVideoFile(null);
    setVideoUrl(null);
    setVideoMetadata(null);
    setValidationIssues([]);
    setCurrentTimeMs(0);
    setMissingLocalVideo(null);
  }, []);

  const handleRelinkLocalVideo = (file: File) => {
    if (!missingLocalVideo) return;
    if (file.name !== missingLocalVideo.file_name || file.size !== missingLocalVideo.file_size) {
      setErrorMessage(`ไฟล์นี้ไม่ใช่วิดีโอเดิมของงาน กรุณาเลือก ${missingLocalVideo.file_name} (${formatFileSize(missingLocalVideo.file_size)})`);
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    objectUrlRef.current = blobUrl;
    setVideoFile(file);
    setVideoUrl(blobUrl);
    setMissingLocalVideo(null);
    setErrorMessage(null);
  };

  const handleProcessReview = useCallback(async (video: File | string, srtFile: File) => {
    const vadInput: ByteSourceInput = typeof video === 'string' ? { kind: 'url', url: video } : { kind: 'file', file: video };
    reviewImportRef.current = null;
    setImportSkipped([]);
    leaveCurrentJob();
    const token = { aborted: false };
    pollAbortRef.current = token;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    clearVideo();
    setErrorMessage(null);
    setVadProgress(null);
    setCheckingFileName(typeof video === 'string' ? video : video.name);
    setStatus('IDLE');

    let source: ByteSource;
    try {
      source = await openByteSource(vadInput);
    } catch (err) {
      if (token.aborted) return;
      setCheckingFileName(null);
      setStatus('FAILED');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    if (token.aborted) return;
    const validation = await validateAndInspectMp4File(source, {
      mode: 'review',
      maxDurationSeconds: REVIEW_MAX_DURATION_MS / 1000,
    });
    if (token.aborted) return;
    setValidationIssues(validation.issues);
    if (!validation.valid || !validation.metadata) {
      setCheckingFileName(null);
      setStatus('FAILED');
      return;
    }

    let spotsFromSrt: ADSpot[];
    let skippedCues: SkippedCue[];
    try {
      const cues = parseSrt(decodeSrtBytes(new Uint8Array(await srtFile.arrayBuffer())));
      ({ spots: spotsFromSrt, skipped: skippedCues } = cuesToSpots(cues, validation.metadata.durationMs));
      if (spotsFromSrt.length === 0) throw new Error('ทุกบรรทัดในไฟล์ SRT เริ่มหลังจากวิดีโอจบแล้ว กรุณาตรวจว่าเลือกไฟล์คู่กันถูกต้อง');
    } catch (err) {
      if (token.aborted) return;
      setCheckingFileName(null);
      setStatus('FAILED');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    if (token.aborted) return;

    setCheckingFileName(null);
    setSrtFileName(srtFile.name);
    setImportSkipped(skippedCues);
    reviewImportRef.current = {
      spots: spotsFromSrt,
      srtFileName: srtFile.name,
      videoSource: typeof video === 'string' ? { kind: 'url', url: video } : { kind: 'local_file', file_name: video.name, file_size: video.size },
      vadInput,
      metadata: validation.metadata,
    };
    setVideoMetadata(validation.metadata);
    if (typeof video === 'string') {
      setVideoUrl(video);
    } else {
      setVideoFile(video);
      const blobUrl = URL.createObjectURL(video);
      objectUrlRef.current = blobUrl;
      setVideoUrl(blobUrl);
    }
    setStatus('VIDEO_READY');
    startVad(vadInput);
  }, [leaveCurrentJob, clearVideo, startVad]);

  // 2. Handle MP4 File Selection & Automatic Built-In VAD Execution
  const handleSelectFile = useCallback(
    async (file: File) => {
      if (videoMetadata && !window.confirm('เปลี่ยนวิดีโอและออกจากงานปัจจุบัน? กรุณาส่งออกบทบรรยายที่ต้องการเก็บไว้ก่อน')) return;
      reviewImportRef.current = null;
      leaveCurrentJob();
      const selectionToken = { aborted: false };
      pollAbortRef.current = selectionToken;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      clearVideo();
      setErrorMessage(null);
      setVadProgress(null);
      setCheckingFileName(file.name);
      setStatus('IDLE');

      const validation = await validateAndInspectMp4File(fileByteSource(file), {
        maxDurationSeconds: FIXED_MAX_VIDEO_DURATION_SECONDS,
        maxFileSizeMb: FIXED_MAX_UPLOAD_SIZE_MB,
      });
      if (selectionToken.aborted) return;

      setCheckingFileName(null);
      setValidationIssues(validation.issues);

      if (validation.valid && validation.metadata) {
        setVideoFile(file);
        setVideoMetadata(validation.metadata);
        const blobUrl = URL.createObjectURL(file);
        objectUrlRef.current = blobUrl;
        setVideoUrl(blobUrl);
        setCurrentTimeMs(0);
        setStatus('VIDEO_READY');
        startVad({ kind: 'file', file });
      } else {
        setVideoUrl(null);
        setStatus('FAILED');
      }
    },
    [videoMetadata, startVad, leaveCurrentJob, clearVideo]
  );

  // 3. Trigger Browser Silero VAD manually if needed
  const handleRunVad = () => {
    const input: ByteSourceInput | undefined = videoFile ? { kind: 'file', file: videoFile } : reviewImportRef.current?.vadInput;
    if (!input || !videoMetadata) return;
    if (spots.some((spot) => spot.is_edited || spot.text.trim()) && !window.confirm('สแกนเสียงใหม่? บทบรรยายและเวลาที่แก้ไว้จะถูกแทนที่ กรุณาส่งออกงานที่ต้องการเก็บก่อน')) return;
    leaveCurrentJob();
    startVad(input);
  };

  // Upload large MP4 videos in 8MB chunks to stay well below Cloud Run's 32MB request body limit
  const uploadVideoInChunks = async (
    file: File,
    token: { aborted: boolean },
    onInitialized: (uploadId: string) => void,
    onProgress: (percent: number, loadedBytes: number, totalBytes: number) => void
  ): Promise<string> => {
    const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    const initRes = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initData = await parseApiResponse<any>(initRes);
    if (!initRes.ok || !initData?.uploadId) {
      throw new Error(initData?.error || 'ไม่สามารถเริ่มต้นเซสชันอัปโหลดไฟล์วิดีโอได้');
    }
    const uploadId: string = initData.uploadId;
    onInitialized(uploadId);
    if (token.aborted) throw new DOMException('Cancelled', 'AbortError');

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkSlice = file.slice(start, end);

      let attempts = 0;
      let success = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastErr: any = null;

      while (attempts < 3 && !success) {
        if (token.aborted) throw new DOMException('Cancelled', 'AbortError');
        try {
          const chunkRes = await fetch(
            `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${i}&totalChunks=${totalChunks}&offset=${start}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: chunkSlice,
            }
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chunkData = await parseApiResponse<any>(chunkRes);
          if (token.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (!chunkRes.ok || !chunkData?.ok) {
            throw new Error(chunkData?.error || `อัปโหลดส่วนที่ ${i + 1}/${totalChunks} ล้มเหลว`);
          }
          success = true;
        } catch (err) {
          if (token.aborted) throw err;
          lastErr = err;
          attempts++;
          if (attempts < 3) {
            await new Promise((r) => setTimeout(r, 1200 * attempts));
          }
        }
      }

      if (!success) {
        throw lastErr || new Error(`ไม่สามารถอัปโหลดไฟล์ส่วนที่ ${i + 1}/${totalChunks} ไปยังเซิร์ฟเวอร์ได้`);
      }

      const loaded = end;
      if (token.aborted) throw new DOMException('Cancelled', 'AbortError');
      const percent = Math.round((loaded / file.size) * 100);
      onProgress(percent, loaded, file.size);
    }

    return uploadId;
  };

  const resumeExistingServerJob = async (existingJobId: string) => {
    const token = pollAbortRef.current;
    try {
      setStatus('ANALYZING');
      setErrorMessage(null);
      setVadProgress({
        stage: 'กำลังรอบันทึกการแก้ไขก่อนดำเนินการต่อ...',
        phase: 'saving-edits',
        percent: 15,
      });

      const saved = await saveQueue.wait();
      if (token.aborted) return;
      if (saved === false) {
        setVadProgress(null);
        setStatus('FAILED');
        setErrorMessage('บันทึกการแก้ไขไม่สำเร็จ กรุณาลองบันทึกอีกครั้งก่อนดำเนินการต่อ');
        return;
      }

      setVadProgress({
        stage: 'กำลังเริ่มประมวลผลชุดข้อมูลต่อบนเซิร์ฟเวอร์...',
        percent: 15,
      });
      let startedJob: PersistedJobState;
      let startError: string | undefined;
      try {
        const startRes = await fetch(`/api/jobs/${encodeURIComponent(existingJobId)}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const startData = await parseApiResponse<{ job?: PersistedJobState; error?: string }>(startRes);
        if (!startRes.ok) {
          startError = startData?.error || 'ไม่สามารถเริ่มงานประมวลผลต่อบนเซิร์ฟเวอร์ได้';
          throw new Error('Start not confirmed');
        }
        if (startData?.job?.job_id !== existingJobId || !Array.isArray(startData.job.batches) || !Array.isArray(startData.job.spots)) {
          throw new Error('Invalid job response');
        }
        startedJob = startData.job;
      } catch {
        if (token.aborted) {
          saveQueue.leave(existingJobId);
          return;
        }
        const polling = pollJobUntilComplete(existingJobId, startError);
        setVadProgress(null);
        setErrorMessage('ยังยืนยันการเริ่มวิเคราะห์ไม่ได้ กำลังตรวจสถานะอีกครั้ง ระหว่างนี้ยังแก้ไขบทบรรยายไม่ได้');
        await polling;
        return;
      }
      if (token.aborted) {
        saveQueue.leave(existingJobId);
        return;
      }

      setBatches(startedJob.batches);
      setSpots(startedJob.spots);
      await pollJobUntilComplete(existingJobId);
    } catch (err) {
      if (token.aborted) return;
      setVadProgress(null);
      setStatus('FAILED');
      setErrorMessage(
        `การเชื่อมต่อเซิร์ฟเวอร์ขัดข้อง: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  // 5. Start Gemini Video Analysis
  const handleStartGeminiAnalysis = async () => {
    if (!vadOutput || !videoMetadata) return;

    if (vadOutput.candidate_spots.length === 0) {
      setStatus('READY');
      return;
    }

    if (jobId && batches.some((b) => b.status !== 'completed')) {
      await resumeExistingServerJob(jobId);
      return;
    }

    if (!videoFile) {
      setErrorMessage('ไม่พบไฟล์วิดีโอต้นทางสำหรับอัปโหลด กรุณาเลือกไฟล์วิดีโออีกครั้ง');
      return;
    }

    if (spots.some((spot) => spot.text.trim()) && !window.confirm('สร้างบทบรรยายใหม่? ข้อความและเวลาที่แก้ไว้อาจถูกแทนที่ กรุณาส่งออกงานที่ต้องการเก็บก่อน')) return;

    pollAbortRef.current.aborted = true;
    const token = { aborted: false };
    pollAbortRef.current = token;
    let uploadId: string | undefined;
    try {
      setStatus('ANALYZING');
      setErrorMessage(null);

      const effectiveVadConfig =
        vadOutput.signal_analysis?.recommendedConfig || DEFAULT_VAD_CONFIG;

      setVadProgress({
        stage: 'กำลังเตรียมส่งข้อมูลวิดีโอไปยังเซิร์ฟเวอร์...',
        percent: 0,
        loadedBytes: 0,
        totalBytes: videoFile.size,
      });

      uploadId = await uploadVideoInChunks(videoFile, token, (id) => { uploadId = id; }, (percent, loadedBytes, totalBytes) => {
        const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        setVadProgress({
          stage: `กำลังอัปโหลดวิดีโอ (${loadedMb} / ${totalMb} MB, ${percent}%)...`,
          percent,
          loadedBytes,
          totalBytes,
        });
      });
      if (token.aborted) return;

      setVadProgress({
        stage: 'กำลังเริ่มต้นงานวิเคราะห์บนเซิร์ฟเวอร์...',
        percent: 8,
      });

      await saveQueue.wait();
      if (token.aborted) return;
      const initRes = await fetch('/api/jobs/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          video_metadata: videoMetadata,
          vad_config: effectiveVadConfig,
          ad_settings: DEFAULT_AD_ANALYSIS_SETTINGS,
          vad_output: vadOutput,
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const initData = await parseApiResponse<any>(initRes);
      if (token.aborted) {
        if (initData?.job?.job_id) {
          void fetch(`/api/jobs/${encodeURIComponent(initData.job.job_id)}`, { method: 'DELETE' }).catch(() => {});
        }
        return;
      }
      if (!initRes.ok || !initData?.job) {
        setVadProgress(null);
        setStatus('FAILED');
        setErrorMessage(
          initData?.error || 'ไม่สามารถลงทะเบียนวิดีโอไปยังเซิร์ฟเวอร์เพื่อวิเคราะห์ได้'
        );
        return;
      }

      const initializedJob: PersistedJobState = initData.job;
      setJobId(initializedJob.job_id);
      setBatches(initializedJob.batches);
      setSpots(initializedJob.spots);

      if (initializedJob.batches.length === 0) {
        setVadProgress(null);
        setStatus('READY');
        return;
      }

      await pollJobUntilComplete(initializedJob.job_id);
    } catch (err) {
      if (token.aborted) {
        if (uploadId) saveQueue.leave(uploadId);
        return;
      }
      setVadProgress(null);
      setStatus('FAILED');
      setErrorMessage(
        `การเชื่อมต่อเซิร์ฟเวอร์ขัดข้อง: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      if (uploadId) {
        void fetch(`/api/upload/${encodeURIComponent(uploadId)}/abandon`, { method: 'POST', keepalive: true }).catch(() => {});
      }
    }
  };

  const handleRetryFailedBatches = async () => {
    if (!jobId) {
      await handleStartGeminiAnalysis();
      return;
    }
    await resumeExistingServerJob(jobId);
  };

  // 6. Select Spot & Seek Video Player
  const handleSelectSpot = useCallback((spotId: string, seekToStart = true) => {
    setSelectedSpotId(spotId);
    if (seekToStart) {
      setSpots((currentSpots) => {
        const target = currentSpots.find((s) => s.spot_id === spotId);
        if (target && videoRef.current) {
          videoRef.current.currentTime = target.start_ms / 1000;
          setCurrentTimeMs(target.start_ms);
        }
        return currentSpots;
      });
    }
  }, []);

  // Keyboard navigation between script spots; playback shortcuts live with the player.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || spots.length === 0) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIdx = spots.findIndex((s) => s.spot_id === selectedSpotId);
        const nextIdx =
          e.key === 'ArrowUp'
            ? Math.max(0, currentIdx <= 0 ? 0 : currentIdx - 1)
            : Math.min(spots.length - 1, currentIdx < 0 ? 0 : currentIdx + 1);
        const targetSpot = spots[nextIdx];
        if (targetSpot) {
          handleSelectSpot(targetSpot.spot_id, true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [spots, selectedSpotId, handleSelectSpot]);

  // 7. Update Spot & Persist to Server JSON
  const handleUpdateSpot = useCallback(
    (updatedSpot: ADSpot) => {
      const nextSpots = spots.map((spot) =>
        spot.spot_id === updatedSpot.spot_id ? updatedSpot : spot
      );
      setSpots(nextSpots);
      if (jobId) saveQueue.save(jobId, nextSpots);
    },
    [jobId, spots, saveQueue]
  );

  // 8. Reset Job
  const handleResetJob = () => {
    if (!window.confirm('เริ่มงานใหม่และออกจากงานปัจจุบัน? กรุณาส่งออกบทบรรยายที่ต้องการเก็บไว้ก่อน')) return;
    reviewImportRef.current = null;
    setImportSkipped([]);
    leaveCurrentJob();
    clearVideo();
    setVadProgress(null);
    setErrorMessage(null);
    setStatus('IDLE');
    setMode(null);
    setSrtFileName(null);
  };

  // 9. Export SRT
  const handleExportSrt = () => {
    const srtContent = generateSrtContent(spots);
    if (!srtContent) return;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'review' && srtFileName
      ? `${srtFileName.replace(/\.srt$/i, '')}_edited.srt`
      : `${(videoMetadata?.fileName || 'video').replace(/\.mp4$/i, '')}_thai_ad.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasProject = Boolean(videoMetadata);
  const processingFeedback = getProcessingFeedback(status, vadProgress, batches, errorMessage);

  return (
    <div className={`min-h-screen flex flex-col bg-canvas text-slate-900 ${hasProject ? 'lg:h-dvh lg:overflow-hidden' : ''}`}>
      <button type="button" onClick={() => workspaceRef.current?.focus()} className="skip-link cursor-pointer">ข้ามไปยังพื้นที่ทำงาน</button>
      <header className="min-h-16 shrink-0 bg-white border-b border-brand-100 px-4 sm:px-6 flex items-center py-3">
        <div className="w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div
            className="inline-flex min-w-0 items-center gap-2.5 text-base font-bold tracking-tight text-slate-900"
          >
            <img src="/logo.svg" alt="" width={36} height={36} className="shrink-0" />
            <span className="leading-tight">AD Script Generator</span>
          </div>

          <div ref={setHeaderActionsElement} className="contents" />
        </div>
      </header>

      {/* Browser Compatibility Blocking Banner */}
      {browserCompat && !browserCompat.supported && (
        <div className="px-4 py-3 border-b border-red-300 bg-red-50 text-red-900 flex items-center gap-3 shrink-0">
          <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
          <div className="text-xs">
            <strong className="font-bold">
              เบราว์เซอร์นี้ไม่รองรับการวิเคราะห์เสียง:
            </strong>{' '}
            {browserCompat.reason} กรุณาเปิดใช้งานด้วย Google Chrome หรือ Microsoft Edge เวอร์ชันล่าสุดบนคอมพิวเตอร์
          </div>
        </div>
      )}

      <main ref={workspaceRef} id="main-workspace" tabIndex={-1} className="flex flex-col flex-1 min-h-0">
      {/* Restored Incomplete Job Resume Banner */}
      {restoredIncompleteJob && jobId && status !== 'ANALYZING' && (
        <div className="px-4 sm:px-6 py-3 border-b border-amber-200 bg-amber-50 text-sm text-amber-950 shrink-0">
          <div>
            <strong className="font-semibold">มีงานวิเคราะห์ที่ยังไม่เสร็จ</strong>
          </div>
        </div>
      )}

      {mode === 'review' && missingLocalVideo && (
        <div role="status" className="px-4 sm:px-6 py-3 border-b border-amber-200 bg-amber-50 text-sm text-amber-950 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 [overflow-wrap:anywhere]">
            <strong className="font-semibold">เลือกวิดีโอเดิมอีกครั้งเพื่อเล่นและดูเทียบ</strong>
            {' · '}{missingLocalVideo.file_name} ({formatFileSize(missingLocalVideo.file_size)}) · ระหว่างนี้ยังแก้บทและส่งออก SRT ได้
          </p>
          <label className="shrink-0 cursor-pointer rounded-md border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100">
            เลือกวิดีโอเดิม
            <input type="file" accept="video/mp4,.mp4" className="sr-only" aria-label="เลือกวิดีโอเดิมของงานนี้" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleRelinkLocalVideo(file); }} />
          </label>
        </div>
      )}

      {mode === 'review' && hasProject && importSkipped.length > 0 && (
        <details className="px-4 sm:px-6 py-3 border-b border-amber-200 bg-amber-50 text-sm text-amber-950 shrink-0">
          <summary className="cursor-pointer font-semibold">ไม่ได้นำเข้า {importSkipped.length} บรรทัดจาก SRT</summary>
          <ul className="mt-2 space-y-1">
            {importSkipped.map(({ cue, reason }, index) => (
              <li key={index} className="[overflow-wrap:anywhere]">
                <span className="font-mono tabular-nums">{formatTimestampDisplay(cue.start_ms)} – {formatTimestampDisplay(cue.end_ms)}</span>
                {' · '}{reason === 'starts_after_video_end' ? 'เริ่มหลังวิดีโอจบ' : 'เวลาจบไม่หลังเวลาเริ่ม'}
                {' · '}{cue.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Top Studio Project & Queue Command Bar */}
      {!hasProject && mode === null ? (
        <ModeChooser headerActionsElement={headerActionsElement} onChoose={(chosen) => { setMode(chosen); setErrorMessage(null); setValidationIssues([]); }} />
      ) : !hasProject && mode === 'review' ? (
        <ReviewIntake
          headerActionsElement={headerActionsElement}
          checkingFileName={checkingFileName}
          errorMessage={errorMessage}
          validationIssues={validationIssues}
          onProcess={handleProcessReview}
          onBack={() => { setMode(null); setErrorMessage(null); setValidationIssues([]); }}
        />
      ) : <UploadAndVadPanel
        mode={mode ?? 'generate'}
        onChangeMode={() => { setMode(null); setErrorMessage(null); setValidationIssues([]); }}
        headerActionsElement={headerActionsElement}
        checkingFileName={checkingFileName}
        processingFeedback={processingFeedback}
        status={status}
        videoFile={videoFile}
        videoMetadata={videoMetadata}
        validationIssues={validationIssues}
        vadOutput={vadOutput}
        batches={batches}
        spots={spots}
        onSelectFile={handleSelectFile}
        onRunVad={handleRunVad}
        onStartGeminiAnalysis={handleStartGeminiAnalysis}
        onRetryFailedBatches={handleRetryFailedBatches}
        onResetJob={handleResetJob}
        onSelectSpot={handleSelectSpot}
        onExportSrt={handleExportSrt}
        errorMessage={errorMessage}
      />}

      {hasProject && <section aria-label="ตรวจและแก้ไขบทบรรยาย" className="flex-1 min-h-0 w-full grid grid-cols-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left Pane: Video Monitor, Caption Strip, Transport & Multi-Track Timeline (6 cols) */}
        <div className="lg:col-span-6 min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 lg:overflow-hidden">
          <VideoPreviewTimeline
            mode={mode ?? 'generate'}
            videoUrl={videoUrl}
            durationMs={vadOutput?.duration_ms || videoMetadata?.durationMs || 0}
            currentTimeMs={currentTimeMs}
            onTimeUpdateMs={setCurrentTimeMs}
            speechSegments={vadOutput?.speech_segments || []}
            waveform={vadOutput?.waveform}
            spots={spots}
            selectedSpotId={selectedSpotId}
            isAnalyzing={status === 'ANALYZING'}
            processingSpotIds={
              status === 'ANALYZING'
                ? new Set(
                    batches
                      .filter((b) => b.status === 'processing')
                      .flatMap((b) => b.candidate_spots.map((s) => s.spot_id))
                  )
                : undefined
            }
            detectProgress={status === 'DETECTING' ? vadProgress : null}
            onSelectSpot={handleSelectSpot}
            onUpdateSpot={handleUpdateSpot}
            videoRef={videoRef}
          />
        </div>

        {/* Right Pane: Full-Height Scrollable AD Script Editor (6 cols) */}
        <div className={`lg:col-span-6 min-h-0 flex flex-col lg:overflow-hidden ${status === 'FAILED' && !vadOutput ? 'order-first lg:order-none' : ''}`}>
          <AdScriptEditor
            spots={spots}
            batches={batches}
            isAnalyzing={status === 'ANALYZING'}
            errorMessage={errorMessage}
            onRetryVad={handleRunVad}
            mode={mode ?? 'generate'}
            emptyState={status === 'DETECTING' || status === 'VIDEO_READY' ? 'preparing' : status === 'FAILED' && !vadOutput ? 'failed' : 'no-gaps'}
            speechSegments={vadOutput?.speech_segments || []}
            videoDurationMs={vadOutput?.duration_ms || videoMetadata?.durationMs || 0}
            selectedSpotId={selectedSpotId}
            currentTimeMs={currentTimeMs}
            onSelectSpot={handleSelectSpot}
            onUpdateSpot={handleUpdateSpot}
            saveStatus={jobId ? saveStatus : 'local'}
            onRetrySave={() => { if (jobId) saveQueue.save(jobId, spots); }}
          />
        </div>
      </section>}
      </main>
    </div>
  );
}
