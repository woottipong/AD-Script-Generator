import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  FileVideo,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { JobMode } from '../types/ad';
import { formatCompactTime, formatFileSize } from '../utils/formatters';
import type { StoredJobSummary } from '../utils/jobStore';
import { defaultJobTitle } from '../utils/jobValidation';
import { jobPath } from '../utils/jobPath';
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
import { Button, buttonVariants } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from 'cn';

/** A `GET /api/jobs` row: the stored summary plus whether the server is analysing or uploading it right now. */
type StoredJob = StoredJobSummary & { is_processing: boolean };

const PAGE_SIZE = 25;
const STATUS_REFRESH_INTERVAL_MS = 5_000;
const UPDATED_AT_FORMAT = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

const MODE_LABEL: Record<JobMode, string> = { generate: 'สร้างบทบรรยาย', review: 'ตรวจแก้ SRT' };

type JobVisualState = {
  label: string;
  variant: 'info' | 'info-strong' | 'destructive' | 'warning';
  icon: LucideIcon;
  tileIcon: LucideIcon;
  tileClass: string;
  rowClass: string;
  spinning?: boolean;
  errorDetails?: string;
};

function jobVisualState(job: StoredJob): JobVisualState {
  const modeIcon = job.mode === 'review' ? FileText : FileVideo;
  if (job.is_processing) {
    const pct = !job.is_upload && typeof job.progress_percent === 'number' && job.progress_percent > 0
      ? ` ${Math.round(job.progress_percent)}%`
      : '';
    return {
      label: job.is_upload ? 'กำลังอัปโหลด' : `กำลังวิเคราะห์${pct}`,
      variant: 'info-strong',
      icon: Loader2,
      tileIcon: job.is_upload ? Upload : modeIcon,
      tileClass: 'border-brand-200 bg-brand-50 text-brand-700',
      rowClass: 'hover:bg-accent/60',
      spinning: true,
    };
  }
  if (job.is_upload) {
    return {
      label: 'อัปโหลดไม่สมบูรณ์',
      variant: 'warning',
      icon: AlertTriangle,
      tileIcon: Upload,
      tileClass: 'border-warning-border bg-warning text-warning-foreground',
      rowClass: 'bg-warning/60 hover:bg-warning',
    };
  }
  if (job.status === 'FAILED') {
    return {
      label: 'วิเคราะห์ไม่สำเร็จ',
      variant: 'destructive',
      icon: AlertCircle,
      tileIcon: modeIcon,
      tileClass: 'border-error-border bg-error-surface text-error-foreground',
      rowClass: 'bg-error-surface/60 hover:bg-error-surface',
      errorDetails: job.error_message,
    };
  }
  if (job.status === 'READY') {
    return {
      label: 'พร้อมแก้',
      variant: 'info',
      icon: CheckCircle2,
      tileIcon: modeIcon,
      tileClass: job.mode === 'review'
        ? 'border-border bg-secondary text-secondary-foreground'
        : 'border-brand-200 bg-brand-50 text-brand-700',
      rowClass: 'hover:bg-accent/60',
    };
  }
  return {
    label: 'รอวิเคราะห์',
    variant: 'warning',
    icon: Clock,
    tileIcon: modeIcon,
    tileClass: 'border-warning-border bg-warning text-warning-foreground',
    rowClass: 'hover:bg-accent/60',
  };
}

function ModeTag({ mode, className }: { mode: JobMode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-secondary-foreground', className)}>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${mode === 'generate' ? 'bg-brand-600' : 'bg-muted-foreground'}`}
      />
      {MODE_LABEL[mode]}
    </span>
  );
}

function JobStatusBadge({ status, name }: { status: JobVisualState; name: string }) {
  const StatusIcon = status.icon;
  const badge = (
    <Badge variant={status.variant} className="h-auto min-h-5 max-w-full whitespace-normal text-left tabular-nums">
      <StatusIcon className={status.spinning ? 'animate-spin' : undefined} aria-hidden="true" />
      {status.label}
      {status.errorDetails && <ChevronDown aria-hidden="true" />}
    </Badge>
  );
  if (!status.errorDetails) return badge;

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" className="h-auto min-h-7 max-w-full px-0" />}
        aria-label={`ดูรายละเอียด: ${status.label} ${name}`}
      >
        {badge}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[calc(100vw-2rem)] motion-reduce:animate-none">
        <PopoverTitle>สาเหตุที่วิเคราะห์ไม่สำเร็จ</PopoverTitle>
        <PopoverDescription className="[overflow-wrap:anywhere]">{status.errorDetails}</PopoverDescription>
      </PopoverContent>
    </Popover>
  );
}

