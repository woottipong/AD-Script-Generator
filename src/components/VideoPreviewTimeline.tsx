import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FastForward,
  Film,
  Loader2,
  MinusCircle,
  Pause,
  Play,
  Repeat,
  Rewind,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ADSpot, AnalysisBatch, SpeechSegment, VideoMetadata } from '../types/ad';
import {
  estimateThaiSpeechDurationMs,
  formatCompactTime,
  formatTimestampDisplay,
} from '../utils/formatters';

interface VideoPreviewTimelineProps {
  videoUrl: string | null;
  videoMetadata: VideoMetadata | null;
  durationMs: number;
  currentTimeMs: number;
  onTimeUpdateMs: (ms: number) => void;
  speechSegments: SpeechSegment[];
  spots: ADSpot[];
  batches: AnalysisBatch[];
  selectedSpotId: string | null;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const VideoPreviewTimeline: React.FC<VideoPreviewTimelineProps> = ({
  videoUrl,
  videoMetadata,
  durationMs,
  currentTimeMs,
  onTimeUpdateMs,
  speechSegments,
  spots,
  batches,
  selectedSpotId,
  onSelectSpot,
  videoRef,
}) => {
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [loopSelectedSpot, setLoopSelectedSpot] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1.5);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);

  const effectiveDurationMs = Math.max(1, durationMs || videoMetadata?.durationMs || 0);

  const activeSubtitleSpot = spots.find(
    (s) =>
      s.decision === 'generate' &&
      s.text.trim().length > 0 &&
      currentTimeMs >= s.start_ms &&
      currentTimeMs <= s.end_ms
  );

  const currentWindowSpot = spots.find(
    (s) => currentTimeMs >= s.start_ms && currentTimeMs <= s.end_ms
  );

  const selectedSpotIndex = spots.findIndex((s) => s.spot_id === selectedSpotId);
  const selectedSpot = selectedSpotIndex >= 0 ? spots[selectedSpotIndex] : null;
  const prevSpot = selectedSpotIndex > 0 ? spots[selectedSpotIndex - 1] : null;
  const nextSpot =
    selectedSpotIndex >= 0 && selectedSpotIndex < spots.length - 1
      ? spots[selectedSpotIndex + 1]
      : null;

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);
    const handleTimeUpdate = () => {
      const nowMs = Math.round(vid.currentTime * 1000);
      if (
        loopSelectedSpot &&
        selectedSpot &&
        nowMs >= selectedSpot.end_ms
      ) {
        vid.currentTime = selectedSpot.start_ms / 1000;
        onTimeUpdateMs(selectedSpot.start_ms);
        return;
      }
      onTimeUpdateMs(nowMs);
    };

    vid.addEventListener('play', handlePlay);
    vid.addEventListener('pause', handlePause);
    vid.addEventListener('ended', handleEnded);
    vid.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      vid.removeEventListener('play', handlePlay);
      vid.removeEventListener('pause', handlePause);
      vid.removeEventListener('ended', handleEnded);
      vid.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [videoRef, onTimeUpdateMs, videoUrl, loopSelectedSpot, selectedSpot]);

  const togglePlayPause = () => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;
    if (vid.paused) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  };

  const seekToMs = (targetMs: number) => {
    const clamped = Math.max(0, Math.min(effectiveDurationMs, targetMs));
    onTimeUpdateMs(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped / 1000;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineTrackRef.current || effectiveDurationMs <= 1) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = clickX / rect.width;
    seekToMs(Math.round(ratio * effectiveDurationMs));
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineTrackRef.current || effectiveDurationMs <= 1) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const posX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverTimeMs(Math.round((posX / rect.width) * effectiveDurationMs));
  };

  const tickCount = Math.min(32, Math.max(6, Math.round(8 * zoomLevel)));
  const ticks = Array.from({ length: tickCount + 1 }, (_, idx) =>
    Math.round((idx / tickCount) * effectiveDurationMs)
  );

  const playheadPercent =
    effectiveDurationMs > 1
      ? Math.min(100, Math.max(0, (currentTimeMs / effectiveDurationMs) * 100))
      : 0;

  const selectedSpotSpeechMs =
    selectedSpot && selectedSpot.decision === 'generate'
      ? estimateThaiSpeechDurationMs(selectedSpot.text)
      : 0;

  return (
    <section
      id="section-preview-timeline"
      className="flex flex-col h-full min-h-0 bg-white overflow-hidden"
    >
      {/* 1. Video Monitor Canvas */}
      <div className="bg-slate-950 flex flex-col shrink-0 border-b border-slate-800">
        <div className="relative aspect-video max-h-[38vh] lg:max-h-[42vh] w-full mx-auto bg-slate-950 flex items-center justify-center overflow-hidden">
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain cursor-pointer"
                playsInline
                onClick={togglePlayPause}
              />

              {/* Top-left subtle monitor HUD showing current window spot */}
              {currentWindowSpot && (
                <div className="absolute top-2.5 left-3 px-2.5 py-1 rounded bg-black/75 text-white text-xs font-mono tabular-nums pointer-events-none flex items-center gap-2">
                  <span className="font-semibold text-emerald-400">
                    {currentWindowSpot.spot_id}
                  </span>
                  <span>·</span>
                  <span>
                    {formatTimestampDisplay(currentWindowSpot.start_ms)} –{' '}
                    {formatTimestampDisplay(currentWindowSpot.end_ms)}
                  </span>
                </div>
              )}

              {/* Live Thai AD Subtitle Scrim Overlay */}
              {activeSubtitleSpot && (
                <div className="absolute inset-x-0 bottom-0 pt-10 pb-3.5 px-6 bg-gradient-to-t from-black/90 via-black/55 to-transparent pointer-events-none flex flex-col items-center text-center">
                  <p className="text-sm sm:text-base font-medium text-white max-w-2xl leading-relaxed drop-shadow">
                    {activeSubtitleSpot.text}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-400 p-6 text-center">
              <Film className="w-8 h-8 mb-2 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">
                มอนิเตอร์พรีวิววิดีโอพร้อมซับไตเติลบรรยายภาพสด
              </p>
              <p className="text-xs text-slate-500 mt-1">
                เปิดไฟล์วิดีโอ MP4 หรือโหลดวิดีโอตัวอย่างด้านบนเพื่อเริ่มต้น
              </p>
            </div>
          )}
        </div>

        {/* 2. Precision Editor Transport & Spot Navigation Bar */}
        <div className="px-3.5 py-2 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-slate-200">
          <div className="flex flex-wrap items-center gap-1">
            {/* Play / Pause */}
            <button
              type="button"
              onClick={togglePlayPause}
              disabled={!videoUrl}
              className="px-2.5 py-1.5 rounded bg-white text-slate-900 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'หยุด' : 'เล่น'}</span>
            </button>

            {/* Seek -5s / -1s / +1s / +5s */}
            <button
              type="button"
              onClick={() => seekToMs(currentTimeMs - 5000)}
              disabled={!videoUrl}
              title="ย้อนกลับ 5 วินาที"
              className="px-1.5 py-1 rounded text-xs font-mono tabular-nums text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-0.5"
            >
              <Rewind className="w-3.5 h-3.5" />
              <span>5s</span>
            </button>

            <button
              type="button"
              onClick={() => seekToMs(currentTimeMs - 1000)}
              disabled={!videoUrl}
              title="ย้อนกลับ 1 วินาที"
              className="px-1.5 py-1 rounded text-xs font-mono tabular-nums text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer"
            >
              -1s
            </button>

            <button
              type="button"
              onClick={() => seekToMs(currentTimeMs + 1000)}
              disabled={!videoUrl}
              title="เดินหน้า 1 วินาที"
              className="px-1.5 py-1 rounded text-xs font-mono tabular-nums text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer"
            >
              +1s
            </button>

            <button
              type="button"
              onClick={() => seekToMs(currentTimeMs + 5000)}
              disabled={!videoUrl}
              title="เดินหน้า 5 วินาที"
              className="px-1.5 py-1 rounded text-xs font-mono tabular-nums text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-0.5"
            >
              <span>5s</span>
              <FastForward className="w-3.5 h-3.5" />
            </button>

            <span className="text-slate-700 mx-1" aria-hidden="true">|</span>

            {/* Prev Spot / Next Spot Quick Jump */}
            <button
              type="button"
              onClick={() => prevSpot && onSelectSpot(prevSpot.spot_id, true)}
              disabled={!prevSpot}
              title="ไปยังจุดบรรยายก่อนหน้า (Alt + ↑)"
              className="px-2 py-1 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 cursor-pointer flex items-center gap-1"
            >
              <SkipBack className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">จุดก่อนหน้า</span>
            </button>

            <button
              type="button"
              onClick={() => nextSpot && onSelectSpot(nextSpot.spot_id, true)}
              disabled={!nextSpot}
              title="ไปยังจุดบรรยายถัดไป (Alt + ↓)"
              className="px-2 py-1 rounded text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-30 cursor-pointer flex items-center gap-1"
            >
              <span className="hidden sm:inline">จุดถัดไป</span>
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            {/* Loop Current Spot Toggle */}
            <button
              type="button"
              onClick={() => setLoopSelectedSpot((prev) => !prev)}
              disabled={!selectedSpot}
              title="เล่นวนซ้ำเฉพาะช่วงเวลาของจุดที่เลือก"
              className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-30 ${
                loopSelectedSpot
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span className="hidden md:inline">วนซ้ำจุดนี้</span>
            </button>

            <button
              type="button"
              onClick={toggleMute}
              disabled={!videoUrl}
              title={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
              className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Live Timecode Readout */}
          <div className="text-xs font-mono tabular-nums text-slate-300 shrink-0">
            <span className="text-white font-semibold">{formatTimestampDisplay(currentTimeMs)}</span>
            <span className="text-slate-600 mx-1">/</span>
            <span>{formatTimestampDisplay(videoUrl ? effectiveDurationMs : 0)}</span>
          </div>
        </div>
      </div>

      {/* 3. Compact Active Spot Inspector Strip */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        {selectedSpot ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className="font-mono tabular-nums font-bold text-slate-900">
                {selectedSpot.spot_id}
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-700">
                {formatTimestampDisplay(selectedSpot.start_ms)} –{' '}
                {formatTimestampDisplay(selectedSpot.end_ms)} (
                {(selectedSpot.duration_ms / 1000).toFixed(1)}s)
              </span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              {selectedSpot.decision === 'generate' && (
                <span className="text-emerald-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    เวลาพูด ~{(selectedSpotSpeechMs / 1000).toFixed(1)}s /{' '}
                    {(selectedSpot.duration_ms / 1000).toFixed(1)}s
                  </span>
                </span>
              )}
              {selectedSpot.decision === 'pending' && (
                <span className="text-amber-700 font-medium flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>รอคิวสร้างบทบรรยาย</span>
                </span>
              )}
              {selectedSpot.decision === 'skip' && (
                <span className="text-slate-600 flex items-center gap-1">
                  <MinusCircle className="w-3.5 h-3.5" />
                  <span>ข้ามการบรรยาย</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  seekToMs(selectedSpot.start_ms);
                  if (videoRef.current && videoRef.current.paused) {
                    videoRef.current.play().catch(() => {});
                  }
                }}
                className="px-2.5 py-1 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Play className="w-3 h-3" />
                <span>เล่นฉากนี้ ({formatCompactTime(selectedSpot.start_ms)})</span>
              </button>
            </div>
          </>
        ) : (
          <div className="text-slate-500">
            คลิกเลือกจุดบรรยายบนไทม์ไลน์หรือรายการด้านขวาเพื่อตรวจสอบเวลาและซับไตเติล
          </div>
        )}
      </div>

      {/* 4. Multi-Track Synchronized Timeline Dock */}
      <div className="flex-1 min-h-[185px] flex flex-col justify-between p-3.5 bg-white overflow-y-auto">
        {/* Timeline Header & Zoom Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">ไทม์ไลน์มัลติแทร็ก</span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-slate-600 inline-block" />
              <span>เสียงพูด</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-emerald-600 inline-block" />
              <span>บรรยาย</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" />
              <span>รอคิว</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-slate-300 inline-block" />
              <span>ข้าม</span>
            </span>
            {hoverTimeMs !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  เมาส์: {formatTimestampDisplay(hoverTimeMs)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(1, z - 0.5))}
              disabled={zoomLevel <= 1}
              className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <ZoomOut className="w-3 h-3" />
              <span>ย่อ</span>
            </button>
            <span className="text-xs font-mono tabular-nums text-slate-700 px-1.5">
              {zoomLevel.toFixed(1)}x
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.min(8, z + 0.5))}
              disabled={zoomLevel >= 8}
              className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <ZoomIn className="w-3 h-3" />
              <span>ขยาย</span>
            </button>
          </div>
        </div>

        {/* Scrollable Track Container */}
        <div
          ref={timelineScrollContainerRef}
          className="w-full overflow-x-auto pb-1 select-none"
        >
          <div
            ref={timelineTrackRef}
            onClick={handleTimelineClick}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={() => setHoverTimeMs(null)}
            style={{ width: `${100 * zoomLevel}%` }}
            className="relative min-w-full bg-white border border-slate-200 rounded cursor-pointer overflow-hidden"
          >
            {/* Time Ruler */}
            <div className="relative h-6 border-b border-slate-200 bg-slate-50">
              {ticks.map((tickMs, idx) => {
                const leftPct = (tickMs / effectiveDurationMs) * 100;
                return (
                  <div
                    key={idx}
                    style={{ left: `${leftPct}%` }}
                    className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
                  >
                    <div className="w-px h-1.5 bg-slate-300" />
                    <span
                      className={`text-[10px] font-mono tabular-nums text-slate-500 pb-0.5 ${
                        idx === 0
                          ? 'translate-x-1'
                          : idx === ticks.length - 1
                          ? '-translate-x-full pr-1'
                          : '-translate-x-1/2'
                      }`}
                    >
                      {formatCompactTime(tickMs)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Track 0: Batch Queue Boundaries (Shows pending/processing/completed batch regions) */}
            {batches.length > 0 && (
              <div className="relative h-6 border-b border-slate-100 bg-slate-50/60 flex items-center">
                <span className="sticky left-2 z-10 text-[10px] font-medium text-slate-500 bg-white/90 px-1.5 py-0.5 rounded pointer-events-none">
                  คิววิเคราะห์ ({batches.length} ชุด)
                </span>
                {batches.map((b) => {
                  const leftPct = Math.max(0, (b.batch_start_ms / effectiveDurationMs) * 100);
                  const widthPct = Math.max(
                    0.5,
                    ((b.batch_end_ms - b.batch_start_ms) / effectiveDurationMs) * 100
                  );
                  return (
                    <div
                      key={b.batch_id}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-0.5 bottom-0.5 border-r border-slate-200 px-1.5 flex items-center justify-between text-[10px] font-mono tabular-nums pointer-events-none overflow-hidden ${
                        b.status === 'processing'
                          ? 'bg-amber-100/80 text-slate-900 font-semibold'
                          : b.status === 'completed'
                          ? 'bg-emerald-50/60 text-emerald-800'
                          : b.status === 'failed'
                          ? 'bg-red-50/80 text-red-800'
                          : 'bg-slate-100/50 text-slate-500'
                      }`}
                    >
                      <span className="truncate">ชุด {b.batch_index}</span>
                      {b.status === 'processing' && (
                        <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Track 1: Speech Segments */}
            <div className="relative h-8 border-b border-slate-100 flex items-center">
              <span className="sticky left-2 z-10 text-[10px] font-medium text-slate-500 bg-white/90 px-1.5 py-0.5 rounded pointer-events-none">
                เสียงพูด ({speechSegments.length})
              </span>

              {speechSegments.map((seg, idx) => {
                const leftPct = Math.max(0, (seg.start_ms / effectiveDurationMs) * 100);
                const widthPct = Math.max(
                  0.2,
                  ((seg.end_ms - seg.start_ms) / effectiveDurationMs) * 100
                );
                return (
                  <div
                    key={idx}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`เสียงพูด: ${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)}`}
                    className="absolute top-1.5 bottom-1.5 bg-slate-600/85 rounded-xs pointer-events-none"
                  />
                );
              })}
            </div>

            {/* Track 2: Candidate AD Spots */}
            <div className="relative h-10 flex items-center bg-slate-50/40">
              <span className="sticky left-2 z-10 text-[10px] font-medium text-slate-600 bg-white/90 px-1.5 py-0.5 rounded pointer-events-none">
                จุดบรรยายภาพ ({spots.length})
              </span>

              {spots.map((spot) => {
                const leftPct = Math.max(0, (spot.start_ms / effectiveDurationMs) * 100);
                const widthPct = Math.max(
                  0.4,
                  ((spot.end_ms - spot.start_ms) / effectiveDurationMs) * 100
                );
                const isSelected = spot.spot_id === selectedSpotId;

                let colorClasses =
                  'bg-amber-500/85 hover:bg-amber-500 text-slate-950 border-amber-600';
                if (spot.decision === 'generate') {
                  colorClasses =
                    'bg-emerald-600/90 hover:bg-emerald-600 text-white border-emerald-700';
                } else if (spot.decision === 'skip') {
                  colorClasses =
                    'bg-slate-300 hover:bg-slate-400 text-slate-800 border-slate-400';
                }

                return (
                  <button
                    key={spot.spot_id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSpot(spot.spot_id, true);
                      seekToMs(spot.start_ms);
                    }}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${spot.spot_id} · ${formatTimestampDisplay(spot.start_ms)} – ${formatTimestampDisplay(spot.end_ms)}${spot.text ? `: ${spot.text}` : ''}`}
                    className={`absolute top-1 bottom-1 rounded-xs border transition-opacity flex items-center justify-center overflow-hidden px-1 cursor-pointer ${colorClasses} ${
                      isSelected ? 'ring-2 ring-slate-950 ring-offset-1 z-20' : 'z-10'
                    }`}
                  >
                    <span className="text-[10px] font-mono tabular-nums font-semibold truncate">
                      {spot.spot_id.replace('spot_', '#')}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Playhead Line */}
            <div
              style={{ left: `${playheadPercent}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-red-600 z-30 pointer-events-none"
            >
              <div className="w-2.5 h-2.5 -ml-1 bg-red-600 rotate-45 -mt-1" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
