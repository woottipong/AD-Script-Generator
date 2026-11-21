import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowLeft, FileText, FileVideo, Play } from 'lucide-react';
import type { VideoValidationIssue } from '../types/ad';
import { JobStorageManager } from './JobStorageManager';
import { isMp4Url } from '../utils/byteSource';
import { VideoProcessingStatus } from './VideoProcessingStatus';

export function ReviewIntake({ headerActionsElement, checkingFileName, errorMessage, validationIssues, onProcess, onBack }: {
  headerActionsElement: HTMLDivElement | null;
  checkingFileName: string | null;
  errorMessage: string | null;
  validationIssues: VideoValidationIssue[];
  onProcess: (video: File | string, srt: File) => void;
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
  const blockingIssues = validationIssues.filter((issue) => issue.severity === 'error');

  const fileButton = (label: string, file: File | null, onClick: () => void, Icon: typeof FileVideo) => (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-3 text-left text-sm hover:border-brand-500 hover:bg-brand-50 cursor-pointer">
      <Icon className="h-5 w-5 shrink-0 text-brand-700" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-semibold text-slate-900">{label}</span>
        <span className="block [overflow-wrap:anywhere] text-slate-600">{file ? file.name : 'ยังไม่ได้เลือกไฟล์'}</span>
      </span>
    </button>
  );

  return (
    <section className="w-[calc(100%_-_2rem)] max-w-4xl mx-auto my-8 sm:my-14 px-1 sm:px-0">
      {headerActionsElement && createPortal(
        <div className="col-start-2 row-start-1 justify-self-end lg:col-start-3"><JobStorageManager /></div>,
        headerActionsElement
      )}
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 cursor-pointer">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />เลือกโหมดอื่น
      </button>
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 leading-tight">แก้ไข SRT ที่มีอยู่</h1>
      <p className="mt-3 text-base text-slate-600 leading-relaxed">ระบบสแกนเสียงพูดบนเครื่องของคุณ แล้วเปิดบทใน SRT ให้แก้เทียบกับวิดีโอ ไม่ส่งวิดีโอขึ้นเซิร์ฟเวอร์</p>

      {checkingFileName ? (
        <div className="mt-7 w-full max-w-lg mx-auto">
          <p className="mb-3 [overflow-wrap:anywhere] text-sm font-medium text-slate-700">{checkingFileName}</p>
          <VideoProcessingStatus feedback={{ title: 'กำลังตรวจสอบวิดีโอและ SRT', description: 'กำลังอ่านไฟล์ก่อนเปิดพื้นที่ทำงาน' }} />
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-3">
          <input ref={videoInputRef} type="file" accept="video/mp4,.mp4" className="hidden" aria-label="เลือกวิดีโอ MP4" onChange={(event) => setVideo(event.target.files?.[0] ?? null)} />
          <input ref={srtInputRef} type="file" accept=".srt,application/x-subrip,text/plain" className="hidden" aria-label="เลือกไฟล์ SRT" onChange={(event) => setSrt(event.target.files?.[0] ?? null)} />
          {fileButton('วิดีโอ MP4', video, () => videoInputRef.current?.click(), FileVideo)}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-slate-900">หรือวางลิงก์วิดีโอ .mp4</span>
            <input
              type="url"
              inputMode="url"
              value={videoLink}
              onChange={(event) => setVideoLink(event.target.value)}
              placeholder="https://…/video.mp4"
              aria-invalid={linkInvalid}
              aria-describedby="review-link-hint"
              className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
            <span id="review-link-hint" className={linkInvalid ? 'text-red-700' : 'text-slate-600'}>
              {linkInvalid ? 'ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4' : 'ถ้าวางลิงก์ ระบบใช้ลิงก์แทนไฟล์ และเล่นวิดีโอจากลิงก์โดยไม่ดาวน์โหลดเก็บ'}
            </span>
          </label>
          {fileButton('ไฟล์ SRT', srt, () => srtInputRef.current?.click(), FileText)}
          <p className="text-sm text-slate-600">MP4 ที่มีเสียง AAC · ทุกความละเอียด · ไม่เกิน 60 นาที</p>
          <button
            type="button"
            disabled={!chosenVideo || !srt}
            onClick={() => { if (chosenVideo && srt) onProcess(chosenVideo, srt); }}
            className="mt-2 inline-flex items-center justify-center gap-2 self-start rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Play className="h-4 w-4" aria-hidden="true" />ประมวลผล
          </button>
        </div>
      )}

      {(errorMessage || blockingIssues.length > 0) && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <div className="min-w-0">
            {errorMessage ? <p>{errorMessage}</p> : (
              <ul className="list-disc space-y-1 pl-5">
                {blockingIssues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
