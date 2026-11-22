import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren } from 'react';
import { AlertOctagon, Check, ChevronDown, FileVideo, Info, ListX, SearchX, TriangleAlert, WifiOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  formatCompactTime,
  formatFileSize,
  formatTimestampDisplay,
  generateSrtContent,
} from './utils/formatters';
import { JobList } from './components/JobList';
import { AccountMenu } from './components/AccountMenu';
import {
  EditorHeaderActionsSkeleton,
  EditorHeaderTitleSkeleton,
  EditorWorkspaceSkeleton,
} from './components/EditorSkeleton';
import { IntakeSkeleton, type GenerateDraft, type IntakeControls, type ReviewDraft } from './components/IntakeShell';
import { useConfirm } from './components/ConfirmDialog';
import { cuesToSpots, decodeSrtBytes, parseSrt, type SkippedCue } from './utils/srtImport';
import { fileByteSource, openByteSource, type ByteSource, type ByteSourceInput } from './utils/byteSource';
import { getProcessingFeedback, type ProcessingProgress } from './utils/processingFeedback';
import { parseApiResponse } from './utils/apiResponse';
import { defaultJobTitle, resolveJobTitle } from './utils/jobValidation';
import { createJobSaveQueue } from './utils/jobSaveQueue';
import { pollJob } from './utils/jobPolling';
import { jobIdFromPath, jobPath } from './utils/jobPath';

const loadReviewIntake = () => import('./components/ReviewIntake').then((module) => ({ default: module.ReviewIntake }));
const ReviewIntake = lazy(loadReviewIntake);
const UploadAndVadPanel = lazy(() => import('./components/UploadAndVadPanel').then((m) => ({ default: m.UploadAndVadPanel })));
const VideoPreviewTimeline = lazy(() => import('./components/VideoPreviewTimeline').then((m) => ({ default: m.VideoPreviewTimeline })));
const AdScriptEditor = lazy(() => import('./components/AdScriptEditor').then((m) => ({ default: m.AdScriptEditor })));

class WorkspaceLoadBoundary extends Component<PropsWithChildren<{ onReady: (element: HTMLElement | null) => void }>, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Empty ref={this.props.onReady} role="alert" className="mx-auto my-14 w-[calc(100%-2rem)] max-w-xl">
        <EmptyHeader>
          <EmptyMedia variant="icon"><WifiOff aria-hidden="true" /></EmptyMedia>
          <EmptyTitle><h1 className="text-xl font-semibold text-foreground">โหลดพื้นที่ทำงานไม่สำเร็จ</h1></EmptyTitle>
          <EmptyDescription>ตรวจการเชื่อมต่อ แล้วลองโหลดหน้านี้อีกครั้ง</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="lg" onClick={() => window.location.reload()}>โหลดหน้าใหม่</Button>
        </EmptyContent>
      </Empty>
    );
  }
}

const FIXED_MAX_VIDEO_DURATION_SECONDS = 1800; // 30 minutes
const FIXED_MAX_UPLOAD_SIZE_MB = 2000;         // 2 GB
const FIXED_CONTEXT_BEFORE_SECONDS = 20;       // 20s context before
const FIXED_CONTEXT_AFTER_SECONDS = 10;        // 10s context after

/** A Review Mode Job the author cancelled while the server was creating it would otherwise stay in storage unasked. */
function discardCreatedJob(jobId: string): void {
  void fetch(`/api/jobs/${encodeURIComponent(jobId)}/files`, { method: 'DELETE' })
    .then((response) => { if (!response.ok) console.error(`Could not discard cancelled job ${jobId}: HTTP ${response.status}`); })
    .catch((err) => console.error(`Could not discard cancelled job ${jobId}:`, err));
}

/** An unfinished upload whose VAD or video transfer failed or was cancelled must not remain in storage. */
function discardUnfinishedUpload(uploadId: string): void {
  void fetch(`/api/upload/${encodeURIComponent(uploadId)}/abandon`, { method: 'POST', keepalive: true })
    .then(() => fetch(`/api/jobs/${encodeURIComponent(uploadId)}/files`, { method: 'DELETE', keepalive: true }))
    .catch(() => {});
}

// Upload large MP4 videos in 8MB chunks to stay well below Cloud Run's 32MB request body limit
async function uploadVideoInChunks(
  file: File,
  token: { aborted: boolean },
  onInitialized: (uploadId: string) => void,
  onProgress: (percent: number, loadedBytes: number, totalBytes: number) => void
): Promise<string> {
  if (token.aborted) throw new DOMException('Cancelled', 'AbortError');
  const CHUNK_SIZE = 8 * 1024 * 1024;
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
  const initData = await parseApiResponse<{ uploadId?: string; error?: string }>(initRes);
  if (!initRes.ok || !initData?.uploadId) {
    throw new Error(initData?.error || 'ไม่สามารถเริ่มต้นเซสชันอัปโหลดไฟล์วิดีโอได้');
  }
  const uploadId = initData.uploadId;
  onInitialized(uploadId);
  if (token.aborted) throw new DOMException('Cancelled', 'AbortError');

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkSlice = file.slice(start, end);

    let attempts = 0;
    let success = false;
    let lastErr: unknown = null;

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
        const chunkData = await parseApiResponse<{ ok?: boolean; error?: string }>(chunkRes);
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
}

/** An SRT waiting for its video's audio scan to finish before it becomes a Review Mode Job. */
type ReviewImport = { spots: ADSpot[]; srtFileName: string; videoSource: VideoSource; vadInput: ByteSourceInput; metadata: VideoMetadata };
type GenerateIntake = { file: File; metadata: VideoMetadata };
type TitleEditor =
  | { kind: 'display' }
  | { kind: 'editing' | 'queued' | 'saving'; draft: string }
  | { kind: 'error'; draft: string; message: string };
const EMPTY_GENERATE_DRAFT: GenerateDraft = { file: null, title: null };
const EMPTY_REVIEW_DRAFT: ReviewDraft = { video: null, srt: null, link: '', title: null };

