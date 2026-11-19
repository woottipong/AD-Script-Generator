import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import { JobStorageManager } from './JobStorageManager';
import type { ProcessingFeedback } from '../utils/processingFeedback';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  FileVideo,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  ADSpot,
  AnalysisBatch,
  JobStatus,
  VADOutput,
  VideoMetadata,
  VideoValidationIssue,
} from '../types/ad';
import {
  formatCompactTime,
  formatFileSize,
} from '../utils/formatters';

const batchColors = {
  pending: {
    surface: 'border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50',
    foreground: 'text-slate-900',
    secondary: 'text-slate-600',
    badge: 'bg-amber-100 text-amber-900',
  },
  processing: {
    surface: 'border-brand-500 bg-brand-100 hover:bg-brand-200',
    foreground: 'text-brand-950',
    secondary: 'text-brand-900',
    badge: 'bg-brand-800 text-white',
  },
  completed: {
    surface: 'border-brand-200 bg-white hover:border-brand-300 hover:bg-brand-50',
    foreground: 'text-slate-900',
    secondary: 'text-slate-600',
    badge: 'bg-emerald-100 text-emerald-900',
  },
  failed: {
    surface: 'border-red-300 bg-red-50 hover:border-red-400 hover:bg-red-100',
    foreground: 'text-red-950',
    secondary: 'text-red-800',
    badge: 'bg-red-100 text-red-900',
  },
};

interface UploadAndVadPanelProps {
  headerActionsElement: HTMLDivElement | null;
  checkingFileName: string | null;
  processingFeedback: ProcessingFeedback | null;
  status: JobStatus;
  videoFile: File | null;
  videoMetadata: VideoMetadata | null;
  validationIssues: VideoValidationIssue[];
  vadOutput: VADOutput | null;
  batches: AnalysisBatch[];
  spots: ADSpot[];
  onSelectFile: (file: File) => void;
  onRunVad: () => void;
  onStartGeminiAnalysis: () => void;
  onRetryFailedBatches: () => void;
  onResetJob: () => void;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  onExportSrt: () => void;
  errorMessage: string | null;
}

