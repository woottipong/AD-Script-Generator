import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import { focusIntakeFeedback, IntakeDropzone, IntakeFooter, IntakeShell, selectIntakeFile, type GenerateDraft, type IntakeControls } from './IntakeShell';
import { isMp4File } from '../utils/videoValidator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ProcessingFeedback } from '../utils/processingFeedback';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  FileVideo,
  Layers,
  List,
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
  JobMode,
  JobStatus,
  VADOutput,
  VideoMetadata,
  VideoValidationIssue,
} from '../types/ad';
import {
  formatCompactTime,
  formatFileSize,
} from '../utils/formatters';
import { defaultJobTitle } from '../utils/jobValidation';

const batchColors = {
  pending: {
    surface: 'border-border bg-card hover:border-warning-strong-border hover:bg-warning',
    foreground: 'text-foreground',
    secondary: 'text-muted-foreground',
    badge: 'bg-warning-strong text-warning-strong-foreground',
  },
  processing: {
    surface: 'border-brand-500 bg-brand-100 hover:bg-brand-200',
    foreground: 'text-brand-950',
    secondary: 'text-brand-900',
    badge: 'bg-brand-800 text-white',
  },
  completed: {
    surface: 'border-brand-200 bg-card hover:border-brand-300 hover:bg-brand-50',
    foreground: 'text-foreground',
    secondary: 'text-muted-foreground',
    badge: 'bg-brand-100 text-brand-900',
  },
  failed: {
    surface: 'border-error-border bg-error-surface hover:bg-destructive/15',
    foreground: 'text-error-foreground',
    secondary: 'text-error-foreground',
    badge: 'bg-destructive/15 text-error-foreground',
  },
};

interface UploadAndVadPanelProps {
  mode: JobMode;
  intake: IntakeControls;
  draft: GenerateDraft;
  setDraft: React.Dispatch<React.SetStateAction<GenerateDraft>>;
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
  onSelectFile: (file: File, title?: string) => void;
  onRunVad: () => void;
  onStartGeminiAnalysis: () => void;
  onRetryFailedBatches: () => void;
  onResetJob: () => void;
  onOpenJobList: () => void;
  jobTitle: string;
  onRenameJob: (title: string) => Promise<'saved' | 'local'>;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  onExportSrt: () => void;
  errorMessage: string | null;
}

