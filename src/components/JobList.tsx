import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
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
import { formatCompactTime } from '../utils/formatters';
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
import { InputGroup, InputGroupAddon, InputGroupClearButton, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from 'cn';

/** A `GET /api/jobs` row: the stored summary plus whether the server is analysing or uploading it right now. */
type StoredJob = StoredJobSummary & { is_processing: boolean };

const PAGE_SIZE = 25;
const STATUS_REFRESH_INTERVAL_MS = 5_000;
const UPDATED_AT_FORMAT = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

const MODE_LABEL: Record<JobMode, string> = { generate: 'สร้างบทบรรยาย', review: 'ตรวจแก้ SRT' };

type OwnerScope = 'all' | 'mine';
type ModeFilter = 'all' | JobMode;
type JobStatusBucket = 'processing' | 'failed' | 'incomplete_upload' | 'ready' | 'pending';
type StatusFilter = 'all' | JobStatusBucket;
type JobListFilters = {
  query: string;
  ownerScope: OwnerScope;
  modeFilter: ModeFilter;
  statusFilter: StatusFilter;
};

const MODE_FILTER_LABEL: Record<ModeFilter, string> = {
  all: 'ทั้งหมด',
  generate: MODE_LABEL.generate,
  review: MODE_LABEL.review,
};

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'ทั้งหมด',
  ready: 'พร้อมแก้',
  processing: 'กำลังดำเนินการ',
  failed: 'วิเคราะห์ไม่สำเร็จ',
  incomplete_upload: 'อัปโหลดไม่สมบูรณ์',
  pending: 'รอวิเคราะห์',
};

const STATUS_FILTER_OPTIONS = Object.entries(STATUS_FILTER_LABEL) as [StatusFilter, string][];

const VALID_MODES = new Set<JobMode>(['generate', 'review']);
const VALID_STATUS_BUCKETS = new Set<JobStatusBucket>(
  STATUS_FILTER_OPTIONS.filter(([value]) => value !== 'all').map(([value]) => value as JobStatusBucket),
);

function jobStatusBucket(job: StoredJob): JobStatusBucket {
  if (job.is_processing) return 'processing';
  if (job.is_upload) return 'incomplete_upload';
  if (job.status === 'FAILED') return 'failed';
  if (job.status === 'READY') return 'ready';
  return 'pending';
}

function readFiltersFromSearch(search: string, showOwners: boolean): JobListFilters {
  const params = new URLSearchParams(search);
  const rawScope = params.get('scope');
  const rawMode = params.get('mode');
  const rawStatus = params.get('status');
  return {
    query: params.get('q') ?? '',
    ownerScope: showOwners && rawScope === 'mine' ? 'mine' : 'all',
    modeFilter: rawMode && VALID_MODES.has(rawMode as JobMode) ? (rawMode as JobMode) : 'all',
    statusFilter: rawStatus && VALID_STATUS_BUCKETS.has(rawStatus as JobStatusBucket) ? (rawStatus as JobStatusBucket) : 'all',
  };
}

function syncFiltersToUrl(filters: JobListFilters, showOwners: boolean): void {
  if (window.location.pathname !== '/') return;
  const params = new URLSearchParams(window.location.search);
  const trimmedQuery = filters.query.trim();
  if (trimmedQuery) params.set('q', trimmedQuery);
  else params.delete('q');
  if (showOwners && filters.ownerScope !== 'all') params.set('scope', filters.ownerScope);
  else params.delete('scope');
  if (filters.modeFilter !== 'all') params.set('mode', filters.modeFilter);
  else params.delete('mode');
  if (filters.statusFilter !== 'all') params.set('status', filters.statusFilter);
  else params.delete('status');
  const nextSearch = params.toString();
  const nextUrl = nextSearch ? `/?${nextSearch}` : '/';
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
}

type SortField = 'updated_at' | 'name' | 'duration' | 'spots';
type SortDirection = 'asc' | 'desc';

const DEFAULT_SORT_DIRECTION: Record<SortField, SortDirection> = {
  updated_at: 'desc',
  name: 'asc',
  duration: 'desc',
  spots: 'desc',
};

