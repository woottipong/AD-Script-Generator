import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Maximize2,
  Minus,
  MinusCircle,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { ADSpot, AnalysisBatch, JobMode, SpeechSegment } from '../types/ad';
import {
  enableSpotNarration,
  formatTimestampDisplay,
  parseTimestampInput,
} from '../utils/formatters';
import { computeClampedSpotDrag, findSpotIssues, spotTimingKey, validateSpotTimestampEdit, type SpotIssue, type SpotTimingContext } from '../utils/spotTiming';
import { estimateThaiSpeechDurationMs } from '../utils/narrationBudget';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupClearButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface AdScriptEditorProps {
  spots: ADSpot[];
  batches: AnalysisBatch[];
  isAnalyzing: boolean;
  emptyState: 'preparing' | 'no-gaps' | 'failed';
  errorMessage: string | null;
  onRetryVad: () => void;
  onRetryJobSave?: () => void;
  mode: JobMode;
  speechSegments: SpeechSegment[];
  videoDurationMs: number;
  selectedSpotId: string | null;
  currentTimeMs: number;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  onUpdateSpot: (updatedSpot: ADSpot) => void;
  saveStatus: 'local' | 'saving' | 'saved' | 'error';
  onRetrySave: () => void;
}

type FilterMode = 'all' | 'generate' | 'pending' | 'skip' | 'edited' | 'needs_check';

/** Timing problems to fix, plus narration longer than its gap, which is fine for Extended AD that pauses the picture. */
type SpotCheck = SpotIssue | 'over_duration';

const isOverDuration = (spot: ADSpot) =>
  spot.decision === 'generate' && spot.text.trim().length > 0 && estimateThaiSpeechDurationMs(spot.text) > spot.duration_ms;

const SPOT_ISSUE_LABELS: Record<SpotIssue, string> = {
  overlaps_speech: 'ทับเสียงพูด',
  overlaps_spot: 'ทับบรรทัดอื่น',
  too_short: 'สั้นกว่า 0.5 วินาที',
  past_video_end: 'เลยท้ายวิดีโอ',
};

const SPOT_CHECK_LABELS: Record<SpotCheck, string> = { ...SPOT_ISSUE_LABELS, over_duration: 'ยาวกว่าช่องว่าง' };

interface SpotBlockItemProps {
  spot: ADSpot;
  spotOrder: number;
  batchInfo?: AnalysisBatch;
  isAnalyzing: boolean;
  isSelected: boolean;
  isPlayingNow: boolean;
  timingContext: SpotTimingContext;
  checks?: SpotCheck[];
  onSelect: (spotId: string, seekToStart?: boolean) => void;
  onUpdate: (updatedSpot: ADSpot) => void;
  registerItemRef: (spotId: string, el: HTMLDivElement | null) => void;
}

const checksEqual = (a?: SpotCheck[], b?: SpotCheck[]) =>
  a === b || (Boolean(a && b) && a!.length === b!.length && a!.every((v, i) => v === b![i]));

const areSpotBlockPropsEqual = (prev: SpotBlockItemProps, next: SpotBlockItemProps) =>
  prev.spot === next.spot &&
  prev.spotOrder === next.spotOrder &&
  prev.batchInfo === next.batchInfo &&
  prev.isAnalyzing === next.isAnalyzing &&
  prev.isSelected === next.isSelected &&
  prev.isPlayingNow === next.isPlayingNow &&
  prev.timingContext === next.timingContext &&
  prev.onSelect === next.onSelect &&
  prev.onUpdate === next.onUpdate &&
  prev.registerItemRef === next.registerItemRef &&
  checksEqual(prev.checks, next.checks);