export default function App() {
  const [browserCompat, setBrowserCompat] = useState<BrowserCompatibilityResult | null>(null);
  const [signedInAuthor, setSignedInAuthor] = useState<{ email: string; name?: string; allJobs: boolean; accessGroups?: string[] } | null>(null);
  const [status, setStatus] = useState<JobStatus>('IDLE');
  const [jobId, setJobId] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [headerActionsElement, setHeaderActionsElement] = useState<HTMLDivElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const jobTitleRef = useRef('');
  const [jobTitle, setJobTitleState] = useState('');
  const setJobTitle = useCallback((title: string) => {
    jobTitleRef.current = title;
    setJobTitleState(title);
  }, []);
  const [titleEditor, setTitleEditor] = useState<TitleEditor>({ kind: 'display' });
  const [titleAcknowledgement, setTitleAcknowledgement] = useState<'server' | 'local' | null>(null);
  const [showSavedCheck, setShowSavedCheck] = useState(false);

  useEffect(() => {
    if (titleAcknowledgement !== 'server') {
      setShowSavedCheck(false);
      return;
    }
    setShowSavedCheck(true);
    const timer = window.setTimeout(() => setShowSavedCheck(false), 2_500);
    return () => window.clearTimeout(timer);
  }, [titleAcknowledgement, jobTitle]);
  const [showVideoSummary, setShowVideoSummary] = useState(false);
  const workspaceVersion = useRef(0);
  const [registeringJob, setRegisteringJob] = useState(false);
  const registration = useRef<object | null>(null);
  const titleSave = useRef<Promise<boolean> | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const restoreTitleFocus = useRef(false);
  /** The author named this not-yet-created Job, so a newly chosen video must not rename it. */
  const titleTypedRef = useRef(false);
  const [validationIssues, setValidationIssues] = useState<VideoValidationIssue[]>([]);
  const [checkingFileName, setCheckingFileName] = useState<string | null>(null);
  const [generateDraft, setGenerateDraft] = useState(EMPTY_GENERATE_DRAFT);
  const [reviewDraft, setReviewDraft] = useState(EMPTY_REVIEW_DRAFT);
  const [generateSaveFailure, setGenerateSaveFailure] = useState<{ input: GenerateIntake; output: VADOutput } | null>(null);

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
  /** `/` is the Job List, `/new` starts a Job, `/jobs/:jobId` opens one. */
  const [path, setPath] = useState(() => window.location.pathname);
  const [jobLoad, setJobLoad] = useState<'loading' | 'missing' | 'failed' | null>(() => (jobIdFromPath(window.location.pathname) ? 'loading' : null));
  const intakeModeButton = useRef<HTMLButtonElement | null>(null);
  const restoreIntakeModeFocus = useRef(false);
  const intakeCheckAbort = useRef<AbortController | null>(null);
  const reviewImportRef = useRef<ReviewImport | null>(null);
  const generateIntakeRef = useRef<GenerateIntake | null>(null);
  const pendingLocalSpotsRef = useRef<ADSpot[] | null>(null);
  const relinkInputRef = useRef<HTMLInputElement | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const focusOpenedJob = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pollAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const [saveQueue] = useState(() => createJobSaveQueue(setSaveStatus));
  const [confirm, confirmDialog] = useConfirm();
  const [isSwitchingMode, startModeTransition] = useTransition();

  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  useEffect(() => {
    saveQueue.invalidate();
    const dirtySpots = pendingLocalSpotsRef.current;
    pendingLocalSpotsRef.current = null;
    if (jobId && dirtySpots) {
      saveQueue.save(jobId, dirtySpots);
    } else {
      setSaveStatus('saved');
    }
  }, [jobId, saveQueue]);

  const registerJob = useCallback(async (endpoint: string, body: object, token: { aborted: boolean }) => {
    const request = {};
    registration.current = request;
    setRegisteringJob(true);
    try {
      if (titleSave.current) await titleSave.current;
      if (token.aborted) throw new DOMException('Cancelled', 'AbortError');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, title: jobTitleRef.current }),
      });
      const data = await parseApiResponse<{ job?: PersistedJobState; error?: string }>(response);
      return { response, data };
    } finally {
      if (registration.current === request) {
        registration.current = null;
        setRegisteringJob(false);
      }
    }
  }, []);

  const acknowledgeJobTitle = useCallback((title: string) => {
    setJobTitle(title);
    titleTypedRef.current = false;
    setTitleAcknowledgement((current) => current === 'local' ? 'server' : current);
  }, [setJobTitle]);

  const createReviewJob = useCallback(async (review: ReviewImport, output: VADOutput) => {
    const token = pollAbortRef.current;
    try {
      const { response, data } = await registerJob('/api/jobs/review', {
        video_metadata: review.metadata,
        vad_config: output.signal_analysis?.recommendedConfig || DEFAULT_VAD_CONFIG,
        vad_output: output,
        video_source: review.videoSource,
        srt_source: { file_name: review.srtFileName, cue_count: review.spots.length },
        spots: review.spots,
      }, token);
      if (token.aborted) {
        if (data?.job?.job_id) discardCreatedJob(data.job.job_id);
        return;
      }
      if (!response.ok || !data?.job) throw new Error(data?.error || 'บันทึกงานตรวจแก้ SRT บนเซิร์ฟเวอร์ไม่สำเร็จ');
      setJobId(data.job.job_id);
      acknowledgeJobTitle(data.job.title);
      navigate(jobPath(data.job.job_id));
    } catch (err) {
      if (token.aborted) return;
      setErrorMessage(`${err instanceof Error ? err.message : String(err)} การแก้ไขจะอยู่ในหน้านี้เท่านั้น กรุณาส่งออก SRT ก่อนปิดหน้า`);
    }
  }, [acknowledgeJobTitle, navigate, registerJob]);

  const createGenerateJob = useCallback(async (generate: GenerateIntake, output: VADOutput) => {
    const token = pollAbortRef.current;
    if (token.aborted) return;
    pendingLocalSpotsRef.current = null;
    setGenerateSaveFailure(null);
    let uploadId: string | undefined;
    let createdJob = false;
    try {
      const effectiveVadConfig = output.signal_analysis?.recommendedConfig || DEFAULT_VAD_CONFIG;
      setVadProgress({
        stage: 'กำลังบันทึกวิดีโอลงเซิร์ฟเวอร์...',
        percent: 0,
        loadedBytes: 0,
        totalBytes: generate.file.size,
      });

      uploadId = await uploadVideoInChunks(
        generate.file,
        token,
        (id) => { uploadId = id; },
        (percent, loadedBytes, totalBytes) => {
          setVadProgress({
            stage: 'กำลังบันทึกวิดีโอลงเซิร์ฟเวอร์...',
            percent,
            loadedBytes,
            totalBytes,
          });
        }
      );
      if (token.aborted) {
        if (uploadId) discardUnfinishedUpload(uploadId);
        return;
      }

      setVadProgress({ stage: 'กำลังบันทึกงาน', phase: 'saving-job', percent: 0 });
      const { response: initRes, data: initData } = await registerJob('/api/jobs/init', {
        uploadId,
        autoStart: false,
        video_metadata: generate.metadata,
        vad_config: effectiveVadConfig,
        ad_settings: DEFAULT_AD_ANALYSIS_SETTINGS,
        vad_output: output,
      }, token);
      if (token.aborted) {
        if (initData?.job?.job_id) discardCreatedJob(initData.job.job_id);
        else if (uploadId) discardUnfinishedUpload(uploadId);
        return;
      }
      if (!initRes.ok || !initData?.job) {
        throw new Error(initData?.error || 'ไม่สามารถบันทึกวิดีโอและสร้างงานบนเซิร์ฟเวอร์ได้');
      }

      createdJob = true;
      const savedJob = initData.job;
      setVadProgress(null);
      setVadOutput(output);
      setJobId(savedJob.job_id);
      acknowledgeJobTitle(savedJob.title);
      setSpots(savedJob.spots);
      setBatches(savedJob.batches);
      setSelectedSpotId(savedJob.spots[0]?.spot_id || null);
      setStatus(savedJob.status);
      setErrorMessage(null);
      navigate(jobPath(savedJob.job_id));
    } catch (err) {
      if (!createdJob && uploadId) {
        discardUnfinishedUpload(uploadId);
      }
      if (token.aborted) return;
      setVadProgress(null);
      setVadOutput(null);
      setSpots([]);
      setBatches([]);
      setSelectedSpotId(null);
      setGenerateSaveFailure({ input: generate, output });
      setStatus('FAILED');
      setErrorMessage(`บันทึกงานบนเซิร์ฟเวอร์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [acknowledgeJobTitle, navigate, registerJob]);

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

        const review = reviewImportRef.current;
        if (review) {
          reviewImportRef.current = null;
          setVadProgress(null);
          setVadOutput(output);
          setSpots(review.spots);
          setBatches([]);
          setSelectedSpotId(review.spots[0]?.spot_id || null);
          setStatus('READY');
          setErrorMessage(null);
          void createReviewJob(review, output);
          return;
        }

        const generate = generateIntakeRef.current;
        if (generate) {
          void createGenerateJob(generate, output);
          return;
        }

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
  }, [createReviewJob, createGenerateJob]);

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

  // Opens the Job named by the URL, picking up its analysis if the server is still running it.
  const restoreJob = useCallback((restoreJobId: string) => {
    pendingLocalSpotsRef.current = null;
    const token = { aborted: false };
    pollAbortRef.current = token;
    setJobLoad('loading');
    fetch(`/api/jobs/${encodeURIComponent(restoreJobId)}`)
      .then((r) => {
        if (r.status === 404) return 'missing' as const;
        if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (token.aborted) return;
        if (data === 'missing') { setJobLoad('missing'); return; }
        if (!data?.job) throw new Error('Invalid job response');
        setJobLoad(null);
        const savedJob: PersistedJobState = data.job;
        setJobId(savedJob.job_id);
        setVideoMetadata(savedJob.video_metadata);
        setJobTitle(savedJob.title);
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
          // A Job saved before its analysis was ever started has no progress and nothing unfinished to warn about;
          // one cut off by a restart keeps its progress even when every batch is back to pending.
          setRestoredIncompleteJob(savedJob.status === 'FAILED' || savedJob.progress_percent !== undefined ||
            savedJob.batches.some((b) => b.status !== 'pending'));
          if (savedJob.error_message) {
            setErrorMessage(savedJob.error_message);
          }
        } else {
          setStatus('READY');
        }
      })
      .catch(() => { if (!token.aborted) setJobLoad('failed'); });
  }, [pollJobUntilComplete, setJobTitle]);

  // 1. Check Browser Compatibility & the Job named by the URL on Mount
  useEffect(() => {
    const clearLegacyHash = () => {
      if (['#main-workspace', '#section-upload-vad', '#section-preview-timeline', '#section-script-editor'].includes(window.location.hash)) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
    };
    clearLegacyHash();
    window.addEventListener('hashchange', clearLegacyHash);
    let mounted = true;

    checkBrowserCompatibility().then((res) => {
      if (mounted) {
        setBrowserCompat(res);
      }
    });
    // Only the header's account menu needs this, so a failure just leaves the menu out.
    fetch('/api/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((author) => { if (mounted && typeof author?.email === 'string') setSignedInAuthor(author); })
      .catch(() => {});

    const pathJobId = jobIdFromPath(window.location.pathname);
    if (pathJobId) restoreJob(pathJobId);

    return () => {
      window.removeEventListener('hashchange', clearLegacyHash);
      mounted = false;
      intakeCheckAbort.current?.abort();
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
  }, [restoreJob]);

  const leaveCurrentJob = useCallback(() => {
    pollAbortRef.current.aborted = true;
    workspaceVersion.current += 1;
    titleSave.current = null;
    registration.current = null;
    restoreTitleFocus.current = false;
    titleTypedRef.current = false;
    pendingLocalSpotsRef.current = null;
    setRegisteringJob(false);
    setJobTitle('');
    setTitleEditor({ kind: 'display' });
    setTitleAcknowledgement(null);
    setShowVideoSummary(false);
    intakeCheckAbort.current?.abort();
    intakeCheckAbort.current = null;
    setGenerateSaveFailure(null);
    saveQueue.invalidate();
    // Back navigation has already moved the URL; only leave the Job's URL when it still shows this Job.
    if (jobId && jobIdFromPath(window.location.pathname) === jobId) navigate('/new');
    setJobId(null);
    setJobLoad(null);
    setVadOutput(null);
    setBatches([]);
    setSpots([]);
    setSelectedSpotId(null);
    setRestoredIncompleteJob(false);
  }, [jobId, saveQueue, navigate, setJobTitle]);

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

  const handleProcessReview = useCallback(async (video: File | string, srtFile: File, title: string) => {
    if (!browserCompat?.supported || checkingFileName) return;
    const vadInput: ByteSourceInput = typeof video === 'string' ? { kind: 'url', url: video } : { kind: 'file', file: video };
    reviewImportRef.current = null;
    generateIntakeRef.current = null;
    setImportSkipped([]);
    leaveCurrentJob();
    const token = { aborted: false };
    pollAbortRef.current = token;
    const controller = new AbortController();
    intakeCheckAbort.current = controller;
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
      source = await openByteSource(vadInput, (input, init) => fetch(input, { ...init, signal: controller.signal }));
    } catch (err) {
      if (token.aborted) return;
      intakeCheckAbort.current = null;
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
    intakeCheckAbort.current = null;
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
    setJobTitle(title.trim());
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
  }, [browserCompat, checkingFileName, leaveCurrentJob, clearVideo, setJobTitle, startVad]);

  // 2. Handle MP4 File Selection & Automatic Built-In VAD Execution
  const handleSelectFile = useCallback(
    async (file: File, customTitle?: string) => {
      if (!browserCompat?.supported || checkingFileName) return;
      if (videoMetadata && !(await confirm({ title: 'เปลี่ยนวิดีโอและออกจากงานปัจจุบัน?', description: 'กรุณาส่งออกบทบรรยายที่ต้องการเก็บไว้ก่อน', confirmLabel: 'เปลี่ยนวิดีโอ' }))) return;
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
      if (customTitle !== undefined) {
        const trimmed = customTitle.trim();
        setJobTitle(trimmed || defaultJobTitle(file.name));
        titleTypedRef.current = Boolean(trimmed);
      }
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
        generateIntakeRef.current = { file, metadata: validation.metadata };
        setVideoFile(file);
        setVideoMetadata(validation.metadata);
        setJobTitle(customTitle?.trim() || (titleTypedRef.current ? jobTitleRef.current : defaultJobTitle(file.name)));
        const blobUrl = URL.createObjectURL(file);
        objectUrlRef.current = blobUrl;
        setVideoUrl(blobUrl);
        setCurrentTimeMs(0);
        setStatus('VIDEO_READY');
        startVad({ kind: 'file', file });
      } else {
        generateIntakeRef.current = null;
        setVideoUrl(null);
        setStatus('FAILED');
      }
    },
    [browserCompat, checkingFileName, videoMetadata, startVad, leaveCurrentJob, clearVideo, confirm, setJobTitle]
  );

  // 3. Trigger Browser Silero VAD manually if needed
  const handleRunVad = async () => {
    const input: ByteSourceInput | undefined = videoFile ? { kind: 'file', file: videoFile } : reviewImportRef.current?.vadInput;
    if (!input || !videoMetadata) return;
    if (spots.some((spot) => spot.is_edited || spot.text.trim()) && !(await confirm({ title: 'สแกนเสียงใหม่?', description: 'บทบรรยายและเวลาที่แก้ไว้จะถูกแทนที่ กรุณาส่งออกงานที่ต้องการเก็บก่อน', confirmLabel: 'สแกนเสียงใหม่', destructive: true }))) return;
    if (mode !== 'review' && videoFile) {
      generateIntakeRef.current = { file: videoFile, metadata: videoMetadata };
    }
    // The rescanned Job is the same work, so it keeps the title the author gave it.
    const keptTitle = jobTitleRef.current;
    leaveCurrentJob();
    if (keptTitle) {
      setJobTitle(keptTitle);
      titleTypedRef.current = true;
    }
    pollAbortRef.current = { aborted: false };
    startVad(input);
  };

  const retryGenerateSave = () => {
    if (!generateSaveFailure) return;
    pollAbortRef.current.aborted = true;
    pollAbortRef.current = { aborted: false };
    setErrorMessage(null);
    setStatus('DETECTING');
    void createGenerateJob(generateSaveFailure.input, generateSaveFailure.output);
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

    if (spots.some((spot) => spot.text.trim()) && !(await confirm({ title: 'สร้างบทบรรยายใหม่?', description: 'ข้อความและเวลาที่แก้ไว้อาจถูกแทนที่ กรุณาส่งออกงานที่ต้องการเก็บก่อน', confirmLabel: 'สร้างบทบรรยายใหม่', destructive: true }))) return;

    pollAbortRef.current.aborted = true;
    const token = { aborted: false };
    pollAbortRef.current = token;
    let uploadId: string | undefined;
    let createdJob = false;
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
      const { response: initRes, data: initData } = await registerJob('/api/jobs/init', {
        uploadId,
        video_metadata: videoMetadata,
        vad_config: effectiveVadConfig,
        ad_settings: DEFAULT_AD_ANALYSIS_SETTINGS,
        vad_output: vadOutput,
      }, token);
      if (initRes.ok && initData?.job) createdJob = true;
      // A Job created here is already analysing on the server, so it stays and shows in the Job List.
      if (token.aborted) return;
      if (!initRes.ok || !initData?.job) {
        if (uploadId) discardUnfinishedUpload(uploadId);
        setVadProgress(null);
        setStatus('FAILED');
        setErrorMessage(
          initData?.error || 'ไม่สามารถลงทะเบียนวิดีโอไปยังเซิร์ฟเวอร์เพื่อวิเคราะห์ได้'
        );
        return;
      }

      const initializedJob = initData.job;
      setJobId(initializedJob.job_id);
      acknowledgeJobTitle(initializedJob.title);
      navigate(jobPath(initializedJob.job_id));
      setBatches(initializedJob.batches);
      setSpots(initializedJob.spots);

      if (initializedJob.batches.length === 0) {
        setVadProgress(null);
        setStatus('READY');
        return;
      }

      await pollJobUntilComplete(initializedJob.job_id);
    } catch (err) {
      if (!createdJob && uploadId) {
        discardUnfinishedUpload(uploadId);
      }
      if (token.aborted) return;
      setVadProgress(null);
      setStatus('FAILED');
      setErrorMessage(
        `การเชื่อมต่อเซิร์ฟเวอร์ขัดข้อง: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      if (createdJob && uploadId) {
        void fetch(`/api/upload/${encodeURIComponent(uploadId)}/abandon`, { method: 'POST', keepalive: true }).catch(() => {});
      } else if (token.aborted && !createdJob && uploadId) {
        discardUnfinishedUpload(uploadId);
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
      if (jobId) {
        saveQueue.save(jobId, nextSpots);
      } else {
        pendingLocalSpotsRef.current = nextSpots;
      }
    },
    [jobId, spots, saveQueue]
  );

  const resetWorkspace = useCallback(() => {
    reviewImportRef.current = null;
    generateIntakeRef.current = null;
    setImportSkipped([]);
    leaveCurrentJob();
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    clearVideo();
    setVadProgress(null);
    setErrorMessage(null);
    setStatus('IDLE');
    setCheckingFileName(null);
    setMode(null);
    setGenerateDraft(EMPTY_GENERATE_DRAFT);
    setReviewDraft(EMPTY_REVIEW_DRAFT);
    restoreIntakeModeFocus.current = false;
    setSrtFileName(null);
    setJobTitle('');
    titleTypedRef.current = false;
  }, [leaveCurrentJob, clearVideo, setJobTitle]);

  const displayedTitle = jobTitle || (videoMetadata ? defaultJobTitle(videoMetadata.fileName) : '');
  const hasTitleDraft = titleEditor.kind !== 'display' && titleEditor.kind !== 'saving' &&
    titleEditor.draft.trim() !== displayedTitle;

  /** Waits for saves already sent, then names what leaving would lose, if anything. */
  const leaveWarning = useCallback(async (): Promise<string | null> => {
    if (videoMetadata && !jobId) return 'งานนี้ยังไม่ได้บันทึกบนเซิร์ฟเวอร์และจะหายไป';
    if (!jobId) return null;
    const [spotsSaved, titleSaved] = await Promise.all([saveQueue.wait(), titleSave.current]);
    if (titleSaved === false || (titleSaved == null && hasTitleDraft)) return 'ชื่องานที่แก้ยังไม่ได้บันทึกและจะหายไป';
    return spotsSaved === false ? 'การแก้ไขล่าสุดยังบันทึกไม่สำเร็จและจะหายไป' : null;
  }, [videoMetadata, jobId, saveQueue, hasTitleDraft]);

  // Back and forward move between Jobs by URL, so the workspace follows whatever the URL now names.
  useEffect(() => {
    const handlePopState = async () => {
      focusOpenedJob.current = null;
      const warning = await leaveWarning();
      // Back cannot be cancelled, so declining puts the page's own URL back.
      if (warning && !(await confirm({ title: 'ออกจากหน้านี้?', description: warning, confirmLabel: 'ออกจากหน้านี้', destructive: true }))) {
        window.history.pushState(null, '', path);
        return;
      }
      setPath(window.location.pathname);
      resetWorkspace();
      const pathJobId = jobIdFromPath(window.location.pathname);
      if (pathJobId) restoreJob(pathJobId);
    };
    const onPopState = () => void handlePopState();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [resetWorkspace, restoreJob, leaveWarning, path, confirm]);

  const openJob = (openJobId: string) => {
    const target = jobPath(openJobId);
    focusOpenedJob.current = target;
    navigate(target);
    restoreJob(openJobId);
  };

  const focusTitleButton = useCallback((button: HTMLButtonElement | null) => {
    if (button && restoreTitleFocus.current) {
      restoreTitleFocus.current = false;
      button.focus();
    }
  }, []);
  const focusTitleInput = useCallback((input: HTMLInputElement | null) => {
    titleInput.current = input;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);
  const closeTitleEditor = useCallback((restoreFocus: boolean) => {
    restoreTitleFocus.current = restoreFocus && document.activeElement === titleInput.current;
    setTitleEditor({ kind: 'display' });
  }, []);
  const saveTitle = useCallback((draft: string, restoreFocus: boolean) => {
    if (titleSave.current) return;
    if (!draft.trim() || draft.trim() === displayedTitle) {
      closeTitleEditor(restoreFocus);
      return;
    }
    if (registration.current) {
      setTitleEditor({ kind: 'queued', draft });
      return;
    }
    const checked = resolveJobTitle(draft);
    if (!checked.success) {
      setTitleEditor({ kind: 'error', draft, message: checked.error });
      return;
    }
    if (!jobId) {
      titleTypedRef.current = true;
      setJobTitle(checked.title);
      setTitleAcknowledgement('local');
      closeTitleEditor(restoreFocus);
      return;
    }
    const version = workspaceVersion.current;
    setTitleEditor({ kind: 'saving', draft });
    titleSave.current = (async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: checked.title }),
        });
        const data = await parseApiResponse<{ job?: PersistedJobState; error?: string }>(response);
        if (workspaceVersion.current !== version) return false;
        if (!response.ok || data?.job?.job_id !== jobId) throw new Error(data?.error || 'บันทึกชื่องานไม่สำเร็จ กรุณาลองอีกครั้ง');
        setJobTitle(data.job.title);
        setTitleAcknowledgement('server');
        closeTitleEditor(restoreFocus);
        return true;
      } catch (err) {
        if (workspaceVersion.current !== version) return false;
        setTitleEditor({ kind: 'error', draft, message: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        if (workspaceVersion.current === version) titleSave.current = null;
      }
    })();
  }, [closeTitleEditor, displayedTitle, jobId, setJobTitle]);

  useEffect(() => {
    if (titleEditor.kind === 'queued' && !registeringJob) saveTitle(titleEditor.draft, true);
  }, [registeringJob, saveTitle, titleEditor]);

  const handleTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (titleEditor.kind === 'display' || titleEditor.kind === 'saving') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTitleEditor(true);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTitle(titleEditor.draft, true);
    }
  };

  // Navigate first so leaving the Job does not also push `/new` onto the history.
  const openJobList = async () => {
    const warning = await leaveWarning();
    if (warning && !(await confirm({ title: 'กลับไปรายการงาน?', description: warning, confirmLabel: 'กลับไปรายการงาน', destructive: true }))) return;
    navigate('/');
    resetWorkspace();
  };

  const signOut = async () => {
    const warning = await leaveWarning();
    if (warning && !(await confirm({ title: 'ออกจากระบบ?', description: warning, confirmLabel: 'ออกจากระบบ', destructive: true }))) return;
    window.location.assign('/auth/logout');
  };

  // 8. Reset Job
  const handleResetJob = async () => {
    if (!(await confirm({ title: 'เริ่มงานใหม่และออกจากงานปัจจุบัน?', description: 'กรุณาส่งออกบทบรรยายที่ต้องการเก็บไว้ก่อน', confirmLabel: 'เริ่มงานใหม่' }))) return;
    resetWorkspace();
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
  useEffect(() => {
    if (!hasProject && path === '/new') void loadReviewIntake();
  }, [hasProject, path]);
  const focusWhenJobReady = useCallback((element: HTMLElement | null) => {
    if (!element || focusOpenedJob.current !== path) return;
    focusOpenedJob.current = null;
    workspaceRef.current?.focus();
  }, [path]);
  const clearIntakeFeedback = () => {
    setErrorMessage(null);
    setValidationIssues([]);
  };
  const attachIntakeModeButton = useCallback((element: HTMLButtonElement | null) => {
    intakeModeButton.current = element;
    if (element && restoreIntakeModeFocus.current) {
      restoreIntakeModeFocus.current = false;
      element.focus();
    }
  }, []);
  const currentMode = mode ?? 'generate';
  const intake: IntakeControls = {
    canProcess: browserCompat?.supported === true,
    onInputChange: clearIntakeFeedback,
    onCancelCheck: () => {
      pollAbortRef.current.aborted = true;
      intakeCheckAbort.current?.abort();
      intakeCheckAbort.current = null;
      setCheckingFileName(null);
      setStatus('IDLE');
      intakeModeButton.current?.focus();
    },
    modeSwitch: {
      mode: currentMode,
      checking: Boolean(checkingFileName),
      switching: isSwitchingMode,
      onModeChange: (next) => {
        if (checkingFileName || currentMode === next) return;
        restoreIntakeModeFocus.current = true;
        clearIntakeFeedback();
        startModeTransition(() => setMode(next));
      },
      activeButtonRef: attachIntakeModeButton,
    },
  };
  const processingFeedback = getProcessingFeedback(status, vadProgress, batches, errorMessage);
  const videoDuration = videoMetadata ? formatCompactTime(vadOutput?.duration_ms || videoMetadata.durationMs) : '';
  const videoResolution = videoMetadata ? `${videoMetadata.width} × ${videoMetadata.height}` : '';
  const videoHeightLabel = videoMetadata?.height ? `${videoMetadata.height}p` : '';
  const videoSize = videoMetadata?.fileSize ? formatFileSize(videoMetadata.fileSize) : null;
  const isCompactHeader = hasProject || path.startsWith('/jobs/');
  const showEditorHeaderSkeleton = isCompactHeader && !videoMetadata && jobLoad === 'loading';
  const titleFeedback = titleEditor.kind === 'saving' ? 'กำลังบันทึกชื่อ…'
    : titleEditor.kind !== 'display' && registeringJob ? 'กำลังบันทึกงานบนเซิร์ฟเวอร์…'
    : titleEditor.kind === 'display' && titleAcknowledgement === 'server' ? 'บันทึกชื่อบนเซิร์ฟเวอร์แล้ว'
    : titleEditor.kind === 'display' && titleAcknowledgement === 'local' ? 'ชื่อนี้อยู่ในหน้านี้เท่านั้นจนกว่าจะสร้างงานบนเซิร์ฟเวอร์'
    : '';
  const showTitleNotice = titleEditor.kind === 'error' || (titleEditor.kind === 'editing' && registeringJob);

  const logoLink = (
    <a
      href="/"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        void openJobList();
      }}
      aria-label="TCC Envisio รายการงาน"
      className="inline-flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-85 pointer-coarse:min-h-11"
    >
      <img src="/logo.svg" alt="" width={36} height={36} className="shrink-0" />
      {!isCompactHeader && (
        <span className="min-w-0">
          <span className="block whitespace-nowrap text-base font-bold leading-tight tracking-tight text-foreground">
            <span className="text-brand-700">TCC</span> Envisio
          </span>
          <span className="hidden truncate text-xs font-medium leading-tight text-muted-foreground sm:block">สร้างและตรวจแก้บทบรรยายภาพ</span>
        </span>
      )}
    </a>
  );

  return (
    <div className={`min-h-screen flex flex-col bg-canvas text-foreground ${isCompactHeader ? 'lg:h-dvh lg:overflow-hidden' : ''}`}>
      <button type="button" onClick={() => workspaceRef.current?.focus()} className="skip-link cursor-pointer">ข้ามไปยังพื้นที่ทำงาน</button>
      <header className="relative flex min-h-16 shrink-0 items-center border-b border-brand-100 bg-card px-4 py-2 sm:px-6">
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-5 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 items-center gap-1">
            {isCompactHeader ? (
              <SimpleTooltip label="กลับรายการงาน" side="bottom">
                {logoLink}
              </SimpleTooltip>
            ) : logoLink}

            {showEditorHeaderSkeleton && <EditorHeaderTitleSkeleton />}

            {videoMetadata && (
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                    {titleEditor.kind === 'display' ? (
                      <SimpleTooltip label="แก้ไขชื่อ" side="bottom">
                        <Button
                          ref={focusTitleButton}
                          variant="ghost"
                          size="lg"
                          aria-label={`เปลี่ยนชื่องาน: ${displayedTitle}`}
                          aria-describedby={titleFeedback ? 'job-title-status' : undefined}
                          className="h-9 min-w-12 max-w-full shrink justify-start gap-1.5 border border-transparent px-2 text-left text-base leading-[1.35] font-bold not-disabled:active:translate-y-0 not-disabled:hover:border-input not-disabled:hover:bg-muted/50 pointer-coarse:h-11"
                          onClick={() => setTitleEditor({ kind: 'editing', draft: displayedTitle })}
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{displayedTitle}</span>
                            {titleAcknowledgement === 'local' && (
                              <span aria-hidden="true" className="block truncate text-xs font-normal text-muted-foreground">
                                ชื่ออยู่เฉพาะในหน้านี้
                              </span>
                            )}
                          </span>
                          {showSavedCheck && (
                            <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          )}
                        </Button>
                      </SimpleTooltip>
                    ) : (
                      <div className="relative inline-grid min-w-20 max-w-full grid-cols-[minmax(0,1fr)] items-center">
                        <span
                          aria-hidden="true"
                          className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre pr-7 pl-2 text-base leading-[1.35] font-bold"
                        >
                          {titleEditor.draft || 'ชื่องาน'}
                        </span>
                        <Input
                          ref={focusTitleInput}
                          type="text"
                          aria-label="ชื่องาน"
                          aria-invalid={titleEditor.kind === 'error' || undefined}
                          aria-describedby={titleEditor.kind === 'error' ? 'job-title-error' : undefined}
                          value={titleEditor.draft}
                          placeholder="ชื่องาน"
                          maxLength={120}
                          readOnly={titleEditor.kind === 'saving' || titleEditor.kind === 'queued'}
                          onChange={(event) => setTitleEditor({ kind: 'editing', draft: event.target.value })}
                          onBlur={() => { if (titleEditor.kind === 'editing') saveTitle(titleEditor.draft, false); }}
                          onKeyDown={handleTitleKeyDown}
                          className="col-start-1 row-start-1 h-9 w-full min-w-0 bg-background pr-7 pl-2 text-base leading-[1.35] font-bold md:text-base pointer-coarse:h-11"
                        />
                        {(titleEditor.kind === 'saving' || titleEditor.kind === 'queued') && (
                          <Spinner className="pointer-events-none absolute inset-y-0 right-2 my-auto size-3.5 text-muted-foreground" aria-hidden="true" />
                        )}
                      </div>
                    )}
                    <Popover>
                      <Tooltip onOpenChange={setShowVideoSummary}>
                        <TooltipTrigger
                          aria-describedby={showVideoSummary ? 'job-video-summary' : undefined}
                          render={
                            <PopoverTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  aria-label="ข้อมูลวิดีโอ"
                                  className="h-7 shrink-0 gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 text-xs font-medium text-muted-foreground tabular-nums not-disabled:hover:border-input not-disabled:hover:bg-muted/70 not-disabled:hover:text-foreground pointer-coarse:h-11"
                                />
                              }
                            />
                          }
                        >
                          <Info className="size-3.5 shrink-0" aria-hidden="true" />
                          {videoDuration && <span className="hidden sm:inline">{videoDuration}</span>}
                          {videoHeightLabel && <span className="hidden text-muted-foreground/80 md:inline">· {videoHeightLabel}</span>}
                        </TooltipTrigger>
                        <TooltipContent id="job-video-summary" role="tooltip" side="bottom" className="block max-w-[min(20rem,calc(100vw-1.5rem))]">
                          <span className="block font-semibold [overflow-wrap:anywhere]">{videoMetadata.fileName}</span>
                          <span className="block tabular-nums">{videoDuration} · {videoResolution}</span>
                        </TooltipContent>
                      </Tooltip>
                      <PopoverContent aria-label="ข้อมูลวิดีโอ" align="start" className="w-80 max-w-[calc(100vw-1.5rem)] p-4">
                        <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{videoMetadata.fileName}</p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-muted-foreground">
                          <dt>ความยาว</dt><dd className="text-right tabular-nums text-foreground">{videoDuration}</dd>
                          <dt>ความละเอียด</dt><dd className="text-right tabular-nums text-foreground">{videoResolution}</dd>
                          <dt>ขนาดไฟล์</dt><dd className="text-right tabular-nums text-foreground">{videoSize ?? 'ไม่ทราบ'}</dd>
                        </dl>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
            )}
          </div>
          {hasProject ? (
            <div ref={setHeaderActionsElement} className="min-h-10 min-w-0 pointer-coarse:min-h-11" />
          ) : showEditorHeaderSkeleton ? (
            <EditorHeaderActionsSkeleton />
          ) : null}
        </div>
        {signedInAuthor && (
          // On a phone the editor header has no room left; the Job List header still offers sign-out there.
          <div className={`ml-2 shrink-0 ${isCompactHeader ? 'hidden sm:block' : ''}`}>
            <AccountMenu email={signedInAuthor.email} name={signedInAuthor.name} allJobs={signedInAuthor.allJobs} accessGroups={signedInAuthor.accessGroups} onSignOut={() => void signOut()} />
          </div>
        )}
        {hasProject && (
          <div className={showTitleNotice
            ? 'absolute top-full left-4 z-20 mt-1 max-w-[calc(100%-2rem)] rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md sm:left-6 sm:max-w-[calc(100%-3rem)]'
            : 'sr-only'}>
            <p id="job-title-status" role="status" className="text-muted-foreground">{titleFeedback}</p>
            {titleEditor.kind === 'error' && (
              <div id="job-title-error" role="alert" className="space-y-1.5 text-error-foreground [overflow-wrap:anywhere]">
                <p>{titleEditor.message}</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => saveTitle(titleEditor.draft, true)}
                  >
                    ลองอีกครั้ง
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => closeTitleEditor(true)}
                  >
                    ยกเลิก
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Browser Compatibility Blocking Banner */}
      {browserCompat && !browserCompat.supported && (
        <Alert variant="destructive" placement="strip">
          <AlertOctagon aria-hidden="true" />
          <AlertDescription className="text-xs">
            <strong className="font-bold">
              เบราว์เซอร์นี้ไม่รองรับการวิเคราะห์เสียง:
            </strong>{' '}
            {browserCompat.reason} กรุณาเปิดใช้งานด้วย Google Chrome หรือ Microsoft Edge เวอร์ชันล่าสุดบนคอมพิวเตอร์
          </AlertDescription>
        </Alert>
      )}

      <main ref={workspaceRef} id="main-workspace" tabIndex={-1} className="flex flex-col flex-1 min-h-0">
      {/* Restored Incomplete Job Resume Banner */}
      {restoredIncompleteJob && jobId && status !== 'ANALYZING' && (
        <Alert variant="warning" placement="strip" role="status">
          <TriangleAlert />
          <AlertTitle>มีงานวิเคราะห์ที่ยังไม่เสร็จ</AlertTitle>
        </Alert>
      )}

      {mode === 'review' && missingLocalVideo && (
        <Alert variant="warning" placement="strip" role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FileVideo />
          {/* One line like the banner it replaces, so the workspace below keeps its height. */}
          <AlertTitle className="min-w-0 flex-1 font-normal [overflow-wrap:anywhere]">
            <strong className="font-semibold">เลือกวิดีโอเดิมอีกครั้งเพื่อเล่นและดูเทียบ</strong>
            {' · '}{missingLocalVideo.file_name} ({formatFileSize(missingLocalVideo.file_size)}) · ระหว่างนี้ยังแก้บทและส่งออก SRT ได้
          </AlertTitle>
          <Button variant="outline" onClick={() => relinkInputRef.current?.click()}>เลือกวิดีโอเดิม</Button>
          <input ref={relinkInputRef} type="file" accept="video/mp4,.mp4" className="hidden" aria-label="เลือกวิดีโอเดิมของงานนี้" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) handleRelinkLocalVideo(file); }} />
        </Alert>
      )}

      {mode === 'review' && hasProject && importSkipped.length > 0 && (
        <Alert variant="warning" placement="strip" role="status">
          <ListX />
          <Collapsible className="col-start-2">
            <CollapsibleTrigger className="group/skipped inline-flex items-center gap-1.5 rounded-sm font-medium">
              ไม่ได้นำเข้า {importSkipped.length} บรรทัดจาก SRT
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-data-[panel-open]/skipped:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 flex flex-col gap-1">
                {importSkipped.map(({ cue, reason }, index) => (
                  <li key={index} className="[overflow-wrap:anywhere]">
                    <span className="font-mono tabular-nums">{formatTimestampDisplay(cue.start_ms)} – {formatTimestampDisplay(cue.end_ms)}</span>
                    {' · '}{reason === 'starts_after_video_end' ? 'เริ่มหลังวิดีโอจบ' : 'เวลาจบไม่หลังเวลาเริ่ม'}
                    {' · '}{cue.text}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </Alert>
      )}

      {/* Top Studio Project & Queue Command Bar */}
      <WorkspaceLoadBoundary key={path === '/' ? 'list' : 'workspace'} onReady={focusWhenJobReady}>
      <Suspense fallback={
        path.startsWith('/jobs/') ? (
          <EditorWorkspaceSkeleton label="กำลังโหลดพื้นที่ทำงาน…" />
        ) : path === '/new' ? (
          <IntakeSkeleton />
        ) : (
          <p role="status" className="my-14 flex items-center justify-center gap-2 text-muted-foreground">
            <Spinner aria-hidden="true" />
            กำลังโหลดพื้นที่ทำงาน…
          </p>
        )
      }>
      {jobLoad === 'loading' && !hasProject ? (
        <EditorWorkspaceSkeleton label="กำลังเปิดงาน…" />
      ) : jobLoad && !hasProject ? (
        <Empty ref={focusWhenJobReady} role="alert" className="mx-auto my-14 w-[calc(100%-2rem)] max-w-xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">{jobLoad === 'missing' ? <SearchX /> : <WifiOff />}</EmptyMedia>
            <EmptyTitle><h1 className="text-xl font-semibold text-foreground">{jobLoad === 'missing' ? 'ไม่พบงานนี้' : 'เปิดงานไม่สำเร็จ'}</h1></EmptyTitle>
            <EmptyDescription>{jobLoad === 'missing' ? 'งานอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองโหลดหน้านี้อีกครั้ง'}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={() => void openJobList()}>กลับหน้าแรก</Button>
          </EmptyContent>
        </Empty>
      ) : !hasProject && path === '/' ? (
        <JobList onOpen={openJob} onNew={() => navigate('/new')} showOwners={signedInAuthor?.allJobs === true} ownEmail={signedInAuthor?.email} />
      ) : !hasProject && (mode ?? 'generate') === 'review' ? (
        <ReviewIntake
          checkingFileName={checkingFileName}
          errorMessage={errorMessage}
          validationIssues={validationIssues}
          onProcess={handleProcessReview}
          intake={intake}
          draft={reviewDraft}
          setDraft={setReviewDraft}
          onBack={() => void openJobList()}
        />
      ) : <UploadAndVadPanel
        mode={currentMode}
        intake={intake}
        draft={generateDraft}
        setDraft={setGenerateDraft}
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
        onOpenJobList={() => void openJobList()}
        onSelectSpot={handleSelectSpot}
        onExportSrt={handleExportSrt}
        errorMessage={errorMessage}
      />}

      {hasProject && <section ref={focusWhenJobReady} aria-label="ตรวจและแก้ไขบทบรรยาย" className="flex-1 min-h-0 w-full grid grid-cols-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left Pane: Video Monitor, Caption Strip, Transport & Multi-Track Timeline (6 cols) */}
        <div className="lg:col-span-6 min-h-0 flex flex-col border-b lg:border-b-0 lg:border-r border-border lg:overflow-hidden">
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
            onRetryJobSave={generateSaveFailure ? retryGenerateSave : undefined}
            preparationTitle={processingFeedback?.title}
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
      </Suspense>
      </WorkspaceLoadBoundary>
      </main>
      {confirmDialog}
    </div>
  );
}
