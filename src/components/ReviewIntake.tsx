import { useRef, useState } from 'react';
import { AlertCircle, FileText, FileVideo, Play } from 'lucide-react';
import type { VideoValidationIssue } from '../types/ad';
import { fileNameFromUrl, isMp4Url } from '../utils/byteSource';
import { defaultJobTitle } from '../utils/jobValidation';
import { VideoProcessingStatus } from './VideoProcessingStatus';
import { IntakeShell } from './IntakeShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function ReviewIntake({ checkingFileName, errorMessage, validationIssues, onProcess, onBack }: {
  checkingFileName: string | null;
  errorMessage: string | null;
  validationIssues: VideoValidationIssue[];
  onProcess: (video: File | string, srt: File, title: string) => void;
  onBack: () => void;
}) {
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const link = videoLink.trim();
  const linkInvalid = link !== '' && !isMp4Url(link);
  const chosenVideo: File | string | null = link ? (linkInvalid ? null : link) : video;
  // The title follows the chosen video until the author types their own.
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const title = typedTitle ?? (typeof chosenVideo === 'string' ? defaultJobTitle(fileNameFromUrl(chosenVideo)) : chosenVideo ? defaultJobTitle(chosenVideo.name) : '');
  const blockingIssues = validationIssues.filter((issue) => issue.severity === 'error');

  // A file picker shows what is chosen, so it is a tall outline button with the file name under its label.
  const fileButton = (label: string, file: File | null, onClick: () => void, Icon: typeof FileVideo) => (
    <Button variant="outline" onClick={onClick} className="h-auto min-h-14 w-full justify-start gap-3 px-4 py-3 text-left whitespace-normal">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-semibold text-foreground">{label}</span>
        <span className="block font-normal [overflow-wrap:anywhere] text-muted-foreground">{file ? file.name : 'ยังไม่ได้เลือกไฟล์'}</span>
      </span>
    </Button>
  );

  return (
    <IntakeShell backLabel="เลือกโหมดอื่น" onBack={onBack} title="ตรวจแก้ไฟล์ SRT" description="ระบบสแกนเสียงพูดบนเครื่องของคุณ แล้วเปิดบทใน SRT ให้แก้เทียบกับวิดีโอ ไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์">

        {checkingFileName ? (
          <div className="mt-7 w-full max-w-lg mx-auto">
            <p className="mb-3 [overflow-wrap:anywhere] text-sm font-medium text-foreground">{checkingFileName}</p>
            <VideoProcessingStatus feedback={{ title: 'กำลังตรวจสอบวิดีโอและ SRT', description: 'กำลังอ่านไฟล์ก่อนเปิดพื้นที่ทำงาน' }} />
          </div>
        ) : (
          <FieldGroup className="mt-7 gap-4">
            <input ref={videoInputRef} type="file" accept="video/mp4,.mp4" className="hidden" aria-label="เลือกวิดีโอ MP4" onChange={(event) => setVideo(event.target.files?.[0] ?? null)} />
            <input ref={srtInputRef} type="file" accept=".srt,application/x-subrip,text/plain" className="hidden" aria-label="เลือกไฟล์ SRT" onChange={(event) => setSrt(event.target.files?.[0] ?? null)} />
            {fileButton('วิดีโอ MP4', video, () => videoInputRef.current?.click(), FileVideo)}
            <Field data-invalid={linkInvalid || undefined}>
              <FieldLabel htmlFor="review-link">หรือวางลิงก์วิดีโอ .mp4</FieldLabel>
              <Input
                id="review-link"
                type="url"
                inputMode="url"
                value={videoLink}
                onChange={(event) => setVideoLink(event.target.value)}
                placeholder="https://…/video.mp4"
                aria-invalid={linkInvalid}
              />
              {linkInvalid
                ? <FieldError>ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4</FieldError>
                : <FieldDescription>หากระบุลิงก์ ระบบจะเล่นวิดีโอจากลิงก์โดยตรงแทนไฟล์ในเครื่อง</FieldDescription>}
            </Field>
            {fileButton('ไฟล์ SRT', srt, () => srtInputRef.current?.click(), FileText)}
            <Field>
              <FieldLabel htmlFor="review-title">ชื่องาน</FieldLabel>
              <Input
                id="review-title"
                type="text"
                value={title}
                maxLength={120}
                onChange={(event) => setTypedTitle(event.target.value)}
                placeholder="ตั้งจากชื่อไฟล์วิดีโอ"
              />
            </Field>
            <p className="text-sm text-muted-foreground">MP4 ที่มีเสียง AAC · ทุกความละเอียด · ไม่เกิน 60 นาที</p>
            <Button
              size="lg"
              className="self-start"
              disabled={!chosenVideo || !srt}
              onClick={() => { if (chosenVideo && srt) onProcess(chosenVideo, srt, title); }}
            >
              <Play data-icon="inline-start" />
              เริ่มตรวจแก้
            </Button>
          </FieldGroup>
        )}

        {(errorMessage || blockingIssues.length > 0) && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle />
            <AlertDescription>
              {errorMessage ? <p>{errorMessage}</p> : (
                <ul className="list-disc pl-5">
                  {blockingIssues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}
    </IntakeShell>
  );
}
