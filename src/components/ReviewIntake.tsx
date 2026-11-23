import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { AlertCircle, CheckCircle2, FileText, FileVideo, Link2, Upload, X } from 'lucide-react';
import type { VideoValidationIssue } from '../types/ad';
import { parseApiResponse } from '../utils/apiResponse';
import { fileNameFromUrl, isMp4Url, probeMp4Url } from '../utils/byteSource';
import { formatFileSize } from '../utils/formatters';
import { isGoogleDriveUrl } from '../utils/googleDriveSrt';
import { defaultJobTitle } from '../utils/jobValidation';
import { VideoProcessingStatus, type IntakeStep } from './VideoProcessingStatus';
import { focusIntakeFeedback, IntakeDropzone, IntakeFooter, IntakeShell, IntakeTitleField, selectIntakeFile, type IntakeControls, type ReviewDraft } from './IntakeShell';
import { isMp4File } from '../utils/videoValidator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupClearButton, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';

const INCOMPLETE_PROTOCOL_PREFIX = /^(?:h|ht|htt|http|https|https?:|https?:\/|https?:\/\/)$/i;
const LINK_PROBE_DEBOUNCE_MS = 400;

function useDebouncedLinkCheck({
  enabled,
  verified,
  target,
  check,
  onErrorFallback,
}: {
  enabled: boolean;
  verified: boolean;
  target: string;
  check: (target: string, signal: AbortSignal) => Promise<void>;
  onErrorFallback: (err: unknown) => string;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const checkRef = useRef(check);
  checkRef.current = check;
  const fallbackRef = useRef(onErrorFallback);
  fallbackRef.current = onErrorFallback;

  useEffect(() => {
    if (!enabled || verified) {
      setChecking(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setChecking(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await checkRef.current(target, controller.signal);
          if (controller.signal.aborted) return;
          setError(null);
          setChecking(false);
        } catch (err) {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
          setError(fallbackRef.current(err));
          setChecking(false);
        }
      })();
    }, LINK_PROBE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, verified, target, retryTick]);

  const reset = useCallback(() => {
    setChecking(false);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setRetryTick((tick) => tick + 1);
  }, []);

  return { checking, error, reset, clearError, retry };
}

