import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Download,
  FileText,
  Loader2,
  Maximize2,
  MinusCircle,
  Play,
  RotateCcw,
  Search,
} from 'lucide-react';
import { ADSpot, AnalysisBatch, SpeechSegment } from '../types/ad';
import {
  estimateThaiSpeechDurationMs,
  formatTimestampDisplay,
  generateSrtContent,
  parseTimestampInput,
  validateSpotTimestampEdit,
} from '../utils/formatters';

interface AdScriptEditorProps {
  spots: ADSpot[];
  batches: AnalysisBatch[];
  isAnalyzing: boolean;
  emptyState: 'preparing' | 'no-gaps' | 'failed';
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
    } else {
      setTimestampError(null);
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
    } else {
      setTimestampError(null);
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

  return (
    <div
      ref={itemRef}
      onClick={() => onSelect(spot.spot_id, true)}
      className={`py-3.5 px-4 transition-colors cursor-pointer ${
        isSelected
          ? 'bg-slate-100/90 ring-1 ring-inset ring-slate-300'
          : isPlayingNow
          ? 'bg-emerald-50/40'
          : 'bg-white hover:bg-slate-50/60'
      }`}
    >
      {/* Top Row: Spot Order, ID, Batch Info, Decision Segmented Control, and Play Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono tabular-nums font-bold text-slate-900">
            #{String(spotOrder).padStart(2, '0')}
          </span>
          <span className="font-mono tabular-nums text-slate-500">
            ({spot.spot_id})
          </span>

          {batchInfo && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-500">
                ชุดที่ {batchInfo.batch_index}
              </span>
            </>
          )}

          <span className="text-slate-300" aria-hidden="true">·</span>

          {/* Interactive Decision Segmented Control */}
          <fieldset
            disabled={isAnalyzing}
            aria-label={`เลือกการบรรยายจุดที่ ${spotOrder}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded"
          >
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  ...spot,
                  decision: 'generate',
                  is_edited: true,
                })
              }
              className={`px-2 py-0.5 text-xs font-medium rounded-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                spot.decision === 'generate'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>บรรยาย</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  ...spot,
                  decision: 'skip',
                  is_edited: true,
                })
              }
              className={`px-2 py-0.5 text-xs font-medium rounded-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                spot.decision === 'skip'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MinusCircle className="w-3 h-3" />
              <span>ข้าม</span>
            </button>
          </fieldset>

          {spot.is_edited && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-xs font-medium text-slate-600">แก้ไขแล้ว</span>
            </>
          )}

          {isPlayingNow && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="text-xs font-semibold text-emerald-700">
                กำลังเล่นบนมอนิเตอร์
              </span>
            </>
          )}
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 shrink-0"
        >
          <button
            type="button"
            onClick={() => onSelect(spot.spot_id, true)}
            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3 h-3" />
            <span>ดูฉากนี้</span>
          </button>
        </div>
      </div>

      {/* Second Row: Precision Timecode Editor + Quick ±0.2s Nudgers */}
      <fieldset
        disabled={isAnalyzing}
        aria-label={`ปรับเวลาบทบรรยายที่ ${spotOrder}`}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 w-full mt-2 pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Start Time + Nudge */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">เริ่ม</span>
            <button
              type="button"
              onClick={() => nudgeStartMs(-200)}
              disabled={spot.start_ms <= spot.original_start_ms}
              title="ขยับเวลาเริ่มเร็วขึ้น 0.2 วินาที"
              className="px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
            >
              -0.2s
            </button>
            <input
              type="text"
              aria-label={`เวลาเริ่มบทบรรยายที่ ${spotOrder}`}
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              onBlur={handleStartBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleStartBlur();
              }}
              className="w-[126px] px-1.5 py-0.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 text-center"
            />
            <button
              type="button"
              onClick={() => nudgeStartMs(200)}
              disabled={spot.start_ms + 1000 >= spot.end_ms}
              title="ขยับเวลาเริ่มช้าลง 0.2 วินาที"
              className="px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
            >
              +0.2s
            </button>
          </div>

          <span className="text-slate-400">–</span>

          {/* End Time + Nudge */}
          <div className="flex items-center gap-1">
            <span className="text-slate-500">จบ</span>
            <button
              type="button"
              onClick={() => nudgeEndMs(-200)}
              disabled={spot.end_ms - 1000 <= spot.start_ms}
              title="ขยับเวลาจบเร็วขึ้น 0.2 วินาที"
              className="px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
            >
              -0.2s
            </button>
            <input
              type="text"
              aria-label={`เวลาจบบทบรรยายที่ ${spotOrder}`}
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              onBlur={handleEndBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleEndBlur();
              }}
              className="w-[126px] px-1.5 py-0.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 text-center"
            />
            <button
              type="button"
              onClick={() => nudgeEndMs(200)}
              disabled={spot.end_ms >= spot.original_end_ms}
              title="ขยายเวลาจบออกไป 0.2 วินาที"
              className="px-1.5 py-0.5 text-xs font-mono tabular-nums text-slate-600 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-30 cursor-pointer"
            >
              +0.2s
            </button>
          </div>
        </div>

        {/* Gap Bounds & Reset */}
        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-500">
          <span>
            ช่วงว่าง {(spot.duration_ms / 1000).toFixed(1)}s
          </span>
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
      <fieldset disabled={isAnalyzing} aria-label={`แก้ไขบทบรรยายที่ ${spotOrder}`} onClick={(e) => e.stopPropagation()} className="min-w-0 w-full mt-2.5">
        {spot.decision === 'pending' ? (
          <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              {isBatchProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-900 shrink-0" />
                  <span>
                    <strong className="font-semibold text-slate-900">
                      กำลังวิเคราะห์ฉากนี้ในชุดที่ {batchInfo?.batch_index}...
                    </strong>{' '}
                    ระบบกำลังสร้างคำบรรยายภาษาไทยให้พอดีกับเวลา {(spot.duration_ms / 1000).toFixed(1)}s
                  </span>
                </>
              ) : isBatchPending ? (
                <>
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong className="font-semibold text-slate-800">
                      อยู่ในคิวรอวิเคราะห์ (ชุดที่ {batchInfo?.batch_index})
                    </strong>{' '}
                    · ตรวจและแก้ไขได้เมื่อการวิเคราะห์สิ้นสุด
                  </span>
                </>
              ) : isAnalyzing ? (
                <>
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>กำลังเตรียมการวิเคราะห์ · ตรวจและแก้ไขได้เมื่อการวิเคราะห์สิ้นสุด</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    รอกดสร้างบทบรรยายภาพอัตโนมัติ (แนะนำไม่เกิน {recommendedMaxChars} ตัวอักษร)
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                onUpdate({
                  ...spot,
                  decision: 'generate',
                  is_edited: true,
                })
              }
              className="px-2.5 py-1 text-xs font-medium text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              เขียนบทบรรยายจุดนี้เอง
            </button>
          </div>
        ) : spot.decision === 'generate' ? (
          <div className="space-y-2">
            <textarea
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
              placeholder={`พิมพ์บทบรรยายภาพภาษาไทย (แนะนำไม่เกิน ${recommendedMaxChars} ตัวอักษร เพื่อให้พูดทันใน ${(spot.duration_ms / 1000).toFixed(1)} วินาที)...`}
              className={`w-full px-3 py-2 text-sm rounded border bg-white text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 leading-relaxed disabled:bg-slate-50 disabled:cursor-not-allowed ${
                isOverDurationWarning
                  ? 'border-amber-400 focus:ring-amber-600'
                  : 'border-slate-300 focus:ring-slate-900'
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
                      : 'bg-emerald-600'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, Math.round(speechRatio * 100)))}%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span>
                  ขอบเขตสูงสุด: {formatTimestampDisplay(spot.original_start_ms)} –{' '}
                  {formatTimestampDisplay(spot.original_end_ms)}
                </span>

                <div className="flex items-center gap-2">
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
                    เวลาพูด ~{(estimatedSpeechMs / 1000).toFixed(1)}s / ช่วงว่าง{' '}
                    {(spot.duration_ms / 1000).toFixed(1)}s
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-1 text-xs text-slate-500">
            <div>
              <span>ข้ามการบรรยาย: </span>
              <span className="text-slate-700">
                {spot.reason || 'ไม่มีเหตุการณ์สำคัญทางภาพที่ต้องบรรยายในช่วงเวลานี้'}
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  ...spot,
                  decision: 'generate',
                  is_edited: true,
                })
              }
              className="text-xs font-medium text-slate-900 underline whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              เปลี่ยนเป็นเขียนคำบรรยาย
            </button>
          </div>
        )}
      </fieldset>
    </div>
  );
};

