import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import type { ProcessingFeedback } from '../utils/processingFeedback';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileVideo,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
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

interface UploadAndVadPanelProps {
  headerActionsElement: HTMLDivElement | null;
  checkingFileName: string | null;
  processingFeedback: ProcessingFeedback | null;
  status: JobStatus;
  videoFile: File | null;
  videoMetadata: VideoMetadata | null;
  validationIssues: VideoValidationIssue[];
  vadOutput: VADOutput | null;
  vadProgress: {
    stage: string;
    percent: number;
    processedMs?: number;
    totalMs?: number;
  } | null;
  batches: AnalysisBatch[];
  spots: ADSpot[];
  onSelectFile: (file: File) => void;
  onRunVad: () => void;
  onStartGeminiAnalysis: () => void;
  onRetryFailedBatches: () => void;
  onResetJob: () => void;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
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
  vadProgress,
  batches,
  spots,
  onSelectFile,
  onRunVad,
  onStartGeminiAnalysis,
  onRetryFailedBatches,
  onResetJob,
  onSelectSpot,
  errorMessage,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const managementRef = useRef<HTMLDetailsElement | null>(null);
  const statusButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isWideHeader, setIsWideHeader] = useState(false);

  const isDetecting = status === 'DETECTING';
  const isAnalyzing = status === 'ANALYZING';
  const isBusy = Boolean(checkingFileName) || isDetecting || isAnalyzing;

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
  }, []);

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
  const statusText = processingFeedback
    ? `${processingFeedback.title}${processingFeedback.percent !== undefined ? ` ${processingFeedback.percent}%` : ''}`
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
                  ? 'border-slate-900 bg-slate-50'
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
                <button type="button" onClick={() => fileInputRef.current?.click()} aria-describedby={errorMessage || hasBlockingErrors ? 'upload-requirements upload-feedback' : 'upload-requirements'} className="px-6 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md flex items-center gap-2 cursor-pointer">
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
      <details ref={videoDetailsRef} name="project-header" className="relative min-w-0 flex-1 basis-36 lg:max-w-xs">
        <summary aria-label={`รายละเอียดวิดีโอ: ${fileName}`} className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <FileVideo className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium">{fileName}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
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
        aria-label={`${statusText} · ดูรายละเอียดการทำงาน`}
        className={`flex min-h-10 max-w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium cursor-pointer transition-colors ${errorMessage || failedBatchesCount > 0 ? 'bg-red-50 text-red-800 hover:bg-red-100' : isBusy || !vadOutput?.candidate_spots.length ? 'bg-slate-100 text-slate-800 hover:bg-slate-200' : 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100'}`}
      >
        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" /> : <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
        <span role={processingFeedback ? undefined : 'status'} className="min-w-0 text-left">{statusText}</span>
        {isQueueExpanded ? <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      </button>

      {canShowGenerate && !isBusy && !isRegenerating && (
        <button type="button" onClick={generateAd} disabled={!canGenerateAd && failedBatchesCount === 0} className="flex min-h-10 grow items-center justify-center gap-2 whitespace-nowrap rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer sm:grow-0">
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          {needsResume ? 'ทำต่อจากชุดที่ค้าง' : 'สร้างบทบรรยายภาพ'}
        </button>
      )}
    </div>
  );

  const managementMenu = (
    <details key="project-management" ref={managementRef} name="project-header" className="relative col-start-2 row-start-1 justify-self-end lg:col-start-3">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        จัดการ <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </summary>
      <div onClick={(event) => { if ((event.target as HTMLElement).closest('button') && managementRef.current) managementRef.current.open = false; }} className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-1.5 text-sm shadow-lg">
        {canShowGenerate && isRegenerating && <button type="button" onClick={generateAd} disabled={isBusy} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><Sparkles className="w-4 h-4" aria-hidden="true" />สร้างบทบรรยายใหม่</button>}
        {videoFile && <button type="button" onClick={onRunVad} disabled={!canRunVad} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><RefreshCw className="w-4 h-4" aria-hidden="true" />สแกนเสียงใหม่</button>}
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><Upload className="w-4 h-4" aria-hidden="true" />เปลี่ยนวิดีโอ</button>
        <div className="my-1 border-t border-slate-200" />
        <button type="button" onClick={onResetJob} disabled={isBusy} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"><RotateCcw className="w-4 h-4" aria-hidden="true" />เริ่มงานใหม่</button>
      </div>
    </details>
  );

  // Keep project controls in the header and processing details beside the workspace.
  return (
    <section
      className="shrink-0"
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

      {/* Expandable Queue & Pipeline Monitor Drawer */}
      {isQueueExpanded && (
        <div id="analysis-details" className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-3 max-h-[60vh] lg:max-h-[45vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">รายละเอียดการทำงาน</h2>
            <button type="button" onClick={() => { setIsQueueExpanded(false); statusButtonRef.current?.focus(); }} className="px-2 text-xs text-slate-600 hover:text-slate-900 underline cursor-pointer">ปิดรายละเอียด</button>
          </div>
          {processingFeedback && <p className="text-sm text-slate-600">{processingFeedback.detail || processingFeedback.title}</p>}
          {vadOutput && (
            <div className="space-y-2 text-xs text-slate-600">
              <p>เสียงพูด {vadOutput.speech_segments.length} ช่วง ({speechPercent}%) · ช่วงว่าง {vadOutput.candidate_spots.length} ช่วง ({formatCompactTime(nonSpeechDurationMs)})</p>
              {videoFile && vadOutput.candidate_spots.length > 0 && status !== 'READY' && (
                <p>เมื่อกดสร้างบทบรรยาย วิดีโอจะถูกส่งไปวิเคราะห์ด้วย Google Gemini</p>
              )}
            </div>
          )}
          {/* Batch Queue Grid (Click any batch to jump to its first spot) */}
          {batches.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">
                    สถานะคิวงานรายชุด (คลิกเพื่อเลื่อนไปยังจุดบรรยายในชุดนั้น)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    เสร็จแล้ว {completedBatchesCount} ชุด · กำลังทำ {processingBatch ? 1 : 0} ชุด · รอคิว {pendingBatchesCount} ชุด
                    {failedBatchesCount > 0 ? ` · ล้มเหลว ${failedBatchesCount} ชุด` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { setIsQueueExpanded(false); statusButtonRef.current?.focus(); }}
                  className="text-xs text-slate-500 hover:text-slate-900 underline cursor-pointer"
                >
                  ซ่อนแผงคิวงาน
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {batches.map((b) => {
                  const firstSpotId = b.candidate_spots[0]?.spot_id;
                  return (
                    <button
                      key={b.batch_id}
                      type="button"
                      onClick={() => {
                        if (firstSpotId) {
                          onSelectSpot(firstSpotId, true);
                        }
                      }}
                      className={`p-2.5 rounded border text-left transition-colors cursor-pointer flex flex-col justify-between gap-1.5 ${
                        b.status === 'processing'
                          ? 'border-slate-900 bg-white ring-1 ring-slate-900'
                          : b.status === 'completed'
                          ? 'border-slate-200 bg-white hover:bg-slate-50'
                          : b.status === 'failed'
                          ? 'border-red-300 bg-red-50/60 hover:bg-red-50'
                          : 'border-slate-200 bg-white/60 hover:bg-white text-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-slate-900">
                          ชุดที่ {b.batch_index}
                        </span>
                        <span className="font-mono tabular-nums text-xs text-slate-500">
                          {formatCompactTime(b.batch_start_ms)}–{formatCompactTime(b.batch_end_ms)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono tabular-nums text-slate-500">
                          {b.candidate_spots.length} จุดบรรยาย
                        </span>

                        {b.status === 'completed' && (
                          <span className="text-emerald-700 font-medium flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>เสร็จสิ้น</span>
                          </span>
                        )}
                        {b.status === 'processing' && (
                          <span className="text-slate-900 font-semibold flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>กำลังวิเคราะห์...</span>
                          </span>
                        )}
                        {b.status === 'pending' && (
                          <span className="text-amber-700 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>รอคิว</span>
                          </span>
                        )}
                        {b.status === 'failed' && (
                          <span className="text-red-700 font-medium flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            <span>ล้มเหลว</span>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