const SpotBlockItem = React.memo<SpotBlockItemProps>(({
  spot,
  spotOrder,
  batchInfo,
  isAnalyzing,
  isSelected,
  isPlayingNow,
  timingContext,
  checks,
  onSelect,
  onUpdate,
  registerItemRef,
}) => {
  const [startInput, setStartInput] = useState(formatTimestampDisplay(spot.start_ms));
  const [endInput, setEndInput] = useState(formatTimestampDisplay(spot.end_ms));
  const [timestampError, setTimestampError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const itemRef = useCallback(
    (el: HTMLDivElement | null) => registerItemRef(spot.spot_id, el),
    [registerItemRef, spot.spot_id]
  );

  React.useEffect(() => {
    setStartInput(formatTimestampDisplay(spot.start_ms));
    setEndInput(formatTimestampDisplay(spot.end_ms));
    setTimestampError(null);
  }, [spot.start_ms, spot.end_ms]);

  const isExpanded = isSelected || timestampError !== null;
  const isSkipped = spot.decision === 'skip';
  const hasSavedText = spot.text.trim().length > 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || !isExpanded || (spot.decision !== 'generate' && !hasSavedText)) return;
    el.style.height = 'auto';
    // scrollHeight excludes the border, so add it back or a phantom scrollbar appears
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 240)}px`;
  }, [spot.text, isExpanded, spot.decision, hasSavedText]);

  const applyTimestampChange = (newStartMs: number, newEndMs: number) => {
    const check = validateSpotTimestampEdit(
      spot,
      newStartMs,
      newEndMs,
      timingContext
    );

    if (!check.valid) {
      setTimestampError(check.error || 'ไม่สามารถแก้ไขเวลาได้');
      return false;
    }

    setTimestampError(null);
    onUpdate({
      ...spot,
      start_ms: newStartMs,
      end_ms: newEndMs,
      duration_ms: newEndMs - newStartMs,
      is_edited: true,
    });
    return true;
  };

  const nudgeTargets = React.useMemo(() => {
    if (!isExpanded) return null;
    const target = (mode: 'trim-start' | 'trim-end', deltaMs: number) =>
      computeClampedSpotDrag(spot, mode, deltaMs, timingContext, 1);
    return {
      startEarlier: target('trim-start', -200),
      startLater: target('trim-start', 200),
      endEarlier: target('trim-end', -200),
      endLater: target('trim-end', 200),
    };
  }, [isExpanded, spot, timingContext]);

  const isUnchanged = (next: { start_ms: number; end_ms: number }) =>
    next.start_ms === spot.start_ms && next.end_ms === spot.end_ms;

  const applyNudge = (next: { start_ms: number; end_ms: number }) => {
    if (!isUnchanged(next)) applyTimestampChange(next.start_ms, next.end_ms);
  };

  const handleStartBlur = () => {
    const parsed = parseTimestampInput(startInput);
    if (parsed === null) {
      setTimestampError('รูปแบบเวลาเริ่มต้นไม่ถูกต้อง (ใช้ HH:MM:SS.mmm)');
      setStartInput(formatTimestampDisplay(spot.start_ms));
      return;
    }
    if (parsed !== spot.start_ms) {
      const ok = applyTimestampChange(parsed, spot.end_ms);
      if (!ok) {
        setStartInput(formatTimestampDisplay(spot.start_ms));
      }
    }
  };

  const handleEndBlur = () => {
    const parsed = parseTimestampInput(endInput);
    if (parsed === null) {
      setTimestampError('รูปแบบเวลาสิ้นสุดไม่ถูกต้อง (ใช้ HH:MM:SS.mmm)');
      setEndInput(formatTimestampDisplay(spot.end_ms));
      return;
    }
    if (parsed !== spot.end_ms) {
      const ok = applyTimestampChange(spot.start_ms, parsed);
      if (!ok) {
        setEndInput(formatTimestampDisplay(spot.end_ms));
      }
    }
  };

  const handleResetTimestamps = () => {
    applyTimestampChange(spot.original_start_ms, spot.original_end_ms);
  };

  const estimatedSpeechMs =
    spot.decision === 'generate' ? estimateThaiSpeechDurationMs(spot.text) : 0;
  const speechRatio =
    spot.duration_ms > 0 ? estimatedSpeechMs / spot.duration_ms : 0;
  const isOverDurationWarning = isOverDuration(spot);
  const issues = checks?.filter((check): check is SpotIssue => check !== 'over_duration');

  const isTimestampsModified =
    spot.start_ms !== spot.original_start_ms || spot.end_ms !== spot.original_end_ms;

  const isBatchProcessing = isAnalyzing && batchInfo?.status === 'processing';
  const isBatchPending = isAnalyzing && batchInfo?.status === 'pending';
  const statusLabel = spot.decision === 'pending'
    ? isBatchProcessing ? `กำลังวิเคราะห์ · ชุด ${batchInfo.batch_index}`
      : isBatchPending ? `รอวิเคราะห์ · ชุด ${batchInfo.batch_index}`
      : isAnalyzing ? 'เตรียมวิเคราะห์' : 'รอสร้าง'
    : spot.decision === 'generate' ? 'บรรยาย' : 'ข้าม';

  return (
    <div
      ref={itemRef}
      role="listitem"
      aria-label={`ช่วงบรรยายที่ ${spotOrder}`}
      onClick={() => onSelect(spot.spot_id, true)}
      className={`px-4 py-3.5 transition-colors ${isSelected ? 'cursor-default' : 'cursor-pointer'} ${
        isSkipped
          ? isSelected
            ? 'relative z-10 bg-muted ring-1 ring-inset ring-input'
            : 'bg-muted/60 hover:bg-muted'
          : isSelected
          ? 'relative z-10 bg-brand-50/90 ring-1 ring-inset ring-brand-200'
          : isPlayingNow
          ? 'bg-brand-50/35 hover:bg-brand-50/60'
          : 'bg-card hover:bg-muted/50'
      }`}
    >
      <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-x-2.5 gap-y-2">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            type="button"
            aria-pressed={isSelected}
            aria-label={`เลือกช่วงที่ ${spotOrder} เวลา ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)}`}
            onClick={(event) => { event.stopPropagation(); onSelect(spot.spot_id, true); }}
            className="min-w-0 inline-flex items-center gap-2 rounded text-left text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <span className={`text-sm font-semibold leading-none whitespace-nowrap ${isSkipped ? 'text-muted-foreground' : isSelected ? 'text-brand-900' : 'text-foreground'}`} title={spot.spot_id}>ช่วง {spotOrder}</span>
            {!isExpanded && <span className="whitespace-nowrap font-mono leading-none tabular-nums text-muted-foreground">{formatTimestampDisplay(spot.start_ms).replace(/^00:/, '')} – {formatTimestampDisplay(spot.end_ms).replace(/^00:/, '')}</span>}
          </button>

          {isExpanded && nudgeTargets && (
            <fieldset
              disabled={isAnalyzing || isSkipped}
              aria-label={`ปรับเวลาบทบรรยายที่ ${spotOrder}`}
              onFocus={() => onSelect(spot.spot_id, false)}
              onClick={(e) => e.stopPropagation()}
              className={`flex flex-wrap items-center gap-1.5 text-xs transition-opacity ${isSkipped ? 'opacity-50' : ''}`}
            >
              <div className="inline-flex items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-brand-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => applyNudge(nudgeTargets.startEarlier)}
                  disabled={isUnchanged(nudgeTargets.startEarlier)}
                  title="ขยับเวลาเริ่มเร็วขึ้น 0.2 วินาที"
                  aria-label="ขยับเวลาเริ่มเร็วขึ้น 0.2 วินาที"
                  className="rounded-none first:rounded-l-lg last:rounded-r-lg"
                >
                  <Minus className="size-3" aria-hidden="true" />
                </Button>
                <Input
                  type="text"
                  aria-label={`เวลาเริ่มบทบรรยายที่ ${spotOrder}`}
                  value={startInput}
                  onChange={(e) => { setStartInput(e.target.value); setTimestampError(null); }}
                  onBlur={handleStartBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleStartBlur();
                  }}
                  className="h-8 w-[6.75rem] rounded-none border-0 bg-transparent px-1 text-center font-mono text-xs md:text-xs tabular-nums focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => applyNudge(nudgeTargets.startLater)}
                  disabled={isUnchanged(nudgeTargets.startLater)}
                  title="ขยับเวลาเริ่มช้าลง 0.2 วินาที"
                  aria-label="ขยับเวลาเริ่มช้าลง 0.2 วินาที"
                  className="rounded-none first:rounded-l-lg last:rounded-r-lg"
                >
                  <Plus className="size-3" aria-hidden="true" />
                </Button>
              </div>
              <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">–</span>
              <div className="inline-flex items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-brand-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => applyNudge(nudgeTargets.endEarlier)}
                  disabled={isUnchanged(nudgeTargets.endEarlier)}
                  title="ขยับเวลาจบเร็วขึ้น 0.2 วินาที"
                  aria-label="ขยับเวลาจบเร็วขึ้น 0.2 วินาที"
                  className="rounded-none first:rounded-l-lg last:rounded-r-lg"
                >
                  <Minus className="size-3" aria-hidden="true" />
                </Button>
                <Input
                  type="text"
                  aria-label={`เวลาจบบทบรรยายที่ ${spotOrder}`}
                  value={endInput}
                  onChange={(e) => { setEndInput(e.target.value); setTimestampError(null); }}
                  onBlur={handleEndBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEndBlur();
                  }}
                  className="h-8 w-[6.75rem] rounded-none border-0 bg-transparent px-1 text-center font-mono text-xs md:text-xs tabular-nums focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => applyNudge(nudgeTargets.endLater)}
                  disabled={isUnchanged(nudgeTargets.endLater)}
                  title="ขยายเวลาจบออกไป 0.2 วินาที"
                  aria-label="ขยายเวลาจบออกไป 0.2 วินาที"
                  className="rounded-none first:rounded-l-lg last:rounded-r-lg"
                >
                  <Plus className="size-3" aria-hidden="true" />
                </Button>
              </div>
            </fieldset>
          )}

          <span className="inline-flex items-center rounded border border-border bg-muted/80 px-1.5 py-1 font-mono text-xs leading-none tabular-nums text-muted-foreground" title="ความยาวช่วงว่าง">
            {(spot.duration_ms / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isExpanded && (
            <ToggleGroup
              appearance="segmented"
              disabled={isAnalyzing}
              aria-label={`เลือกการบรรยายจุดที่ ${spotOrder}`}
              value={spot.decision === 'generate' || spot.decision === 'skip' ? [spot.decision] : []}
              onValueChange={(next) => {
                const chosen = next[0];
                if (!chosen || chosen === spot.decision) return;
                if (chosen === 'generate') onUpdate(enableSpotNarration(spot));
                else if (chosen === 'skip') onUpdate({ ...spot, decision: 'skip', is_edited: true });
              }}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0"
            >
              <ToggleGroupItem
                value="generate"
                variant="solid-primary"
                className="gap-1.5 text-xs font-semibold [&_svg:not([class*='size-'])]:size-3.5"
              >
                <CheckCircle2 aria-hidden="true" />
                <span>บรรยาย</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="skip"
                variant="solid-muted"
                className="gap-1.5 text-xs font-semibold [&_svg:not([class*='size-'])]:size-3.5"
              >
                <MinusCircle aria-hidden="true" />
                <span>ข้าม</span>
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {(!isExpanded || spot.decision === 'pending') && (
            <Badge
              variant={
                isBatchProcessing
                  ? 'info-strong'
                  : spot.decision === 'pending'
                  ? 'warning'
                  : spot.decision === 'generate'
                  ? 'info'
                  : 'secondary'
              }
              className={spot.decision === 'skip' ? 'text-muted-foreground' : undefined}
            >
              {isBatchProcessing ? (
                <Spinner aria-hidden="true" />
              ) : spot.decision === 'pending' ? (
                <Clock aria-hidden="true" />
              ) : spot.decision === 'generate' ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <MinusCircle aria-hidden="true" />
              )}
              {statusLabel}
            </Badge>
          )}
          {issues?.map((issue) => (
            <Badge key={issue} variant="warning-strong">
              <AlertTriangle aria-hidden="true" />
              {SPOT_ISSUE_LABELS[issue]}
            </Badge>
          ))}
          {!isExpanded && isOverDurationWarning && (
            <Badge variant="secondary">
              <Clock aria-hidden="true" />
              {SPOT_CHECK_LABELS.over_duration}
            </Badge>
          )}
          {!isExpanded && spot.is_edited && <span className="text-muted-foreground">แก้ไขแล้ว</span>}
          {isPlayingNow && !isSelected && (
            <span className="inline-flex items-center gap-1.5 font-medium text-brand-700">
              <span className="size-1.5 rounded-full bg-brand-600" aria-hidden="true" />
              ตำแหน่งวิดีโอ
            </span>
          )}
        </div>
      </div>

      {isExpanded && <>
        {/* Timestamp Validation Error */}
        {timestampError && (
          <Alert variant="destructive" onClick={(e) => e.stopPropagation()} className="mb-2 items-center py-1.5 text-xs">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            <AlertDescription className="text-xs">{timestampError}</AlertDescription>
          </Alert>
        )}

        {/* Main Content Area: Pending Queue Status OR Script Textarea OR Skip Info */}
        {spot.decision !== 'pending' && <fieldset disabled={isAnalyzing} aria-label={`แก้ไขบทบรรยายที่ ${spotOrder}`} onFocus={() => onSelect(spot.spot_id, false)} onClick={(e) => e.stopPropagation()} className="min-w-0 w-full">
          {spot.decision === 'generate' ? (
            <div className="flex flex-col gap-2">
              <Textarea
                ref={textareaRef}
                variant="script"
                rows={2}
                aria-label={`บทบรรยายที่ ${spotOrder}`}
                value={spot.text}
                onChange={(e) =>
                  onUpdate({
                    ...spot,
                    text: e.target.value,
                    is_edited: true,
                  })
                }
                placeholder="เขียนบทบรรยายภาพ"
              />

              {/* Visual Thai Speech Duration Fit Bar & Compact Footer */}
              <div className="flex flex-col gap-1.5">
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      isOverDurationWarning
                        ? 'bg-warning-foreground'
                        : speechRatio > 0.85
                        ? 'bg-warning-strong-border'
                        : 'bg-brand-600'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, Math.round(speechRatio * 100)))}%`,
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={
                        isOverDurationWarning
                          ? 'text-warning-foreground font-medium'
                          : 'text-secondary-foreground font-medium'
                      }
                    >
                      พูด ~{(estimatedSpeechMs / 1000).toFixed(1)} / {(spot.duration_ms / 1000).toFixed(1)}s
                      {isOverDurationWarning && (
                        <span title="ถ้าเป็น Extended AD ที่หยุดภาพไว้ระหว่างบรรยาย ไม่ต้องแก้"> · เกิน +{(Math.ceil((estimatedSpeechMs - spot.duration_ms) / 100) / 10).toFixed(1)}s</span>
                      )}
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground/60">·</span>
                    <span>{spot.text.trim().length} อักษร</span>
                    {spot.is_edited && <>
                      <span aria-hidden="true" className="text-muted-foreground/60">·</span>
                      <span>แก้ไขแล้ว</span>
                    </>}
                  </div>

                  {isTimestampsModified && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleResetTimestamps}
                      title={`คืนค่าเวลาต้นทาง (${formatTimestampDisplay(spot.original_start_ms)} – ${formatTimestampDisplay(spot.original_end_ms)})`}
                      className="-mr-2"
                    >
                      <RotateCcw data-icon="inline-start" aria-hidden="true" />
                      <span>คืนเวลาเดิม</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : hasSavedText ? (
            <div className="flex flex-col gap-2">
              <Textarea
                ref={textareaRef}
                variant="script"
                rows={2}
                disabled
                aria-label={`บทบรรยายที่ ${spotOrder} (ข้ามช่วงนี้)`}
                value={spot.text}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>ข้ามช่วงนี้ · ไม่รวมในการส่งออก SRT (ข้อความเดิมยังถูกเก็บไว้)</span>
                {spot.is_edited && <span>แก้ไขแล้ว</span>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-muted-foreground">
              <span>
                {spot.reason || 'ไม่มีเหตุการณ์สำคัญทางภาพที่ต้องบรรยายในช่วงเวลานี้'}
              </span>
              {spot.is_edited && <span>แก้ไขแล้ว</span>}
            </div>
          )}
        </fieldset>}
      </>}
      {spot.decision === 'pending' && isBatchProcessing && (
        <div
          aria-hidden="true"
          className="mt-1.5 flex w-full flex-col gap-2"
        >
          <Skeleton variant="shimmer" delay={(spotOrder % 4) * 140} className="h-3.5 w-full rounded bg-brand-100/80" />
          <Skeleton
            variant="shimmer"
            delay={(spotOrder % 4) * 140}
            className="h-3.5 rounded bg-brand-100/60"
            style={{ width: `${[68, 54, 78, 60][spotOrder % 4]}%` }}
          />
        </div>
      )}
      {!isExpanded && spot.decision !== 'pending' && (
        <p
          className={`line-clamp-2 ${
            spot.decision === 'generate'
              ? 'max-w-[75ch] font-script text-script font-normal tracking-normal text-foreground'
              : hasSavedText
              ? 'max-w-[75ch] font-script text-script font-normal tracking-normal text-muted-foreground'
              : 'text-sm leading-relaxed text-muted-foreground'
          }`}
        >
          {spot.decision === 'generate'
            ? (spot.text || 'ยังไม่มีข้อความบรรยาย')
            : hasSavedText
            ? spot.text
            : (spot.reason || 'ไม่มีเหตุการณ์สำคัญทางภาพที่ต้องบรรยายในช่วงนี้')}
        </p>
      )}
    </div>
  );
}, areSpotBlockPropsEqual);