const SKELETON_ROWS: readonly { title: string; subtitle: string | null }[] = [
  { title: 'w-56', subtitle: 'w-36' },
  { title: 'w-44', subtitle: null },
  { title: 'w-64', subtitle: 'w-40' },
  { title: 'w-48', subtitle: null },
];

type JobVisualState = {
  label: string;
  variant: 'secondary' | 'info' | 'info-strong' | 'destructive' | 'warning';
  icon: LucideIcon;
  tileIcon: LucideIcon;
  tileClass: string;
  rowClass: string;
  spinning?: boolean;
  errorDetails?: string;
};

function jobVisualState(job: StoredJob): JobVisualState {
  const modeIcon = job.mode === 'review' ? FileText : FileVideo;
  switch (jobStatusBucket(job)) {
    case 'processing': {
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
    case 'incomplete_upload':
      return {
        label: 'อัปโหลดไม่สมบูรณ์',
        variant: 'warning',
        icon: AlertTriangle,
        tileIcon: Upload,
        tileClass: 'border-warning-border bg-warning text-warning-foreground',
        rowClass: 'bg-warning/60 hover:bg-warning',
      };
    case 'failed':
      return {
        label: 'วิเคราะห์ไม่สำเร็จ',
        variant: 'destructive',
        icon: AlertCircle,
        tileIcon: modeIcon,
        tileClass: 'border-error-border bg-error-surface text-error-foreground',
        rowClass: 'bg-error-surface/60 hover:bg-error-surface',
        errorDetails: job.error_message,
      };
    case 'ready':
      return {
        label: 'พร้อมแก้',
        variant: 'secondary',
        icon: CheckCircle2,
        tileIcon: modeIcon,
        tileClass: job.mode === 'review'
          ? 'border-border bg-secondary text-secondary-foreground'
          : 'border-brand-200 bg-brand-50 text-brand-700',
        rowClass: 'hover:bg-accent/60',
      };
    case 'pending':
      return {
        label: 'รอวิเคราะห์',
        variant: 'warning',
        icon: Clock,
        tileIcon: modeIcon,
        tileClass: 'border-warning-border bg-warning text-warning-foreground',
        rowClass: 'hover:bg-accent/60',
      };
  }
}

function emptyFilterCopy(
  searchTerm: string,
  showMineOnly: boolean,
  modeFilter: ModeFilter,
  statusFilter: StatusFilter,
): { title: string; description: string; actionLabel: string } {
  if (searchTerm) {
    const hasExtraFilters = showMineOnly || modeFilter !== 'all' || statusFilter !== 'all';
    return {
      title: 'ไม่พบงานที่ตรงกับการค้นหา',
      description: 'ลองใช้ชื่ออื่นหรือค้นหาด้วยชื่อไฟล์ต้นฉบับ',
      actionLabel: hasExtraFilters ? 'ล้างตัวกรองและคำค้นหา' : 'ล้างการค้นหา',
    };
  }
  if (showMineOnly && modeFilter === 'all' && statusFilter === 'all') {
    return {
      title: 'คุณยังไม่มีงานของตัวเอง',
      description: 'เลือก "ทุกคน" เพื่อดูงานของผู้เขียนคนอื่น',
      actionLabel: 'แสดงทั้งหมด',
    };
  }
  if (statusFilter !== 'all' && modeFilter === 'all') {
    return {
      title: 'ไม่มีงานในสถานะนี้',
      description: showMineOnly ? 'เลือก "ทุกคน" หรือสลับตัวกรองสถานะเพื่อดูรายการงานอื่น' : 'สลับตัวกรองสถานะเพื่อดูรายการงานอื่น',
      actionLabel: 'แสดงทั้งหมด',
    };
  }
  if (modeFilter !== 'all' && statusFilter === 'all') {
    return {
      title: 'ไม่มีงานในโหมดนี้',
      description: showMineOnly ? 'เลือก "ทุกคน" หรือสลับตัวกรองโหมดเพื่อดูรายการงานอื่น' : 'สลับตัวกรองโหมดเพื่อดูรายการงานอื่น',
      actionLabel: 'แสดงทั้งหมด',
    };
  }
  return {
    title: 'ไม่มีงานที่ตรงกับตัวกรอง',
    description: 'ลองเปลี่ยนตัวกรองโหมดหรือสถานะเพื่อดูรายการงานอื่น',
    actionLabel: 'แสดงทั้งหมด',
  };
}

function ModeTag({ mode, className }: { mode: JobMode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground', className)}>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${mode === 'generate' ? 'bg-brand-500/80' : 'bg-muted-foreground/50'}`}
      />
      {MODE_LABEL[mode]}
    </span>
  );
}

function SortableColumnButton({
  label,
  field,
  activeField,
  direction,
  align = 'left',
  disabled = false,
  onSort,
}: {
  label: string;
  field: SortField;
  activeField: SortField;
  direction: SortDirection;
  align?: 'left' | 'right';
  disabled?: boolean;
  onSort: (field: SortField) => void;
}) {
  const isActive = activeField === field;
  const Icon = isActive ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSort(field)}
      className={cn(
        'group/sort inline-flex min-h-6 items-center gap-1 rounded-sm py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none pointer-coarse:min-h-11',
        !disabled && 'hover:text-foreground',
        align === 'right' && 'ml-auto flex-row-reverse',
        isActive ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span>{label}</span>
      <Icon
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-70 group-focus-visible/sort:opacity-70',
        )}
      />
    </button>
  );
}

