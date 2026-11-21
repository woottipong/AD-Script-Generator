import { useRef, useState } from 'react';
import { AlertCircle, FileText, FileVideo } from 'lucide-react';
import type { JobMode, VideoValidationIssue } from '../types/ad';
import { fileNameFromUrl, isMp4Url } from '../utils/byteSource';
import { formatFileSize } from '../utils/formatters';
import { defaultJobTitle } from '../utils/jobValidation';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import { IntakeDropzone, IntakeFooter, IntakeShell } from './IntakeShell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
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
  const linkInvalid = link !== '' && !isMp4Url(link);
  const chosenVideo: File | string | null = link ? (linkInvalid ? null : link) : video;
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
      backLabel="รายการงาน"
      onBack={onBack}
      title="เริ่มงานบทบรรยายภาพ"
      description="สแกนเสียงพูดบนเครื่อง แล้วเปิดไฟล์ SRT เทียบกับวิดีโอโดยไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์"
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
          <VideoProcessingStatus feedback={{ title: 'กำลังตรวจสอบวิดีโอและ SRT', description: 'กำลังอ่านไฟล์ก่อนเปิดพื้นที่ทำงาน' }} />
          {errorAlert && <div className="mt-4">{errorAlert}</div>}
        </div>
      ) : (
        <FieldGroup className="gap-5">
          <Field>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <FieldLabel>วิดีโอ MP4</FieldLabel>
              <span id="review-video-requirements" className="text-xs text-muted-foreground">
                MP4 เสียง AAC · ทุกความละเอียด · ไม่เกิน 60 นาที
              </span>
            </div>
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
              emptyTitle="ลากไฟล์วิดีโอ MP4 มาวาง หรือคลิกเพื่อเลือกไฟล์"
              emptySubtitle="รองรับไฟล์ .mp4 จากเครื่องของคุณ"
              fileSubtitle={video ? `${formatFileSize(video.size)} · MP4` : ''}
              pickLabel="เลือกไฟล์"
              clearLabel="ล้างวิดีโอ MP4"
              pickDescribedBy="review-video-requirements"
            />
            <Field data-invalid={linkInvalid || undefined} className="mt-2.5">
              <FieldLabel htmlFor="review-link">หรือวางลิงก์วิดีโอ .mp4</FieldLabel>
              <Input
                id="review-link"
                type="url"
                inputMode="url"
                value={videoLink}
                onChange={(event) => {
                  const val = event.target.value;
                  setVideoLink(val);
                  if (val.trim() !== '' && video) {
                    setVideo(null);
                    if (videoInputRef.current) videoInputRef.current.value = '';
                  }
                }}
                placeholder="https://…/video.mp4"
                aria-invalid={linkInvalid}
              />
              {linkInvalid
                ? <FieldError>ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4</FieldError>
                : <FieldDescription>หากระบุลิงก์ ระบบจะเล่นวิดีโอจากลิงก์โดยตรงแทนไฟล์ในเครื่อง</FieldDescription>}
            </Field>
          </Field>

          <Field>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <FieldLabel>ไฟล์ SRT</FieldLabel>
              <span id="review-srt-requirements" className="text-xs text-muted-foreground">
                ซับไตเติล .srt (UTF-8 หรือ Windows-874)
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
              emptyTitle="ลากไฟล์ SRT มาวาง หรือคลิกเพื่อเลือกไฟล์"
              emptySubtitle="รองรับไฟล์ .srt จากเครื่องของคุณ"
              fileSubtitle={srt ? `${formatFileSize(srt.size)} · SRT` : ''}
              pickLabel="เลือกไฟล์"
              clearLabel="ล้างไฟล์ SRT"
              pickDescribedBy="review-srt-requirements"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="review-title">ชื่องาน</FieldLabel>
            <Input
              id="review-title"
              type="text"
              value={title}
              maxLength={120}
              onChange={(event) => setTypedTitle(event.target.value)}
              placeholder="ตั้งอัตโนมัติจากชื่อไฟล์วิดีโอ"
            />
            <FieldDescription>ตั้งจากชื่อไฟล์วิดีโอให้อัตโนมัติ แก้ไขได้ก่อนเริ่มหรือเปลี่ยนภายหลังได้</FieldDescription>
          </Field>

          {errorAlert}

          <IntakeFooter
            note="ประมวลผลเสียงบนเครื่อง ไม่ส่งไฟล์วิดีโอขึ้นเซิร์ฟเวอร์"
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