export const UploadAndVadPanel: React.FC<UploadAndVadPanelProps> = ({
  mode,
  intake,
  draft,
  setDraft,
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
  onOpenJobList,
  jobTitle,
  onRenameJob,
  onSelectSpot,
  onExportSrt,
  errorMessage,
}) => {
  const isReview = mode === 'review';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [titleDraft, setTitleDraft] = useState(jobTitle);
  const [renameState, setRenameState] = useState<{ status: 'idle' | 'saving' | 'saved' | 'local' | 'error'; message?: string }>({ status: 'idle' });
  useEffect(() => {
    setTitleDraft(jobTitle);
  }, [jobTitle]);
  const renameJob = async (event: React.FormEvent) => {
    event.preventDefault();
    setRenameState({ status: 'saving' });
    try {
      setRenameState({ status: await onRenameJob(titleDraft) });
    } catch (err) {
      setRenameState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
  const [isDragging, setIsDragging] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const { file: stagedFile, title: typedTitle } = draft;
  const resolvedTitle = typedTitle ?? (stagedFile ? defaultJobTitle(stagedFile.name) : '');
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isWideHeader, setIsWideHeader] = useState(false);
  const [activityElapsedMs, setActivityElapsedMs] = useState(0);

  const hasLoadedProject = Boolean(videoMetadata || vadOutput || videoFile);
  const isDetecting = status === 'DETECTING';
  const isAnalyzing = status === 'ANALYZING';
  const isBusy = Boolean(checkingFileName) || isDetecting || isAnalyzing;
  const activityFeedback: ProcessingFeedback | null = checkingFileName
    ? { title: 'กำลังตรวจสอบวิดีโอ', description: 'กำลังตรวจรูปแบบไฟล์ ความละเอียด และแทร็กเสียง' }
    : processingFeedback;

  useEffect(() => {
    if (!hasLoadedProject || !activityFeedback?.title) {
      setActivityElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setActivityElapsedMs(0);
    const timer = setInterval(() => setActivityElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [hasLoadedProject, activityFeedback?.title]);

  useEffect(() => {
    if (!hasLoadedProject) return;
    // Match keyboard order to the header layout without duplicating its controls.
    const query = window.matchMedia('(min-width: 1024px)');
    const updateLayout = () => setIsWideHeader(query.matches);
    updateLayout();
    query.addEventListener('change', updateLayout);
    return () => query.removeEventListener('change', updateLayout);
  }, [hasLoadedProject]);

  const stageVideo = (files: FileList | null) => {
    const selection = selectIntakeFile(files, isMp4File, 'กรุณาเลือกไฟล์วิดีโอ MP4');
    if (!selection) return;
    intake.onInputChange();
    setInputError(selection.kind === 'invalid' ? selection.message : null);
    if (selection.kind === 'file') setDraft((current) => ({ ...current, file: selection.file }));
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (!isBusy) stageVideo(event.dataTransfer.files);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (hasLoadedProject) {
      if (files?.[0]) onSelectFile(files[0]);
    } else {
      stageVideo(files);
    }
    event.target.value = '';
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

  const canShowGenerate = !isReview && Boolean(vadOutput?.candidate_spots.length) &&
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
    : isReview
    ? `ตรวจแก้ SRT · ${spots.length} บรรทัด`
    : status === 'READY'
    ? 'วิเคราะห์เสร็จแล้ว'
    : vadOutput?.candidate_spots.length === 0
    ? 'ไม่พบช่วงว่าง'
    : needsResume
    ? 'มีงานที่ยังไม่เสร็จ'
    : vadOutput
    ? `พร้อมสร้าง · ${vadOutput.candidate_spots.length} ช่วง`
    : 'กำลังเตรียมวิดีโอ';

  // If no video is loaded yet, show a clean studio intake workspace bar
  if (!hasLoadedProject) {
    const errorAlert = (inputError || errorMessage || hasBlockingErrors) ? (
      <Alert id="upload-feedback" ref={focusIntakeFeedback} tabIndex={-1} variant="destructive">
        <AlertCircle />
        <AlertTitle>{hasBlockingErrors ? 'วิดีโอไม่ผ่านสเปค' : 'ไม่สามารถเลือกวิดีโอได้'}</AlertTitle>
        <AlertDescription>
          {inputError || errorMessage ? <p>{inputError || errorMessage}</p> : (
            <ul className="list-disc pl-5">
              {validationIssues.filter((issue) => issue.severity === 'error').map((issue, index) => (
                <li key={`${issue.field}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          )}
          {hasBlockingErrors && <p className="mt-2">กรุณาเลือกวิดีโอที่ตรงตามสเปคด้านบน</p>}
        </AlertDescription>
      </Alert>
    ) : null;

    return (
      <IntakeShell
        title="เริ่มงานบทบรรยายภาพ"
        description="สร้างบทบรรยายจากวิดีโอ หรือตรวจแก้ไฟล์ SRT ที่มีอยู่"
        modeSwitch={intake.modeSwitch}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,.mp4"
          disabled={Boolean(checkingFileName)}
          onChange={handleFileChange}
          className="hidden"
          aria-label="เลือกวิดีโอ MP4"
        />

        {checkingFileName ? (
          <div className="w-full mx-auto">
            <p className="mb-3 [overflow-wrap:anywhere] text-sm font-medium text-foreground">{checkingFileName}</p>
            <VideoProcessingStatus feedback={{ title: 'กำลังตรวจสอบวิดีโอ', description: 'ตรวจรูปแบบไฟล์ ความละเอียด และเสียง' }} onCancel={intake.onCancelCheck} />
            {errorAlert && <div className="mt-4">{errorAlert}</div>}
          </div>
        ) : (
          <FieldGroup className="gap-5">
            <Field aria-labelledby="generate-video-label">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <FieldTitle id="generate-video-label">วิดีโอ MP4</FieldTitle>
                <span id="upload-requirements" className="text-xs text-muted-foreground">
                  480p · H.264 + AAC · ไม่เกิน 30 นาที · 2 GB
                </span>
              </div>
              <IntakeDropzone
                file={stagedFile}
                isDragging={isDragging}
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
                onPick={() => fileInputRef.current?.click()}
                onClear={() => {
                  setDraft((current) => ({ ...current, file: null }));
                  setInputError(null);
                  intake.onInputChange();
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                icon={<FileVideo className="size-5" />}
                emptyTitle="วางไฟล์ MP4 ที่นี่"
                fileSubtitle={stagedFile ? `${formatFileSize(stagedFile.size)} · MP4` : ''}
                pickLabel="เลือกวิดีโอ"
                clearLabel="ล้างไฟล์วิดีโอ"
                pickDescribedBy={errorAlert ? 'upload-requirements upload-feedback' : 'upload-requirements'}
              />
            </Field>

            <Field>
              <div className="flex items-baseline justify-between gap-2">
                <FieldLabel htmlFor="generate-title">ชื่องาน</FieldLabel>
                <span className="text-xs text-muted-foreground">ไม่บังคับ</span>
              </div>
              <Input
                id="generate-title"
                type="text"
                value={resolvedTitle}
                maxLength={120}
                onChange={(event) => { const title = event.target.value; setDraft((current) => ({ ...current, title })); }}
                placeholder="ใช้ชื่อไฟล์วิดีโอเมื่อเว้นว่าง"
              />
            </Field>

            {errorAlert}
            <p className="text-sm text-muted-foreground">
              ระบบจะตรวจเสียงบนเครื่องแล้วบันทึกวิดีโอไว้บนเซิร์ฟเวอร์ คุณเลือกเริ่มสร้างบทด้วย AI ได้ในหน้าตัดต่อ
            </p>

            <IntakeFooter
              actionLabel="ตรวจเสียงและเตรียมงาน"
              disabled={!stagedFile || Boolean(inputError) || hasBlockingErrors || !intake.canProcess}
              onCancel={onOpenJobList}
              onAction={() => { if (stagedFile) onSelectFile(stagedFile, resolvedTitle); }}
            />
          </FieldGroup>
        )}
      </IntakeShell>
    );
  }

  const projectControls = (
    <div key="project-controls" className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:justify-end">
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="lg" className="min-w-0 flex-1 basis-36 justify-start lg:max-w-xs" aria-label={`รายละเอียดงาน: ${jobTitle || fileName}`} />}>
          <FileVideo data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">{jobTitle || fileName}</span>
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-0 p-4">
          <form onSubmit={(event) => void renameJob(event)} className="mb-2 flex flex-col gap-1.5 border-b border-border pb-4">
            <Field data-invalid={renameState.status === 'error' || undefined}>
              <FieldLabel htmlFor="job-title">ชื่องาน</FieldLabel>
              <div className="flex gap-2">
                <Input id="job-title" type="text" value={titleDraft} maxLength={120} onChange={(event) => { setTitleDraft(event.target.value); setRenameState({ status: 'idle' }); }} aria-invalid={renameState.status === 'error'} className="min-w-0 flex-1" />
                <Button type="submit" disabled={!titleDraft.trim() || titleDraft.trim() === jobTitle || renameState.status === 'saving'}>บันทึกชื่อ</Button>
              </div>
              {renameState.status === 'error'
                ? <FieldError>{renameState.message}</FieldError>
                : (
                  <FieldDescription role="status">
                    {renameState.status === 'saving' ? 'กำลังบันทึกชื่อ…'
                      : renameState.status === 'saved' ? 'บันทึกชื่อบนเซิร์ฟเวอร์แล้ว'
                      : renameState.status === 'local' ? 'ชื่อนี้จะบันทึกเมื่อสร้างงานบนเซิร์ฟเวอร์'
                      : ''}
                  </FieldDescription>
                )}
            </Field>
          </form>
          <p className="[overflow-wrap:anywhere] font-semibold text-foreground">{fileName}</p>
          {videoMetadata && <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-muted-foreground">
            <dt>ความละเอียด</dt><dd className="text-right tabular-nums text-foreground">{videoMetadata.width} × {videoMetadata.height}</dd>
            <dt>ความยาว</dt><dd className="text-right tabular-nums text-foreground">{formatCompactTime(totalDurationMs)}</dd>
            {videoMetadata.fileSize > 0 && <><dt>ขนาดไฟล์</dt><dd className="text-right tabular-nums text-foreground">{formatFileSize(videoMetadata.fileSize)}</dd></>}
          </dl>}
        </PopoverContent>
      </Popover>

      {/* The status pill (DESIGN › Status Pill) keeps its state colours; it opens the processing details below it. */}
      <Popover open={isQueueExpanded} onOpenChange={setIsQueueExpanded}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="lg"
              aria-label={`${statusText}${activityFeedback?.detail ? ` · ${activityFeedback.detail}` : ''} · ดูรายละเอียดการทำงาน`}
              className={`max-w-full text-xs ${
                errorMessage || failedBatchesCount > 0
                  ? 'border-transparent bg-error-surface text-error-foreground hover:bg-destructive/15'
                  : activityFeedback
                  ? 'border-brand-200 bg-brand-50 text-brand-950 hover:bg-brand-100'
                  : status === 'READY' || !vadOutput?.candidate_spots.length
                  ? 'border-border bg-secondary text-secondary-foreground hover:bg-muted/80'
                  : 'border-transparent bg-brand-50 text-brand-900 hover:bg-brand-100'
              }`}
            />
          }
        >
          {isBusy ? (
            <Loader2 data-icon="inline-start" className="animate-spin text-brand-700" aria-hidden="true" />
          ) : (
            <Layers data-icon="inline-start" aria-hidden="true" />
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
          <ChevronDown data-icon="inline-end" className={`transition-transform ${isQueueExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" aria-labelledby="analysis-details-title" className={`w-[calc(100vw-1.5rem)] gap-0 p-0 ${batches.length > 0 ? 'sm:w-[36rem]' : 'sm:w-80'}`}>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-card px-4 pb-1 pt-3">
              <h2 id="analysis-details-title" className="font-semibold text-foreground">รายละเอียดการทำงาน</h2>
              <Button variant="ghost" size="icon-sm" className="-mr-1" onClick={() => setIsQueueExpanded(false)} aria-label="ปิดรายละเอียดการทำงาน">
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="space-y-3 px-4 pb-4 pt-2">
              {activityFeedback && (
                <p className="leading-relaxed text-muted-foreground">
                  {activityFeedback.detail || activityFeedback.description}
                </p>
              )}
              {vadOutput ? (
                <dl className={`grid gap-x-6 gap-y-2 text-muted-foreground ${batches.length > 0 ? 'grid-cols-[auto_1fr_auto_1fr]' : 'grid-cols-[auto_1fr]'}`}>
                  <dt>เสียงพูด</dt><dd className="text-right tabular-nums text-foreground">{vadOutput.speech_segments.length} ช่วง · {speechPercent}%</dd>
                  {isReview
                    ? <><dt>บรรทัดใน SRT</dt><dd className="text-right tabular-nums text-foreground">{spots.length} บรรทัด</dd></>
                    : <><dt>ช่วงสำหรับบรรยาย</dt><dd className="text-right tabular-nums text-foreground">{vadOutput.candidate_spots.length} ช่วง</dd></>}
                  <dt>เวลาที่ไม่มีเสียงพูด</dt><dd className="text-right tabular-nums text-foreground">{formatCompactTime(nonSpeechDurationMs)}</dd>
                </dl>
              ) : <p className="text-muted-foreground">ผลตรวจเสียงและช่วงสำหรับบรรยายจะแสดงเมื่อตรวจเสร็จ</p>}
              {!isReview && videoFile && vadOutput && vadOutput.candidate_spots.length > 0 && status !== 'READY' && !isBusy && (
                <p className="text-xs leading-relaxed text-muted-foreground">เมื่อกดสร้างบทบรรยาย วิดีโอจะถูกส่งไปวิเคราะห์ด้วย Google Gemini</p>
              )}
            </div>
            {batches.length > 0 && (
              <div className="border-t border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <h3 className="text-xs font-semibold text-foreground">คิววิเคราะห์</h3>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                    <span className={completedBatchesCount > 0 ? 'font-medium text-brand-800' : undefined}>เสร็จ {completedBatchesCount}/{batches.length}</span>
                    <span className={processingBatch ? 'font-medium text-brand-800' : undefined}>กำลังทำ {processingBatch ? 1 : 0}</span>
                    <span className={pendingBatchesCount > 0 ? 'font-medium text-warning-foreground' : undefined}>รอคิว {pendingBatchesCount}</span>
                    {failedBatchesCount > 0 && <span className="font-medium text-destructive">ไม่สำเร็จ {failedBatchesCount}</span>}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">เลือกชุดเพื่อไปยังช่วงบรรยายแรกของชุดนั้น</p>
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
                        className={`flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-left text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${colors.surface} ${colors.foreground}`}
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
        </PopoverContent>
      </Popover>

      {canShowGenerate && !isBusy && !isRegenerating && (
        <Button size="lg" onClick={generateAd} disabled={!canGenerateAd && failedBatchesCount === 0} className="grow sm:grow-0">
          <Sparkles data-icon="inline-start" aria-hidden="true" />
          {needsResume ? 'ทำต่อจากชุดที่ค้าง' : 'สร้างบทบรรยายภาพ'}
        </Button>
      )}

      {generatedSpotsCount > 0 && !isBusy && (
        // One cerulean action in the navbar (DESIGN › Status Pill): export steps down to outline while generating is offered.
        <Button size="lg" variant={canShowGenerate && !isRegenerating ? 'outline' : 'default'} onClick={onExportSrt}>
          <FileText data-icon="inline-start" aria-hidden="true" />
          ส่งออก SRT
        </Button>
      )}
    </div>
  );

  const managementMenu = (
    <DropdownMenu key="project-management">
      <DropdownMenuTrigger render={<Button variant="outline" size="lg" className="col-start-2 row-start-1 justify-self-end lg:col-start-3" />}>
        จัดการ
        <ChevronDown data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {(canShowGenerate && isRegenerating) || !isReview ? (
          <>
            <DropdownMenuGroup>
              {canShowGenerate && isRegenerating && <DropdownMenuItem onClick={generateAd} disabled={isBusy}><Sparkles aria-hidden="true" />สร้างบทบรรยายใหม่</DropdownMenuItem>}
              {!isReview && videoFile && <DropdownMenuItem onClick={onRunVad} disabled={!canRunVad}><RefreshCw aria-hidden="true" />สแกนเสียงใหม่</DropdownMenuItem>}
              {!isReview && <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={Boolean(checkingFileName) || isDetecting}><Upload aria-hidden="true" />เปลี่ยนวิดีโอ</DropdownMenuItem>}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onResetJob} disabled={Boolean(checkingFileName) || isDetecting}><RotateCcw aria-hidden="true" />เริ่มงานใหม่</DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenJobList}><List aria-hidden="true" />รายการงาน</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
        <Alert variant={errorMessage || hasBlockingErrors ? 'destructive' : 'warning'} placement="strip" role={errorMessage || hasBlockingErrors ? 'alert' : 'status'} className="border-t">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{errorMessage || validationIssues.map((i) => i.message).join(' · ')}</AlertDescription>
        </Alert>
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

    </section>
  );
};
