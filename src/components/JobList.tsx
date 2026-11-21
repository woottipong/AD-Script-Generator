import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, FileVideo, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { formatFileSize } from '../utils/formatters';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** A `GET /api/jobs` row: the stored summary plus whether the server is analysing or uploading it right now. */
type StoredJob = StoredJobSummary & { is_processing: boolean };

const MODE_LABEL: Record<JobMode, string> = { generate: 'สร้างบทบรรยาย', review: 'ตรวจแก้ SRT' };

function statusBadge(job: StoredJob): { label: string; variant: 'info' | 'secondary' | 'destructive' | 'warning' } {
  if (job.is_processing) return { label: job.is_upload ? 'กำลังอัปโหลด' : 'กำลังวิเคราะห์', variant: 'info' };
  if (job.is_upload) return { label: 'อัปโหลดไม่เสร็จ', variant: 'secondary' };
  if (job.status === 'READY') return { label: 'พร้อมแก้', variant: 'secondary' };
  if (job.status === 'FAILED') return { label: 'ผิดพลาด', variant: 'destructive' };
  return { label: 'รอวิเคราะห์', variant: 'warning' };
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

const jobName = (job: StoredJob) => (job.is_upload ? 'อัปโหลดไม่เสร็จ' : job.title || job.file_name);

/** The landing view: every stored Job and Unfinished Upload in one dense table, so an author can reopen or delete one. */
export function JobList({ onOpen, onNew }: { onOpen: (jobId: string) => void; onNew: () => void }) {
  const [jobs, setJobs] = useState<StoredJob[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredJob | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(pendingDelete.job_id)}/files`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === 'string' ? data.error : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
      }
      const removedId = pendingDelete.job_id;
      setJobs((current) => current?.filter((item) => item.job_id !== removedId) ?? null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'ลบงานไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <section aria-labelledby="job-list-heading" className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="job-list-heading" className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
            รายการงาน
            {jobs && jobs.length > 0 && <span className="ml-3 align-middle text-sm font-medium tabular-nums text-muted-foreground">{jobs.length} งาน</span>}
          </h1>
          <p className="text-sm text-muted-foreground">เปิดงานที่ทำค้างไว้ หรือเริ่มงานบทบรรยายใหม่</p>
        </div>
        {jobs?.length !== 0 && (
          <Button size="lg" onClick={onNew}>
            <Plus data-icon="inline-start" />
            งานใหม่
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{error}</AlertTitle>
          <AlertDescription>ตรวจการเชื่อมต่อเซิร์ฟเวอร์ แล้วลองอีกครั้ง</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>ลองอีกครั้ง</Button>
          </AlertAction>
        </Alert>
      )}

      {jobs?.length === 0 ? (
        <Empty className="border bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileVideo /></EmptyMedia>
            <EmptyTitle>ยังไม่มีงาน</EmptyTitle>
            <EmptyDescription>เริ่มสร้างบทบรรยายใหม่ หรือเปิด SRT ที่มีอยู่มาตรวจแก้</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={onNew}>
              <Plus data-icon="inline-start" />
              งานใหม่
            </Button>
          </EmptyContent>
        </Empty>
      ) : (jobs || !error) && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table aria-label="งานที่บันทึกไว้" aria-busy={jobs === null}>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-full pl-4 text-muted-foreground">ชื่องาน</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">โหมด</TableHead>
                <TableHead className="text-muted-foreground">สถานะ</TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">แก้ล่าสุด</TableHead>
                <TableHead className="hidden text-right text-muted-foreground lg:table-cell">ขนาด</TableHead>
                <TableHead className="pr-4"><span className="sr-only">การทำงาน</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs === null
                ? Array.from({ length: 3 }, (_, index) => (
                  <TableRow key={index} className="hover:bg-transparent">
                    <TableCell className="py-3 pl-4"><Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="mt-2 h-3 w-40 max-w-full" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell className="pr-4" />
                  </TableRow>
                ))
                : jobs.map((job) => {
                  const name = jobName(job);
                  const status = statusBadge(job);
                  return (
                    <TableRow key={job.job_id}>
                      <TableCell className="max-w-0 py-3 pl-4 whitespace-normal">
                        {job.is_upload ? (
                          <p className="truncate font-medium text-foreground">{name}</p>
                        ) : (
                          <button type="button" onClick={() => onOpen(job.job_id)} className="max-w-full cursor-pointer truncate rounded-sm text-left font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                            {name}
                          </button>
                        )}
                        {/* The file name repeats the title unless the author renamed the Job, so show it only then. */}
                        {!job.is_upload && job.title && job.title !== defaultJobTitle(job.file_name) && <p className="truncate text-xs text-muted-foreground">{job.file_name}</p>}
                        {job.mode && <p className="text-xs text-muted-foreground md:hidden">{MODE_LABEL[job.mode]}</p>}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{job.mode ? MODE_LABEL[job.mode] : '—'}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                      <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">{formatUpdatedAt(job.updated_at)}</TableCell>
                      <TableCell className="hidden text-right text-muted-foreground tabular-nums lg:table-cell">{formatFileSize(job.size_bytes)}</TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center justify-end gap-1">
                          {!job.is_upload && (
                            <Button variant="outline" className="hidden sm:inline-flex" onClick={() => onOpen(job.job_id)} aria-label={`ทำต่อ ${name}`}>ทำต่อ</Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`ตัวเลือกงาน ${name}`} />}>
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {!job.is_upload && (
                                <DropdownMenuGroup className="sm:hidden">
                                  <DropdownMenuItem onClick={() => onOpen(job.job_id)}>
                                    <ArrowRight />
                                    ทำต่อ
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              )}
                              <DropdownMenuGroup>
                                <DropdownMenuItem variant="destructive" disabled={job.is_processing} onClick={() => setPendingDelete(job)}>
                                  <Trash2 />
                                  ลบงาน
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
              ลบ “{pendingDelete ? jobName(pendingDelete) : ''}” และวิดีโอต้นทางออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้
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
