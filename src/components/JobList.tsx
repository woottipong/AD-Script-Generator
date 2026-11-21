import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, FileText, FileVideo, Loader2, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { formatCompactTime, formatFileSize } from '../utils/formatters';
import type { StoredJobSummary } from '../utils/jobStore';
import { defaultJobTitle } from '../utils/jobValidation';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A `GET /api/jobs` row: the stored summary plus whether the server is analysing or uploading it right now. */
type StoredJob = StoredJobSummary & { is_processing: boolean };

const MODE_LABEL: Record<JobMode, string> = { generate: 'สร้างบทบรรยาย', review: 'ตรวจแก้ SRT' };

function statusBadge(job: StoredJob): {
  label: string;
  variant: 'info-strong' | 'secondary' | 'destructive' | 'warning';
  spinning?: boolean;
  tooltip?: string;
} {
  if (job.is_processing) {
    if (job.is_upload) return { label: 'กำลังอัปโหลด', variant: 'info-strong', spinning: true };
    const pct = typeof job.progress_percent === 'number' && job.progress_percent > 0 ? ` ${Math.round(job.progress_percent)}%` : '';
    return { label: `กำลังวิเคราะห์${pct}`, variant: 'info-strong', spinning: true };
  }
  if (job.is_upload) return { label: 'อัปโหลดไม่เสร็จ', variant: 'warning' };
  if (job.status === 'READY') return { label: 'พร้อมแก้', variant: 'secondary' };
  if (job.status === 'FAILED') return { label: 'ผิดพลาด', variant: 'destructive', tooltip: job.error_message };
  return { label: 'รอวิเคราะห์', variant: 'warning' };
}