function VerifiedLinkCard({
  icon,
  fileName,
  subtitle,
  clearLabel,
  onEdit,
  onClear,
}: {
  icon: ReactNode;
  fileName: string;
  subtitle: string;
  clearLabel: string;
  onEdit: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="status"
      className="flex min-h-18 flex-col justify-between gap-3 rounded-lg border border-success-border bg-success-surface/65 px-4 py-3 @min-[19rem]:flex-row @min-[19rem]:items-center"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-accent/12 text-success-foreground"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success-accent" />
            <span className="truncate text-sm font-semibold text-foreground" title={fileName}>
              {fileName}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-success-foreground/90 tabular-nums">{subtitle}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="outline-success"
          size="sm"
          onClick={onEdit}
          className="h-8 text-xs pointer-coarse:min-h-11"
        >
          แก้ไขลิงก์
        </Button>
        <Button
          type="button"
          variant="ghost-success"
          size="icon-sm"
          aria-label={clearLabel}
          onClick={onClear}
          className="pointer-coarse:size-11"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

const REVIEW_INTAKE_STEPS: readonly IntakeStep[] = [
  { label: 'ตรวจวิดีโอและไฟล์ SRT' },
  { label: 'เปิดหน้าตรวจแก้' },
];

export function ReviewIntake({ checkingFileName, errorMessage, validationIssues, onProcess, draft, setDraft, intake, onBack }: {
  checkingFileName: string | null;
  errorMessage: string | null;
  validationIssues: VideoValidationIssue[];
  onProcess: (video: File | string, srt: File, title: string) => void;
  draft: ReviewDraft;
  setDraft: Dispatch<SetStateAction<ReviewDraft>>;
  intake: IntakeControls;
  onBack: () => void;
}) {
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const reviewLink = useRef<HTMLInputElement | null>(null);
  const srtLinkInputRef = useRef<HTMLInputElement | null>(null);
  const restoreLinkFocus = useRef(false);
  const restoreSrtLinkFocus = useRef(false);
  const restoreSrtPickFocus = useRef(false);
  const attachReviewLink = useCallback((element: HTMLInputElement | null) => {
    reviewLink.current = element;
    if (!element || !restoreLinkFocus.current) return;
    restoreLinkFocus.current = false;
    element.focus();
  }, []);
  const attachSrtLink = useCallback((element: HTMLInputElement | null) => {
    srtLinkInputRef.current = element;
    if (!element || !restoreSrtLinkFocus.current) return;
    restoreSrtLinkFocus.current = false;
    element.focus();
  }, []);
  const attachSrtPickButton = useCallback((element: HTMLButtonElement | null) => {
    if (!element || !restoreSrtPickFocus.current) return;
    restoreSrtPickFocus.current = false;
    element.focus();
  }, []);

  const [inputError, setInputError] = useState<string | null>(null);
  const [editingVideoLink, setEditingVideoLink] = useState(false);
  const [editingSrtLink, setEditingSrtLink] = useState(false);

  const { video, srt, link: videoLink, linkProbe, srtLink, srtLinkResult, title: typedTitle } = draft;
  const [draggingTarget, setDraggingTarget] = useState<'video' | 'srt' | null>(null);

  const link = videoLink.trim();
  const linkIsMp4 = isMp4Url(link);
  const linkInvalid = !video && link !== '' && !INCOMPLETE_PROTOCOL_PREFIX.test(link) && !linkIsMp4;
  const verifiedVideo = !video && linkProbe && linkProbe.url === link ? linkProbe : null;
  const chosenVideo: File | string | null = video ?? (linkIsMp4 ? link : null);

  const trimmedSrtLink = srtLink.trim();
  const srtLinkIsDrive = isGoogleDriveUrl(trimmedSrtLink);
  const srtLinkInvalid = !srt && trimmedSrtLink !== '' && !INCOMPLETE_PROTOCOL_PREFIX.test(trimmedSrtLink) && !srtLinkIsDrive;
  const verifiedSrt = !srt && srtLinkResult && srtLinkResult.url === trimmedSrtLink ? srtLinkResult : null;
  const chosenSrt = srt ?? verifiedSrt?.file ?? null;

  // The title follows the chosen video until the author types their own.
  const title = typedTitle ?? (typeof chosenVideo === 'string' ? defaultJobTitle(fileNameFromUrl(chosenVideo)) : chosenVideo ? defaultJobTitle(chosenVideo.name) : '');
  const isAutoTitle = typedTitle === null && title.trim() !== '';
  const blockingIssues = validationIssues.filter((issue) => issue.severity === 'error');

  const {
    checking: videoLinkChecking,
    error: videoLinkError,
    reset: resetVideoLinkCheck,
    clearError: clearVideoLinkError,
    retry: retryVideoLinkCheck,
  } = useDebouncedLinkCheck({
    enabled: !video && linkIsMp4,
    verified: Boolean(verifiedVideo),
    target: link,
    check: async (url, signal) => {
      const probe = await probeMp4Url(url, { signal });
      if (signal.aborted) return;
      setDraft((current) => (
        current.video || current.link.trim() !== url
          ? current
          : { ...current, linkProbe: { url, fileName: probe.fileName, sizeBytes: probe.sizeBytes } }
      ));
      setEditingVideoLink(false);
    },
    onErrorFallback: (err) => (
      err instanceof Error && err.message
        ? err.message
        : 'ลิงก์นี้เปิดจากเบราว์เซอร์ไม่ได้ กรุณาดาวน์โหลดแล้วเลือกเป็นไฟล์แทน'
    ),
  });

  const {
    checking: srtLinkChecking,
    error: srtLinkError,
    reset: resetSrtLinkCheck,
    clearError: clearSrtLinkError,
    retry: retrySrtLinkCheck,
  } = useDebouncedLinkCheck({
    enabled: !srt && srtLinkIsDrive,
    verified: Boolean(verifiedSrt),
    target: trimmedSrtLink,
    check: async (url, signal) => {
      const response = await fetch('/api/review/fetch-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
      });
      const data = await parseApiResponse<{
        file_name?: string;
        content?: string;
        size_bytes?: number;
        cue_count?: number;
        error?: string;
      }>(response);
      if (!response.ok || !data?.file_name || typeof data.content !== 'string' || typeof data.cue_count !== 'number') {
        throw new Error(data?.error || 'ไม่สามารถดึงไฟล์จาก Google Drive ได้ กรุณาลองอีกครั้ง');
      }
      if (signal.aborted) return;
      const file = new File([data.content], data.file_name, { type: 'application/x-subrip' });
      setDraft((current) => (
        current.srt || current.srtLink.trim() !== url
          ? current
          : { ...current, srtLinkResult: { url, file, cueCount: data.cue_count! } }
      ));
      setEditingSrtLink(false);
    },
    onErrorFallback: (err) => (
      err instanceof TypeError
        ? 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อดึงไฟล์ SRT ได้ กรุณาลองอีกครั้ง'
        : err instanceof Error
          ? err.message
          : 'ไม่สามารถดึงไฟล์จาก Google Drive ได้ กรุณาลองอีกครั้ง'
    ),
  });

  const clearInputError = () => {
    setInputError(null);
    intake.onInputChange();
  };

  const stageFile = (target: 'video' | 'srt', files: FileList | null) => {
    const selection = target === 'video'
      ? selectIntakeFile(files, isMp4File, 'กรุณาเลือกไฟล์วิดีโอ MP4')
      : selectIntakeFile(files, (file) => /\.srt$/i.test(file.name) || ['text/plain', 'application/x-subrip'].includes(file.type), 'กรุณาเลือกไฟล์ SRT');
    if (!selection) return;
    clearInputError();
    if (selection.kind === 'invalid') {
      setInputError(selection.message);
    } else if (target === 'video') {
      resetVideoLinkCheck();
      setEditingVideoLink(false);
      restoreLinkFocus.current = false;
      setDraft((current) => ({ ...current, video: selection.file, link: '', linkProbe: null }));
    } else {
      resetSrtLinkCheck();
      setEditingSrtLink(false);
      restoreSrtPickFocus.current = false;
      setDraft((current) => ({ ...current, srt: selection.file, srtLink: '', srtLinkResult: null }));
    }
  };

  const updateLink = (value: string) => {
    clearInputError();
    clearVideoLinkError();
    setEditingVideoLink(false);
    setDraft((current) => ({ ...current, video: null, link: value, linkProbe: null }));
  };

  const retryVideoLink = () => {
    setDraft((current) => ({ ...current, linkProbe: null }));
    retryVideoLinkCheck();
  };

  const updateSrtLink = (value: string) => {
    clearInputError();
    clearSrtLinkError();
    setEditingSrtLink(false);
    setDraft((current) => ({ ...current, srt: null, srtLink: value, srtLinkResult: null }));
  };

  const retrySrtLink = () => {
    setDraft((current) => ({ ...current, srtLinkResult: null }));
    retrySrtLinkCheck();
  };

  const handleDragOver = (target: 'video' | 'srt') => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingTarget(target);
  };

  const handleDragLeave = (target: 'video' | 'srt') => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingTarget((prev) => (prev === target ? null : prev));
  };

  const handleDrop = (target: 'video' | 'srt') => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingTarget(null);
    stageFile(target, event.dataTransfer.files);
  };

  const errorAlert = (inputError || errorMessage || blockingIssues.length > 0) ? (
    <Alert ref={focusIntakeFeedback} tabIndex={-1} variant="destructive">
      <AlertCircle />
      <AlertTitle>{inputError || errorMessage ? 'ไม่สามารถเปิดงานตรวจแก้ได้' : 'วิดีโอไม่ผ่านสเปค'}</AlertTitle>
      <AlertDescription>
        {inputError || errorMessage ? <p>{inputError || errorMessage}</p> : (
          <ul className="list-disc pl-5">
            {blockingIssues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  ) : null;

  const showVerifiedVideoCard = Boolean(verifiedVideo) && !editingVideoLink;
  const showVerifiedSrtCard = Boolean(verifiedSrt) && !editingSrtLink;
  const hasVideoLinkFeedback = !video && (linkInvalid || (!videoLinkChecking && Boolean(videoLinkError)));
  const hasSrtLinkFeedback = !srt && (srtLinkInvalid || (!srtLinkChecking && Boolean(srtLinkError)));

  return (
    <IntakeShell
      title="เริ่มงานบทบรรยายภาพ"
      description="สร้างบทบรรยายจากวิดีโอ หรือตรวจแก้ไฟล์ SRT ที่มีอยู่"
      modeSwitch={intake.modeSwitch}
    >
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,.mp4"
        className="hidden"
        aria-label="เลือกวิดีโอ MP4"
        onChange={(event) => {
          stageFile('video', event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,application/x-subrip,text/plain"
        className="hidden"
        aria-label="เลือกไฟล์ SRT"
        onChange={(event) => {
          stageFile('srt', event.target.files);
          event.target.value = '';
        }}
      />

      {checkingFileName ? (
        <div className="w-full">
          <VideoProcessingStatus
            fileName={checkingFileName}
            feedback={intake.checkPassed
              ? { title: 'ไฟล์ผ่านการตรวจแล้ว', description: 'กำลังเปิดหน้าตรวจแก้…' }
              : { title: 'กำลังตรวจสอบวิดีโอและ SRT', description: 'อ่านไฟล์และตรวจความพร้อม' }}
            steps={REVIEW_INTAKE_STEPS}
            passed={intake.checkPassed}
            onCancel={intake.onCancelCheck}
          />
          {errorAlert && <div className="mt-4">{errorAlert}</div>}
        </div>
      ) : (
        <FieldGroup className="gap-5">
          <Field
            data-invalid={hasVideoLinkFeedback || undefined}
            aria-labelledby={video || showVerifiedVideoCard ? 'review-video-label' : undefined}
          >
              {video || showVerifiedVideoCard
                ? <FieldTitle id="review-video-label">วิดีโอ MP4</FieldTitle>
                : <FieldLabel htmlFor="review-link">วิดีโอ MP4</FieldLabel>}
              {video ? (
                <IntakeDropzone
                  file={video}
                  isDragging={draggingTarget === 'video'}
                  onDragOver={handleDragOver('video')}
                  onDragLeave={handleDragLeave('video')}
                  onDrop={handleDrop('video')}
                  onPick={() => videoInputRef.current?.click()}
                  onClear={() => {
                    clearInputError();
                    restoreLinkFocus.current = true;
                    setDraft((current) => ({ ...current, video: null }));
                    if (videoInputRef.current) videoInputRef.current.value = '';
                  }}
                  icon={<FileVideo className="size-5" />}
                  emptyTitle="วางไฟล์ MP4 ที่นี่"
                  fileSubtitle={`${formatFileSize(video.size)} · MP4`}
                  pickLabel="เลือกวิดีโอ"
                  clearLabel="ล้างวิดีโอ MP4"
                  pickDescribedBy="review-video-requirements"
                />
              ) : showVerifiedVideoCard && verifiedVideo ? (
                <VerifiedLinkCard
                  icon={<FileVideo className="size-5" />}
                  fileName={verifiedVideo.fileName}
                  subtitle={`${formatFileSize(verifiedVideo.sizeBytes)} · ลิงก์ MP4 พร้อมใช้`}
                  clearLabel="ล้างลิงก์วิดีโอ"
                  onEdit={() => {
                    restoreLinkFocus.current = true;
                    setEditingVideoLink(true);
                  }}
                  onClear={() => {
                    restoreLinkFocus.current = true;
                    updateLink('');
                  }}
                />
              ) : (
                <div
                  onDragOver={handleDragOver('video')}
                  onDragLeave={handleDragLeave('video')}
                  onDrop={handleDrop('video')}
                  onBlur={(event) => {
                    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) && verifiedVideo) {
                      setEditingVideoLink(false);
                    }
                  }}
                  className={`flex flex-col gap-2 rounded-lg transition-colors sm:flex-row sm:items-center ${
                    draggingTarget === 'video' ? 'bg-brand-50 p-1.5 -m-1.5 outline-1 outline-dashed outline-brand-500' : ''
                  }`}
                >
                  <InputGroup className="w-full min-w-0 flex-1 bg-background">
                    <InputGroupAddon>
                      <Link2 aria-hidden="true" className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      ref={attachReviewLink}
                      id="review-link"
                      type="url"
                      inputMode="url"
                      value={videoLink}
                      onChange={(event) => updateLink(event.target.value)}
                      placeholder="https://…/video.mp4"
                      aria-invalid={hasVideoLinkFeedback}
                      aria-describedby={hasVideoLinkFeedback ? 'review-link-feedback review-video-requirements' : 'review-video-requirements'}
                    />
                    {videoLinkChecking && (
                      <InputGroupAddon align="inline-end">
                        <Spinner aria-hidden="true" className="size-4 text-brand-700" />
                      </InputGroupAddon>
                    )}
                    {videoLink && (
                      <InputGroupClearButton
                        label="ล้างลิงก์วิดีโอ"
                        onClear={() => { updateLink(''); reviewLink.current?.focus(); }}
                      />
                    )}
                  </InputGroup>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label="เลือกไฟล์จากเครื่อง (MP4)"
                    onClick={() => videoInputRef.current?.click()}
                    aria-describedby="review-video-requirements"
                    className="h-auto min-h-9 w-full max-w-full shrink-0 whitespace-normal bg-background py-2 pointer-coarse:min-h-11 sm:w-auto"
                  >
                    <Upload data-icon="inline-start" aria-hidden="true" />
                    เลือกไฟล์จากเครื่อง
                  </Button>
                </div>
              )}
              <FieldDescription id="review-video-requirements" className="text-xs">
                รองรับเสียง AAC · ทุกความละเอียด · ไม่เกิน 60 นาที
              </FieldDescription>
              {!video && linkIsMp4 && videoLinkChecking && (
                <p role="status" className="text-xs text-muted-foreground">
                  กำลังตรวจสอบลิงก์วิดีโอ MP4…
                </p>
              )}
              {!video && linkInvalid && (
                <FieldError id="review-link-feedback" role="status">
                  ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4
                </FieldError>
              )}
              {!video && !videoLinkChecking && videoLinkError && (
                <FieldError id="review-link-feedback" role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{videoLinkError}</span>
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="sm"
                    onClick={retryVideoLink}
                    className="h-auto px-2 py-0.5 text-xs font-medium"
                  >
                    ลองอีกครั้ง
                  </Button>
                </FieldError>
              )}
            </Field>

            <Field
              data-invalid={hasSrtLinkFeedback || undefined}
              aria-labelledby={srt || showVerifiedSrtCard ? 'review-srt-label' : undefined}
            >
              {srt || showVerifiedSrtCard
                ? <FieldTitle id="review-srt-label">ไฟล์ SRT</FieldTitle>
                : <FieldLabel htmlFor="review-srt-link">ไฟล์ SRT</FieldLabel>}
              {srt ? (
                <IntakeDropzone
                  file={srt}
                  isDragging={draggingTarget === 'srt'}
                  onDragOver={handleDragOver('srt')}
                  onDragLeave={handleDragLeave('srt')}
                  onDrop={handleDrop('srt')}
                  onPick={() => srtInputRef.current?.click()}
                  onClear={() => {
                    clearInputError();
                    restoreSrtPickFocus.current = true;
                    setDraft((current) => ({ ...current, srt: null }));
                    if (srtInputRef.current) srtInputRef.current.value = '';
                  }}
                  icon={<FileText className="size-5" />}
                  emptyTitle="วางไฟล์ SRT ที่นี่"
                  fileSubtitle={`${formatFileSize(srt.size)} · SRT`}
                  pickLabel="เลือกไฟล์ SRT"
                  clearLabel="ล้างไฟล์ SRT"
                  pickDescribedBy="review-srt-requirements"
                />
              ) : showVerifiedSrtCard && verifiedSrt ? (
                <VerifiedLinkCard
                  icon={<FileText className="size-5" />}
                  fileName={verifiedSrt.file.name}
                  subtitle={`${formatFileSize(verifiedSrt.file.size)} · ${verifiedSrt.cueCount} บรรทัด · Google Drive`}
                  clearLabel="ล้างลิงก์ไฟล์ SRT"
                  onEdit={() => {
                    restoreSrtLinkFocus.current = true;
                    setEditingSrtLink(true);
                  }}
                  onClear={() => {
                    restoreSrtLinkFocus.current = true;
                    updateSrtLink('');
                  }}
                />
              ) : (
                <div
                  onDragOver={handleDragOver('srt')}
                  onDragLeave={handleDragLeave('srt')}
                  onDrop={handleDrop('srt')}
                  onBlur={(event) => {
                    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) && verifiedSrt) {
                      setEditingSrtLink(false);
                    }
                  }}
                  className={`flex flex-col gap-2 rounded-lg transition-colors sm:flex-row sm:items-center ${
                    draggingTarget === 'srt' ? 'bg-brand-50 p-1.5 -m-1.5 outline-1 outline-dashed outline-brand-500' : ''
                  }`}
                >
                  <InputGroup className="w-full min-w-0 flex-1 bg-background">
                    <InputGroupAddon>
                      <Link2 aria-hidden="true" className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      ref={attachSrtLink}
                      id="review-srt-link"
                      type="url"
                      inputMode="url"
                      value={srtLink}
                      onChange={(event) => updateSrtLink(event.target.value)}
                      placeholder="https://drive.google.com/file/d/…/view"
                      aria-invalid={hasSrtLinkFeedback}
                      aria-describedby={hasSrtLinkFeedback ? 'review-srt-link-feedback review-srt-requirements' : 'review-srt-requirements'}
                    />
                    {srtLinkChecking && (
                      <InputGroupAddon align="inline-end">
                        <Spinner aria-hidden="true" className="size-4 text-brand-700" />
                      </InputGroupAddon>
                    )}
                    {srtLink && (
                      <InputGroupClearButton
                        label="ล้างลิงก์ไฟล์ SRT"
                        onClear={() => { updateSrtLink(''); srtLinkInputRef.current?.focus(); }}
                      />
                    )}
                  </InputGroup>
                  <Button
                    ref={attachSrtPickButton}
                    type="button"
                    variant="outline"
                    aria-label="เลือกไฟล์จากเครื่อง (SRT)"
                    onClick={() => srtInputRef.current?.click()}
                    aria-describedby="review-srt-requirements"
                    className="h-auto min-h-9 w-full max-w-full shrink-0 whitespace-normal bg-background py-2 pointer-coarse:min-h-11 sm:w-auto"
                  >
                    <Upload data-icon="inline-start" aria-hidden="true" />
                    เลือกไฟล์จากเครื่อง
                  </Button>
                </div>
              )}
              <FieldDescription id="review-srt-requirements" className="text-xs">
                วางลิงก์ Google Drive ที่เปิดสาธารณะ หรือเลือกไฟล์ .srt (UTF-8 หรือ Windows-874)
              </FieldDescription>
              {!srt && srtLinkInvalid && (
                <FieldError id="review-srt-link-feedback" role="status">
                  กรุณาวางลิงก์ไฟล์ Google Drive เช่น https://drive.google.com/file/d/…/view
                </FieldError>
              )}
              {!srt && srtLinkIsDrive && srtLinkChecking && (
                <p role="status" className="text-xs text-muted-foreground">
                  กำลังตรวจสอบและดึงไฟล์ SRT จาก Google Drive…
                </p>
              )}
              {!srt && !srtLinkChecking && srtLinkError && (
                <FieldError id="review-srt-link-feedback" role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{srtLinkError}</span>
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="sm"
                    onClick={retrySrtLink}
                    className="h-auto px-2 py-0.5 text-xs font-medium"
                  >
                    ลองอีกครั้ง
                  </Button>
                </FieldError>
              )}
            </Field>

          <IntakeTitleField
            id="review-title"
            value={title}
            isAutoTitle={isAutoTitle}
            onChange={(nextTitle) => setDraft((current) => ({ ...current, title: nextTitle }))}
          />

          {errorAlert}

          <IntakeFooter
            actionLabel="เริ่มตรวจแก้"
            disabled={!chosenVideo || !chosenSrt || srtLinkChecking || Boolean(srtLinkError) || Boolean(videoLinkError) || Boolean(inputError) || blockingIssues.length > 0 || !intake.canProcess}
            onCancel={onBack}
            onAction={() => { if (chosenVideo && chosenSrt) onProcess(chosenVideo, chosenSrt, title); }}
          />
        </FieldGroup>
      )}
    </IntakeShell>
  );
}