export const AdScriptEditor: React.FC<AdScriptEditorProps> = ({
  spots,
  batches,
  isAnalyzing,
  emptyState,
  errorMessage,
  onRetryVad,
  onRetryJobSave,
  mode,
  speechSegments,
  videoDurationMs,
  selectedSpotId,
  currentTimeMs,
  onSelectSpot,
  onUpdateSpot,
  saveStatus,
  onRetrySave,
}) => {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingClickAnchorRef = useRef<{ spotId: string; topBefore: number } | null>(null);
  const selectedSpotIdRef = useRef(selectedSpotId);
  selectedSpotIdRef.current = selectedSpotId;
  const onSelectSpotRef = useRef(onSelectSpot);
  onSelectSpotRef.current = onSelectSpot;
  const onUpdateSpotRef = useRef(onUpdateSpot);
  onUpdateSpotRef.current = onUpdateSpot;
  const filterModeRef = useRef(filterMode);
  filterModeRef.current = filterMode;

  const registerItemRef = useCallback((spotId: string, el: HTMLDivElement | null) => {
    itemRefs.current[spotId] = el;
  }, []);

  const handleListSelectSpot = useCallback((spotId: string, seekToStart = false) => {
    const el = itemRefs.current[spotId];
    if (el && spotId !== selectedSpotIdRef.current) {
      pendingClickAnchorRef.current = {
        spotId,
        topBefore: el.getBoundingClientRect().top,
      };
    }
    onSelectSpotRef.current(spotId, seekToStart);
  }, []);

  const handleSpotUpdate = useCallback((updatedSpot: ADSpot) => {
    if (filterModeRef.current === 'skip' && updatedSpot.decision === 'generate') {
      setFilterMode('all');
    }
    onUpdateSpotRef.current(updatedSpot);
  }, []);

  // Preserve visual position when clicking inside the list; auto-scroll only for external selection (timeline / shortcuts)
  useLayoutEffect(() => {
    if (!selectedSpotId) return;
    const el = itemRefs.current[selectedSpotId];
    if (!el) return;

    const anchor = pendingClickAnchorRef.current;
    if (anchor && anchor.spotId === selectedSpotId) {
      pendingClickAnchorRef.current = null;
      const scrollContainer = listScrollRef.current;
      if (scrollContainer) {
        const delta = el.getBoundingClientRect().top - anchor.topBefore;
        if (Math.abs(delta) > 1) {
          scrollContainer.scrollTop += delta;
        }
      }
      return;
    }

    pendingClickAnchorRef.current = null;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }, [selectedSpotId]);

  // Map each spot_id to its parent AnalysisBatch for live queue visibility
  // Text edits change `spots` but not timing, so timing-derived values key on spotTimingKey instead.
  const timingKey = mode === 'review' ? spotTimingKey(spots) : '';
  const timingContext = React.useMemo<SpotTimingContext>(() => mode === 'review'
    ? { mode, spots, videoDurationMs }
    : { mode, speechSegments, videoDurationMs },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [mode, timingKey, speechSegments, videoDurationMs]);

  const spotBatchMap = React.useMemo(() => {
    const map: Record<string, AnalysisBatch> = {};
    for (const b of batches) {
      for (const c of b.candidate_spots) {
        map[c.spot_id] = b;
      }
    }
    return map;
  }, [batches]);

  const { generatedCount, pendingCount, skippedCount, editedCount, spotOrder } = React.useMemo(() => {
    let generatedCount = 0;
    let pendingCount = 0;
    let skippedCount = 0;
    let editedCount = 0;
    const spotOrder = new Map<string, number>();
    spots.forEach((spot, index) => {
      if (!spotOrder.has(spot.spot_id)) spotOrder.set(spot.spot_id, index + 1);
      if (spot.decision === 'generate' && spot.text.trim().length > 0) generatedCount++;
      if (spot.decision === 'pending') pendingCount++;
      if (spot.decision === 'skip') skippedCount++;
      if (spot.is_edited) editedCount++;
    });
    return { generatedCount, pendingCount, skippedCount, editedCount, spotOrder };
  }, [spots]);

  const spotIssues = React.useMemo(
    () => (mode === 'review' ? findSpotIssues(spots, speechSegments, videoDurationMs) : new Map<string, SpotIssue[]>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, timingKey, speechSegments, videoDurationMs]
  );

  const spotChecks = React.useMemo(() => {
    const checks = new Map<string, SpotCheck[]>();
    for (const spot of spots) {
      const list: SpotCheck[] = [...(spotIssues.get(spot.spot_id) ?? [])];
      if (isOverDuration(spot)) list.push('over_duration');
      if (list.length > 0) checks.set(spot.spot_id, list);
    }
    return checks;
  }, [spots, spotIssues]);

  const checkCounts = React.useMemo(() => {
    const counts = new Map<SpotCheck, number>();
    for (const list of spotChecks.values()) for (const check of list) counts.set(check, (counts.get(check) ?? 0) + 1);
    return (Object.keys(SPOT_CHECK_LABELS) as SpotCheck[]).filter((check) => counts.has(check)).map((check) => ({ check, count: counts.get(check)! }));
  }, [spotChecks]);
  const hasTimingIssue = spotIssues.size > 0;

  const filterLabels: Record<FilterMode, string> = {
    all: `ทั้งหมด (${spots.length})`,
    generate: `มีบทบรรยาย (${generatedCount})`,
    pending: `รอสร้าง (${pendingCount})`,
    skip: `ข้ามการบรรยาย (${skippedCount})`,
    edited: `แก้ไขแล้ว (${editedCount})`,
    needs_check: `ต้องตรวจ (${spotChecks.size})`,
  };

  const jumpToNextCheck = (check: SpotCheck) => {
    const from = spots.findIndex((spot) => spot.spot_id === selectedSpotId);
    const ordered = [...spots.slice(from + 1), ...spots.slice(0, from + 1)];
    const target = ordered.find((spot) => spotChecks.get(spot.spot_id)?.includes(check));
    if (!target) return;
    if (!filteredSpots.some((spot) => spot.spot_id === target.spot_id)) {
      setFilterMode('needs_check');
      setSearchQuery('');
    }
    onSelectSpot(target.spot_id, true);
  };

  const filteredSpots = React.useMemo(() => {
    return spots.filter((spot) => {
      if (filterMode === 'needs_check' && !spotChecks.has(spot.spot_id)) return false;
      if (filterMode === 'generate' && spot.decision !== 'generate') return false;
      if (filterMode === 'pending' && spot.decision !== 'pending') return false;
      if (filterMode === 'skip' && spot.decision !== 'skip') return false;
      if (filterMode === 'edited' && !spot.is_edited) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = spot.spot_id.toLowerCase().includes(q);
        const matchText = spot.text.toLowerCase().includes(q);
        const matchReason = (spot.reason || '').toLowerCase().includes(q);
        const matchTime = formatTimestampDisplay(spot.start_ms).includes(q);
        return matchId || matchText || matchReason || matchTime;
      }

      return true;
    });
  }, [spots, filterMode, searchQuery, spotChecks]);

  return (
    <section
      aria-label="บทบรรยาย"
      className="flex flex-col lg:h-full min-h-0 bg-card lg:overflow-hidden"
    >
      <h1 className="sr-only">บทบรรยายภาพ</h1>
      {spots.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
          <InputGroup className="flex-1">
            <InputGroupAddon align="inline-start">
              <Search className="size-3.5" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              type="search"
              aria-label="ค้นหาบทบรรยายหรือเวลา"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ค้นหาบทหรือเวลา…"
              className="text-xs md:text-xs [&::-webkit-search-cancel-button]:hidden"
            />
            {searchQuery && (
              <InputGroupClearButton
                label="ล้างคำค้นหา"
                onClear={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
              />
            )}
          </InputGroup>
          <Select
            value={filterMode}
            onValueChange={(value) => {
              if (value) setFilterMode(value as FilterMode);
            }}
          >
            <SelectTrigger id="spot-filter" aria-label="แสดง" className="w-36 shrink-0 text-xs font-medium sm:w-40">
              <SelectValue>
                {(value: FilterMode | null) => (value ? filterLabels[value] : filterLabels.all)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false} className="w-auto min-w-44">
              <SelectGroup>
                {(Object.entries(filterLabels) as [FilterMode, string][]).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {spotChecks.size > 0 && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant={hasTimingIssue ? 'warning' : 'outline'}
                    className="shrink-0 gap-1.5 px-2.5 text-xs font-semibold"
                  />
                }
              >
                {hasTimingIssue ? <AlertTriangle data-icon="inline-start" className="size-3.5" aria-hidden="true" /> : <Clock data-icon="inline-start" className="size-3.5" aria-hidden="true" />}
                ต้องตรวจ <span className="tabular-nums">{spotChecks.size}</span>
                <ChevronDown data-icon="inline-end" className="size-3.5 transition-transform group-aria-expanded/button:rotate-180" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>กดเพื่อไปบรรทัดถัดไปของแต่ละแบบ</DropdownMenuLabel>
                  {checkCounts.map(({ check, count }) => (
                    <DropdownMenuItem key={check} onClick={() => jumpToNextCheck(check)} className="justify-between gap-3 py-1.5 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {check === 'over_duration'
                          ? <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          : <AlertTriangle className="size-3.5 shrink-0 text-warning-foreground" aria-hidden="true" />}
                        <span className={check === 'over_duration' ? 'text-foreground' : 'font-medium text-foreground'}>
                          {SPOT_CHECK_LABELS[check]}
                          {check === 'over_duration' && <span className="block font-normal text-muted-foreground">ใช้ได้ถ้าเป็น Extended AD</span>}
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="primary"
                    onClick={() => {
                      setFilterMode('needs_check');
                      setSearchQuery('');
                    }}
                    className="py-1.5 text-xs"
                  >
                    แสดงเฉพาะบรรทัดที่ต้องตรวจ
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
      {/* 2. Scrollable spot editor list */}
      <div ref={listScrollRef} className="flex-1 min-h-0 bg-canvas lg:overflow-y-auto">
        {spots.length === 0 ? (
          emptyState === 'preparing' ? (
            <div className="flex h-full min-h-full flex-col">
              <div aria-hidden="true" className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
                <Skeleton variant="shimmer" className="h-9 flex-1 rounded-lg bg-muted/70" />
                <Skeleton variant="shimmer" delay={120} className="h-9 w-36 shrink-0 rounded-lg bg-muted/70 sm:w-40" />
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
                <div className="min-h-0 flex-1 divide-y divide-border overflow-hidden [mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)]">
                  {[74, 58, 82, 52, 68, 86, 60].map((secondLineWidth, idx) => (
                    <div
                      key={idx}
                      aria-hidden="true"
                      className="px-4 py-3.5"
                    >
                      <div className="mb-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Skeleton variant="shimmer" delay={idx * 140} className="h-4 w-12 rounded bg-border/80" />
                          <Skeleton variant="shimmer" delay={idx * 140} className="h-3.5 w-28 rounded bg-muted" />
                          <Skeleton variant="shimmer" delay={idx * 140} className="h-4 w-10 rounded bg-muted" />
                        </div>
                        <Skeleton variant="shimmer" delay={idx * 140} className="h-5 w-16 rounded-md bg-brand-100/60" />
                      </div>
                      <div className="flex w-full flex-col gap-2">
                        <Skeleton variant="shimmer" delay={idx * 140} className="h-3.5 w-full rounded bg-muted" />
                        <Skeleton variant="shimmer" delay={idx * 140} className="h-3.5 rounded bg-muted/70" style={{ width: `${secondLineWidth}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div aria-hidden="true" className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton variant="shimmer" className="h-4 w-24 rounded bg-muted" />
                  <Skeleton variant="shimmer" delay={100} className="h-4 w-20 rounded bg-muted" />
                </div>
                <Skeleton variant="shimmer" delay={180} className="h-4 w-32 rounded bg-muted" />
              </div>
            </div>
          ) : (
            <Empty className="h-full py-10 sm:py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {emptyState === 'failed'
                    ? <AlertTriangle className="text-destructive" aria-hidden="true" />
                    : <Maximize2 aria-hidden="true" />}
                </EmptyMedia>
                <EmptyTitle role={emptyState === 'failed' ? 'alert' : undefined} className="text-base font-semibold text-foreground">
                  {emptyState === 'failed' ? (onRetryJobSave ? 'ยังบันทึกงานไม่สำเร็จ' : 'ยังตรวจเสียงไม่สำเร็จ') : 'ไม่พบช่วงสำหรับบรรยาย'}
                </EmptyTitle>
                <EmptyDescription>
                  {emptyState === 'failed'
                    ? (onRetryJobSave
                      ? 'ตรวจเสียงเสร็จแล้ว ลองบันทึกงานอีกครั้งได้โดยใช้ผลตรวจเสียงเดิม'
                      : 'ลองตรวจเสียงอีกครั้ง หากยังไม่สำเร็จ ให้เปลี่ยนวิดีโอจากเมนูจัดการ')
                    : 'วิดีโอนี้ไม่มีช่วงว่างที่ยาวพอ ลองเลือกวิดีโออื่นที่มีช่วงไม่มีเสียงพูดอย่างน้อย 3 วินาที'}
                </EmptyDescription>
              </EmptyHeader>
              {emptyState === 'failed' && (
                <EmptyContent>
                  <Button onClick={onRetryJobSave ?? onRetryVad}>
                    {onRetryJobSave ? 'ลองบันทึกอีกครั้ง' : 'ลองตรวจเสียงอีกครั้ง'}
                  </Button>
                  {errorMessage && (
                    <Collapsible className="w-full text-left text-sm text-muted-foreground">
                      <CollapsibleTrigger className="group/err inline-flex items-center gap-1.5 rounded px-1 py-2 hover:text-foreground">
                        รายละเอียดข้อผิดพลาด
                        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-data-[panel-open]/err:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <p className="mt-2 rounded-md bg-muted/60 p-3 leading-relaxed [overflow-wrap:anywhere]">{errorMessage}</p>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </EmptyContent>
              )}
            </Empty>
          )
        ) : filteredSpots.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Search aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>ไม่พบจุดบรรยายที่ตรงกับตัวกรองหรือคำค้นหา</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => { setFilterMode('all'); setSearchQuery(''); }}>ล้างตัวกรองและคำค้นหา</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div role="list" aria-label="รายการช่วงบรรยาย" className="divide-y divide-border border-b border-border bg-card">
            {filteredSpots.map((spot) => {
              const globalIdx = spotOrder.get(spot.spot_id)!;
              const isPlayingNow =
                currentTimeMs >= spot.start_ms && currentTimeMs <= spot.end_ms;
              return (
                <SpotBlockItem
                  key={spot.spot_id}
                  spot={spot}
                  spotOrder={globalIdx}
                  batchInfo={spotBatchMap[spot.spot_id]}
                  isAnalyzing={isAnalyzing}
                  isSelected={spot.spot_id === selectedSpotId}
                  isPlayingNow={isPlayingNow}
                  timingContext={timingContext}
                  checks={spotChecks.get(spot.spot_id)}
                  onSelect={handleListSelectSpot}
                  onUpdate={handleSpotUpdate}
                  registerItemRef={registerItemRef}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Compact Editor Shortcut Footer */}
      {spots.length > 0 && <div className="px-4 py-2.5 border-t border-border bg-muted/40 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground shrink-0">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs leading-none font-medium text-secondary-foreground">Alt + ↑/↓</kbd>
          <span>เลือกช่วง</span>
          <span aria-hidden="true" className="text-border">·</span>
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs leading-none font-medium text-secondary-foreground">Alt + P</kbd>
          <span>เล่น/หยุด</span>
        </span>
        <div role="status" className={`flex flex-wrap items-center gap-2 ${saveStatus === 'error' ? 'text-destructive' : ''}`}>
          {saveStatus === 'saving' ? <Spinner className="size-3.5 shrink-0 text-brand-700" aria-hidden="true" />
            : saveStatus === 'saved' ? <CheckCircle2 className="size-3.5 shrink-0 text-brand-800" aria-hidden="true" />
            : saveStatus === 'error' ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            : <FileText className="size-3.5 shrink-0" aria-hidden="true" />}
          <span>
            {saveStatus === 'local' ? 'งานยังอยู่ในหน้านี้เท่านั้น'
              : saveStatus === 'saving' ? 'กำลังบันทึกการแก้ไข…'
              : saveStatus === 'error' ? 'บันทึกไม่สำเร็จ · งานที่แก้ยังอยู่ในหน้านี้'
              : 'บันทึกบนเซิร์ฟเวอร์แล้ว'}
          </span>
          {saveStatus === 'error' && (
            <Button variant="link" size="xs" onClick={onRetrySave} disabled={isAnalyzing} className="h-auto px-0 font-semibold underline">
              ลองบันทึกอีกครั้ง
            </Button>
          )}
        </div>
      </div>}
      </div>
    </section>
  );
};
