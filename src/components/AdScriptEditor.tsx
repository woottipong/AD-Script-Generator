import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Maximize2,
  MinusCircle,
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
  onExportSrt: () => void;
  onExportJson: () => void;
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

  useEffect(() => {
    setStartInput(formatTimestampDisplay(spot.start_ms));
    setEndInput(formatTimestampDisplay(spot.end_ms));
    setTimestampError(null);
  }, [spot.start_ms, spot.end_ms]);

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

  const recommendedMaxChars = Math.max(10, Math.floor((spot.duration_ms / 1000) * 11.5));

  const isTimestampsModified =
    spot.start_ms !== spot.original_start_ms || spot.end_ms !== spot.original_end_ms;

  const isBatchProcessing = isAnalyzing && batchInfo?.status === 'processing';
  const isBatchPending = isAnalyzing && batchInfo?.status === 'pending';
  const isExpanded = isSelected || timestampError !== null;
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
        isSelected
          ? 'border-brand-700 bg-white shadow-sm'
          : 'border-slate-300 bg-white hover:border-brand-400'
      }`}
    >
      <div className={`-mx-3 -mt-2.5 mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-t-md px-3 py-1.5 ${isSelected ? 'bg-brand-800 text-white' : 'bg-slate-50'}`}>
        <button
          type="button"
          aria-pressed={isSelected}
          aria-label={`เลือกช่วงที่ ${spotOrder} เวลา ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)}`}
          onClick={(event) => { event.stopPropagation(); onSelect(spot.spot_id, true); }}
          className={`min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded py-1 text-left text-xs cursor-pointer ${isSelected ? 'text-brand-100 hover:text-white focus-visible:outline-white' : 'text-slate-600 hover:text-slate-900'}`}
        >
          <span className={`font-semibold ${isSelected ? 'text-white' : 'text-slate-900'}`} title={spot.spot_id}>ช่วง {spotOrder}</span>
          <span className="whitespace-nowrap font-mono tabular-nums">{formatTimestampDisplay(spot.start_ms).replace(/^00:/, '')} – {formatTimestampDisplay(spot.end_ms).replace(/^00:/, '')}</span>
          <span className="tabular-nums">{(spot.duration_ms / 1000).toFixed(1)}s</span>
        </button>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isSelected && <span className="rounded bg-white px-2 py-1 font-semibold text-brand-900">{isAnalyzing ? 'เลือกอยู่' : 'กำลังแก้ไข'}</span>}
          {isExpanded && (
            <fieldset
              disabled={isAnalyzing}
              aria-label={`เลือกการบรรยายจุดที่ ${spotOrder}`}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded"
            >
              <button
                type="button"
                aria-pressed={spot.decision === 'generate'}
                onClick={() => onUpdate(enableSpotNarration(spot))}
                className={`video-control px-2 py-0.5 text-xs font-medium rounded-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  spot.decision === 'generate'
                    ? 'bg-brand-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
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
                className={`video-control px-2 py-0.5 text-xs font-medium rounded-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  spot.decision === 'skip'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <MinusCircle className="w-3 h-3" />
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
          {isOverDurationWarning && <span className={`inline-flex items-center gap-1 font-medium ${isSelected ? 'text-amber-100' : 'text-amber-800'}`}><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />ข้อความเกินเวลา</span>}
          {spot.is_edited && <span className={isSelected ? 'text-brand-100' : 'text-slate-600'}>แก้ไขแล้ว</span>}
          {isPlayingNow && !isSelected && <span className="font-medium text-brand-800">ตำแหน่งวิดีโอ</span>}
        </div>
      </div>

      {isExpanded && <>
        {/* Second Row: Precision Timecode Editor + Quick ±0.2s Nudgers */}
        <fieldset
          disabled={isAnalyzing}
          aria-label={`ปรับเวลาบทบรรยายที่ ${spotOrder}`}
          onFocus={() => onSelect(spot.spot_id, false)}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 w-full mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Start Time + Nudge */}
            <div className="flex items-center gap-1">
              <span className="text-slate-600">เริ่ม</span>
              <button
                type="button"
                onClick={() => nudgeStartMs(-200)}
                disabled={spot.start_ms <= spot.original_start_ms}
                title="ขยับเวลาเริ่มเร็วขึ้น 0.2 วินาที"
                className="video-control px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
              >
                -0.2s
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
                className="video-control w-32 px-1.5 py-0.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-600 text-center"
              />
              <button
                type="button"
                onClick={() => nudgeStartMs(200)}
                disabled={spot.start_ms + 1000 >= spot.end_ms}
                title="ขยับเวลาเริ่มช้าลง 0.2 วินาที"
                className="video-control px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
              >
                +0.2s
              </button>
            </div>

            <span className="text-slate-400">–</span>

            {/* End Time + Nudge */}
            <div className="flex items-center gap-1">
              <span className="text-slate-600">จบ</span>
              <button
                type="button"
                onClick={() => nudgeEndMs(-200)}
                disabled={spot.end_ms - 1000 <= spot.start_ms}
                title="ขยับเวลาจบเร็วขึ้น 0.2 วินาที"
                className="video-control px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
              >
                -0.2s
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
                className="video-control w-32 px-1.5 py-0.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-600 text-center"
              />
              <button
                type="button"
                onClick={() => nudgeEndMs(200)}
                disabled={spot.end_ms >= spot.original_end_ms}
                title="ขยายเวลาจบออกไป 0.2 วินาที"
                className="video-control px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
              >
                +0.2s
              </button>
            </div>
          </div>

          {/* Gap Bounds & Reset */}
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-600">
            {isTimestampsModified && (
              <button
                type="button"
                onClick={handleResetTimestamps}
                title={`คืนค่าเวลาต้นทาง (${formatTimestampDisplay(spot.original_start_ms)} – ${formatTimestampDisplay(spot.original_end_ms)})`}
                className="px-1.5 py-0.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1 font-sans cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>เต็มช่วงว่าง</span>
              </button>
            )}
          </div>
        </fieldset>

        {/* Timestamp Validation Error */}
        {timestampError && (
          <div
            onClick={(e) => e.stopPropagation()}
            role="alert"
            className="mt-2 px-2.5 py-1.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{timestampError}</span>
          </div>
        )}

        {/* Main Content Area: Pending Queue Status OR Script Textarea OR Skip Info */}
        {spot.decision !== 'pending' && <fieldset disabled={isAnalyzing} aria-label={`แก้ไขบทบรรยายที่ ${spotOrder}`} onFocus={() => onSelect(spot.spot_id, false)} onClick={(e) => e.stopPropagation()} className="min-w-0 w-full mt-2">
          {spot.decision === 'generate' ? (
            <div className="space-y-2">
              <textarea
                rows={3}
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
                className={`w-full px-2.5 py-1.5 font-script text-script font-normal tracking-normal rounded border bg-white text-slate-900 placeholder:text-slate-600 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:cursor-not-allowed ${
                  isOverDurationWarning
                    ? 'border-amber-400 focus:ring-amber-600'
                    : 'border-slate-300 focus:ring-brand-600'
                }`}
              />

              {/* Visual Thai Speech Duration Fit Bar & Character Telemetry */}
              <div className="space-y-1">
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      isOverDurationWarning
                        ? 'bg-red-600'
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
                  {isTimestampsModified && (
                    <span>
                      ช่วงว่างต้นทาง: {formatTimestampDisplay(spot.original_start_ms)} –{' '}
                      {formatTimestampDisplay(spot.original_end_ms)}
                    </span>
                  )}

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      {spot.text.trim().length} / ≤{recommendedMaxChars} ตัวอักษร
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span
                      className={
                        isOverDurationWarning
                          ? 'text-red-700 font-semibold'
                          : 'text-slate-700'
                      }
                    >
                      เวลาพูดประมาณ {(estimatedSpeechMs / 1000).toFixed(1)} /{' '}
                      {(spot.duration_ms / 1000).toFixed(1)} วินาที
                    </span>
                  </div>
                </div>
              </div>

              {isOverDurationWarning && (
                <div className="px-2.5 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2">
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
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-1 text-xs text-slate-600">
              <div>
                  <span className="text-slate-700">
                  {spot.reason || 'ไม่มีเหตุการณ์สำคัญทางภาพที่ต้องบรรยายในช่วงเวลานี้'}
                </span>
              </div>

            </div>
          )}
        </fieldset>}
      </>}
      {!isExpanded && spot.decision !== 'pending' && (
        <p className={`line-clamp-2 ${spot.decision === 'generate' ? 'max-w-[75ch] font-script text-script font-normal tracking-normal text-slate-800' : 'text-sm leading-relaxed text-slate-600'}`}>
          {spot.decision === 'generate' ? (spot.text || 'ยังไม่มีข้อความบรรยาย') : (spot.reason || 'ไม่มีเหตุการณ์สำคัญทางภาพที่ต้องบรรยายในช่วงนี้')}
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
  onExportSrt,
  onExportJson,
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

  const generatedCount = spots.filter(
    (s) => s.decision === 'generate' && s.text.trim().length > 0
  ).length;
  const pendingCount = spots.filter((s) => s.decision === 'pending').length;
  const skippedCount = spots.filter((s) => s.decision === 'skip').length;
  const editedCount = spots.filter((s) => s.is_edited).length;
  const overDurationCount = spots.filter(
    (s) =>
      s.decision === 'generate' &&
      s.text.trim().length > 0 &&
      estimateThaiSpeechDurationMs(s.text) > s.duration_ms
  ).length;

  const filteredSpots = spots.filter((spot) => {
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

  return (
    <section
      aria-label="บทบรรยาย"
      className="flex flex-col lg:h-full min-h-0 bg-white lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:overflow-hidden"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <h1 className="workspace-pane-heading text-base font-semibold text-slate-900">บทบรรยาย</h1>
        {spots.length > 0 && (
          <div className="flex min-w-0 grow basis-[32rem] flex-wrap items-center gap-2">
            <label htmlFor="spot-filter" className="sr-only">แสดง</label>
            <select
              id="spot-filter"
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value as FilterMode)}
              className="w-40 max-w-full shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
            >
              <option value="all">ทั้งหมด ({spots.length})</option>
              <option value="generate">มีบทบรรยาย ({generatedCount})</option>
              <option value="pending">รอสร้าง ({pendingCount})</option>
              <option value="skip">ข้ามการบรรยาย ({skippedCount})</option>
              <option value="edited">แก้ไขแล้ว ({editedCount})</option>
              <option value="over_duration">ข้อความเกินเวลา ({overDurationCount})</option>
            </select>
            <div className="relative min-w-32 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-600" aria-hidden="true" />
              <input
                type="search"
                aria-label="ค้นหาบทบรรยายหรือเวลา"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ค้นหาบทหรือเวลา…"
                className="w-full rounded border border-slate-300 bg-white py-1 pl-8 pr-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-700"
              />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={onExportJson}
                aria-label="ส่งออก JSON"
                title="ส่งออก JSON"
                disabled={spots.length === 0}
                className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>

              <button
                type="button"
                onClick={onExportSrt}
                disabled={generatedCount === 0}
                title={generatedCount === 0 ? 'เพิ่มบทบรรยายก่อนส่งออก' : undefined}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>ส่งออก SRT</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
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
              const globalIdx = spots.findIndex((s) => s.spot_id === spot.spot_id) + 1;
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
            {saveStatus === 'local' ? 'งานยังอยู่ในหน้านี้ · ส่งออก JSON เพื่อเก็บงาน'
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