function formatDuration(job: StoredJob): string {
  return !job.is_upload && typeof job.duration_ms === 'number' && job.duration_ms > 0
    ? formatCompactTime(job.duration_ms)
    : '—';
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

const jobName = (job: StoredJob) => (job.is_upload ? 'อัปโหลดไม่เสร็จ' : job.title || job.file_name);

function deleteConfirmationCopy(job: StoredJob): string {
  if (job.is_upload) {
    return `ลบไฟล์อัปโหลดที่ยังไม่เสร็จ (${formatFileSize(job.size_bytes)}) ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
  }
  if (job.mode === 'review') {
    return `ลบ “${jobName(job)}” และบทบรรยายที่บันทึกไว้ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
  }
  const sizeNote = job.size_bytes > 0 ? ` (${formatFileSize(job.size_bytes)})` : '';
  return `ลบ “${jobName(job)}” และวิดีโอต้นทาง${sizeNote} ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
}

/** The landing view: every stored Job and Unfinished Upload in one dense table with direct row actions. */
export function JobList({ onOpen, onNew }: { onOpen: (jobId: string) => void; onNew: () => void }) {
  const [jobs, setJobs] = useState<StoredJob[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredJob | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFetchError(null);
    fetch('/api/jobs', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data: { jobs?: StoredJob[] } = await response.json();
        if (!Array.isArray(data.jobs)) throw new Error();
        if (!controller.signal.aborted) setJobs(data.jobs);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetchError('โหลดรายการงานไม่สำเร็จ');
      });
    return () => controller.abort();
  }, [refresh]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(pendingDelete.job_id)}/files`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === 'string' ? data.error : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      const removedId = pendingDelete.job_id;
      setJobs((current) => current?.filter((item) => item.job_id !== removedId) ?? null);
    } catch (err) {
      setDeleteError(err instanceof Error && err.message ? err.message : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <section aria-labelledby="job-list-heading" className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h1 id="job-list-heading" className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
              รายการงาน
            </h1>
            {jobs && jobs.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {jobs.length} งาน
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">เปิดงานที่ทำค้างไว้ หรือเริ่มงานบทบรรยายใหม่</p>
        </div>
        {jobs?.length !== 0 && (
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-lg"
                    onClick={() => setRefresh((value) => value + 1)}
                    aria-label="รีเฟรชรายการงาน"
                  />
                }
              >
                <RefreshCw aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>รีเฟรชรายการงาน</TooltipContent>
            </Tooltip>
            <Button size="lg" onClick={onNew}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              งานใหม่
            </Button>
          </div>
        )}
      </div>

      {fetchError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{fetchError}</AlertTitle>
          <AlertDescription>ตรวจการเชื่อมต่อเซิร์ฟเวอร์ แล้วลองอีกครั้ง</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>ลองอีกครั้ง</Button>
          </AlertAction>
        </Alert>
      )}

      {deleteError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>ลบงานไม่สำเร็จ</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
          <AlertAction>
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteError(null)} aria-label="ปิดข้อความแจ้งเตือน">
              <X aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      )}

      {jobs?.length === 0 ? (
        <Empty className="border bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileVideo aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>ยังไม่มีงาน</EmptyTitle>
            <EmptyDescription>เริ่มสร้างบทบรรยายใหม่ หรือเปิด SRT ที่มีอยู่มาตรวจแก้</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={onNew}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              งานใหม่
            </Button>
          </EmptyContent>
        </Empty>
      ) : (jobs || !fetchError) && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table aria-label="งานที่บันทึกไว้" aria-busy={jobs === null}>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-full py-2.5 pl-4 text-xs font-semibold text-muted-foreground sm:pl-5">ชื่องาน</TableHead>
                <TableHead className="hidden px-4 py-2.5 text-xs font-semibold text-muted-foreground md:table-cell">โหมด</TableHead>
                <TableHead className="hidden px-4 py-2.5 text-xs font-semibold text-muted-foreground sm:table-cell">สถานะ</TableHead>
                <TableHead className="hidden px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground lg:table-cell">ความยาว</TableHead>
                <TableHead className="hidden px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground lg:table-cell">บทบรรยาย</TableHead>
                <TableHead className="hidden px-4 py-2.5 pr-6 text-xs font-semibold text-muted-foreground sm:table-cell">แก้ล่าสุด</TableHead>
                <TableHead className="py-2.5 pl-4 pr-4 text-right text-xs font-semibold text-muted-foreground sm:pr-5">การทำงาน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs === null
                ? Array.from({ length: 3 }, (_, index) => (
                  <TableRow key={index} className="hover:bg-transparent">
                    <TableCell className="py-3.5 pl-4 sm:pl-5">
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-9 shrink-0 rounded-md" />
                        <div className="min-w-0 flex-1">
                          <Skeleton className="h-4 w-64 max-w-full" />
                          <Skeleton className="mt-2 h-3 w-40 max-w-full" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-4 md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="hidden px-4 sm:table-cell"><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell className="hidden px-4 lg:table-cell"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                    <TableCell className="hidden px-4 lg:table-cell"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell className="hidden px-4 pr-6 sm:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="py-3.5 pl-4 pr-4 sm:pr-5">
                      <div className="flex justify-end gap-2">
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-16 rounded-lg" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
                : jobs.map((job) => {
                  const name = jobName(job);
                  const status = statusBadge(job);
                  const badge = (
                    <Badge variant={status.variant}>
                      {status.spinning && <Loader2 className="animate-spin" aria-hidden="true" />}
                      {status.label}
                    </Badge>
                  );
                  const statusNode = status.tooltip ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>{badge}</TooltipTrigger>
                      <TooltipContent>{status.tooltip}</TooltipContent>
                    </Tooltip>
                  ) : badge;
                  const spotCount = !job.is_upload && typeof job.spot_count === 'number' && job.spot_count > 0 ? job.spot_count : 0;
                  const editedCount = typeof job.edited_spot_count === 'number' ? job.edited_spot_count : 0;
                  const deleteButton = (
                    <Button
                      variant="ghost-destructive"
                      disabled={job.is_processing}
                      onClick={() => setPendingDelete(job)}
                      aria-label={`ลบงาน ${name}`}
                      className="px-2.5"
                    >
                      <Trash2 data-icon="inline-start" aria-hidden="true" />
                      <span>ลบ</span>
                    </Button>
                  );
                  return (
                    <TableRow key={job.job_id} className="hover:bg-brand-50/40">
                      <TableCell className="max-w-0 py-3.5 pl-4 whitespace-normal sm:pl-5">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="hidden size-9 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/40 sm:inline-flex"
                          >
                            {job.is_upload ? (
                              <Upload className="size-4 text-amber-700" />
                            ) : job.mode === 'review' ? (
                              <FileText className="size-4 text-muted-foreground" />
                            ) : (
                              <FileVideo className="size-4 text-primary" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            {job.is_upload ? (
                              <p className="truncate font-medium text-foreground">{name}</p>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpen(job.job_id)}
                                className="max-w-full cursor-pointer truncate rounded-sm text-left font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                              >
                                {name}
                              </button>
                            )}
                            {/* The file name repeats the title unless the author renamed the Job, so show it only then. */}
                            {!job.is_upload && job.title && job.title !== defaultJobTitle(job.file_name) && (
                              <p className="truncate text-xs text-muted-foreground">{job.file_name}</p>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
                              {statusNode}
                              {job.mode && <span className="text-xs text-muted-foreground">{MODE_LABEL[job.mode]}</span>}
                            </div>
                            {job.mode && (
                              <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block md:hidden">{MODE_LABEL[job.mode]}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-4 text-xs text-muted-foreground md:table-cell">
                        {job.mode ? MODE_LABEL[job.mode] : '—'}
                      </TableCell>
                      <TableCell className="hidden px-4 sm:table-cell">
                        {statusNode}
                      </TableCell>
                      <TableCell className="hidden px-4 text-right font-mono text-xs text-muted-foreground tabular-nums lg:table-cell">
                        {formatDuration(job)}
                      </TableCell>
                      <TableCell className="hidden px-4 text-right text-xs tabular-nums lg:table-cell">
                        {spotCount > 0 ? (
                          <span className="whitespace-nowrap text-foreground">
                            {spotCount} จุด
                            {editedCount > 0 && <span className="text-muted-foreground"> · แก้ {editedCount}</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden px-4 pr-6 text-xs text-muted-foreground tabular-nums sm:table-cell">
                        {formatUpdatedAt(job.updated_at)}
                      </TableCell>
                      <TableCell className="py-3.5 pl-4 pr-4 sm:pr-5">
                        <div className="flex items-center justify-end gap-2">
                          {!job.is_upload && (
                            <Button
                              variant="outline"
                              onClick={() => onOpen(job.job_id)}
                              aria-label={`ทำต่อ ${name}`}
                            >
                              <span>ทำต่อ</span>
                              <ArrowRight data-icon="inline-end" aria-hidden="true" />
                            </Button>
                          )}
                          {job.is_processing ? (
                            <Tooltip>
                              <TooltipTrigger render={<span className="inline-flex" />}>
                                {deleteButton}
                              </TooltipTrigger>
                              <TooltipContent>กำลังประมวลผลอยู่ จึงยังลบไม่ได้</TooltipContent>
                            </Tooltip>
                          ) : deleteButton}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบงานนี้?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? deleteConfirmationCopy(pendingDelete) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? 'กำลังลบ…' : 'ลบงาน'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