function formatDuration(job: StoredJob): string {
  return !job.is_upload && typeof job.duration_ms === 'number' && job.duration_ms > 0
    ? formatCompactTime(job.duration_ms)
    : '—';
}

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : UPDATED_AT_FORMAT.format(date);
}

const uploadCode = (jobId: string) => jobId.replace(/^job_/, '').slice(-8);
const jobName = (job: StoredJob) => job.is_upload ? `ไฟล์อัปโหลด #${uploadCode(job.job_id)}` : job.title || job.file_name;

function describeUpload(job: StoredJob): string {
  const updated = formatUpdatedAt(job.updated_at);
  return `ขนาด ${formatFileSize(job.size_bytes)}${updated ? ` อัปเดตล่าสุด ${updated}` : ''}`;
}

function deleteConfirmationCopy(job: StoredJob): string {
  const name = jobName(job);
  if (job.is_upload) {
    return `ลบ “${name}” ${describeUpload(job)} ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
  }
  if (job.mode === 'review') {
    return `ลบ “${name}” และบทบรรยายที่บันทึกไว้ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
  }
  const sizeNote = job.size_bytes > 0 ? ` (${formatFileSize(job.size_bytes)})` : '';
  return `ลบ “${name}” และวิดีโอต้นทาง${sizeNote} ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
}

export function JobList({ onOpen, onNew }: { onOpen: (jobId: string) => void; onNew: () => void }) {
  const [jobs, setJobs] = useState<StoredJob[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredJob | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const searchInput = useRef<HTMLInputElement>(null);
  const emptyNewJobButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const activeRequest = useRef<{ controller: AbortController; announce: boolean } | null>(null);

  const loadJobs = useCallback(async (announce = false) => {
    if (!mounted.current || activeRequest.current) return;
    const controller = new AbortController();
    const request = { controller, announce };
    activeRequest.current = request;
    setLoading(true);
    if (announce) setRefreshMessage('กำลังอัปเดตรายการงาน');
    try {
      const response = await fetch('/api/jobs', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data: { jobs?: StoredJob[] } = await response.json();
      if (!Array.isArray(data.jobs)) throw new Error();
      if (controller.signal.aborted) return;
      setJobs(data.jobs);
      setFetchError(null);
      if (announce) setRefreshMessage('อัปเดตรายการงานแล้ว');
    } catch {
      if (controller.signal.aborted) return;
      setFetchError('โหลดรายการงานไม่สำเร็จ');
      if (announce) setRefreshMessage('');
    } finally {
      if (activeRequest.current === request) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadJobs();
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadJobs();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
    };
  }, [loadJobs]);

  const hasProcessingJobs = jobs?.some((job) => job.is_processing) ?? false;

  useEffect(() => {
    if (!hasProcessingJobs || loading) return;
    const timer = window.setTimeout(() => {
      if (!document.hidden) void loadJobs();
    }, STATUS_REFRESH_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [hasProcessingJobs, loading, loadJobs]);

  const searchTerm = query.trim().toLocaleLowerCase('th-TH');
  const matchingJobs = (jobs ?? []).filter((job) =>
    !searchTerm || [jobName(job), job.file_name].some((value) => value.toLocaleLowerCase('th-TH').includes(searchTerm))
  );
  const pageCount = Math.max(1, Math.ceil(matchingJobs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageJobs = matchingJobs.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const openJobLink = (event: MouseEvent<HTMLAnchorElement>, jobId: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(jobId);
  };

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
      // A list request sent before the deletion could still contain this row.
      const request = activeRequest.current;
      request?.controller.abort();
      activeRequest.current = null;
      setJobs((current) => current?.filter((item) => item.job_id !== removedId) ?? null);
      setDeleteMessage(`ลบ${pendingDelete.is_upload ? '' : 'งาน '}${jobName(pendingDelete)}แล้ว`);
      void loadJobs(request?.announce);
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
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 id="job-list-heading" className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
              รายการงาน
            </h1>
            {jobs && jobs.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {jobs.length} รายการ
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">จัดการงานบทบรรยายภาพทั้งหมด หรือสร้างงานใหม่</p>
        </div>
        {jobs?.length !== 0 && (
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-lg"
                    onClick={() => void loadJobs(true)}
                    disabled={loading}
                    focusableWhenDisabled
                    aria-label="รีเฟรชรายการงาน"
                    className="aria-disabled:cursor-wait aria-disabled:opacity-60"
                  />
                }
              >
                <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
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

      <p role="status" className="sr-only">{refreshMessage}</p>
      <p role="status" className="sr-only">{deleteMessage}</p>

      {fetchError && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{fetchError}</AlertTitle>
          <AlertDescription>ตรวจการเชื่อมต่อเซิร์ฟเวอร์ แล้วลองอีกครั้ง</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void loadJobs(true)} disabled={loading} focusableWhenDisabled>
              {loading ? 'กำลังโหลด…' : 'ลองอีกครั้ง'}
            </Button>
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

      {Boolean(jobs?.length) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InputGroup className="w-full sm:w-80">
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
            <InputGroupInput
              ref={searchInput}
              type="search"
              aria-label="ค้นหาชื่องานหรือชื่อไฟล์"
              placeholder="ค้นหาชื่องานหรือชื่อไฟล์"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </InputGroup>
          <p role="status" className={searchTerm ? 'text-sm text-muted-foreground' : 'sr-only'}>
            {searchTerm ? `พบ ${matchingJobs.length} รายการ` : ''}
          </p>
        </div>
      )}

      {jobs?.length === 0 ? (
        <Empty className="border bg-card py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileVideo aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>ยังไม่มีงาน</EmptyTitle>
            <EmptyDescription>เริ่มสร้างบทบรรยายใหม่ หรือเปิด SRT ที่มีอยู่มาตรวจแก้</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button ref={emptyNewJobButton} size="lg" onClick={onNew}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              งานใหม่
            </Button>
          </EmptyContent>
        </Empty>
      ) : jobs && matchingJobs.length === 0 ? (
        <Empty className="border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Search aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>ไม่พบงานที่ตรงกับการค้นหา</EmptyTitle>
            <EmptyDescription>ลองใช้ชื่ออื่นหรือค้นหาด้วยชื่อไฟล์ต้นฉบับ</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => { setQuery(''); searchInput.current?.focus(); }}>
              ล้างการค้นหา
            </Button>
          </EmptyContent>
        </Empty>
      ) : (jobs || !fetchError) && (
        <div className="@container overflow-hidden rounded-lg border bg-card">
          <Table aria-label="งานที่บันทึกไว้" aria-busy={loading} className="table-fixed">
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground @min-[42rem]:pl-5">ชื่องาน</TableHead>
                <TableHead scope="col" className="hidden w-32 px-3 text-xs font-semibold text-muted-foreground @min-[54rem]:table-cell">โหมด</TableHead>
                <TableHead scope="col" className="hidden w-44 px-3 text-xs font-semibold text-muted-foreground @min-[54rem]:table-cell">สถานะ</TableHead>
                <TableHead scope="col" className="hidden w-24 px-3 text-right text-xs font-semibold text-muted-foreground @min-[66rem]:table-cell">ความยาว</TableHead>
                <TableHead scope="col" className="hidden w-24 px-3 text-right text-xs font-semibold text-muted-foreground @min-[66rem]:table-cell">บทบรรยาย</TableHead>
                <TableHead scope="col" className="hidden w-36 px-3 text-xs font-semibold text-muted-foreground @min-[54rem]:table-cell">แก้ล่าสุด</TableHead>
                <TableHead scope="col" className="hidden w-36 px-4 text-right text-xs font-semibold text-muted-foreground @min-[42rem]:table-cell @min-[42rem]:pr-5">การทำงาน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs === null
                ? Array.from({ length: 3 }, (_, index) => (
                  <TableRow key={index} aria-hidden="true" className="hover:bg-transparent">
                    <TableCell colSpan={7} className="px-4 py-4">
                      <Skeleton className="h-5 w-64 max-w-full" />
                      <Skeleton className="mt-2 h-3 w-40 max-w-full" />
                    </TableCell>
                  </TableRow>
                ))
                : pageJobs.map((job) => {
                  const name = jobName(job);
                  const status = jobVisualState(job);
                  const TileIcon = status.tileIcon;
                  const updated = formatUpdatedAt(job.updated_at);
                  const uploadSize = job.is_upload ? formatFileSize(job.size_bytes) : '';
                  const href = jobPath(job.job_id);
                  const statusNode = <JobStatusBadge status={status} name={name} />;
                  const deleteButton = (
                    <Button
                      variant="ghost-destructive"
                      size="icon"
                      disabled={job.is_processing}
                      onClick={() => {
                        setDeleteMessage('');
                        setPendingDelete(job);
                      }}
                      aria-label={job.is_upload ? `ลบ${name} ${describeUpload(job)}` : `ลบงาน ${name}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  );
                  const actions = (
                    <div className="flex items-center gap-1 @min-[42rem]:justify-end">
                      {!job.is_upload && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <a
                                href={href}
                                onClick={(event) => openJobLink(event, job.job_id)}
                                aria-label={`เปิดงาน ${name}`}
                                className={cn(
                                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                                  'text-primary not-disabled:hover:bg-accent not-disabled:hover:text-primary pointer-coarse:size-11',
                                )}
                              />
                            }
                          >
                            <ArrowRight strokeWidth={2.5} aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent>เปิดงาน</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger render={job.is_processing ? <span className="inline-flex">{deleteButton}</span> : deleteButton} />
                        <TooltipContent>{job.is_processing ? 'กำลังประมวลผลอยู่ จึงยังลบไม่ได้' : 'ลบ'}</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                  return (
                    <TableRow key={job.job_id} className={status.rowClass}>
                      <TableCell className="px-4 py-3.5 whitespace-normal @min-[42rem]:pl-5">
                        <div className="flex items-start gap-3 @min-[54rem]:items-center">
                          <span
                            aria-hidden="true"
                            className={`hidden size-9 shrink-0 items-center justify-center rounded-md border @min-[42rem]:inline-flex ${status.tileClass}`}
                          >
                            <TileIcon className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            {job.is_upload ? (
                              <p className="font-medium text-foreground [overflow-wrap:anywhere]">{name}</p>
                            ) : (
                              <a
                                href={href}
                                onClick={(event) => openJobLink(event, job.job_id)}
                                className="inline-flex min-h-6 max-w-full items-center rounded-sm font-medium text-foreground underline-offset-4 [overflow-wrap:anywhere] hover:text-primary hover:underline pointer-coarse:min-h-11"
                              >
                                {name}
                              </a>
                            )}
                            {job.is_upload ? (
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {uploadSize}
                                {updated && <time dateTime={job.updated_at} className="before:mx-1.5 before:content-['·'] @min-[54rem]:hidden">{updated}</time>}
                              </p>
                            ) : job.title && job.title !== defaultJobTitle(job.file_name) && (
                              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{job.file_name}</p>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 @min-[54rem]:hidden">
                              {statusNode}
                              {!job.is_upload && job.mode && <ModeTag mode={job.mode} />}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 border-t border-border/60 pt-1 @min-[42rem]:hidden">{actions}</div>
                      </TableCell>
                      <TableCell className="hidden px-3 text-xs whitespace-normal @min-[54rem]:table-cell">
                        {!job.is_upload && job.mode ? <ModeTag mode={job.mode} /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden px-3 whitespace-normal @min-[54rem]:table-cell">
                        {statusNode}
                      </TableCell>
                      <TableCell className="hidden px-3 text-right font-mono text-xs text-muted-foreground tabular-nums @min-[66rem]:table-cell">
                        {formatDuration(job)}
                      </TableCell>
                      <TableCell className="hidden px-3 text-right text-xs tabular-nums @min-[66rem]:table-cell">
                        {typeof job.spot_count === 'number' && job.spot_count > 0
                          ? <span>{job.spot_count} จุด</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden px-3 text-xs whitespace-normal text-muted-foreground tabular-nums @min-[54rem]:table-cell">
                        {updated && <time dateTime={job.updated_at}>{updated}</time>}
                      </TableCell>
                      <TableCell className="hidden px-4 py-3.5 @min-[42rem]:table-cell @min-[42rem]:pr-5">{actions}</TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
          {pageCount > 1 && (
            <nav aria-label="หน้ารายการงาน" className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 @min-[42rem]:px-5">
              <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {pageStart + 1}–{pageStart + pageJobs.length} จาก {matchingJobs.length} รายการ
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" aria-label="หน้าก่อนหน้า" disabled={currentPage === 1} focusableWhenDisabled className="aria-disabled:opacity-50" onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="px-2 text-xs text-muted-foreground tabular-nums">หน้า {currentPage} / {pageCount}</span>
                <Button variant="outline" size="icon-sm" aria-label="หน้าถัดไป" disabled={currentPage === pageCount} focusableWhenDisabled className="aria-disabled:opacity-50" onClick={() => setPage(currentPage + 1)}>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent finalFocus={() => deleteMessage ? searchInput.current ?? emptyNewJobButton.current : true}>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันการลบงาน</AlertDialogTitle>
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
