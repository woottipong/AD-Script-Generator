import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertOctagon, Check, PlayCircle } from 'lucide-react';
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
  buildAnalysisBatches,
  generateJsonExportContent,
  generateSrtContent,
} from './utils/formatters';
import { UploadAndVadPanel } from './components/UploadAndVadPanel';
import { VideoPreviewTimeline } from './components/VideoPreviewTimeline';
import { AdScriptEditor } from './components/AdScriptEditor';

const FIXED_MAX_VIDEO_DURATION_SECONDS = 1800; // 30 minutes
const FIXED_MAX_UPLOAD_SIZE_MB = 2000;         // 2 GB
const FIXED_ANALYSIS_BATCH_SECONDS = 120;      // 120s per batch
const FIXED_CONTEXT_BEFORE_SECONDS = 20;       // 20s context before
const FIXED_CONTEXT_AFTER_SECONDS = 10;        // 10s context after

export default function App() {
  const [browserCompat, setBrowserCompat] = useState<BrowserCompatibilityResult | null>(null);
  const [status, setStatus] = useState<JobStatus>('IDLE');
  const [jobId, setJobId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [validationIssues, setValidationIssues] = useState<VideoValidationIssue[]>([]);

  const [vadOutput, setVadOutput] = useState<VADOutput | null>(null);
  const [vadProgress, setVadProgress] = useState<{
    stage: string;
    percent: number;
    processedMs?: number;
    totalMs?: number;
  } | null>(null);

  const [batches, setBatches] = useState<AnalysisBatch[]>([]);
  const [spots, setSpots] = useState<ADSpot[]>([]);
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState<boolean>(false);
  const [restoredIncompleteJob, setRestoredIncompleteJob] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pollAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const saveQueueRef = useRef<Promise<boolean | void>>(Promise.resolve());
  const saveRequestRef = useRef(0);

  const leaveServerJob = useCallback((activeJobId: string) => {
    saveRequestRef.current++;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}`, { method: 'DELETE' }).catch(() => {});
    });
  }, []);

  useEffect(() => {
    saveRequestRef.current++;
    setSaveStatus('saved');
  }, [jobId]);

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
          FIXED_ANALYSIS_BATCH_SECONDS,
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

  // Poll Server Background Job Until Complete (no long-held HTTP connections)
  const pollJobUntilComplete = useCallback(async (activeJobId: string) => {
    pollAbortRef.current.aborted = true;
    const token = { aborted: false };
    pollAbortRef.current = token;

    setStatus('ANALYZING');
    setErrorMessage(null);

    let consecutiveErrors = 0;
    let idlePollsWithoutRunner = 0;
    let autoResumedOnce = false;

    while (!token.aborted) {
      await new Promise((r) => setTimeout(r, 1400));
      if (token.aborted) return;

      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await parseResponseJson<any>(res);
        if (token.aborted) return;

        if (!res.ok || data?.job?.job_id !== activeJobId || !Array.isArray(data.job.batches) || !Array.isArray(data.job.spots)) {
          throw new Error(data?.error || 'ไม่พบสถานะงานประมวลผลบนเซิร์ฟเวอร์');
        }

        consecutiveErrors = 0;
        setErrorMessage(null);
        const liveJob: PersistedJobState = data.job;
        const isRunning = Boolean(data.isRunning);

        setBatches(liveJob.batches);
        setSpots(liveJob.spots);

        if (liveJob.progress_stage) {
          setVadProgress({
            stage: liveJob.progress_stage,
            percent: liveJob.progress_percent ?? 20,
          });
        }

        const allDone =
          liveJob.status === 'READY' ||
          (liveJob.batches.length > 0 &&
            liveJob.batches.every((b) => b.status === 'completed'));

        if (allDone) {
          setVadProgress(null);
          setRestoredIncompleteJob(false);
          setStatus('READY');
          setErrorMessage(null);
          return;
        }

        if (liveJob.status === 'FAILED') {
          setVadProgress(null);
          setStatus('FAILED');
          setErrorMessage(
            liveJob.error_message || 'เกิดข้อผิดพลาดระหว่างการวิเคราะห์วิดีโอด้วย Gemini'
          );
          return;
        }

        // If server restarted mid-job and is no longer actively running, auto-resume once
        if (!isRunning) {
          idlePollsWithoutRunner++;
          if (idlePollsWithoutRunner >= 2 && !autoResumedOnce) {
            autoResumedOnce = true;
            idlePollsWithoutRunner = 0;
            await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }).catch(() => {});
          }
        } else {
          idlePollsWithoutRunner = 0;
        }
      } catch {
        if (token.aborted) return;
        consecutiveErrors++;
        if (consecutiveErrors === 6) {
          setVadProgress(null);
          setErrorMessage('ตรวจสถานะการวิเคราะห์ไม่ได้ กำลังลองเชื่อมต่ออีกครั้ง ระหว่างนี้ยังแก้ไขบทบรรยายไม่ได้');
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }, []);

  // 1. Check Browser Compatibility & Active Persisted Job on Mount
  useEffect(() => {
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
        leaveServerJob(jobId);
        setJobId(null);
      }

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      setVideoFile(file);

      const validation = await validateAndInspectMp4File(file, {
        maxDurationSeconds: FIXED_MAX_VIDEO_DURATION_SECONDS,
        maxFileSizeMb: FIXED_MAX_UPLOAD_SIZE_MB,
      });
      if (selectionToken.aborted) return;

      setVideoMetadata(validation.metadata);
      setValidationIssues(validation.issues);

      if (validation.valid && validation.metadata) {
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
    [jobId, videoMetadata, startVadForFile, leaveServerJob]
  );

  // Load bundled 480p sample MP4 video
  const handleLoadSampleVideo = async () => {
    pollAbortRef.current.aborted = true;
    const sampleToken = { aborted: false };
    pollAbortRef.current = sampleToken;
    try {
      setIsLoadingSample(true);
      setErrorMessage(null);
      const res = await fetch('/samples/sample_480p.mp4');
      if (!res.ok) {
        throw new Error('ไม่สามารถโหลดไฟล์วิดีโอตัวอย่าง 480p ได้');
      }
      const blob = await res.blob();
      if (sampleToken.aborted) return;
      const sampleFile = new File([blob], 'sample_480p_scene.mp4', { type: 'video/mp4' });
      await handleSelectFile(sampleFile);
    } catch (err) {
      if (!sampleToken.aborted) setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingSample(false);
    }
  };

  // 3. Trigger Browser Silero VAD manually if needed
  const handleRunVad = () => {
    if (!videoFile || !videoMetadata) return;
    if (spots.some((spot) => spot.is_edited || spot.text.trim()) && !window.confirm('สแกนเสียงใหม่? บทบรรยายและเวลาที่แก้ไว้จะถูกแทนที่ กรุณาส่งออกงานที่ต้องการเก็บก่อน')) return;
    pollAbortRef.current.aborted = true;
    if (jobId) leaveServerJob(jobId);
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

      const saved = await saveQueueRef.current;
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
      let startRes: Response;
      let startData: { job?: PersistedJobState; error?: string };
      try {
        startRes = await fetch(`/api/jobs/${encodeURIComponent(existingJobId)}/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        startData = await parseResponseJson(startRes);
        if (startRes.ok && (startData.job?.job_id !== existingJobId || !Array.isArray(startData.job.batches) || !Array.isArray(startData.job.spots))) {
          throw new Error('Invalid job response');
        }
      } catch {
        if (token.aborted) return;
        const polling = pollJobUntilComplete(existingJobId);
        setVadProgress(null);
        setErrorMessage('ยังยืนยันการเริ่มวิเคราะห์ไม่ได้ กำลังตรวจสถานะอีกครั้ง ระหว่างนี้ยังแก้ไขบทบรรยายไม่ได้');
        await polling;
        return;
      }
      if (token.aborted) return;
      if (!startRes.ok || !startData?.job) {
        setVadProgress(null);
        setStatus('FAILED');
        setErrorMessage(
          startData?.error || 'ไม่สามารถเริ่มงานประมวลผลต่อบนเซิร์ฟเวอร์ได้'
        );
        return;
      }

      setBatches(startData.job.batches);
      setSpots(startData.job.spots);
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
      });

      const uploadId = await uploadVideoInChunks(videoFile, (percent, loadedBytes, totalBytes) => {
        const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        setVadProgress({
          stage: `กำลังอัปโหลดวิดีโอ (${loadedMb} / ${totalMb} MB, ${percent}%)...`,
          percent: Math.min(95, percent),
        });
      });

      setVadProgress({
        stage: 'กำลังเริ่มต้นงานวิเคราะห์บนเซิร์ฟเวอร์...',
        percent: 8,
      });

      await saveQueueRef.current;
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

  // Serialize saves so a slower earlier request cannot overwrite a later edit.
  const persistSpots = useCallback((activeJobId: string, nextSpots: ADSpot[]) => {
    const request = ++saveRequestRef.current;
    setSaveStatus('saving');
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (request !== saveRequestRef.current) return;
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(activeJobId)}/spots`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spots: nextSpots }),
        });
        if (!response.ok) throw new Error('Save failed');
        const data = await response.json() as { job?: PersistedJobState };
        if (data.job?.job_id !== activeJobId) throw new Error('Save not acknowledged');
        if (request === saveRequestRef.current) setSaveStatus('saved');
        return true;
      } catch {
        if (request === saveRequestRef.current) setSaveStatus('error');
        return false;
      }
    });
  }, []);

  // 7. Update Spot & Persist to Server JSON
  const handleUpdateSpot = useCallback(
    (updatedSpot: ADSpot) => {
      const nextSpots = spots.map((spot) =>
        spot.spot_id === updatedSpot.spot_id ? updatedSpot : spot
      );
      setSpots(nextSpots);
      if (jobId) persistSpots(jobId, nextSpots);
    },
    [jobId, spots, persistSpots]
  );

  // 8. Reset Job
  const handleResetJob = () => {
    if (!window.confirm('เริ่มงานใหม่และออกจากงานปัจจุบัน? กรุณาส่งออกบทบรรยายที่ต้องการเก็บไว้ก่อน')) return;
    pollAbortRef.current.aborted = true;
    if (jobId) {
      leaveServerJob(jobId);
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

  // 9. Export SRT & JSON
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

  const handleExportJson = () => {
    if (!videoMetadata) return;
    const durationMs = vadOutput?.duration_ms || videoMetadata.durationMs || 0;
    const effectiveVadConfig =
      vadOutput?.signal_analysis?.recommendedConfig || DEFAULT_VAD_CONFIG;
    const jsonContent = generateJsonExportContent({
      videoMetadata,
      vadConfig: effectiveVadConfig,
      durationMs,
      speechSegments: vadOutput?.speech_segments || [],
      candidateSpots: vadOutput?.candidate_spots || [],
      spots,
    });
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const baseName = (videoMetadata.fileName || 'video').replace(/\.mp4$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_ad_result.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasProject = Boolean(videoMetadata);
  const workflowStep = status === 'READY' ? 2 : hasProject ? 1 : 0;

  return (
    <div className={`min-h-screen flex flex-col bg-slate-100 text-slate-900 ${hasProject ? 'lg:h-dvh lg:overflow-hidden' : ''}`}>
      <a href={hasProject ? '#section-script-editor' : '#section-upload-vad'} className="skip-link">ข้ามไปยังพื้นที่ทำงาน</a>
      <header className="min-h-16 shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center py-3">
        <div className="w-full flex items-center justify-between gap-4">
          <a
            href="#section-upload-vad"
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            AD Script Studio
          </a>

          {hasProject ? <nav aria-label="พื้นที่ทำงาน" className="flex items-center gap-4 text-sm font-medium text-slate-600">
            <a
              href="#section-preview-timeline"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              วิดีโอ
            </a>
            <a
              href="#section-script-editor"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              บทบรรยาย
            </a>
          </nav> : <span className="hidden sm:block text-sm text-slate-600">สร้างบทบรรยายภาพภาษาไทยจากวิดีโอ</span>}
        </div>
      </header>

      <ol aria-label="ขั้นตอนสร้างบทบรรยาย" className="grid grid-cols-3 gap-2 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 shrink-0">
        {['เลือกวิดีโอ', 'สร้างบทบรรยาย', 'ตรวจและส่งออก'].map((label, index) => (
          <li key={label} aria-current={workflowStep === index ? 'step' : undefined} className={`flex flex-col sm:flex-row items-center gap-2 text-center sm:text-left text-xs sm:text-sm ${workflowStep === index ? 'text-emerald-800 font-semibold' : 'text-slate-600'}`}>
            <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs ${workflowStep >= index ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {workflowStep > index ? <Check className="w-4 h-4" aria-hidden="true" /> : index + 1}
            </span>
            <span className="whitespace-nowrap">{label}</span>
          </li>
        ))}
      </ol>

      {/* Browser Compatibility Blocking Banner */}
      {browserCompat && !browserCompat.supported && (
        <div className="px-4 py-3 border-b border-red-300 bg-red-50 text-red-900 flex items-center gap-3 shrink-0">
          <AlertOctagon className="w-4 h-4 text-red-600 shrink-0" />
          <div className="text-xs">
            <strong className="font-bold">
              เบราว์เซอร์ไม่รองรับการถอดรหัสเสียง WebCodecs AudioDecoder:
            </strong>{' '}
            {browserCompat.reason} กรุณาเปิดใช้งานด้วย Google Chrome หรือ Microsoft Edge เวอร์ชันล่าสุดบนคอมพิวเตอร์
          </div>
        </div>
      )}

      {/* Restored Incomplete Job Resume Banner */}
      {restoredIncompleteJob && jobId && status !== 'ANALYZING' && (
        <div className="px-4 py-2 border-b border-amber-300 bg-amber-50 text-slate-900 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="text-xs">
            <strong className="font-semibold">พบคิวงานที่ค้างอยู่:</strong>{' '}
            ไฟล์ <span className="font-mono">{videoMetadata?.fileName}</span> วิเคราะห์สำเร็จแล้ว{' '}
            <span className="font-mono tabular-nums font-semibold">
              {batches.filter((b) => b.status === 'completed').length}/{batches.length}
            </span>{' '}
            ชุด กดเพื่อดำเนินการต่อจากชุดที่ค้างได้ทันที
          </div>
          <button
            type="button"
            onClick={handleRetryFailedBatches}
            className="px-3 py-1 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PlayCircle className="w-3.5 h-3.5" />
            <span>ทำต่อจากชุดที่ค้าง</span>
          </button>
        </div>
      )}

      {/* Top Studio Project & Queue Command Bar */}
      <UploadAndVadPanel
        status={status}
        videoFile={videoFile}
        videoMetadata={videoMetadata}
        validationIssues={validationIssues}
        vadOutput={vadOutput}
        vadProgress={vadProgress}
        batches={batches}
        spots={spots}
        onSelectFile={handleSelectFile}
        onLoadSampleVideo={handleLoadSampleVideo}
        isLoadingSample={isLoadingSample}
        onRunVad={handleRunVad}
        onStartGeminiAnalysis={handleStartGeminiAnalysis}
        onRetryFailedBatches={handleRetryFailedBatches}
        onResetJob={handleResetJob}
        onSelectSpot={handleSelectSpot}
        errorMessage={errorMessage}
      />

      {/* Full-Screen Split-Pane NLE Workstation */}
      {hasProject && <main aria-label="ตรวจและแก้ไขบทบรรยาย" className="flex-1 min-h-0 w-full grid grid-cols-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left Pane: Video Monitor, Transport & Multi-Track Timeline (6 cols) */}
        <div className="lg:col-span-6 min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 lg:overflow-hidden">
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

        {/* Right Pane: Full-Height Scrollable AD Script Editor & SRT Preview (6 cols) */}
        <div className="lg:col-span-6 min-h-0 flex flex-col lg:overflow-hidden">
          <AdScriptEditor
            spots={spots}
            batches={batches}
            isAnalyzing={status === 'ANALYZING'}
            emptyState={status === 'DETECTING' || status === 'VIDEO_READY' ? 'preparing' : status === 'FAILED' && !vadOutput ? 'failed' : 'no-gaps'}
            speechSegments={vadOutput?.speech_segments || []}
            videoDurationMs={vadOutput?.duration_ms || videoMetadata?.durationMs || 0}
            selectedSpotId={selectedSpotId}
            currentTimeMs={currentTimeMs}
            onSelectSpot={handleSelectSpot}
            onUpdateSpot={handleUpdateSpot}
            onExportSrt={handleExportSrt}
            onExportJson={handleExportJson}
            saveStatus={jobId ? saveStatus : 'local'}
            onRetrySave={() => { if (jobId) persistSpots(jobId, spots); }}
          />
        </div>
      </main>}
    </div>
  );
}