export const AdScriptEditor: React.FC<AdScriptEditorProps> = ({
  spots,
  batches,
  isAnalyzing,
  emptyState,
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
  const [showSrtPreview, setShowSrtPreview] = useState(false);
  const [copiedSrt, setCopiedSrt] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    if (spots.length === 0) setShowSrtPreview(false);
  }, [spots.length]);

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-scroll to selected spot when changed from timeline or keyboard shortcuts
  useEffect(() => {
    if (!selectedSpotId || showSrtPreview) return;
    const el = itemRefs.current[selectedSpotId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSpotId, showSrtPreview]);

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

  const srtPreviewText = React.useMemo(() => generateSrtContent(spots), [spots]);

  const handleCopySrt = async () => {
    if (!srtPreviewText) return;
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(srtPreviewText);
      setCopiedSrt(true);
      setTimeout(() => setCopiedSrt(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <section
      id="section-script-editor"
      tabIndex={-1}
      className="flex flex-col lg:h-full min-h-0 bg-white lg:overflow-hidden"
    >
      {/* 1. Sticky Editor Command Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white space-y-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              ตรวจและแก้บทบรรยาย
            </h1>
            <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
              ทั้งหมด {spots.length} จุด · บรรยาย {generatedCount} · รอคิว {pendingCount} · ข้าม {skippedCount}
              {overDurationCount > 0 ? ` · เกินเวลา ${overDurationCount}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowSrtPreview((prev) => !prev)}
              disabled={spots.length === 0}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer ${
                showSrtPreview
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{showSrtPreview ? 'กลับไปหน้าแก้ไข' : 'ดูตัวอย่าง SRT'}</span>
            </button>

            <button
              type="button"
              onClick={onExportJson}
              disabled={spots.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>

            <button
              type="button"
              onClick={onExportSrt}
              disabled={generatedCount === 0}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>ส่งออก SRT ({generatedCount})</span>
            </button>
          </div>
        </div>

        {isAnalyzing && (
          <p role="status" className="text-sm text-slate-700">
            ระหว่างรอผลวิเคราะห์ คุณดูวิดีโอและตรวจผลได้ และแก้ไขได้เมื่อการวิเคราะห์สิ้นสุด
          </p>
        )}

        {/* Filter Bar & Live Search */}
        {!showSrtPreview && spots.length > 0 && (
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <label htmlFor="spot-filter" className="text-sm text-slate-600 shrink-0">แสดง</label>
              <select
                id="spot-filter"
                value={filterMode}
                onChange={(event) => setFilterMode(event.target.value as FilterMode)}
                className="min-w-0 flex-1 px-3 py-2 text-sm border border-slate-300 rounded bg-white text-slate-900"
              >
                <option value="all">ทั้งหมด ({spots.length})</option>
                <option value="generate">มีบทบรรยาย ({generatedCount})</option>
                <option value="pending">รอสร้าง ({pendingCount})</option>
                <option value="skip">ข้ามการบรรยาย ({skippedCount})</option>
                <option value="edited">แก้ไขแล้ว ({editedCount})</option>
                <option value="over_duration">ข้อความเกินเวลา ({overDurationCount})</option>
              </select>
            </div>

            <div className="relative w-full xl:w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="ค้นหาบทบรรยายหรือเวลา"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาบทบรรยายหรือเวลา..."
                className="w-full pl-8 pr-2.5 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Scrollable Body: Either Live SRT Preview OR Spot Block Editor List */}
      <div className="flex-1 min-h-0 lg:overflow-y-auto">
        {showSrtPreview ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                ตัวอย่างไฟล์ซับไตเติล .SRT ({generatedCount} รายการบรรยาย)
              </span>
              <button
                type="button"
                onClick={handleCopySrt}
                disabled={!srtPreviewText}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                {copiedSrt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>คัดลอกแล้ว</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>คัดลอกข้อความ SRT</span>
                  </>
                )}
              </button>
            </div>

            {copyError && <p role="alert" className="text-sm text-red-700">คัดลอกไม่สำเร็จ เลือกข้อความด้านล่างเพื่อคัดลอก หรือกดส่งออก SRT แทน</p>}

            {srtPreviewText ? (
              <pre className="p-4 rounded border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums text-slate-800 whitespace-pre-wrap leading-relaxed select-all">
                {srtPreviewText}
              </pre>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500">
                ยังไม่มีจุดบรรยายที่มีข้อความสำหรับสร้างไฟล์ .SRT
              </div>
            )}
          </div>
        ) : spots.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-16 px-6 text-center">
            <Maximize2 className="w-7 h-7 text-slate-300 mb-2" />
            <p className="text-base font-medium text-slate-700">
              {emptyState === 'preparing' ? 'กำลังหาช่วงสำหรับบรรยาย…' : emptyState === 'failed' ? 'ยังตรวจเสียงไม่สำเร็จ' : 'ไม่พบช่วงสำหรับบรรยาย'}
            </p>
            <p className="text-sm text-slate-600 mt-2 max-w-sm leading-relaxed">
              {emptyState === 'preparing' ? 'ระบบกำลังตรวจช่วงเสียงพูดบนเครื่องของคุณ รายการบทบรรยายจะแสดงที่นี่เมื่อพร้อม' : emptyState === 'failed' ? 'ดูข้อความแจ้งปัญหาด้านบน แล้วลองสแกนเสียงใหม่หรือเลือกวิดีโออื่น' : 'วิดีโอนี้ไม่มีช่วงว่างที่ยาวพอ ลองเลือกวิดีโออื่นที่มีช่วงไม่มีเสียงพูดอย่างน้อย 3 วินาที'}
            </p>
          </div>
        ) : filteredSpots.length === 0 ? (
          <div className="py-12 px-6 text-center text-sm text-slate-600 space-y-3">
            <p>ไม่พบจุดบรรยายที่ตรงกับตัวกรองหรือคำค้นหา</p>
            <button type="button" onClick={() => { setFilterMode('all'); setSearchQuery(''); }} className="px-3 py-2 border border-slate-300 rounded font-medium hover:bg-slate-50 cursor-pointer">ล้างตัวกรองและคำค้นหา</button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
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
                  onUpdate={onUpdateSpot}
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
          คีย์ลัดผู้แก้ไข: <strong className="font-mono text-slate-700">Alt + ↑/↓</strong> เปลี่ยนจุดบรรยาย ·{' '}
          <strong className="font-mono text-slate-700">Alt + P</strong> เล่น/หยุดฉากที่เลือก
        </span>
        <div role="status" className={`flex flex-wrap items-center gap-2 ${saveStatus === 'error' ? 'text-red-700' : ''}`}>
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
    </section>
  );
};
