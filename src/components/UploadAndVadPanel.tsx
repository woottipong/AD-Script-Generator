import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileVideo,
  Layers,
  Loader2,
  Play,
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
  onLoadSampleVideo: () => void;
  isLoadingSample: boolean;
  onRunVad: () => void;
  onStartGeminiAnalysis: () => void;
  onRetryFailedBatches: () => void;
  onResetJob: () => void;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  errorMessage: string | null;
}

export const UploadAndVadPanel: React.FC<UploadAndVadPanelProps> = ({
  status,
  videoFile,
  videoMetadata,
  validationIssues,
  vadOutput,
  vadProgress,
  batches,
  spots,
  onSelectFile,
  onLoadSampleVideo,
  isLoadingSample,
  onRunVad,
  onStartGeminiAnalysis,
  onRetryFailedBatches,
  onResetJob,
  onSelectSpot,
  errorMessage,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isDetecting = status === 'DETECTING';
  const isAnalyzing = status === 'ANALYZING';
  const isBusy = isDetecting || isAnalyzing;

  // Auto-expand queue drawer when actively processing or when an error occurs
  useEffect(() => {
    if (isDetecting || isAnalyzing || status === 'FAILED' || errorMessage) {
      setIsQueueExpanded(true);
    }
  }, [isDetecting, isAnalyzing, status, errorMessage]);

  // Live elapsed timer during active jobs so the editor sees real-time activity
  useEffect(() => {
    if (!isBusy) {
      setElapsedSeconds(0);
      return;
    }
    const startTs = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTs) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isBusy]);

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

  const formatElapsed = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  // Determine current pipeline stage for the 4-stage visual stepper
  const stageText = vadProgress?.stage || '';
  const isUploadingStage = isAnalyzing && stageText.includes('อัปโหลดวิดีโอ');
  const isIndexingStage =
    isAnalyzing &&
    (stageText.includes('Files API') ||
      stageText.includes('เตรียมไฟล์วิดีโอ') ||
      stageText.includes('เริ่มต้นงานวิเคราะห์'));
  const isBatchingStage =
    isAnalyzing && !isUploadingStage && !isIndexingStage;

  const hasLoadedProject = Boolean(videoMetadata || vadOutput || videoFile);

  // If no video is loaded yet, show a clean studio intake workspace bar
  if (!hasLoadedProject) {
    return (
      <section
        id="section-upload-vad"
        className="bg-white border-b border-slate-200 px-4 sm:px-6 py-5"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,.mp4"
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Dropzone (7 cols) */}
          <div className="lg:col-span-7">
            <div
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
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-md p-4 sm:p-5 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                isDragging
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-300 hover:border-slate-500 bg-slate-50/50'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    เปิดโปรเจกต์วิดีโอ MP4 เพื่อเริ่มตัดต่อบทบรรยายภาพ (AD)
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    ลากไฟล์ MP4 มาวาง หรือคลิกเลือกไฟล์ · รองรับ 480p (854×480) H.264 + AAC · สูงสุด 30 นาที
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLoadSampleVideo();
                  }}
                  disabled={isLoadingSample}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {isLoadingSample ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>โหลดวิดีโอตัวอย่าง 480p</span>
                </button>
              </div>
            </div>
          </div>

          {/* Workflow Pipeline Overview (5 cols) */}
          <div className="lg:col-span-5 lg:border-l border-slate-200 lg:pl-6 space-y-2">
            <div className="text-xs font-semibold text-slate-900">
              ขั้นตอนการทำงานอัตโนมัติสำหรับผู้แก้ไขบทบรรยาย
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs text-slate-600">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="font-mono tabular-nums font-bold text-slate-900 block">
                  01 · Silero VAD
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  สแกนหาช่องว่างไร้เสียงพูด ≥ 3.0s ในเบราว์เซอร์
                </span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="font-mono tabular-nums font-bold text-slate-900 block">
                  02 · Batch Queue
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  แบ่งคิววิเคราะห์ทีละ 120 วินาที พร้อมสถานะรายชุด
                </span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="font-mono tabular-nums font-bold text-slate-900 block">
                  03 · NLE Editor
                </span>
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  ปรับคำพูด ขยับเวลา ±0.2s และส่งออก .SRT ทันที
                </span>
              </div>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 p-2.5 rounded border border-red-200 bg-red-50 text-red-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{errorMessage}</span>
          </div>
        )}
      </section>
    );
  }

  // Loaded Project State: Compact High-Density Studio Command Bar + Expandable Queue Drawer
  return (
    <section
      id="section-upload-vad"
      className="bg-white border-b border-slate-200 shrink-0"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,.mp4"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Compact Studio Project & Queue Ribbon */}
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Active File & Audio/VAD Telemetry */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <FileVideo className="w-4 h-4 text-slate-700 shrink-0" />
            <span
              className="font-semibold text-slate-900 truncate max-w-[220px] sm:max-w-[300px]"
              title={videoMetadata?.fileName || videoFile?.name}
            >
              {videoMetadata?.fileName || videoFile?.name || 'วิดีโอโปรเจกต์'}
            </span>
          </div>

          {videoMetadata && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-600">
                {videoMetadata.width}×{videoMetadata.height}
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-600">
                {formatCompactTime(totalDurationMs)}
              </span>
              {videoMetadata.fileSize > 0 && (
                <>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {formatFileSize(videoMetadata.fileSize)}
                  </span>
                </>
              )}
            </>
          )}

          {vadOutput && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-slate-600">
                เสียงพูด{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {vadOutput.speech_segments.length}
                </strong>{' '}
                ช่วง ({speechPercent}%)
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-slate-600">
                ช่องว่าง{' '}
                <strong className="font-mono tabular-nums text-emerald-700">
                  {vadOutput.candidate_spots.length} จุด
                </strong>{' '}
                ({formatCompactTime(nonSpeechDurationMs)})
              </span>
            </>
          )}
        </div>

        {/* Right: Live Status Trigger, Queue Drawer Toggle, and Primary Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Live Job / Queue Status Summary Button */}
          {(batches.length > 0 || isBusy) && (
            <button
              type="button"
              onClick={() => setIsQueueExpanded((prev) => !prev)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors flex items-center gap-2 cursor-pointer ${
                isBusy
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : failedBatchesCount > 0
                  ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {isBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Layers className="w-3.5 h-3.5 shrink-0" />
              )}

              <span className="font-mono tabular-nums">
                {isDetecting
                  ? `กำลังสแกนเสียง ${vadProgress?.percent ?? 0}%`
                  : isAnalyzing
                  ? `กำลังทำงาน: ชุดที่ ${
                      processingBatch?.batch_index ?? completedBatchesCount + 1
                    }/${batches.length} (${formatElapsed(elapsedSeconds)})`
                  : `คิวงาน: ${completedBatchesCount}/${batches.length} ชุด`}
              </span>

              {pendingSpotsCount > 0 && !isBusy && (
                <span className="text-amber-700 font-mono tabular-nums">
                  · รอสร้าง {pendingSpotsCount} จุด
                </span>
              )}

              {isQueueExpanded ? (
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>
          )}

          {/* Re-run VAD if file exists */}
          {videoFile && !isBusy && (
            <button
              type="button"
              onClick={onRunVad}
              disabled={!canRunVad}
              title="สแกนหาช่วงว่างไร้เสียงพูดใหม่"
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">สแกนเสียงใหม่</span>
            </button>
          )}

          {/* Primary Generate / Resume Button */}
          {vadOutput && vadOutput.candidate_spots.length > 0 && (
            <button
              type="button"
              onClick={
                failedBatchesCount > 0 || (completedBatchesCount > 0 && completedBatchesCount < batches.length)
                  ? onRetryFailedBatches
                  : onStartGeminiAnalysis
              }
              disabled={!canGenerateAd && !(failedBatchesCount > 0 && !isBusy)}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {isAnalyzing
                  ? 'กำลังวิเคราะห์วิดีโอ...'
                  : failedBatchesCount > 0
                  ? `ลองใหม่ชุดที่ค้าง (${failedBatchesCount} ชุด)`
                  : completedBatchesCount > 0 && completedBatchesCount < batches.length
                  ? `ทำต่อชุดที่เหลือ (${batches.length - completedBatchesCount} ชุด)`
                  : generatedSpotsCount > 0 && pendingSpotsCount === 0
                  ? 'วิเคราะห์บทบรรยายใหม่ทั้งหมด'
                  : `สร้างบทบรรยายภาพ (${vadOutput.candidate_spots.length} จุด)`}
              </span>
            </button>
          )}

          {/* Change Video File Button */}
          <button
            type="button"
            onClick={() => {
              if (!isBusy) {
                fileInputRef.current?.click();
              }
            }}
            disabled={isBusy}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
          >
            <Upload className="w-3 h-3" />
            <span>เปลี่ยนวิดีโอ</span>
          </button>

          <button
            type="button"
            onClick={onResetJob}
            disabled={isBusy}
            title="ล้างโปรเจกต์ปัจจุบัน"
            className="p-1.5 text-xs text-slate-500 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active Progress Bar Strip (Always visible when detecting or analyzing) */}
      {vadProgress && (
        <div className="px-4 py-2 bg-slate-900 text-white border-t border-slate-800 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
              <span className="font-medium truncate">{vadProgress.stage}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-slate-300">
              {isBusy && (
                <span>เวลาที่ใช้: {formatElapsed(elapsedSeconds)}</span>
              )}
              <span className="text-white font-semibold">{vadProgress.percent}%</span>
            </div>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-transform duration-200 origin-left"
              style={{ transform: `scaleX(${Math.max(0.02, vadProgress.percent / 100)})` }}
            />
          </div>
        </div>
      )}

      {/* Validation Issues or Error Banner */}
      {(validationIssues.length > 0 || errorMessage) && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex flex-wrap items-center justify-between gap-2 text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>
              {errorMessage ||
                validationIssues.map((i) => i.message).join(' · ')}
            </span>
          </div>
          {failedBatchesCount > 0 && !isBusy && (
            <button
              type="button"
              onClick={onRetryFailedBatches}
              className="px-2.5 py-1 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              กดลองใหม่เฉพาะชุดที่ค้าง
            </button>
          )}
        </div>
      )}

      {/* Expandable Queue & Pipeline Monitor Drawer */}
      {isQueueExpanded && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 space-y-3">
          {/* 4-Stage Pipeline Tracker */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
            {/* Step 1: Silero VAD */}
            <div
              className={`px-3 py-2 rounded border flex items-center justify-between ${
                isDetecting
                  ? 'border-slate-900 bg-white text-slate-900 font-semibold'
                  : vadOutput
                  ? 'border-slate-200 bg-white text-slate-700'
                  : 'border-slate-200 bg-slate-100/60 text-slate-400'
              }`}
            >
              <span className="truncate">1. ถอดรหัสเสียง Silero VAD</span>
              {isDetecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-900 shrink-0" />
              ) : vadOutput ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 shrink-0" />
              )}
            </div>

            {/* Step 2: Chunked Video Upload */}
            <div
              className={`px-3 py-2 rounded border flex items-center justify-between ${
                isUploadingStage
                  ? 'border-slate-900 bg-white text-slate-900 font-semibold'
                  : completedBatchesCount > 0 || isIndexingStage || isBatchingStage
                  ? 'border-slate-200 bg-white text-slate-700'
                  : 'border-slate-200 bg-slate-100/60 text-slate-400'
              }`}
            >
              <span className="truncate">2. อัปโหลดวิดีโอ (8MB Chunks)</span>
              {isUploadingStage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-900 shrink-0" />
              ) : completedBatchesCount > 0 || isIndexingStage || isBatchingStage ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 shrink-0" />
              )}
            </div>

            {/* Step 3: Gemini Files API Indexing */}
            <div
              className={`px-3 py-2 rounded border flex items-center justify-between ${
                isIndexingStage
                  ? 'border-slate-900 bg-white text-slate-900 font-semibold'
                  : completedBatchesCount > 0 || isBatchingStage
                  ? 'border-slate-200 bg-white text-slate-700'
                  : 'border-slate-200 bg-slate-100/60 text-slate-400'
              }`}
            >
              <span className="truncate">3. เตรียมดัชนีวิดีโอ Files API</span>
              {isIndexingStage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-900 shrink-0" />
              ) : completedBatchesCount > 0 || isBatchingStage ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 shrink-0" />
              )}
            </div>

            {/* Step 4: Batch Generation */}
            <div
              className={`px-3 py-2 rounded border flex items-center justify-between ${
                isBatchingStage
                  ? 'border-slate-900 bg-white text-slate-900 font-semibold'
                  : batches.length > 0 && completedBatchesCount === batches.length
                  ? 'border-slate-200 bg-white text-emerald-700 font-semibold'
                  : 'border-slate-200 bg-slate-100/60 text-slate-400'
              }`}
            >
              <span className="truncate">
                4. สร้างบทบรรยาย ({completedBatchesCount}/{batches.length} ชุด)
              </span>
              {isBatchingStage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-900 shrink-0" />
              ) : batches.length > 0 && completedBatchesCount === batches.length ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="w-3.5 h-3.5 shrink-0" />
              )}
            </div>
          </div>

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
                  onClick={() => setIsQueueExpanded(false)}
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
                        <span className="font-mono tabular-nums text-[11px] text-slate-500">
                          {formatCompactTime(b.batch_start_ms)}–{formatCompactTime(b.batch_end_ms)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
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
