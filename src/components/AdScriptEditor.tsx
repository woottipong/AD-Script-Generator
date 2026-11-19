import React, { useEffect, useRef, useState } from 'react';
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
import { ADSpot, AnalysisBatch, SpeechSegment } from '../types/ad';
import {
  enableSpotNarration,
  estimateThaiSpeechDurationMs,
  formatTimestampDisplay,
  parseTimestampInput,
  validateSpotTimestampEdit,
} from '../utils/formatters';

interface AdScriptEditorProps {
  spots: ADSpot[];
  batches: AnalysisBatch[];
  isAnalyzing: boolean;
  emptyState: 'preparing' | 'no-gaps' | 'failed';
  errorMessage: string | null;
  onRetryVad: () => void;
  speechSegments: SpeechSegment[];
  videoDurationMs: number;
  selectedSpotId: string | null;
  currentTimeMs: number;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  onUpdateSpot: (updatedSpot: ADSpot) => void;
  saveStatus: 'local' | 'saving' | 'saved' | 'error';
  onRetrySave: () => void;
}

type FilterMode = 'all' | 'generate' | 'pending' | 'skip' | 'edited' | 'over_duration';

interface SpotBlockItemProps {
  spot: ADSpot;
  spotOrder: number;
  batchInfo?: AnalysisBatch;
  isAnalyzing: boolean;
  isSelected: boolean;
  isPlayingNow: boolean;
  speechSegments: SpeechSegment[];
  videoDurationMs: number;
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
  speechSegments,
  videoDurationMs,
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

  useEffect(() => {
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
      speechSegments,
      videoDurationMs
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

  // Nudge start or end timestamp by deltaMs (e.g. -200ms or +200ms) within valid non-speech bounds
  const nudgeStartMs = (deltaMs: number) => {
    const targetStart = Math.max(
      spot.original_start_ms,
      Math.min(spot.end_ms - 1000, spot.start_ms + deltaMs)
    );
    if (targetStart !== spot.start_ms) {
      applyTimestampChange(targetStart, spot.end_ms);
    }
  };

  const nudgeEndMs = (deltaMs: number) => {
    const targetEnd = Math.min(
      spot.original_end_ms,
      Math.max(spot.start_ms + 1000, spot.end_ms + deltaMs)
    );
    if (targetEnd !== spot.end_ms) {
      applyTimestampChange(spot.start_ms, targetEnd);
    }
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
    setTimestampError(null);
    onUpdate({
      ...spot,
      start_ms: spot.original_start_ms,
      end_ms: spot.original_end_ms,
      duration_ms: spot.original_end_ms - spot.original_start_ms,
      is_edited: true,
    });
  };

  const estimatedSpeechMs =
    spot.decision === 'generate' ? estimateThaiSpeechDurationMs(spot.text) : 0;
  const speechRatio =
    spot.duration_ms > 0 ? estimatedSpeechMs / spot.duration_ms : 0;
  const isOverDurationWarning =
    spot.decision === 'generate' &&
    spot.text.trim().length > 0 &&
    estimatedSpeechMs > spot.duration_ms;

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
      className={`rounded-md border px-3 py-2.5 transition-colors cursor-pointer ${
        isSkipped
          ? isSelected
            ? 'border-dashed border-slate-400 bg-slate-50'
            : 'border-dashed border-slate-300 bg-slate-50/75 hover:border-slate-400'
          : isSelected
          ? 'border-brand-300 bg-white shadow-sm'
          : 'border-slate-300 bg-white hover:border-brand-400'
      }`}
    >
      <div
        className={`-mx-3 -mt-2.5 ${isExpanded ? 'mb-2.5' : 'mb-2'} flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2 rounded-t-md border-b px-3 py-2 ${
          isSkipped
            ? 'border-slate-200 bg-slate-100/80'
            : isSelected
            ? 'border-brand-100 bg-brand-50/60'
            : 'border-slate-100 bg-slate-50/60'
        }`}
      >
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            type="button"
            aria-pressed={isSelected}
            aria-label={`เลือกช่วงที่ ${spotOrder} เวลา ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)}`}
            onClick={(event) => { event.stopPropagation(); onSelect(spot.spot_id, true); }}
            className="min-w-0 inline-flex items-center gap-2 rounded py-0.5 text-left text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <span className={`text-sm font-semibold whitespace-nowrap ${isSkipped ? 'text-slate-500' : isSelected ? 'text-brand-900' : 'text-slate-900'}`} title={spot.spot_id}>ช่วง {spotOrder}</span>
            {!isExpanded && <span className={`whitespace-nowrap font-mono tabular-nums ${isSkipped ? 'text-slate-400' : ''}`}>{formatTimestampDisplay(spot.start_ms).replace(/^00:/, '')} – {formatTimestampDisplay(spot.end_ms).replace(/^00:/, '')}</span>}
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
                  onClick={() => nudgeStartMs(-200)}
                  disabled={spot.start_ms <= spot.original_start_ms}
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
                  className="video-control w-[6.25rem] border-0 bg-transparent px-1 text-center font-mono text-xs tabular-nums text-slate-900 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => nudgeStartMs(200)}
                  disabled={spot.start_ms + 1000 >= spot.end_ms}
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
                  onClick={() => nudgeEndMs(-200)}
                  disabled={spot.end_ms - 1000 <= spot.start_ms}
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
                  className="video-control w-[6.25rem] border-0 bg-transparent px-1 text-center font-mono text-xs tabular-nums text-slate-900 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => nudgeEndMs(200)}
                  disabled={spot.end_ms >= spot.original_end_ms}
                  title="ขยายเวลาจบออกไป 0.2 วินาที"
                  aria-label="ขยายเวลาจบออกไป 0.2 วินาที"
                  className="video-control inline-flex shrink-0 items-center justify-center rounded-r text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </fieldset>
          )}