export const UploadAndVadPanel: React.FC<UploadAndVadPanelProps> = ({
  headerActionsElement,
  checkingFileName,
  processingFeedback,
  status,
  videoFile,
  videoMetadata,
  validationIssues,
  vadOutput,
  batches,
  spots,
  onSelectFile,
  onRunVad,
  onStartGeminiAnalysis,
  onRetryFailedBatches,
  onResetJob,
  onSelectSpot,
  onExportSrt,
  errorMessage,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const managementRef = useRef<HTMLDetailsElement | null>(null);
  const analysisDetailsRef = useRef<HTMLDivElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isWideHeader, setIsWideHeader] = useState(false);
  const [activityElapsedMs, setActivityElapsedMs] = useState(0);

  const isDetecting = status === 'DETECTING';
  const isAnalyzing = status === 'ANALYZING';
  const isBusy = Boolean(checkingFileName) || isDetecting || isAnalyzing;
  const activityFeedback: ProcessingFeedback | null = checkingFileName
    ? { title: 'กำลังตรวจสอบวิดีโอ', description: 'กำลังตรวจรูปแบบไฟล์ ความละเอียด และแทร็กเสียง' }
    : processingFeedback;

  useEffect(() => {
    if (!activityFeedback?.title) {
      setActivityElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setActivityElapsedMs(0);
    const timer = setInterval(() => setActivityElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [activityFeedback?.title]);

  useEffect(() => {
    // Match keyboard order to the header layout without duplicating its controls.
    const query = window.matchMedia('(min-width: 1024px)');
    const updateLayout = () => setIsWideHeader(query.matches);
    updateLayout();
    query.addEventListener('change', updateLayout);
    return () => query.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    const dismissDisclosures = (event: PointerEvent | KeyboardEvent) => {
      const isEscape = event instanceof KeyboardEvent && event.key === 'Escape';
      if (event instanceof KeyboardEvent && !isEscape) return;
      if (isQueueExpanded && (isEscape || (!analysisDetailsRef.current?.contains(event.target as Node) && !statusButtonRef.current?.contains(event.target as Node)))) {
        setIsQueueExpanded(false);
        if (isEscape) statusButtonRef.current?.focus();
      }
      for (const disclosure of [videoDetailsRef.current, managementRef.current]) {
        if (disclosure?.open && (isEscape || !disclosure.contains(event.target as Node))) {
          disclosure.open = false;
          if (isEscape) disclosure.querySelector('summary')?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', dismissDisclosures);
    document.addEventListener('keydown', dismissDisclosures);
    return () => {
      document.removeEventListener('pointerdown', dismissDisclosures);
      document.removeEventListener('keydown', dismissDisclosures);
    };
  }, [isQueueExpanded]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isBusy) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      onSelectFile(droppedFile);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      onSelectFile(selected);
    }
    e.target.value = '';
  };

  const speechDurationMs = vadOutput
    ? vadOutput.speech_segments.reduce((acc, s) => acc + (s.end_ms - s.start_ms), 0)
    : 0;
  const totalDurationMs = vadOutput?.duration_ms || videoMetadata?.durationMs || 0;
  const nonSpeechDurationMs = Math.max(0, totalDurationMs - speechDurationMs);
  const speechPercent =
    totalDurationMs > 0 ? Math.round((speechDurationMs / totalDurationMs) * 100) : 0;

  const hasBlockingErrors = validationIssues.some((i) => i.severity === 'error');
  const canRunVad =
    Boolean(videoFile) &&
    Boolean(videoMetadata) &&
    !hasBlockingErrors &&
    !isBusy;

  const canGenerateAd =
    Boolean(vadOutput) &&
    (vadOutput?.candidate_spots.length ?? 0) > 0 &&
    !isBusy;

  const completedBatchesCount = batches.filter((b) => b.status === 'completed').length;
  const processingBatch = batches.find((b) => b.status === 'processing');
  const pendingBatchesCount = batches.filter((b) => b.status === 'pending').length;
  const failedBatchesCount = batches.filter((b) => b.status === 'failed').length;

  const pendingSpotsCount = spots.filter((s) => s.decision === 'pending').length;
  const generatedSpotsCount = spots.filter(
    (s) => s.decision === 'generate' && s.text.trim().length > 0
  ).length;

  const canShowGenerate = Boolean(vadOutput?.candidate_spots.length) &&
    Boolean(videoFile || completedBatchesCount < batches.length);
  const needsResume = failedBatchesCount > 0 ||
    (completedBatchesCount > 0 && completedBatchesCount < batches.length) ||
    (!videoFile && batches.length > 0 && completedBatchesCount < batches.length);
  const isRegenerating = !needsResume && generatedSpotsCount > 0 && pendingSpotsCount === 0;
  const generateAd = needsResume ? onRetryFailedBatches : onStartGeminiAnalysis;
  const fileName = videoMetadata?.fileName || videoFile?.name || 'วิดีโอโปรเจกต์';
  const statusText = activityFeedback
    ? `${activityFeedback.title}${activityFeedback.percent !== undefined ? ` ${activityFeedback.percent}%` : ''}`
    : errorMessage || failedBatchesCount > 0
    ? 'ต้องตรวจสอบการทำงาน'
    : status === 'READY'
    ? 'วิเคราะห์เสร็จแล้ว'
    : vadOutput?.candidate_spots.length === 0
    ? 'ไม่พบช่วงว่าง'
    : needsResume
    ? 'มีงานที่ยังไม่เสร็จ'
    : vadOutput
    ? `พร้อมสร้าง · ${vadOutput.candidate_spots.length} ช่วง`
    : 'กำลังเตรียมวิดีโอ';

  const hasLoadedProject = Boolean(videoMetadata || vadOutput || videoFile);

  // If no video is loaded yet, show a clean studio intake workspace bar
  if (!hasLoadedProject) {
    return (
      <section
        className="w-[calc(100%_-_2rem)] max-w-4xl mx-auto my-8 sm:my-14 px-1 sm:px-0"
      >
        {headerActionsElement && createPortal(
          <div className="col-start-2 row-start-1 justify-self-end lg:col-start-3"><JobStorageManager /></div>,
          headerActionsElement
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,.mp4"
          aria-invalid={hasBlockingErrors}
          disabled={Boolean(checkingFileName)}
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="mb-7">
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 leading-tight">สร้างบทบรรยายภาพ</h1>
          <p className="mt-3 text-base text-slate-600 leading-relaxed max-w-2xl">ระบบหาช่วงว่างบนเครื่องของคุณ</p>
        </div>
        <div className="flex flex-col gap-7">
          <div>
            {checkingFileName ? (
              <div className="w-full max-w-lg mx-auto">
                <p className="mb-3 [overflow-wrap:anywhere] text-sm font-medium text-slate-700">{checkingFileName}</p>
                <VideoProcessingStatus feedback={{ title: 'กำลังตรวจสอบวิดีโอ', description: 'กำลังตรวจรูปแบบไฟล์ ความละเอียด และแทร็กเสียง ก่อนเปิดพื้นที่ทำงาน' }} />
              </div>
            ) : <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 sm:p-10 transition-colors flex flex-col items-center text-center gap-5 ${
                isDragging
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-300 hover:border-slate-500 bg-white'
              }`}
            >
              <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900">
                    ลากวิดีโอ MP4 มาวางที่นี่
                  </p>
                  <p id="upload-requirements" className="text-sm text-slate-600 mt-2 leading-relaxed">
                    ความสูง 480p · H.264 + AAC · ไม่เกิน 30 นาที และ 2 GB
                  </p>
              </div>

              <div className="flex flex-wrap justify-center items-center gap-3">
                <button type="button" onClick={() => fileInputRef.current?.click()} aria-describedby={errorMessage || hasBlockingErrors ? 'upload-requirements upload-feedback' : 'upload-requirements'} className="px-6 py-3 text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-md flex items-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  เลือกวิดีโอ
                </button>
              </div>
            </div>}

            {(errorMessage || hasBlockingErrors) && (
              <div id="upload-feedback" role="alert" className="mt-3 p-3 rounded-md border border-red-200 bg-red-50 text-red-800 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold">{hasBlockingErrors ? 'วิดีโอไม่ผ่านสเปค' : 'ไม่สามารถเปิดวิดีโอได้'}</p>
                  {errorMessage ? <p className="mt-1">{errorMessage}</p> : (
                    <ul className="mt-1 list-disc pl-5 space-y-1">
                      {validationIssues.filter((issue) => issue.severity === 'error').map((issue, index) => (
                        <li key={`${issue.field}-${index}`}>{issue.message}</li>
                      ))}
                    </ul>
                  )}
                  {hasBlockingErrors && <p className="mt-2">กรุณาเลือกวิดีโอที่ตรงตามสเปคด้านบน</p>}
                </div>
              </div>
            )}
          </div>

          <div className="text-sm leading-relaxed text-slate-600">
            <p>เมื่อกดสร้างบทบรรยาย วิดีโอจะถูกส่งไปวิเคราะห์ด้วย Google Gemini</p>
          </div>
        </div>

      </section>
    );
  }

  const projectControls = (
    <div key="project-controls" className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:justify-end">
      <details ref={videoDetailsRef} name="project-header" className="group relative min-w-0 flex-1 basis-36 lg:max-w-xs">
        <summary aria-label={`รายละเอียดวิดีโอ: ${fileName}`} className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50 group-open:bg-brand-50 group-open:text-brand-900 [&::-webkit-details-marker]:hidden">
          <FileVideo className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium">{fileName}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-lg lg:left-auto lg:right-0">
          <p className="[overflow-wrap:anywhere] font-semibold text-slate-900">{fileName}</p>
          {videoMetadata && <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-slate-600">
            <dt>ความละเอียด</dt><dd className="text-right tabular-nums text-slate-900">{videoMetadata.width} × {videoMetadata.height}</dd>
            <dt>ความยาว</dt><dd className="text-right tabular-nums text-slate-900">{formatCompactTime(totalDurationMs)}</dd>
            {videoMetadata.fileSize > 0 && <><dt>ขนาดไฟล์</dt><dd className="text-right tabular-nums text-slate-900">{formatFileSize(videoMetadata.fileSize)}</dd></>}
          </dl>}
        </div>
      </details>

      <button
        ref={statusButtonRef}
        type="button"
        onClick={() => setIsQueueExpanded((prev) => !prev)}
        aria-expanded={isQueueExpanded}
        aria-controls="analysis-details"
        aria-label={`${statusText}${activityFeedback?.detail ? ` · ${activityFeedback.detail}` : ''} · ดูรายละเอียดการทำงาน`}
        className={`flex min-h-10 max-w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${
          errorMessage || failedBatchesCount > 0
            ? 'bg-red-50 text-red-800 hover:bg-red-100'
            : activityFeedback
            ? 'border border-brand-200 bg-brand-50 text-brand-950 hover:bg-brand-100'
            : status === 'READY' || !vadOutput?.candidate_spots.length
            ? 'border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200/80'
            : 'bg-brand-50 text-brand-900 hover:bg-brand-100'
        }`}
      >
        {isBusy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-brand-700" aria-hidden="true" />
        ) : (
          <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        )}
        {activityFeedback ? (
          <span role="status" className="flex min-w-0 items-center gap-1.5 tabular-nums text-left">
            <span className="truncate font-semibold">{activityFeedback.title}</span>
            {isAnalyzing && batches.length > 0 && processingBatch && (
              <span className="hidden md:inline text-brand-800">· ชุด {processingBatch.batch_index}/{batches.length}</span>
            )}
            {activityFeedback.percent !== undefined && (
              <span className="font-semibold text-brand-800">· {activityFeedback.percent}%</span>
            )}
            <span className="hidden sm:inline text-brand-800/80">· {formatCompactTime(activityElapsedMs)}</span>
          </span>
        ) : (
          <span role="status" className="min-w-0 text-left">{statusText}</span>
        )}
        {isQueueExpanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      </button>

      {canShowGenerate && !isBusy && !isRegenerating && (
        <button type="button" onClick={generateAd} disabled={!canGenerateAd && failedBatchesCount === 0} className="flex min-h-10 grow items-center justify-center gap-2 whitespace-nowrap rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer sm:grow-0">
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          {needsResume ? 'ทำต่อจากชุดที่ค้าง' : 'สร้างบทบรรยายภาพ'}
        </button>
      )}

      {generatedSpotsCount > 0 && !isBusy && (
        <button
          type="button"
          onClick={onExportSrt}
          className={`flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer ${
            canShowGenerate && !isRegenerating
              ? 'border border-brand-200 bg-white text-brand-800 hover:bg-brand-50'
              : 'bg-brand-700 text-white hover:bg-brand-800'
          }`}
        >
          <FileText className="w-4 h-4" aria-hidden="true" />
          <span>ส่งออก SRT</span>
        </button>
      )}
    </div>
  );

  const managementMenu = (
    <details key="project-management" ref={managementRef} name="project-header" className="group relative col-start-2 row-start-1 justify-self-end lg:col-start-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 group-open:border-brand-700 group-open:bg-brand-50 group-open:text-brand-900 [&::-webkit-details-marker]:hidden">
        จัดการ <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div onClick={(event) => { if ((event.target as HTMLElement).closest('button') && !(event.target as HTMLElement).closest('[data-job-storage]') && managementRef.current) managementRef.current.open = false; }} className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-1.5 text-sm shadow-lg">
        {canShowGenerate && isRegenerating && <button type="button" onClick={generateAd} disabled={isBusy} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><Sparkles className="w-4 h-4" aria-hidden="true" />สร้างบทบรรยายใหม่</button>}
        {videoFile && <button type="button" onClick={onRunVad} disabled={!canRunVad} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><RefreshCw className="w-4 h-4" aria-hidden="true" />สแกนเสียงใหม่</button>}
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(checkingFileName) || isDetecting} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><Upload className="w-4 h-4" aria-hidden="true" />เปลี่ยนวิดีโอ</button>
        <div className="my-1 border-t border-slate-200" />
        <button type="button" onClick={onResetJob} disabled={Boolean(checkingFileName) || isDetecting} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><RotateCcw className="w-4 h-4" aria-hidden="true" />เริ่มงานใหม่</button>
        <div data-job-storage><JobStorageManager /></div>
      </div>
    </details>
  );

  // Keep project controls in the header and processing details beside the workspace.
  return (
    <section
      className="relative shrink-0"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,.mp4"
        onChange={handleFileChange}
        className="hidden"
      />

      {headerActionsElement && createPortal(
        isWideHeader ? [projectControls, managementMenu] : [managementMenu, projectControls],
        headerActionsElement
      )}

      {/* Validation Issues or Error Banner */}
      {(validationIssues.length > 0 || errorMessage) && !(status === 'FAILED' && !vadOutput) && (
        <div role={errorMessage || hasBlockingErrors ? 'alert' : 'status'} className={`px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2 text-sm ${errorMessage || hasBlockingErrors ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {errorMessage ||
                validationIssues.map((i) => i.message).join(' · ')}
            </span>
          </div>
        </div>
      )}

      {activityFeedback && (
        <div
          role="progressbar"
          aria-label={activityFeedback.title}
          aria-valuenow={activityFeedback.percent}
          aria-valuetext={
            activityFeedback.percent !== undefined
              ? `${activityFeedback.percent}%${activityFeedback.detail ? ` · ${activityFeedback.detail}` : ''}`
              : activityFeedback.description
          }
          aria-valuemin={0}
          aria-valuemax={100}
          className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[3px] overflow-hidden bg-brand-100"
        >
          {activityFeedback.percent !== undefined && activityFeedback.percent > 0 ? (
            <div
              className="relative h-full overflow-hidden bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, activityFeedback.percent)}%` }}
            >
              <div className="progress-shimmer-sweep absolute inset-0" />
              <div className="absolute right-0 top-0 bottom-0 w-3 bg-gradient-to-r from-transparent to-brand-200/90" />
            </div>
          ) : (
            <>
              <div className="progress-indeterminate-primary absolute inset-0" />
              <div className="progress-indeterminate-secondary absolute inset-0" />
            </>
          )}
        </div>
      )}

      <div
        id="analysis-details"
        ref={analysisDetailsRef}
        role="region"
        aria-labelledby="analysis-details-title"
        hidden={!isQueueExpanded}
        className="absolute left-3 right-3 top-full z-40 mt-2 rounded-lg border border-slate-300 bg-white shadow-lg sm:left-auto sm:right-4 sm:w-[calc(100%_-_2rem)] sm:max-w-4xl"
      >
        <div className="max-h-[50vh] overflow-y-auto rounded-lg">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-brand-200 bg-brand-100 px-4 py-2 text-brand-950">
            <h2 id="analysis-details-title" className="text-sm font-semibold">รายละเอียดการทำงาน</h2>
            <button type="button" onClick={() => { setIsQueueExpanded(false); statusButtonRef.current?.focus(); }} aria-label="ปิดรายละเอียดการทำงาน" title="ปิดรายละเอียด (Esc)" className="inline-flex items-center justify-center rounded text-brand-700 hover:bg-brand-200 hover:text-brand-950 focus-visible:outline-brand-700 cursor-pointer">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="border-b border-brand-100 bg-brand-50/60 px-4 py-3 space-y-3">
            {activityFeedback && (
              <div className="rounded-lg border border-brand-200 bg-white px-3.5 py-2.5">
                <VideoProcessingStatus feedback={activityFeedback} compact />
              </div>
            )}
            {vadOutput ? (
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <div className="flex items-center gap-2"><dt className="text-slate-600">เสียงพูด</dt><dd className="font-medium tabular-nums text-slate-800">{vadOutput.speech_segments.length} ช่วง · {speechPercent}%</dd></div>
                <div className="flex items-center gap-2"><dt className="text-slate-600">ช่วงสำหรับบรรยาย</dt><dd className="font-semibold tabular-nums text-brand-800">{vadOutput.candidate_spots.length} ช่วง</dd></div>
                <div className="flex items-center gap-2"><dt className="text-slate-600">เวลาที่ไม่มีเสียงพูด</dt><dd className="font-medium tabular-nums text-slate-800">{formatCompactTime(nonSpeechDurationMs)}</dd></div>
              </dl>
            ) : <p className="text-xs text-slate-600">ผลตรวจเสียงและช่วงสำหรับบรรยายจะแสดงเมื่อตรวจเสร็จ</p>}
            {videoFile && vadOutput && vadOutput.candidate_spots.length > 0 && status !== 'READY' && !isBusy && (
              <p className="text-xs leading-relaxed text-slate-600">เมื่อกดสร้างบทบรรยาย วิดีโอจะถูกส่งไปวิเคราะห์ด้วย Google Gemini</p>
            )}
          </div>
          {batches.length > 0 && (
            <div className="bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h3 className="text-xs font-semibold text-slate-900">คิววิเคราะห์</h3>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-slate-600">
                  <span className={completedBatchesCount > 0 ? 'font-medium text-brand-800' : undefined}>เสร็จ {completedBatchesCount}/{batches.length}</span>
                  <span className={processingBatch ? 'font-medium text-brand-800' : undefined}>กำลังทำ {processingBatch ? 1 : 0}</span>
                  <span className={pendingBatchesCount > 0 ? 'font-medium text-amber-800' : undefined}>รอคิว {pendingBatchesCount}</span>
                  {failedBatchesCount > 0 && <span className="font-medium text-red-700">ไม่สำเร็จ {failedBatchesCount}</span>}
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-600">เลือกชุดเพื่อไปยังช่วงบรรยายแรกของชุดนั้น</p>
              <div className={`mt-2 grid gap-1.5 ${batches.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                {batches.map((batch) => {
                  const firstSpotId = batch.candidate_spots[0]?.spot_id;
                  const colors = batchColors[batch.status];
                  return (
                    <button
                      key={batch.batch_id}
                      type="button"
                      disabled={!firstSpotId}
                      onClick={() => { if (firstSpotId) onSelectSpot(firstSpotId, true); }}
                      aria-label={`ชุดที่ ${batch.batch_index} · ${formatCompactTime(batch.batch_start_ms)} ถึง ${formatCompactTime(batch.batch_end_ms)} · ${batch.status === 'processing' ? 'กำลังวิเคราะห์' : batch.status === 'completed' ? 'เสร็จแล้ว' : batch.status === 'failed' ? 'ทำไม่สำเร็จ' : 'รอคิว'}`}
                      className={`flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60 ${colors.surface} ${colors.foreground}`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">ชุด {batch.batch_index}<span className={`ml-2 font-normal tabular-nums ${colors.secondary}`}>{formatCompactTime(batch.batch_start_ms)}–{formatCompactTime(batch.batch_end_ms)}</span></p>
                        <p className={`mt-1 ${colors.secondary}`}>{batch.candidate_spots.length} ช่วงบรรยาย</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium ${colors.badge}`}>
                        {batch.status === 'processing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : batch.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : batch.status === 'failed' ? <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                        {batch.status === 'processing' ? 'กำลังวิเคราะห์' : batch.status === 'completed' ? 'เสร็จแล้ว' : batch.status === 'failed' ? 'ทำไม่สำเร็จ' : 'รอคิว'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
