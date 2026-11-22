import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, FileText, FileVideo, Upload } from 'lucide-react';
import type { VideoValidationIssue } from '../types/ad';
import { fileNameFromUrl, isMp4Url } from '../utils/byteSource';
import { formatFileSize } from '../utils/formatters';
import { defaultJobTitle } from '../utils/jobValidation';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import { focusIntakeFeedback, IntakeDropzone, IntakeFooter, IntakeShell, selectIntakeFile, type IntakeControls, type ReviewDraft } from './IntakeShell';
import { isMp4File } from '../utils/videoValidator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupClearButton, InputGroupInput } from '@/components/ui/input-group';

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
  const restoreLinkFocus = useRef(false);
  const attachReviewLink = useCallback((element: HTMLInputElement | null) => {
    reviewLink.current = element;
    if (!element || !restoreLinkFocus.current) return;
    restoreLinkFocus.current = false;
    element.focus();
  }, []);
  const [inputError, setInputError] = useState<string | null>(null);
  const { video, srt, link: videoLink, title: typedTitle } = draft;
  const [draggingTarget, setDraggingTarget] = useState<'video' | 'srt' | null>(null);
  const link = videoLink.trim();
  const isIncompleteProtocolPrefix = /^(?:h|ht|htt|http|https|https?:|https?:\/|https?:\/\/)$/i.test(link);
  const linkInvalid = link !== '' && !isIncompleteProtocolPrefix && !isMp4Url(link);
  const chosenVideo: File | string | null = link ? (isMp4Url(link) ? link : null) : video;
  // The title follows the chosen video until the author types their own.
  const title = typedTitle ?? (typeof chosenVideo === 'string' ? defaultJobTitle(fileNameFromUrl(chosenVideo)) : chosenVideo ? defaultJobTitle(chosenVideo.name) : '');
  const blockingIssues = validationIssues.filter((issue) => issue.severity === 'error');

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
      setDraft((current) => ({ ...current, video: selection.file, link: '' }));
      restoreLinkFocus.current = false;
    } else {
      setDraft((current) => ({ ...current, srt: selection.file }));
    }
  };

  const updateLink = (value: string) => {
    clearInputError();
    setDraft((current) => ({ ...current, link: value }));
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
            feedback={{ title: 'กำลังตรวจสอบวิดีโอและ SRT', description: 'อ่านไฟล์และตรวจความพร้อม' }}
            onCancel={intake.onCancelCheck}
          />
          {errorAlert && <div className="mt-4">{errorAlert}</div>}
        </div>
      ) : (
        <FieldGroup className="gap-5">
          <Field
            data-invalid={linkInvalid || undefined}
            aria-labelledby={video ? 'review-video-label' : undefined}
          >
            {video
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
            ) : (
              <div
                onDragOver={handleDragOver('video')}
                onDragLeave={handleDragLeave('video')}
                onDrop={handleDrop('video')}
                className={`flex flex-col gap-2 rounded-lg transition-colors sm:flex-row sm:items-center ${
                  draggingTarget === 'video' ? 'bg-brand-50 p-1.5 -m-1.5 outline-1 outline-dashed outline-brand-500' : ''
                }`}
              >
                <InputGroup className="w-full min-w-0 flex-1">
                  <InputGroupInput
                    ref={attachReviewLink}
                    id="review-link"
                    type="url"
                    inputMode="url"
                    value={videoLink}
                    onChange={(event) => updateLink(event.target.value)}
                    placeholder="https://…/video.mp4"
                    aria-invalid={linkInvalid}
                    aria-describedby={linkInvalid ? 'review-link-feedback review-video-requirements' : 'review-video-requirements'}
                  />
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
                  onClick={() => videoInputRef.current?.click()}
                  aria-describedby="review-video-requirements"
                  className="h-auto min-h-9 w-full max-w-full shrink-0 whitespace-normal py-2 pointer-coarse:min-h-11 sm:w-auto"
                >
                  <Upload data-icon="inline-start" aria-hidden="true" />
                  เลือกไฟล์จากเครื่อง
                </Button>
              </div>
            )}
            <FieldDescription id="review-video-requirements" className="text-xs">
              รองรับเสียง AAC · ทุกความละเอียด · ไม่เกิน 60 นาที
            </FieldDescription>
            {!video && linkInvalid && (
              <FieldError id="review-link-feedback" role="status">
                ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4
              </FieldError>
            )}
          </Field>

          <Field aria-labelledby="review-srt-label">
            <FieldTitle id="review-srt-label">ไฟล์ SRT</FieldTitle>
            <IntakeDropzone
              file={srt}
              isDragging={draggingTarget === 'srt'}
              onDragOver={handleDragOver('srt')}
              onDragLeave={handleDragLeave('srt')}
              onDrop={handleDrop('srt')}
              onPick={() => srtInputRef.current?.click()}
              onClear={() => {
                clearInputError();
                setDraft((current) => ({ ...current, srt: null }));
                if (srtInputRef.current) srtInputRef.current.value = '';
              }}
              icon={<FileText className="size-5" />}
              emptyTitle="วางไฟล์ SRT ที่นี่"
              fileSubtitle={srt ? `${formatFileSize(srt.size)} · SRT` : ''}
              pickLabel="เลือกไฟล์ SRT"
              clearLabel="ล้างไฟล์ SRT"
              pickDescribedBy="review-srt-requirements"
            />
            <FieldDescription id="review-srt-requirements" className="text-xs">
              รองรับรหัสภาษา UTF-8 หรือ Windows-874
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="review-title" className="gap-1.5">
              <span>ชื่องาน</span>
              <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
            </FieldLabel>
            <Input
              id="review-title"
              type="text"
              value={title}
              maxLength={120}
              onChange={(event) => { const title = event.target.value; setDraft((current) => ({ ...current, title })); }}
              placeholder="ใช้ชื่อไฟล์วิดีโอเมื่อเว้นว่าง"
            />
          </Field>

          {errorAlert}

          <p className="text-xs leading-relaxed text-muted-foreground">
            วิดีโอจะเล่นบนเครื่องของคุณโดยไม่อัปโหลดขึ้นเซิร์ฟเวอร์ และบันทึกเฉพาะบทบรรยายที่ตรวจแก้
          </p>

          <IntakeFooter
            actionLabel="เริ่มตรวจแก้"
            disabled={!chosenVideo || !srt || Boolean(inputError) || blockingIssues.length > 0 || !intake.canProcess}
            onCancel={onBack}
            onAction={() => { if (chosenVideo && srt) onProcess(chosenVideo, srt, title); }}
          />
        </FieldGroup>
      )}
    </IntakeShell>
  );
}
