import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import {
  ADSpot,
  AnalysisBatch,
  DEFAULT_AD_ANALYSIS_SETTINGS,
  DEFAULT_VAD_CONFIG,
  JobStatus,
  PersistedJobState,
  VADOutput,
  VideoMetadata,
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
  generateSrtContent,
} from './utils/formatters';
import { UploadAndVadPanel } from './components/UploadAndVadPanel';
import { VideoPreviewTimeline } from './components/VideoPreviewTimeline';
import { AdScriptEditor } from './components/AdScriptEditor';
import { getProcessingFeedback, type ProcessingProgress } from './utils/processingFeedback';
import { createJobSaveQueue } from './utils/jobSaveQueue';
import { pollJob } from './utils/jobPolling';

const FIXED_MAX_VIDEO_DURATION_SECONDS = 1800; // 30 minutes
const FIXED_MAX_UPLOAD_SIZE_MB = 2000;         // 2 GB
const FIXED_CONTEXT_BEFORE_SECONDS = 20;       // 20s context before
const FIXED_CONTEXT_AFTER_SECONDS = 10;        // 10s context after

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
          percent: data.percent,
          processedMs: data.processedMs,
          totalMs: data.totalMs,
        });
      } else if (data.type === 'COMPLETE') {
        const output: VADOutput = data.vadOutput;
        setVadProgress(null);
        setVadOutput(output);

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
  }, []);

  const startVadForFile = useCallback(
    (file: File) => {
      setErrorMessage(null);
      setStatus('DETECTING');
      setVadProgress({
        stage: 'กำลังถอดรหัสเสียงและตรวจหาช่วงว่างไร้เสียงพูด...',
        percent: 2,
      });

      const worker = getOrCreateWorker();
      worker.postMessage({
        type: 'PROCESS_FILE',
        file,
        vadConfig: DEFAULT_VAD_CONFIG,
        autoTuneOptimal: true,
      });
    },
    [getOrCreateWorker]
  );

  // Helper to safely parse JSON responses or classify transient proxy warmup HTML
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseResponseJson = async <T = any,>(response: Response): Promise<T> => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    const text = await response.text();
    if (response.status === 413) {
      throw new Error(
        'ไฟล์วิดีโอมีขนาดใหญ่เกินกว่าที่เครือข่ายอนุญาตในคำขอเดียว (HTTP 413 Payload Too Large)'
      );
    }
    const lowerText = text.toLowerCase();
    if (lowerText.includes('<!doctype html') || lowerText.includes('<html')) {
      const htmlErr = new Error(
        'เซิร์ฟเวอร์กำลังสลับการเชื่อมต่อชั่วคราว กรุณาลองกดดำเนินการต่ออีกครั้ง'
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (htmlErr as any).isTransientHtml = true;
      throw htmlErr;
    }
    if (!response.ok) {
      throw new Error(
        `เซิร์ฟเวอร์ตอบกลับรหัสข้อผิดพลาด HTTP ${response.status} (${response.statusText || 'Error'})`
      );
    }
    throw new Error(`รูปแบบข้อมูลที่ได้รับจากเซิร์ฟเวอร์ไม่ถูกต้อง: ${text.slice(0, 100)}`);
  };

  const pollJobUntilComplete = useCallback(async (activeJobId: string, startError?: string) => {
    pollAbortRef.current.aborted = true;
    const token = { aborted: false };
    pollAbortRef.current = token;
    setStatus('ANALYZING');
    setErrorMessage(null);

    await pollJob({
      jobId: activeJobId,
      token,
      parseResponse: parseResponseJson,
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
        setVideoUrl(`/api/jobs/${savedJob.job_id}/video`);
        if (savedJob.spots.length > 0) {
          setSelectedSpotId(savedJob.spots[0].spot_id);
        }

        const hasIncompleteBatches = savedJob.batches.some((b) => b.status !== 'completed');
        if (data.isRunning && hasIncompleteBatches) {
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

  // 2. Handle MP4 File Selection & Automatic Built-In VAD Execution
  const handleSelectFile = useCallback(
    async (file: File) => {
      if (videoMetadata && !window.confirm('เปลี่ยนวิดีโอและออกจากงานปัจจุบัน? กรุณาส่งออกบทบรรยายที่ต้องการเก็บไว้ก่อน')) return;
      pollAbortRef.current.aborted = true;
      const selectionToken = { aborted: false };
      pollAbortRef.current = selectionToken;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      setErrorMessage(null);
      setVadProgress(null);
      setVadOutput(null);
      setSpots([]);
      setBatches([]);
      setSelectedSpotId(null);
      setRestoredIncompleteJob(false);

      if (jobId) {
        saveQueue.leave(jobId);
        setJobId(null);
      }

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      setCheckingFileName(file.name);
      setVideoFile(null);
      setVideoMetadata(null);
      setVideoUrl(null);
      setValidationIssues([]);
      setCurrentTimeMs(0);
      setStatus('IDLE');

      const validation = await validateAndInspectMp4File(file, {
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
        startVadForFile(file);
      } else {
        setVideoUrl(null);
        setStatus('FAILED');
      }
    },
    [jobId, videoMetadata, startVadForFile, saveQueue]
  );

  // 3. Trigger Browser Silero VAD manually if needed
  const handleRunVad = () => {
    if (!videoFile || !videoMetadata) return;
    if (spots.some((spot) => spot.is_edited || spot.text.trim()) && !window.confirm('สแกนเสียงใหม่? บทบรรยายและเวลาที่แก้ไว้จะถูกแทนที่ กรุณาส่งออกงานที่ต้องการเก็บก่อน')) return;
    pollAbortRef.current.aborted = true;
    if (jobId) saveQueue.leave(jobId);
    setJobId(null);
    setVadOutput(null);
    setBatches([]);
    setSpots([]);
    setSelectedSpotId(null);
    setRestoredIncompleteJob(false);
    startVadForFile(videoFile);
  };

  // Upload large MP4 videos in 8MB chunks to stay well below Cloud Run's 32MB request body limit
  const uploadVideoInChunks = async (
    file: File,
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
    const initData = await parseResponseJson<any>(initRes);
    if (!initRes.ok || !initData?.uploadId) {
      throw new Error(initData?.error || 'ไม่สามารถเริ่มต้นเซสชันอัปโหลดไฟล์วิดีโอได้');
    }
    const uploadId: string = initData.uploadId;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkSlice = file.slice(start, end);

      let attempts = 0;
      let success = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastErr: any = null;

      while (attempts < 3 && !success) {
        try {
          const chunkRes = await fetch(
            `/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${i}&totalChunks=${totalChunks}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: chunkSlice,
            }
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chunkData = await parseResponseJson<any>(chunkRes);
          if (!chunkRes.ok || !chunkData?.ok) {
            throw new Error(chunkData?.error || `อัปโหลดส่วนที่ ${i + 1}/${totalChunks} ล้มเหลว`);
          }
          success = true;
        } catch (err) {
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
        const startData = await parseResponseJson<{ job?: PersistedJobState; error?: string }>(startRes);
        if (!startRes.ok) {
          startError = startData?.error || 'ไม่สามารถเริ่มงานประมวลผลต่อบนเซิร์ฟเวอร์ได้';
          throw new Error('Start not confirmed');
        }
        if (startData?.job?.job_id !== existingJobId || !Array.isArray(startData.job.batches) || !Array.isArray(startData.job.spots)) {
          throw new Error('Invalid job response');
        }
        startedJob = startData.job;
      } catch {
        if (token.aborted) return;
        const polling = pollJobUntilComplete(existingJobId, startError);
        setVadProgress(null);
        setErrorMessage('ยังยืนยันการเริ่มวิเคราะห์ไม่ได้ กำลังตรวจสถานะอีกครั้ง ระหว่างนี้ยังแก้ไขบทบรรยายไม่ได้');
        await polling;
        return;
      }
      if (token.aborted) return;

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

      const uploadId = await uploadVideoInChunks(videoFile, (percent, loadedBytes, totalBytes) => {
        const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        setVadProgress({
          stage: `กำลังอัปโหลดวิดีโอ (${loadedMb} / ${totalMb} MB, ${percent}%)...`,
          percent,
          loadedBytes,
          totalBytes,
        });
      });

      setVadProgress({
        stage: 'กำลังเริ่มต้นงานวิเคราะห์บนเซิร์ฟเวอร์...',
        percent: 8,
      });

      await saveQueue.wait();
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
      const initData = await parseResponseJson<any>(initRes);
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
      setVadProgress(null);
      setStatus('FAILED');
      setErrorMessage(
        `การเชื่อมต่อเซิร์ฟเวอร์ขัดข้อง: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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

  // Global Keyboard Shortcuts for Script Editors (Alt+Up/Down to step spots, Alt+P to play/pause selected spot)
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
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const vid = videoRef.current;
        if (!vid) return;
        const targetSpot = spots.find((s) => s.spot_id === selectedSpotId);
        if (vid.paused) {
          if (
            targetSpot &&
            (vid.currentTime * 1000 < targetSpot.start_ms ||
              vid.currentTime * 1000 >= targetSpot.end_ms)
          ) {
            vid.currentTime = targetSpot.start_ms / 1000;
          }
          vid.play().catch(() => {});
        } else {
          vid.pause();
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
    pollAbortRef.current.aborted = true;
    if (jobId) {
      saveQueue.leave(jobId);
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setJobId(null);
    setVideoFile(null);
    setVideoUrl(null);
    setVideoMetadata(null);
    setValidationIssues([]);
    setVadOutput(null);
    setVadProgress(null);
    setBatches([]);
    setSpots([]);
    setSelectedSpotId(null);
    setCurrentTimeMs(0);
    setErrorMessage(null);
    setRestoredIncompleteJob(false);
    setStatus('IDLE');
  };

  // 9. Export SRT
  const handleExportSrt = () => {
    const srtContent = generateSrtContent(spots);
    if (!srtContent) return;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const baseName = (videoMetadata?.fileName || 'video').replace(/\.mp4$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_thai_ad.srt`;
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

      {/* Top Studio Project & Queue Command Bar */}
      <UploadAndVadPanel
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
        errorMessage={errorMessage}
      />

      {/* Shared header row keeps both panes aligned when editor controls wrap. */}
      {hasProject && <section aria-label="ตรวจและแก้ไขบทบรรยาย" className="flex-1 min-h-0 w-full grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
        {/* Left Pane: Video Monitor, Transport & Multi-Track Timeline (6 cols) */}
        <div className="lg:col-span-6 min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:overflow-hidden">
          <VideoPreviewTimeline
            videoUrl={videoUrl}
            videoMetadata={videoMetadata}
            durationMs={vadOutput?.duration_ms || videoMetadata?.durationMs || 0}
            currentTimeMs={currentTimeMs}
            onTimeUpdateMs={setCurrentTimeMs}
            speechSegments={vadOutput?.speech_segments || []}
            spots={spots}
            batches={batches}
            selectedSpotId={selectedSpotId}
            onSelectSpot={handleSelectSpot}
            videoRef={videoRef}
          />
        </div>

        {/* Right Pane: Full-Height Scrollable AD Script Editor (6 cols) */}
        <div className={`lg:col-span-6 min-h-0 flex flex-col lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:overflow-hidden ${status === 'FAILED' && !vadOutput ? 'order-first lg:order-none' : ''}`}>
          <AdScriptEditor
            spots={spots}
            batches={batches}
            isAnalyzing={status === 'ANALYZING'}
            errorMessage={errorMessage}
            onRetryVad={handleRunVad}
            emptyState={status === 'DETECTING' || status === 'VIDEO_READY' ? 'preparing' : status === 'FAILED' && !vadOutput ? 'failed' : 'no-gaps'}
            speechSegments={vadOutput?.speech_segments || []}
            videoDurationMs={vadOutput?.duration_ms || videoMetadata?.durationMs || 0}
            selectedSpotId={selectedSpotId}
            currentTimeMs={currentTimeMs}
            onSelectSpot={handleSelectSpot}
            onUpdateSpot={handleUpdateSpot}
            onExportSrt={handleExportSrt}
            saveStatus={jobId ? saveStatus : 'local'}
            onRetrySave={() => { if (jobId) saveQueue.save(jobId, spots); }}
          />
        </div>
      </section>}
      </main>
    </div>
  );
}