function JobStatusBadge({ status, name }: { status: JobVisualState; name: string }) {
  const StatusIcon = status.icon;
  const badge = (
    <Badge variant={status.variant} className="h-auto min-h-5 max-w-full whitespace-normal text-left tabular-nums">
      <StatusIcon className={status.spinning ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />
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
  return updated ? `อัปเดตล่าสุด ${updated}` : '';
}

function deleteConfirmationCopy(job: StoredJob): string {
  const name = jobName(job);
  if (job.is_upload) {
    return `ลบ “${name}”${describeUpload(job) && ` ${describeUpload(job)}`} ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
  }
  if (job.mode === 'review') {
    return `ลบ “${name}” และบทบรรยายที่บันทึกไว้ออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
  }
  return `ลบ “${name}” และวิดีโอต้นทางออกจากเซิร์ฟเวอร์ การลบนี้ย้อนกลับไม่ได้`;
}

/**
 * `showOwners` is the Author's All-Jobs Access: their list mixes Authors, so it names each Job Owner and can narrow
 * to the Jobs whose owner email is `ownEmail`.
 */
export function JobList({ onOpen, onNew, showOwners, ownEmail }: {
  onOpen: (jobId: string) => void;
  onNew: () => void;
  showOwners: boolean;
  ownEmail?: string;
}) {
  const [jobs, setJobs] = useState<StoredJob[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredJob | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [initialFilters] = useState(() => readFiltersFromSearch(window.location.search, showOwners));
  const [query, setQuery] = useState(initialFilters.query);
  const [ownerScope, setOwnerScope] = useState<OwnerScope>(initialFilters.ownerScope);
  const [modeFilter, setModeFilter] = useState<ModeFilter>(initialFilters.modeFilter);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialFilters.statusFilter);
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const searchInput = useRef<HTMLInputElement>(null);
  const emptyNewJobButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const activeRequest = useRef<{ controller: AbortController; announce: boolean } | null>(null);
  const ownerScopeTouched = useRef(false);
  const prevShowOwners = useRef(showOwners);
  const isFirstSync = useRef(true);

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

  const isMine = useCallback(
    (job: StoredJob) =>
      typeof job.is_owner === 'boolean'
        ? job.is_owner
        : (!job.is_upload && Boolean(ownEmail) && job.owner_email === ownEmail),
    [ownEmail],
  );
  const mineCount = useMemo(() => (jobs ?? []).filter(isMine).length, [jobs, isMine]);
  // Only an Author with All-Jobs Access sees other Authors' Jobs, so only they can narrow to their own.
  const showMineOnly = showOwners && ownerScope === 'mine';
  const scopedJobs = useMemo(() => (jobs ?? []).filter((job) => !showMineOnly || isMine(job)), [jobs, showMineOnly, isMine]);
  // Every row is the Author's own while narrowed, so the owner column would repeat one email.
  const showOwnerColumn = showOwners && !showMineOnly;
  useEffect(() => {
    // Preserve ?scope=mine while /api/me is still resolving showOwners from false to true.
    if (!prevShowOwners.current && showOwners && !ownerScopeTouched.current) {
      const restoredScope = readFiltersFromSearch(window.location.search, true).ownerScope;
      if (restoredScope !== ownerScope) {
        setOwnerScope(restoredScope);
        prevShowOwners.current = showOwners;
        return;
      }
    }
    prevShowOwners.current = showOwners;
    if (isFirstSync.current) {
      isFirstSync.current = false;
      return;
    }
    syncFiltersToUrl({ query, ownerScope, modeFilter, statusFilter }, showOwners);
  }, [query, ownerScope, modeFilter, statusFilter, showOwners]);

  const { generateCount, reviewCount } = useMemo(() => {
    let generate = 0;
    let review = 0;
    for (const job of scopedJobs) {
      if (job.is_upload) continue;
      if (job.mode === 'generate') generate++;
      else if (job.mode === 'review') review++;
    }
    return { generateCount: generate, reviewCount: review };
  }, [scopedJobs]);

  const modeScopedJobs = useMemo(
    () => scopedJobs.filter((job) => modeFilter === 'all' || (!job.is_upload && job.mode === modeFilter)),
    [scopedJobs, modeFilter],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<JobStatusBucket, number> = {
      ready: 0,
      processing: 0,
      failed: 0,
      incomplete_upload: 0,
      pending: 0,
    };
    for (const job of modeScopedJobs) {
      counts[jobStatusBucket(job)]++;
    }
    return counts;
  }, [modeScopedJobs]);

  const searchTerm = query.trim().toLocaleLowerCase('th-TH');
  const isFiltered = Boolean(searchTerm) || modeFilter !== 'all' || statusFilter !== 'all' || showMineOnly;
  const resetFilters = () => {
    ownerScopeTouched.current = true;
    setQuery('');
    setOwnerScope('all');
    setModeFilter('all');
    setStatusFilter('all');
    setPage(1);
    searchInput.current?.focus();
  };

  const matchingJobs = useMemo(() => {
    const filtered = modeScopedJobs.filter((job) => {
      if (statusFilter !== 'all' && jobStatusBucket(job) !== statusFilter) return false;
      if (!searchTerm) return true;
      return [jobName(job), job.file_name, showOwners ? job.owner_email ?? '' : '']
        .some((value) => value.toLocaleLowerCase('th-TH').includes(searchTerm));
    });
    return filtered.sort((a, b) => {
      let delta = 0;
      if (sortField === 'name') {
        delta = jobName(a).localeCompare(jobName(b), 'th-TH', { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'duration') {
        const aVal = !a.is_upload && typeof a.duration_ms === 'number' ? a.duration_ms : -1;
        const bVal = !b.is_upload && typeof b.duration_ms === 'number' ? b.duration_ms : -1;
        delta = aVal - bVal;
      } else if (sortField === 'spots') {
        const aVal = typeof a.spot_count === 'number' ? a.spot_count : -1;
        const bVal = typeof b.spot_count === 'number' ? b.spot_count : -1;
        delta = aVal - bVal;
      } else {
        const aTime = Date.parse(a.updated_at);
        const bTime = Date.parse(b.updated_at);
        delta = (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
      }
      return sortDirection === 'asc' ? delta : -delta;
    });
  }, [modeScopedJobs, statusFilter, searchTerm, sortField, sortDirection, showOwners]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(DEFAULT_SORT_DIRECTION[field]);
    }
    setPage(1);
  };

  const ariaSortFor = (field: SortField): 'ascending' | 'descending' | 'none' =>
    sortField === field ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';

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
            {jobs === null && !fetchError ? (
              <Skeleton aria-hidden="true" className="h-5 w-16 border border-border/60 bg-secondary" />
            ) : jobs && jobs.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {jobs.length} รายการ
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">จัดการงานบทบรรยายภาพทั้งหมด หรือสร้างงานใหม่</p>
        </div>
        {jobs?.length !== 0 && (
          <div className="flex items-center gap-2">
            <SimpleTooltip label="รีเฟรชรายการงาน">
              <Button
                variant="outline"
                size="icon-lg"
                onClick={() => void loadJobs(true)}
                disabled={loading}
                focusableWhenDisabled
                aria-label="รีเฟรชรายการงาน"
                className="aria-disabled:cursor-wait aria-disabled:opacity-60"
              >
                <RefreshCw className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />
              </Button>
            </SimpleTooltip>
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
      ) : (jobs || !fetchError) && (
        <div className="@container overflow-hidden rounded-xl border bg-card">
          {jobs === null ? (
            <div aria-hidden="true" className="flex flex-col gap-3 border-b bg-card px-4 py-3 @min-[42rem]:flex-row @min-[42rem]:flex-wrap @min-[42rem]:items-center @min-[42rem]:justify-between @min-[42rem]:px-5">
              <Skeleton className="h-9 w-full @min-[42rem]:w-80" />
              <div className="flex flex-wrap items-center gap-2">
                {showOwners && <Skeleton className="h-9 w-40" />}
                <Skeleton className="h-9 w-38" />
                <Skeleton className="h-9 w-40" />
              </div>
            </div>
          ) : Boolean(jobs.length) && (
            <div className="flex flex-col gap-3 border-b bg-card px-4 py-3 @min-[42rem]:flex-row @min-[42rem]:flex-wrap @min-[42rem]:items-center @min-[42rem]:justify-between @min-[42rem]:px-5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <InputGroup className="w-full bg-background @min-[42rem]:w-80">
                  <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                  <InputGroupInput
                    ref={searchInput}
                    type="search"
                    aria-label={showOwners ? 'ค้นหาชื่องาน ชื่อไฟล์ หรืออีเมลเจ้าของ' : 'ค้นหาชื่องานหรือชื่อไฟล์'}
                    placeholder={showOwners ? 'ค้นหาชื่องาน ชื่อไฟล์ หรืออีเมลเจ้าของ' : 'ค้นหาชื่องานหรือชื่อไฟล์'}
                    className="[&::-webkit-search-cancel-button]:hidden"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                  />
                  {query && (
                    <InputGroupClearButton
                      label="ล้างคำค้นหา"
                      onClear={() => {
                        setQuery('');
                        setPage(1);
                        searchInput.current?.focus();
                      }}
                    />
                  )}
                </InputGroup>
                <p role="status" className={isFiltered ? 'text-xs text-muted-foreground tabular-nums' : 'sr-only'}>
                  {isFiltered ? `พบ ${matchingJobs.length} รายการ` : ''}
                </p>
                {isFiltered && (
                  <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
                    <X data-icon="inline-start" aria-hidden="true" />
                    ล้างตัวกรอง
                  </Button>
                )}
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-2">
              {showOwners && (
                <>
                  <ToggleGroup
                    appearance="segmented"
                    aria-label="กรองตามเจ้าของ"
                    value={[ownerScope]}
                    onValueChange={(next) => {
                      const chosen = next[0] as OwnerScope | undefined;
                      if (!chosen) return;
                      ownerScopeTouched.current = true;
                      setOwnerScope(chosen);
                      setPage(1);
                    }}
                    className="min-h-9 max-w-full flex-nowrap items-center p-0.5"
                  >
                    {([
                      ['all', 'ทุกคน', jobs.length],
                      ['mine', 'งานของฉัน', mineCount],
                    ] as const).map(([value, label, count]) => (
                      <ToggleGroupItem
                        key={value}
                        value={value}
                        variant="segmented"
                        size="sm"
                        className="h-7 gap-1.5 text-xs pointer-coarse:min-h-10"
                      >
                        <span>{label}</span>
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            ownerScope === value ? 'text-muted-foreground' : 'text-muted-foreground/85',
                          )}
                        >
                          {count}
                        </span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <Separator orientation="vertical" className="hidden h-5 self-center @min-[42rem]:block" />
                </>
              )}
              <Select
                value={modeFilter}
                onValueChange={(value) => {
                  if (!value) return;
                  setModeFilter(value as ModeFilter);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="กรองตามโหมด"
                  className={cn(
                    'w-auto min-w-[9.5rem] text-xs font-medium',
                    modeFilter !== 'all' && 'border-brand-300 bg-brand-50/60 text-brand-900 [&_svg]:text-brand-700',
                  )}
                >
                  <SelectValue>
                    {(value: ModeFilter | null) => {
                      const active = value ?? 'all';
                      return (
                        <>
                          <span className={cn('font-normal', active !== 'all' ? 'text-brand-700/80' : 'text-muted-foreground')}>โหมด:</span>
                          <span>{MODE_FILTER_LABEL[active]}</span>
                        </>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false} className="w-auto min-w-44">
                  <SelectGroup>
                    {([
                      ['all', MODE_FILTER_LABEL.all, scopedJobs.length],
                      ['generate', MODE_FILTER_LABEL.generate, generateCount],
                      ['review', MODE_FILTER_LABEL.review, reviewCount],
                    ] as const).map(([value, label, count]) => (
                      <SelectItem key={value} value={value} className="text-xs">
                        <span className="flex-1">{label}</span>
                        <span className="text-muted-foreground tabular-nums">{count}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  if (!value) return;
                  setStatusFilter(value as StatusFilter);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="กรองตามสถานะ"
                  className={cn(
                    'w-auto min-w-[9.5rem] text-xs font-medium',
                    statusFilter !== 'all' && 'border-brand-300 bg-brand-50/60 text-brand-900 [&_svg]:text-brand-700',
                  )}
                >
                  <SelectValue>
                    {(value: StatusFilter | null) => {
                      const active = value ?? 'all';
                      return (
                        <>
                          <span className={cn('font-normal', active !== 'all' ? 'text-brand-700/80' : 'text-muted-foreground')}>สถานะ:</span>
                          <span>{STATUS_FILTER_LABEL[active]}</span>
                        </>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false} className="w-auto min-w-48">
                  <SelectGroup>
                    {STATUS_FILTER_OPTIONS.map(([value, label]) => {
                      const count = value === 'all' ? modeScopedJobs.length : statusCounts[value];
                      return (
                        <SelectItem key={value} value={value} className="text-xs">
                          <span className="flex-1">{label}</span>
                          <span className="text-muted-foreground tabular-nums">{count}</span>
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
              </div>
            </div>
          )}

          {jobs && matchingJobs.length === 0 ? (() => {
            const emptyCopy = emptyFilterCopy(searchTerm, showMineOnly, modeFilter, statusFilter);
            return (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Search aria-hidden="true" /></EmptyMedia>
                  <EmptyTitle>{emptyCopy.title}</EmptyTitle>
                  <EmptyDescription>{emptyCopy.description}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={resetFilters}>
                    {emptyCopy.actionLabel}
                  </Button>
                </EmptyContent>
              </Empty>
            );
          })() : (
            <>
              <Table aria-label="งานที่บันทึกไว้" aria-busy={loading} className="table-fixed">
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col" aria-sort={ariaSortFor('name')} className="px-4 py-2.5 text-xs font-semibold text-muted-foreground @min-[42rem]:pl-5">
                      <SortableColumnButton label="ชื่องาน" field="name" activeField={sortField} direction={sortDirection} disabled={jobs === null} onSort={handleSort} />
                    </TableHead>
                    {showOwnerColumn && <TableHead scope="col" className="hidden w-48 px-3 text-xs font-semibold text-muted-foreground @min-[75rem]:table-cell">เจ้าของ</TableHead>}
                    <TableHead scope="col" className="hidden w-32 px-3 text-xs font-semibold text-muted-foreground @min-[54rem]:table-cell">โหมด</TableHead>
                    <TableHead scope="col" className="hidden w-40 px-3 text-xs font-semibold text-muted-foreground @min-[54rem]:table-cell">สถานะ</TableHead>
                    <TableHead scope="col" aria-sort={ariaSortFor('duration')} className="hidden w-24 px-3 text-right text-xs font-semibold text-muted-foreground @min-[66rem]:table-cell">
                      <SortableColumnButton label="ความยาว" field="duration" activeField={sortField} direction={sortDirection} align="right" disabled={jobs === null} onSort={handleSort} />
                    </TableHead>
                    <TableHead scope="col" aria-sort={ariaSortFor('spots')} className="hidden w-24 px-3 text-right text-xs font-semibold text-muted-foreground @min-[66rem]:table-cell">
                      <SortableColumnButton label="บทบรรยาย" field="spots" activeField={sortField} direction={sortDirection} align="right" disabled={jobs === null} onSort={handleSort} />
                    </TableHead>
                    <TableHead scope="col" aria-sort={ariaSortFor('updated_at')} className="hidden w-40 px-3 text-xs font-semibold text-muted-foreground @min-[54rem]:table-cell">
                      <SortableColumnButton label="แก้ล่าสุด" field="updated_at" activeField={sortField} direction={sortDirection} disabled={jobs === null} onSort={handleSort} />
                    </TableHead>
                    <TableHead scope="col" className="hidden w-28 px-4 text-right text-xs font-semibold text-muted-foreground @min-[42rem]:table-cell @min-[42rem]:pr-5">การทำงาน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs === null
                    ? SKELETON_ROWS.map((row, index) => (
                      <TableRow key={index} aria-hidden="true" className="hover:bg-transparent">
                        <TableCell className="px-4 py-3.5 whitespace-normal @min-[42rem]:pl-5">
                          <div className="flex min-h-10 items-start gap-3 @min-[54rem]:items-center">
                            <Skeleton className="hidden size-9 shrink-0 rounded-md @min-[42rem]:block" />
                            <div className="min-w-0 flex-1">
                              <Skeleton className={cn('h-4 max-w-full', row.title)} />
                              {row.subtitle && <Skeleton className={cn('mt-1.5 h-3 max-w-full', row.subtitle)} />}
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 @min-[54rem]:hidden">
                                <Skeleton className="h-5 w-20" />
                                <Skeleton className="h-3.5 w-20" />
                              </div>
                              {showOwnerColumn && (
                                <Skeleton className="mt-1.5 hidden h-3.5 w-32 @min-[54rem]:block @min-[75rem]:hidden" />
                              )}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-1 @min-[42rem]:hidden">
                            <Skeleton className="size-9 rounded-md" />
                            <Skeleton className="size-9 rounded-md" />
                          </div>
                        </TableCell>
                        {showOwnerColumn && (
                          <TableCell className="hidden px-3 @min-[75rem]:table-cell">
                            <Skeleton className="h-3.5 w-32" />
                          </TableCell>
                        )}
                        <TableCell className="hidden px-3 @min-[54rem]:table-cell">
                          <Skeleton className="h-3.5 w-20" />
                        </TableCell>
                        <TableCell className="hidden px-3 @min-[54rem]:table-cell">
                          <Skeleton className="h-5 w-20" />
                        </TableCell>
                        <TableCell className="hidden px-3 text-right @min-[66rem]:table-cell">
                          <Skeleton className="ml-auto h-3.5 w-11" />
                        </TableCell>
                        <TableCell className="hidden px-3 text-right @min-[66rem]:table-cell">
                          <Skeleton className="ml-auto h-3.5 w-10" />
                        </TableCell>
                        <TableCell className="hidden px-3 @min-[54rem]:table-cell">
                          <Skeleton className="h-3.5 w-28" />
                        </TableCell>
                        <TableCell className="hidden px-4 py-3.5 @min-[42rem]:table-cell @min-[42rem]:pr-5">
                          <div className="flex items-center justify-end gap-1">
                            <Skeleton className="size-9 rounded-md" />
                            <Skeleton className="size-9 rounded-md" />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                    : pageJobs.map((job) => {
                      const name = jobName(job);
                      const status = jobVisualState(job);
                      const TileIcon = status.tileIcon;
                      const updated = formatUpdatedAt(job.updated_at);
                      const href = jobPath(job.job_id);
                      const statusNode = <JobStatusBadge status={status} name={name} />;
                      const ownerNode = job.is_upload
                        ? <span className="text-muted-foreground">—</span>
                        : job.owner_email
                          ? <span className="[overflow-wrap:anywhere]">{job.owner_email}</span>
                          : <span className="text-muted-foreground">ไม่มีเจ้าของ</span>;
                      const deleteButton = (
                        <Button
                          variant="ghost-destructive"
                          size="icon"
                          disabled={job.is_processing}
                          onClick={() => {
                            setDeleteMessage('');
                            setPendingDelete(job);
                          }}
                          aria-label={job.is_upload ? `ลบ${name}${describeUpload(job) && ` ${describeUpload(job)}`}` : `ลบงาน ${name}`}
                          className="text-muted-foreground/70 pointer-coarse:size-11"
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      );
                      const actions = (
                        <div className="flex items-center gap-1 @min-[42rem]:justify-end">
                          {!job.is_upload && (
                            <SimpleTooltip label="เปิดงาน">
                              <a
                                href={href}
                                onClick={(event) => openJobLink(event, job.job_id)}
                                aria-label={`เปิดงาน ${name}`}
                                className={cn(
                                  buttonVariants({ variant: 'ghost', size: 'icon' }),
                                  'text-primary not-disabled:hover:bg-brand-200/75 not-disabled:hover:text-brand-800 pointer-coarse:size-11',
                                )}
                              >
                                <ArrowRight strokeWidth={2.5} aria-hidden="true" />
                              </a>
                            </SimpleTooltip>
                          )}
                          <SimpleTooltip label={job.is_processing ? 'กำลังประมวลผลอยู่ จึงยังลบไม่ได้' : 'ลบ'}>
                            {job.is_processing ? <span className="inline-flex">{deleteButton}</span> : deleteButton}
                          </SimpleTooltip>
                        </div>
                      );
                      return (
                        <TableRow key={job.job_id} className={status.rowClass}>
                          <TableCell className="px-4 py-3.5 whitespace-normal @min-[42rem]:pl-5">
                            <div className="flex min-h-10 items-start gap-3 @min-[54rem]:items-center">
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
                                  updated && <p className="text-xs text-muted-foreground tabular-nums @min-[54rem]:hidden">
                                    <time dateTime={job.updated_at}>{updated}</time>
                                  </p>
                                ) : job.title && job.title !== defaultJobTitle(job.file_name) && (
                                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{job.file_name}</p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 @min-[54rem]:hidden">
                                  {statusNode}
                                  {!job.is_upload && job.mode && <ModeTag mode={job.mode} />}
                                  {showOwnerColumn && !job.is_upload && <span className="text-xs text-muted-foreground">{ownerNode}</span>}
                                </div>
                                {showOwnerColumn && !job.is_upload && (
                                  <p className="mt-1 hidden text-xs text-muted-foreground @min-[54rem]:block @min-[75rem]:hidden">{ownerNode}</p>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 border-t border-border/60 pt-1 @min-[42rem]:hidden">{actions}</div>
                          </TableCell>
                          {showOwnerColumn && (
                            <TableCell className="hidden px-3 text-xs whitespace-normal text-foreground @min-[75rem]:table-cell">{ownerNode}</TableCell>
                          )}
                          <TableCell className="hidden px-3 text-xs whitespace-normal @min-[54rem]:table-cell">
                            {!job.is_upload && job.mode ? <ModeTag mode={job.mode} /> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="hidden px-3 whitespace-normal @min-[54rem]:table-cell">
                            {statusNode}
                          </TableCell>
                          <TableCell className="hidden px-3 text-right font-mono text-xs text-muted-foreground tabular-nums @min-[66rem]:table-cell">
                            {formatDuration(job)}
                          </TableCell>
                          <TableCell className="hidden px-3 text-right text-xs text-muted-foreground tabular-nums @min-[66rem]:table-cell">
                            {typeof job.spot_count === 'number' && job.spot_count > 0
                              ? <span>{job.spot_count} จุด</span>
                              : <span>—</span>}
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
                    <Button variant="outline" size="icon-sm" aria-label="หน้าก่อนหน้า" disabled={currentPage === 1} focusableWhenDisabled className="aria-disabled:opacity-50 pointer-coarse:size-11" onClick={() => setPage(currentPage - 1)}>
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <span className="px-2 text-xs text-muted-foreground tabular-nums">หน้า {currentPage} / {pageCount}</span>
                    <Button variant="outline" size="icon-sm" aria-label="หน้าถัดไป" disabled={currentPage === pageCount} focusableWhenDisabled className="aria-disabled:opacity-50 pointer-coarse:size-11" onClick={() => setPage(currentPage + 1)}>
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                </nav>
              )}
            </>
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