          <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-700" title="ความยาวช่วงว่าง">
            {(spot.duration_ms / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isExpanded && (
            <fieldset
              disabled={isAnalyzing}
              aria-label={`เลือกการบรรยายจุดที่ ${spotOrder}`}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 inline-flex items-center gap-0.5 rounded-md bg-slate-200/70 p-0.5"
            >
              <button
                type="button"
                aria-pressed={spot.decision === 'generate'}
                onClick={() => onUpdate(enableSpotNarration(spot))}
                className={`video-control px-2.5 py-0.5 text-xs font-semibold rounded-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  spot.decision === 'generate'
                    ? 'bg-brand-700 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
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
                className={`video-control px-2.5 py-0.5 text-xs font-semibold rounded-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  spot.decision === 'skip'
                    ? 'bg-slate-700 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                <MinusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ข้าม</span>
              </button>
            </fieldset>
          )}
          {(!isExpanded || spot.decision === 'pending') && (
            <span className={`inline-flex items-center gap-1 ${spot.decision === 'pending' ? isSelected ? 'rounded bg-amber-100 px-2 py-1 text-amber-900' : 'text-amber-800' : spot.decision === 'generate' ? 'text-brand-800' : 'text-slate-600'}`}>
              {isBatchProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : spot.decision === 'pending' ? <Clock className="h-3.5 w-3.5" aria-hidden="true" /> : spot.decision === 'generate' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <MinusCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              {statusLabel}
            </span>
          )}
          {!isExpanded && isOverDurationWarning && <span className="inline-flex items-center gap-1 font-medium text-amber-800"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />เกินเวลา</span>}
          {!isExpanded && spot.is_edited && <span className="text-slate-500">แก้ไขแล้ว</span>}
          {isPlayingNow && !isSelected && <span className="font-medium text-brand-800">ตำแหน่งวิดีโอ</span>}
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
                className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 font-script text-script font-normal tracking-normal text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:cursor-not-allowed"
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
                    {spot.is_edited && <span className="text-slate-500">แก้ไขแล้ว</span>}
                  </div>
                </div>
              </div>

              {isOverDurationWarning && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                    <span>
                      คำบรรยายใช้เวลาพูดประมาณ {(estimatedSpeechMs / 1000).toFixed(1)}s เกินช่องว่าง {(spot.duration_ms / 1000).toFixed(1)}s
                    </span>
                  </div>
                  {isTimestampsModified && (
                    <button
                      type="button"
                      onClick={handleResetTimestamps}
                      className="text-xs font-semibold text-amber-900 underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      ขยายเวลาเต็มช่วงว่าง ({((spot.original_end_ms - spot.original_start_ms) / 1000).toFixed(1)}s)
                    </button>
                  )}
                </div>
              )}
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
                {spot.is_edited && <span>แก้ไขแล้ว</span>}
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
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-scroll to selected spot when changed from timeline or keyboard shortcuts
  useEffect(() => {
    if (!selectedSpotId) return;
    const el = itemRefs.current[selectedSpotId];
    if (el) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [selectedSpotId]);

  // Map each spot_id to its parent AnalysisBatch for live queue visibility
  const spotBatchMap = React.useMemo(() => {
    const map: Record<string, AnalysisBatch> = {};
    for (const b of batches) {
      for (const c of b.candidate_spots) {
        map[c.spot_id] = b;
      }
    }
    return map;
  }, [batches]);

  const { generatedCount, pendingCount, skippedCount, editedCount, overDurationCount, spotOrder } = React.useMemo(() => {
    let generatedCount = 0;
    let pendingCount = 0;
    let skippedCount = 0;
    let editedCount = 0;
    let overDurationCount = 0;
    const spotOrder = new Map<string, number>();
    spots.forEach((spot, index) => {
      if (!spotOrder.has(spot.spot_id)) spotOrder.set(spot.spot_id, index + 1);
      if (spot.decision === 'generate' && spot.text.trim().length > 0) {
        generatedCount++;
        if (estimateThaiSpeechDurationMs(spot.text) > spot.duration_ms) overDurationCount++;
      }
      if (spot.decision === 'pending') pendingCount++;
      if (spot.decision === 'skip') skippedCount++;
      if (spot.is_edited) editedCount++;
    });
    return { generatedCount, pendingCount, skippedCount, editedCount, overDurationCount, spotOrder };
  }, [spots]);

  const filteredSpots = React.useMemo(() => {
    return spots.filter((spot) => {
      if (filterMode === 'generate' && spot.decision !== 'generate') return false;
      if (filterMode === 'pending' && spot.decision !== 'pending') return false;
      if (filterMode === 'skip' && spot.decision !== 'skip') return false;
      if (filterMode === 'edited' && !spot.is_edited) return false;
      if (
        filterMode === 'over_duration' &&
        !(
          spot.decision === 'generate' &&
          spot.text.trim().length > 0 &&
          estimateThaiSpeechDurationMs(spot.text) > spot.duration_ms
        )
      ) {
        return false;
      }

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
  }, [spots, filterMode, searchQuery]);

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
            <option value="over_duration">ข้อความเกินเวลา ({overDurationCount})</option>
          </select>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
      {overDurationCount > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p role="status" className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />ข้อความเกินเวลา {overDurationCount} ช่วง · ควรตรวจก่อนส่งออก</p>
          <button type="button" onClick={() => {
            setFilterMode('over_duration');
            setSearchQuery('');
            const firstWarning = spots.find((spot) => spot.decision === 'generate' && estimateThaiSpeechDurationMs(spot.text) > spot.duration_ms);
            if (firstWarning) onSelectSpot(firstWarning.spot_id, true);
          }} className="shrink-0 rounded px-2 py-1 font-semibold underline underline-offset-2 hover:bg-amber-100 cursor-pointer">ดูช่วงที่ต้องตรวจ</button>
        </div>
      )}
      {/* 2. Scrollable spot editor list */}
      <div className="flex-1 min-h-0 bg-canvas lg:overflow-y-auto">
        {spots.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-10 sm:py-16 px-6 text-center">
            {emptyState === 'failed' ? <AlertTriangle className="w-7 h-7 text-red-600 mb-2" aria-hidden="true" /> : <Maximize2 className="w-7 h-7 text-slate-300 mb-2" aria-hidden="true" />}
            <p role={emptyState === 'failed' ? 'alert' : undefined} className="text-base font-semibold text-slate-900">
              {emptyState === 'preparing' ? 'บทบรรยายจะแสดงที่นี่' : emptyState === 'failed' ? 'ยังตรวจเสียงไม่สำเร็จ' : 'ไม่พบช่วงสำหรับบรรยาย'}
            </p>
            <p className="text-sm text-slate-600 mt-2 max-w-sm leading-relaxed">
              {emptyState === 'preparing' ? 'ระบบกำลังตรวจช่วงเสียงพูดบนเครื่องของคุณ รายการบทบรรยายจะแสดงที่นี่เมื่อพร้อม' : emptyState === 'failed' ? 'ลองตรวจเสียงอีกครั้ง หากยังไม่สำเร็จ ให้เปลี่ยนวิดีโอจากเมนูจัดการ' : 'วิดีโอนี้ไม่มีช่วงว่างที่ยาวพอ ลองเลือกวิดีโออื่นที่มีช่วงไม่มีเสียงพูดอย่างน้อย 3 วินาที'}
            </p>
            {emptyState === 'failed' && <button type="button" onClick={onRetryVad} className="mt-5 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 cursor-pointer">ลองตรวจเสียงอีกครั้ง</button>}
            {emptyState === 'failed' && errorMessage && (
              <details className="mt-4 w-full max-w-sm text-left text-sm text-slate-600">
                <summary className="w-fit cursor-pointer rounded px-1 py-2 hover:text-slate-900">รายละเอียดข้อผิดพลาด</summary>
                <p className="mt-2 rounded-md bg-slate-50 p-3 leading-relaxed [overflow-wrap:anywhere]">{errorMessage}</p>
              </details>
            )}
          </div>
        ) : filteredSpots.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-600 space-y-3">
            <p>ไม่พบจุดบรรยายที่ตรงกับตัวกรองหรือคำค้นหา</p>
            <button type="button" onClick={() => { setFilterMode('all'); setSearchQuery(''); }} className="px-3 py-2 border border-slate-300 rounded font-medium hover:bg-slate-50 cursor-pointer">ล้างตัวกรองและคำค้นหา</button>
          </div>
        ) : (
          <div role="list" aria-label="รายการช่วงบรรยาย" className="space-y-2 p-3">
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
                  speechSegments={speechSegments}
                  videoDurationMs={videoDurationMs}
                  onSelect={onSelectSpot}
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
