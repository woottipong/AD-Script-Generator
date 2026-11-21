import { useRef, useState } from 'react';
import { AlertCircle, FileText, FileVideo, Upload, X } from 'lucide-react';
import type { JobMode, VideoValidationIssue } from '../types/ad';
import { fileNameFromUrl, isMp4Url } from '../utils/byteSource';
import { formatFileSize } from '../utils/formatters';
import { defaultJobTitle } from '../utils/jobValidation';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import { IntakeDropzone, IntakeFooter, IntakeShell } from './IntakeShell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function ReviewIntake({ checkingFileName, errorMessage, validationIssues, onProcess, onModeChange, onBack }: {
  checkingFileName: string | null;
  errorMessage: string | null;
  validationIssues: VideoValidationIssue[];
  onProcess: (video: File | string, srt: File, title: string) => void;
  onModeChange: (mode: JobMode) => void;
  onBack: () => void;
}) {
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [draggingTarget, setDraggingTarget] = useState<'video' | 'srt' | null>(null);
  const link = videoLink.trim();
  const isIncompleteProtocolPrefix = /^(?:h|ht|htt|http|https|https?:|https?:\/|https?:\/\/)$/i.test(link);
  const linkInvalid = link !== '' && !isIncompleteProtocolPrefix && !isMp4Url(link);
  const chosenVideo: File | string | null = link ? (isMp4Url(link) ? link : null) : video;
  // The title follows the chosen video until the author types their own.
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const title = typedTitle ?? (typeof chosenVideo === 'string' ? defaultJobTitle(fileNameFromUrl(chosenVideo)) : chosenVideo ? defaultJobTitle(chosenVideo.name) : '');
  const blockingIssues = validationIssues.filter((issue) => issue.severity === 'error');

  const selectLocalVideo = (file: File) => {
    setVideo(file);
    setVideoLink('');
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

  const handleDrop = (onFileDrop: (dropped: File) => void) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingTarget(null);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onFileDrop(dropped);
  };

  const errorAlert = (errorMessage || blockingIssues.length > 0) ? (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{errorMessage ? 'ไม่สามารถเปิดงานตรวจแก้ได้' : 'วิดีโอไม่ผ่านสเปค'}</AlertTitle>
      <AlertDescription>
        {errorMessage ? <p>{errorMessage}</p> : (
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
      modeSwitch={{ mode: 'review', onModeChange }}
    >
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,.mp4"
        className="hidden"
        aria-label="เลือกวิดีโอ MP4"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) selectLocalVideo(picked);
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
          const picked = event.target.files?.[0];
          if (picked) setSrt(picked);
          event.target.value = '';
        }}
      />

      {checkingFileName ? (
        <div className="w-full mx-auto">
          <p className="mb-3 [overflow-wrap:anywhere] text-sm font-medium text-foreground">{checkingFileName}</p>
          <VideoProcessingStatus feedback={{ title: 'กำลังตรวจสอบวิดีโอและ SRT', description: 'อ่านไฟล์และตรวจความพร้อม' }} />
          {errorAlert && <div className="mt-4">{errorAlert}</div>}
        </div>
      ) : (
        <FieldGroup className="gap-5">
          <Field
            data-invalid={linkInvalid || undefined}
            aria-labelledby={video ? 'review-video-label' : undefined}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {video
                ? <FieldTitle id="review-video-label">วิดีโอ MP4</FieldTitle>
                : <FieldLabel htmlFor="review-link">วิดีโอ MP4</FieldLabel>}
              <span id="review-video-requirements" className="text-xs text-muted-foreground">
                เสียง AAC · ทุกความละเอียด · ไม่เกิน 60 นาที
              </span>
            </div>
            {video ? (
              <IntakeDropzone
                file={video}
                isDragging={draggingTarget === 'video'}
                onDragOver={handleDragOver('video')}
                onDragLeave={handleDragLeave('video')}
                onDrop={handleDrop(selectLocalVideo)}
                onPick={() => videoInputRef.current?.click()}
                onClear={() => {
                  setVideo(null);
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
                onDrop={handleDrop(selectLocalVideo)}
                className={`flex flex-col gap-2 rounded-lg transition-colors sm:flex-row sm:items-center ${
                  draggingTarget === 'video' ? 'bg-brand-50 p-1.5 -m-1.5 outline-1 outline-dashed outline-brand-500' : ''
                }`}
              >
                <div className="relative min-w-0 flex-1">
                  <Input
                    id="review-link"
                    type="url"
                    inputMode="url"
                    value={videoLink}
                    onChange={(event) => setVideoLink(event.target.value)}
                    placeholder="https://…/video.mp4"
                    aria-invalid={linkInvalid}
                    aria-describedby={linkInvalid ? 'review-link-feedback review-video-requirements' : 'review-video-requirements'}
                    className={videoLink ? 'pr-8' : undefined}
                  />
                  {videoLink && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="ล้างลิงก์วิดีโอ"
                      onClick={() => setVideoLink('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => videoInputRef.current?.click()}
                  aria-describedby="review-video-requirements"
                  className="w-full shrink-0 sm:w-auto"
                >
                  <Upload data-icon="inline-start" aria-hidden="true" />
                  เลือกไฟล์จากเครื่อง
                </Button>
              </div>
            )}
            {!video && linkInvalid && (
              <FieldError id="review-link-feedback" role="status">
                ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4
              </FieldError>
            )}
          </Field>

          <Field aria-labelledby="review-srt-label">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <FieldTitle id="review-srt-label">ไฟล์ SRT</FieldTitle>
              <span id="review-srt-requirements" className="text-xs text-muted-foreground">
                UTF-8 หรือ Windows-874
              </span>
            </div>
            <IntakeDropzone
              file={srt}
              isDragging={draggingTarget === 'srt'}
              onDragOver={handleDragOver('srt')}
              onDragLeave={handleDragLeave('srt')}
              onDrop={handleDrop((file) => setSrt(file))}
              onPick={() => srtInputRef.current?.click()}
              onClear={() => {
                setSrt(null);
                if (srtInputRef.current) srtInputRef.current.value = '';
              }}
              icon={<FileText className="size-5" />}
              emptyTitle="วางไฟล์ SRT ที่นี่"
              fileSubtitle={srt ? `${formatFileSize(srt.size)} · SRT` : ''}
              pickLabel="เลือกไฟล์ SRT"
              clearLabel="ล้างไฟล์ SRT"
              pickDescribedBy="review-srt-requirements"
            />
          </Field>

          <Field>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel htmlFor="review-title">ชื่องาน</FieldLabel>
              <span className="text-xs text-muted-foreground">ไม่บังคับ</span>
            </div>
            <Input
              id="review-title"
              type="text"
              value={title}
              maxLength={120}
              onChange={(event) => setTypedTitle(event.target.value)}
              placeholder="ใช้ชื่อไฟล์วิดีโอเมื่อเว้นว่าง"
            />
          </Field>

          {errorAlert}

          <IntakeFooter
            actionLabel="เริ่มตรวจแก้"
            disabled={!chosenVideo || !srt}
            onCancel={onBack}
            onAction={() => { if (chosenVideo && srt) onProcess(chosenVideo, srt, title); }}
          />
        </FieldGroup>
      )}
    </IntakeShell>
  );
}
