import { useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { formatFileSize } from '../utils/formatters';
import type { StoredJobSummary } from '../utils/jobStore';

/** A `GET /api/jobs` row: the stored summary plus whether the server is analysing or uploading it right now. */
type StoredJob = StoredJobSummary & { is_processing: boolean };

const MODE_LABEL: Record<JobMode, string> = { generate: 'สร้างบทบรรยาย', review: 'ตรวจแก้ SRT' };

function statusTag(job: StoredJob): { label: string; className: string } {
  if (job.is_processing) return { label: job.is_upload ? 'กำลังอัปโหลด' : 'กำลังวิเคราะห์', className: 'border-brand-300 bg-brand-50 text-brand-900' };
  if (job.is_upload) return { label: 'อัปโหลดไม่เสร็จ', className: 'border-slate-200 bg-slate-100 text-slate-700' };
  if (job.status === 'READY') return { label: 'พร้อมแก้', className: 'border-slate-200 bg-slate-100 text-slate-700' };
  if (job.status === 'FAILED') return { label: 'ผิดพลาด', className: 'border-red-200 bg-red-50 text-red-800' };
  return { label: 'รอวิเคราะห์', className: 'border-amber-300 bg-amber-50 text-amber-900' };
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The landing view: every stored Job and Unfinished Upload, so an author can reopen or delete one. */
export function JobList({ onOpen, onNew }: { onOpen: (jobId: string) => void; onNew: () => void }) {
  const [jobs, setJobs] = useState<StoredJob[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch('/api/jobs', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data: { jobs?: StoredJob[] } = await response.json();
        if (!Array.isArray(data.jobs)) throw new Error();
        if (!controller.signal.aborted) setJobs(data.jobs);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('โหลดรายการงานไม่สำเร็จ');
      });
    return () => controller.abort();
  }, [refresh]);

  const deleteJob = async (job: StoredJob, name: string) => {
    if (!window.confirm(`ลบงาน "${name}" และวิดีโอต้นทางออกจากเซิร์ฟเวอร์? การลบนี้ย้อนกลับไม่ได้`)) return;
    setDeleting(job.job_id);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.job_id)}/files`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === 'string' ? data.error : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      setJobs((current) => current?.filter((item) => item.job_id !== job.job_id) ?? null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setDeleting(null);
    }
  };

  const newJobButton = (
    <button type="button" onClick={onNew} className="btn-primary inline-flex min-h-10 shrink-0 items-center gap-2 px-4 py-2 text-sm">
      <Plus className="h-4 w-4" aria-hidden="true" />งานใหม่
    </button>
  );

  return (
    <section aria-labelledby="job-list-heading" className="w-[calc(100%_-_2rem)] max-w-4xl mx-auto my-8 sm:my-14 px-1 sm:px-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="job-list-heading" className="text-2xl sm:text-3xl font-semibold text-slate-900 leading-tight">รายการงาน</h1>
          <p className="mt-2 text-base text-slate-600">เปิดงานที่ทำค้างไว้ หรือเริ่มงานบทบรรยายใหม่</p>
        </div>
        {jobs?.length !== 0 && newJobButton}
      </div>

      {error && (
        <div role="alert" className="alert-error mt-6 px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error} <button type="button" onClick={() => setRefresh((value) => value + 1)} className="font-semibold underline cursor-pointer">ลองอีกครั้ง</button></p>
        </div>
      )}

      {jobs === null ? (
        !error && <p role="status" className="mt-8 text-slate-600">กำลังโหลดรายการงาน…</p>
      ) : jobs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-slate-900">ยังไม่มีงาน</h2>
          <p className="mt-2 text-slate-600">เริ่มสร้างบทบรรยายใหม่ หรือเปิด SRT ที่มีอยู่มาตรวจแก้</p>
          <div className="mt-6">{newJobButton}</div>
        </div>
      ) : (
        <ul aria-label="งานที่บันทึกไว้" className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {jobs.map((job) => {
            const name = job.is_upload ? 'อัปโหลดไม่เสร็จ' : job.title || job.file_name;
            const tag = statusTag(job);
            return (
              <li key={job.job_id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{name}</p>
                  {!job.is_upload && job.title && <p className="mt-0.5 text-xs text-slate-600 [overflow-wrap:anywhere]">{job.file_name}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-600 tabular-nums">
                    {job.mode && <span className="tag border-slate-200 bg-white text-slate-700">{MODE_LABEL[job.mode]}</span>}
                    <span className={`tag ${tag.className}`}>{tag.label}</span>
                    <span>แก้ล่าสุด {formatUpdatedAt(job.updated_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatFileSize(job.size_bytes)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!job.is_upload && (
                    <button type="button" onClick={() => onOpen(job.job_id)} aria-label={`ทำต่อ ${name}`} className="btn-primary min-h-10 px-4 py-2 text-sm">ทำต่อ</button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteJob(job, name)}
                    disabled={job.is_processing || deleting !== null}
                    aria-label={`ลบงาน ${name}`}
                    className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 cursor-pointer disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
                  >
                    {deleting === job.job_id ? 'กำลังลบ…' : 'ลบ'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
