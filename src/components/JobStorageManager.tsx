import { useEffect, useState } from 'react';
import { ChevronDown, HardDrive } from 'lucide-react';
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
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group relative">
      <summary className="menu-item list-none group-open:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <HardDrive className="h-4 w-4" aria-hidden="true" />
        <span className="flex-1">จัดการพื้นที่จัดเก็บ</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <section aria-label="งานที่เก็บบนเซิร์ฟเวอร์" className="menu-panel right-0 w-96 p-4">
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
