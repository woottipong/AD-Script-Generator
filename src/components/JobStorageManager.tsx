import { useEffect, useState } from 'react';
import { formatFileSize } from '../utils/formatters';

interface StoredJob {
  job_id: string;
  file_name: string;
  updated_at: string;
  size_bytes: number;
  is_active: boolean;
  is_processing: boolean;
  is_upload: boolean;
}

export function JobStorageManager() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<StoredJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch('/api/jobs', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data: { jobs?: StoredJob[] } = await response.json();
        if (!Array.isArray(data.jobs)) throw new Error();
        if (!controller.signal.aborted) setJobs(data.jobs);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('โหลดรายการงานไม่สำเร็จ กรุณาลองอีกครั้ง');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, refresh]);

  const deleteJob = async (job: StoredJob) => {
    if (!window.confirm(`ลบงาน "${job.file_name}" และวิดีโอต้นทางออกจากเซิร์ฟเวอร์? การลบนี้ย้อนกลับไม่ได้`)) return;
    setDeleting(job.job_id);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.job_id)}/files`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === 'string' ? data.error : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      setJobs((current) => current.filter((item) => item.job_id !== job.job_id));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="relative">
      <summary className="min-h-10 cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-brand-700">จัดการพื้นที่จัดเก็บ</summary>
      <section aria-label="งานที่เก็บบนเซิร์ฟเวอร์" className="absolute right-0 z-50 mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-300 bg-white p-4 text-sm shadow-lg">
        <h2 className="font-semibold text-slate-900">งานที่เก็บบนเซิร์ฟเวอร์</h2>
        <p className="mt-1 text-slate-600">การลบจะลบข้อมูลงานและวิดีโอต้นทางออกจากเซิร์ฟเวอร์ และย้อนกลับไม่ได้</p>
        {error && <p role="alert" className="mt-3 text-red-700">{error} <button type="button" onClick={() => setRefresh((value) => value + 1)} className="font-semibold underline">ลองอีกครั้ง</button></p>}
        {loading ? <p role="status" className="mt-3 text-slate-600">กำลังโหลดรายการงาน…</p> : jobs.length === 0 && !error ? <p className="mt-3 text-slate-600">ไม่มีงานที่เก็บไว้</p> : (
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {jobs.map((job) => <li key={job.job_id} className="flex items-start justify-between gap-3 rounded border border-slate-200 p-2">
              <div className="min-w-0"><p className="break-words font-medium text-slate-900">{job.file_name}</p><p className="text-xs text-slate-600">{formatFileSize(job.size_bytes)} · {new Date(job.updated_at).toLocaleString('th-TH')}</p>{(job.is_active || job.is_processing) && <p className="text-xs text-slate-600">{job.is_processing ? (job.is_upload ? 'กำลังอัปโหลด' : 'กำลังประมวลผล') : 'งานปัจจุบัน'}</p>}</div>
              <button type="button" onClick={() => void deleteJob(job)} disabled={job.is_active || job.is_processing || deleting !== null} aria-label={`ลบงาน ${job.file_name}`} className="shrink-0 rounded px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400">{deleting === job.job_id ? 'กำลังลบ…' : 'ลบ'}</button>
            </li>)}
          </ul>
        )}
      </section>
    </details>
  );
}
