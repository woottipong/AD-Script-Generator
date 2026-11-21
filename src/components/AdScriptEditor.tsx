import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
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

interface AdScriptEditorProps {
  spots: ADSpot[];
  batches: AnalysisBatch[];
  isAnalyzing: boolean;
  emptyState: 'preparing' | 'no-gaps' | 'failed';
  errorMessage: string | null;
  onRetryVad: () => void;
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
  itemRef?: (el: HTMLDivElement | null) => void;
}

const SpotBlockItem: React.FC<SpotBlockItemProps> = ({
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
  itemRef,
}) => {
  const [startInput, setStartInput] = useState(formatTimestampDisplay(spot.start_ms));
  const [endInput, setEndInput] = useState(formatTimestampDisplay(spot.end_ms));
  const [timestampError, setTimestampError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
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
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
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
    const target = (mode: 'trim-start' | 'trim-end', deltaMs: number) =>
      computeClampedSpotDrag(spot, mode, deltaMs, timingContext, 1);
    return {
      startEarlier: target('trim-start', -200),
      startLater: target('trim-start', 200),
      endEarlier: target('trim-end', -200),
      endLater: target('trim-end', 200),
    };
  }, [spot, timingContext]);

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
      className={`px-4 py-3.5 transition-colors cursor-pointer ${
        isSkipped
          ? isSelected
            ? 'relative z-10 bg-slate-100 ring-1 ring-inset ring-slate-300'
            : 'bg-slate-50/85 hover:bg-slate-100/70'
          : isSelected
          ? 'relative z-10 bg-brand-50/90 ring-1 ring-inset ring-brand-200'
          : isPlayingNow
          ? 'bg-brand-50/35 hover:bg-brand-50/60'
          : 'bg-white hover:bg-slate-50/80'
      }`}
    >
      <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-x-2.5 gap-y-2">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            type="button"
            aria-pressed={isSelected}
            aria-label={`เลือกช่วงที่ ${spotOrder} เวลา ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)}`}
            onClick={(event) => { event.stopPropagation(); onSelect(spot.spot_id, true); }}
            className="min-w-0 inline-flex items-center gap-2 rounded text-left text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <span className={`text-sm font-semibold leading-none whitespace-nowrap ${isSkipped ? 'text-slate-500' : isSelected ? 'text-brand-900' : 'text-slate-900'}`} title={spot.spot_id}>ช่วง {spotOrder}</span>
            {!isExpanded && <span className={`whitespace-nowrap font-mono leading-none tabular-nums ${isSkipped ? 'text-slate-400' : ''}`}>{formatTimestampDisplay(spot.start_ms).replace(/^00:/, '')} – {formatTimestampDisplay(spot.end_ms).replace(/^00:/, '')}</span>}
          </button>

          {isExpanded && (
            <fieldset
              disabled={isAnalyzing || isSkipped}
              aria-label={`ปรับเวลาบทบรรยายที่ ${spotOrder}`}
              onFocus={() => onSelect(spot.spot_id, false)}
              onClick={(e) => e.stopPropagation()}
              className={`flex flex-wrap items-center gap-1.5 text-xs transition-opacity ${isSkipped ? 'opacity-50' : ''}`}
            >
              <div className="inline-flex items-center rounded-md border border-slate-200 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                <button
                  type="button"
                  onClick={() => applyNudge(nudgeTargets.startEarlier)}
                  disabled={isUnchanged(nudgeTargets.startEarlier)}
                  title="ขยับเวลาเริ่มเร็วขึ้น 0.2 วินาที"
                  aria-label="ขยับเวลาเริ่มเร็วขึ้น 0.2 วินาที"
                  className="video-control inline-flex shrink-0 items-center justify-center rounded-l text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                >
                  <Minus className="h-3 w-3" aria-hidden="true" />
                </button>
                <input
                  type="text"
                  aria-label={`เวลาเริ่มบทบรรยายที่ ${spotOrder}`}
                  value={startInput}
                  onChange={(e) => { setStartInput(e.target.value); setTimestampError(null); }}
                  onBlur={handleStartBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleStartBlur();
                  }}
                  className="video-control w-[6.75rem] border-0 bg-transparent px-1 text-center font-mono text-xs tabular-nums text-slate-900 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => applyNudge(nudgeTargets.startLater)}
                  disabled={isUnchanged(nudgeTargets.startLater)}
                  title="ขยับเวลาเริ่มช้าลง 0.2 วินาที"
                  aria-label="ขยับเวลาเริ่มช้าลง 0.2 วินาที"
                  className="video-control inline-flex shrink-0 items-center justify-center rounded-r text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
              <span aria-hidden="true" className="text-slate-400">–</span>
              <div className="inline-flex items-center rounded-md border border-slate-200 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                <button
                  type="button"
                  onClick={() => applyNudge(nudgeTargets.endEarlier)}
                  disabled={isUnchanged(nudgeTargets.endEarlier)}
                  title="ขยับเวลาจบเร็วขึ้น 0.2 วินาที"
                  aria-label="ขยับเวลาจบเร็วขึ้น 0.2 วินาที"
                  className="video-control inline-flex shrink-0 items-center justify-center rounded-l text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                >
                  <Minus className="h-3 w-3" aria-hidden="true" />
                </button>
                <input
                  type="text"
                  aria-label={`เวลาจบบทบรรยายที่ ${spotOrder}`}
                  value={endInput}
                  onChange={(e) => { setEndInput(e.target.value); setTimestampError(null); }}
                  onBlur={handleEndBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEndBlur();
                  }}
                  className="video-control w-[6.75rem] border-0 bg-transparent px-1 text-center font-mono text-xs tabular-nums text-slate-900 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => applyNudge(nudgeTargets.endLater)}
                  disabled={isUnchanged(nudgeTargets.endLater)}
                  title="ขยายเวลาจบออกไป 0.2 วินาที"
                  aria-label="ขยายเวลาจบออกไป 0.2 วินาที"
                  className="video-control inline-flex shrink-0 items-center justify-center rounded-r text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </fieldset>
          )}

          <span className="inline-flex items-center rounded border border-slate-200 bg-slate-100/80 px-1.5 py-1 font-mono text-xs leading-none tabular-nums text-slate-600" title="ความยาวช่วงว่าง">
            {(spot.duration_ms / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isExpanded && (
            <fieldset
              disabled={isAnalyzing}
              aria-label={`เลือกการบรรยายจุดที่ ${spotOrder}`}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 inline-flex items-center gap-0.5 rounded-md border border-slate-200/90 bg-slate-100 p-0.5"
            >
              <button
                type="button"
                aria-pressed={spot.decision === 'generate'}
                onClick={() => onUpdate(enableSpotNarration(spot))}
                className={`video-control px-2.5 text-xs font-semibold leading-none rounded transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  spot.decision === 'generate'
                    ? 'bg-brand-700 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>บรรยาย</span>
              </button>
              <button
                type="button"
                aria-pressed={spot.decision === 'skip'}
                onClick={() =>
                  onUpdate({
                    ...spot,
                    decision: 'skip',
                    is_edited: true,
                  })
                }
                className={`video-control px-2.5 text-xs font-semibold leading-none rounded transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  spot.decision === 'skip'
                    ? 'bg-slate-700 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                }`}
              >
                <MinusCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>ข้าม</span>
              </button>
            </fieldset>
          )}
          {(!isExpanded || spot.decision === 'pending') && (
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                isBatchProcessing
                  ? 'border-brand-200 bg-brand-100 text-brand-900'
                  : spot.decision === 'pending'
                  ? 'border-amber-200 bg-amber-100/80 text-amber-900'
                  : spot.decision === 'generate'
                  ? 'border-brand-200 bg-brand-50 text-brand-800'
                  : 'border-slate-300 bg-slate-200/75 text-slate-700'
              }`}
            >
              {isBatchProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : spot.decision === 'pending' ? <Clock className="h-3.5 w-3.5" aria-hidden="true" /> : spot.decision === 'generate' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              {statusLabel}
            </span>
          )}
          {issues?.map((issue) => (
            <span key={issue} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {SPOT_ISSUE_LABELS[issue]}
            </span>
          ))}
          {isOverDurationWarning && (
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {SPOT_CHECK_LABELS.over_duration}
            </span>
          )}
          {!isExpanded && spot.is_edited && (
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600">
              แก้ไขแล้ว
            </span>
          )}
          {isPlayingNow && !isSelected && (
            <span className="inline-flex items-center rounded-md border border-brand-600 bg-brand-600 px-2 py-0.5 font-medium text-white">
              ตำแหน่งวิดีโอ
            </span>
          )}
        </div>
      </div>

      {isExpanded && <>
        {/* Timestamp Validation Error */}
        {timestampError && (
          <div
            onClick={(e) => e.stopPropagation()}
            role="alert"
            className="mb-2 px-2.5 py-1.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{timestampError}</span>
          </div>
        )}

        {/* Main Content Area: Pending Queue Status OR Script Textarea OR Skip Info */}
        {spot.decision !== 'pending' && <fieldset disabled={isAnalyzing} aria-label={`แก้ไขบทบรรยายที่ ${spotOrder}`} onFocus={() => onSelect(spot.spot_id, false)} onClick={(e) => e.stopPropagation()} className="min-w-0 w-full">
          {spot.decision === 'generate' ? (
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
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
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 font-script text-script font-normal tracking-normal text-slate-900 placeholder:text-slate-500 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:cursor-not-allowed"
              />

              {/* Visual Thai Speech Duration Fit Bar & Compact Footer */}
              <div className="space-y-1.5">
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      isOverDurationWarning
                        ? 'bg-amber-600'
                        : speechRatio > 0.85
                        ? 'bg-amber-500'
                        : 'bg-brand-600'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, Math.round(speechRatio * 100)))}%`,
                    }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 tabular-nums">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={
                        isOverDurationWarning
                          ? 'text-amber-800 font-semibold'
                          : 'text-slate-700 font-medium'
                      }
                    >
                      พูด ~{(estimatedSpeechMs / 1000).toFixed(1)} / {(spot.duration_ms / 1000).toFixed(1)}s
                      {isOverDurationWarning && (
                        <span title="ถ้าเป็น Extended AD ที่หยุดภาพไว้ระหว่างบรรยาย ไม่ต้องแก้"> · เกิน +{(Math.ceil((estimatedSpeechMs - spot.duration_ms) / 100) / 10).toFixed(1)}s</span>
                      )}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span>{spot.text.trim().length} อักษร</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isTimestampsModified && (
                      <button
                        type="button"
                        onClick={handleResetTimestamps}
                        title={`คืนค่าเวลาต้นทาง (${formatTimestampDisplay(spot.original_start_ms)} – ${formatTimestampDisplay(spot.original_end_ms)})`}
                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-sans text-xs text-slate-700 hover:bg-slate-200 hover:text-slate-900 cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        <span>คืนเวลาเดิม</span>
                      </button>
                    )}
                    {spot.is_edited && (
                      <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600">
                        แก้ไขแล้ว
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : hasSavedText ? (
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                rows={2}
                disabled
                aria-label={`บทบรรยายที่ ${spotOrder} (ข้ามช่วงนี้)`}
                value={spot.text}
                className="w-full resize-none rounded-md border border-slate-200 bg-slate-100/80 px-3 py-2 font-script text-script font-normal tracking-normal text-slate-400 cursor-not-allowed"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>ข้ามช่วงนี้ · ไม่รวมในการส่งออก SRT (ข้อความเดิมยังถูกเก็บไว้)</span>
                {spot.is_edited && (
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-600">
                    แก้ไขแล้ว
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-slate-500">
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
          style={{ '--shimmer-delay': `${(spotOrder % 4) * 140}ms` } as React.CSSProperties}
          className="mt-1.5 w-full space-y-2"
        >
          <div className="soft-shimmer h-3.5 w-full rounded bg-brand-100/80" />
          <div
            className="soft-shimmer h-3.5 rounded bg-brand-100/60"
            style={{ width: `${[68, 54, 78, 60][spotOrder % 4]}%` }}
          />
        </div>
      )}
      {!isExpanded && spot.decision !== 'pending' && (
        <p
          className={`line-clamp-2 ${
            spot.decision === 'generate'
              ? 'max-w-[75ch] font-script text-script font-normal tracking-normal text-slate-800'
              : hasSavedText
              ? 'max-w-[75ch] font-script text-script font-normal tracking-normal text-slate-400'
              : 'text-sm leading-relaxed text-slate-500'
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
};

export const AdScriptEditor: React.FC<AdScriptEditorProps> = ({
  spots,
  batches,
  isAnalyzing,
  emptyState,
  errorMessage,
  onRetryVad,
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
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingClickAnchorRef = useRef<{ spotId: string; topBefore: number } | null>(null);

  const handleListSelectSpot = (spotId: string, seekToStart = false) => {
    const el = itemRefs.current[spotId];
    if (el && spotId !== selectedSpotId) {
      pendingClickAnchorRef.current = {
        spotId,
        topBefore: el.getBoundingClientRect().top,
      };
    }
    onSelectSpot(spotId, seekToStart);
  };

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
  const checkMenuRef = useRef<HTMLDetailsElement | null>(null);

  const jumpToNextCheck = (check: SpotCheck) => {
    const from = spots.findIndex((spot) => spot.spot_id === selectedSpotId);
    const ordered = [...spots.slice(from + 1), ...spots.slice(0, from + 1)];
    const target = ordered.find((spot) => spotChecks.get(spot.spot_id)?.includes(check));
    if (!target) return;
    if (!filteredSpots.some((spot) => spot.spot_id === target.spot_id)) {
      setFilterMode('needs_check');
      setSearchQuery('');
    }
    if (checkMenuRef.current) checkMenuRef.current.open = false;
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
      className="flex flex-col lg:h-full min-h-0 bg-white lg:overflow-hidden"
    >
      <h1 className="sr-only">บทบรรยายภาพ</h1>
      {spots.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              aria-label="ค้นหาบทบรรยายหรือเวลา"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ค้นหาบทหรือเวลา…"
              className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>
          <label htmlFor="spot-filter" className="sr-only">แสดง</label>
          <select
            id="spot-filter"
            value={filterMode}
            onChange={(event) => setFilterMode(event.target.value as FilterMode)}
            className="w-36 sm:w-40 shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="all">ทั้งหมด ({spots.length})</option>
            <option value="generate">มีบทบรรยาย ({generatedCount})</option>
            <option value="pending">รอสร้าง ({pendingCount})</option>
            <option value="skip">ข้ามการบรรยาย ({skippedCount})</option>
            <option value="edited">แก้ไขแล้ว ({editedCount})</option>
            <option value="needs_check">ต้องตรวจ ({spotChecks.size})</option>
          </select>
          {spotChecks.size > 0 && (
            <details ref={checkMenuRef} className="relative shrink-0">
              <summary className={`flex cursor-pointer list-none items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold [&::-webkit-details-marker]:hidden ${
                hasTimingIssue ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}>
                {hasTimingIssue ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                ต้องตรวจ <span className="tabular-nums">{spotChecks.size}</span>
              </summary>
              <div className="absolute right-0 z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-300 bg-white p-1.5 text-xs shadow-lg">
                <p className="px-2 pb-1 pt-0.5 text-slate-500">กดเพื่อไปบรรทัดถัดไปของแต่ละแบบ</p>
                {checkCounts.map(({ check, count }) => (
                  <button key={check} type="button" onClick={() => jumpToNextCheck(check)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 cursor-pointer">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {check === 'over_duration'
                        ? <Clock className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                        : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />}
                      <span className={check === 'over_duration' ? 'text-slate-700' : 'font-medium text-slate-900'}>
                        {SPOT_CHECK_LABELS[check]}
                        {check === 'over_duration' && <span className="block font-normal text-slate-500">ใช้ได้ถ้าเป็น Extended AD</span>}
                      </span>
                    </span>
                    <span className="tabular-nums text-slate-600">{count}</span>
                  </button>
                ))}
                <button type="button" onClick={() => {
                  setFilterMode('needs_check');
                  setSearchQuery('');
                  if (checkMenuRef.current) checkMenuRef.current.open = false;
                }} className="mt-1 w-full rounded-md border-t border-slate-200 px-2 pb-1 pt-2 text-left font-semibold text-brand-700 hover:bg-slate-50 cursor-pointer">แสดงเฉพาะบรรทัดที่ต้องตรวจ</button>
              </div>
            </details>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
      {/* 2. Scrollable spot editor list */}
      <div ref={listScrollRef} className="flex-1 min-h-0 bg-canvas lg:overflow-y-auto">
        {spots.length === 0 ? (
          emptyState === 'preparing' ? (
            <div role="status" className="divide-y divide-slate-200 border-b border-slate-200 bg-white">
              <div className="flex items-center gap-2 bg-brand-50/50 px-4 py-2.5 text-xs font-medium text-brand-900">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
                <span>กำลังตรวจช่วงเสียงพูดเพื่อสร้างรายการบทบรรยาย…</span>
              </div>
              {[74, 58, 82, 52].map((secondLineWidth, idx) => (
                <div
                  key={idx}
                  aria-hidden="true"
                  style={{ '--shimmer-delay': `${idx * 140}ms` } as React.CSSProperties}
                  className="px-4 py-3.5"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="soft-shimmer h-4 w-12 rounded bg-slate-200/80" />
                      <div className="soft-shimmer h-3.5 w-28 rounded bg-slate-100" />
                      <div className="soft-shimmer h-4 w-10 rounded bg-slate-100" />
                    </div>
                    <div className="soft-shimmer h-5 w-16 rounded-md bg-brand-100/60" />
                  </div>
                  <div className="w-full space-y-2">
                    <div className="soft-shimmer h-3.5 w-full rounded bg-slate-100" />
                    <div className="soft-shimmer h-3.5 rounded bg-slate-100/70" style={{ width: `${secondLineWidth}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center py-10 sm:py-16 px-6 text-center">
              {emptyState === 'failed' ? <AlertTriangle className="w-7 h-7 text-red-600 mb-2" aria-hidden="true" /> : <Maximize2 className="w-7 h-7 text-slate-300 mb-2" aria-hidden="true" />}
              <p role={emptyState === 'failed' ? 'alert' : undefined} className="text-base font-semibold text-slate-900">
                {emptyState === 'failed' ? 'ยังตรวจเสียงไม่สำเร็จ' : 'ไม่พบช่วงสำหรับบรรยาย'}
              </p>
              <p className="text-sm text-slate-600 mt-2 max-w-sm leading-relaxed">
                {emptyState === 'failed' ? 'ลองตรวจเสียงอีกครั้ง หากยังไม่สำเร็จ ให้เปลี่ยนวิดีโอจากเมนูจัดการ' : 'วิดีโอนี้ไม่มีช่วงว่างที่ยาวพอ ลองเลือกวิดีโออื่นที่มีช่วงไม่มีเสียงพูดอย่างน้อย 3 วินาที'}
              </p>
              {emptyState === 'failed' && <button type="button" onClick={onRetryVad} className="mt-5 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 cursor-pointer">ลองตรวจเสียงอีกครั้ง</button>}
              {emptyState === 'failed' && errorMessage && (
                <details className="mt-4 w-full max-w-sm text-left text-sm text-slate-600">
                  <summary className="w-fit cursor-pointer rounded px-1 py-2 hover:text-slate-900">รายละเอียดข้อผิดพลาด</summary>
                  <p className="mt-2 rounded-md bg-slate-50 p-3 leading-relaxed [overflow-wrap:anywhere]">{errorMessage}</p>
                </details>
              )}
            </div>
          )
        ) : filteredSpots.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-600 space-y-3">
            <p>ไม่พบจุดบรรยายที่ตรงกับตัวกรองหรือคำค้นหา</p>
            <button type="button" onClick={() => { setFilterMode('all'); setSearchQuery(''); }} className="px-3 py-2 border border-slate-300 rounded font-medium hover:bg-slate-50 cursor-pointer">ล้างตัวกรองและคำค้นหา</button>
          </div>
        ) : (
          <div role="list" aria-label="รายการช่วงบรรยาย" className="divide-y divide-slate-200 border-b border-slate-200 bg-white">
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
                  onUpdate={(updatedSpot) => {
                    if (filterMode === 'skip' && updatedSpot.decision === 'generate') {
                      setFilterMode('all');
                    }
                    onUpdateSpot(updatedSpot);
                  }}
                  itemRef={(el) => {
                    itemRefs.current[spot.spot_id] = el;
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Compact Editor Shortcut Footer */}
      {spots.length > 0 && <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
        <span>
          <strong className="font-mono text-slate-700">Alt + ↑/↓</strong> เลือกช่วง ·{' '}
          <strong className="font-mono text-slate-700">Alt + P</strong> เล่น/หยุด
        </span>
        <div role="status" className={`flex flex-wrap items-center gap-2 ${saveStatus === 'error' ? 'text-red-700' : ''}`}>
          {saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-700" aria-hidden="true" />
            : saveStatus === 'saved' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-800" aria-hidden="true" />
            : saveStatus === 'error' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span>
            {saveStatus === 'local' ? 'งานยังอยู่ในหน้านี้เท่านั้น'
              : saveStatus === 'saving' ? 'กำลังบันทึกการแก้ไข…'
              : saveStatus === 'error' ? 'บันทึกไม่สำเร็จ · งานที่แก้ยังอยู่ในหน้านี้'
              : 'บันทึกบนเซิร์ฟเวอร์แล้ว'}
          </span>
          {saveStatus === 'error' && (
            <button type="button" onClick={onRetrySave} disabled={isAnalyzing} className="font-semibold underline cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
              ลองบันทึกอีกครั้ง
            </button>
          )}
        </div>
      </div>}
      </div>
    </section>
  );
};
