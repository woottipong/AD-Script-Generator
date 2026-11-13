import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Film,
  Loader2,
  MinusCircle,
  Pause,
  Play,
  Repeat,
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

const controlBase = 'video-control inline-flex shrink-0 items-center justify-center gap-1 rounded px-1.5 text-xs transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer';
const transportControl = `${controlBase} text-slate-300 hover:bg-slate-800 hover:text-white`;
const timelineControl = `${controlBase} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
const decisionLabels = { generate: 'มีบทบรรยาย', pending: 'รอสร้าง', skip: 'ข้าม' };
const monitorTime = (ms: number) => formatTimestampDisplay(ms).replace(/^00:/, '');

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
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(600);

  useEffect(() => {
    const container = timelineScrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setTimelineViewportWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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

  const tickCount = Math.min(32, Math.max(2, Math.floor(timelineViewportWidth * zoomLevel / 80)));
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
    <section aria-label="วิดีโอและไทม์ไลน์" className="flex flex-col lg:h-full min-h-0 bg-white lg:overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-900">วิดีโอ</h2>
        {videoMetadata && <span className="text-xs text-slate-500 tabular-nums">{videoMetadata.width} × {videoMetadata.height}</span>}
      </div>

      <div className="flex min-h-0 flex-col bg-slate-950 lg:flex-1">
        <div className="relative aspect-video min-h-0 max-h-[38vh] w-full overflow-hidden lg:aspect-auto lg:max-h-none lg:flex-1">
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain cursor-pointer"
                playsInline
                onClick={togglePlayPause}
                tabIndex={0}
                role="button"
                aria-label={isPlaying ? 'หยุดวิดีโอชั่วคราว' : 'เล่นวิดีโอ'}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    togglePlayPause();
                  }
                }}
              />
              {currentWindowSpot && (
                <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/75 px-2 py-1 text-xs font-medium text-white">
                  ช่วง {spots.indexOf(currentWindowSpot) + 1}
                </div>
              )}
              {activeSubtitleSpot && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-black/90 via-black/55 to-transparent px-6 pt-10 pb-3 text-center">
                  <p className="max-w-2xl text-sm sm:text-base font-medium leading-relaxed text-white drop-shadow">{activeSubtitleSpot.text}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-300">
              <Film className="mb-2 h-8 w-8 text-slate-500" aria-hidden="true" />
              <p className="text-sm font-medium">ยังเปิดวิดีโอไม่ได้</p>
              <p className="mt-1 text-xs">ตรวจสอบข้อความแจ้งปัญหา หรือเลือกวิดีโออีกครั้ง</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-800 bg-slate-900 px-3 py-2">
          <div role="group" aria-label="เล่นและเลื่อนเวลา" className="flex items-center gap-0.5">
            <button type="button" onClick={() => seekToMs(currentTimeMs - 5000)} disabled={!videoUrl} title="ย้อนกลับ 5 วินาที" aria-label="ย้อนกลับ 5 วินาที" className={`${transportControl} font-mono tabular-nums`}>−5s</button>
            <button type="button" onClick={() => seekToMs(currentTimeMs - 1000)} disabled={!videoUrl} title="ย้อนกลับ 1 วินาที" aria-label="ย้อนกลับ 1 วินาที" className={`${transportControl} font-mono tabular-nums`}>−1s</button>
            <button type="button" onClick={togglePlayPause} disabled={!videoUrl} title={isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} className={`${controlBase} bg-emerald-700 text-white hover:bg-emerald-800`}>
              {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => seekToMs(currentTimeMs + 1000)} disabled={!videoUrl} title="เดินหน้า 1 วินาที" aria-label="เดินหน้า 1 วินาที" className={`${transportControl} font-mono tabular-nums`}>+1s</button>
            <button type="button" onClick={() => seekToMs(currentTimeMs + 5000)} disabled={!videoUrl} title="เดินหน้า 5 วินาที" aria-label="เดินหน้า 5 วินาที" className={`${transportControl} font-mono tabular-nums`}>+5s</button>
          </div>
          <div role="group" aria-label="เลือกช่วงบรรยาย" className="flex items-center gap-0.5 border-l border-slate-700 pl-2">
            <button type="button" onClick={() => prevSpot && onSelectSpot(prevSpot.spot_id, true)} disabled={!prevSpot} title="ช่วงก่อนหน้า (Alt + ↑)" aria-label="ช่วงบรรยายก่อนหน้า" className={transportControl}><SkipBack className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => nextSpot && onSelectSpot(nextSpot.spot_id, true)} disabled={!nextSpot} title="ช่วงถัดไป (Alt + ↓)" aria-label="ช่วงบรรยายถัดไป" className={transportControl}><SkipForward className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <div role="group" aria-label="ตัวเลือกการเล่น" className="flex items-center gap-0.5 border-l border-slate-700 pl-2">
            <button type="button" onClick={() => setLoopSelectedSpot((prev) => !prev)} disabled={!selectedSpot} title="วนซ้ำช่วงที่เลือก" aria-label="วนซ้ำช่วงที่เลือก" aria-pressed={loopSelectedSpot} className={`${controlBase} ${loopSelectedSpot ? 'bg-emerald-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><Repeat className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={toggleMute} disabled={!videoUrl} title={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'} aria-label={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'} aria-pressed={isMuted} className={transportControl}>{isMuted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}</button>
          </div>
          <div className="ml-auto whitespace-nowrap font-mono text-xs tabular-nums text-slate-400" title={`${formatTimestampDisplay(currentTimeMs)} / ${formatTimestampDisplay(videoUrl ? effectiveDurationMs : 0)}`}>
            <span className="font-semibold text-white">{monitorTime(currentTimeMs)}</span><span className="mx-1.5" aria-hidden="true">/</span><span>{formatCompactTime(videoUrl ? effectiveDurationMs : 0)}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        {selectedSpot ? (
          <div className="flex min-w-0 grow basis-80 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-slate-900" aria-label={`ช่วงที่เลือก ${selectedSpotIndex + 1} จาก ${spots.length}`}>ช่วง {selectedSpotIndex + 1}/{spots.length}</span>
            <span className="whitespace-nowrap font-mono tabular-nums text-slate-600" title={`${formatTimestampDisplay(selectedSpot.start_ms)} – ${formatTimestampDisplay(selectedSpot.end_ms)}`}>{monitorTime(selectedSpot.start_ms)} – {monitorTime(selectedSpot.end_ms)}</span>
            <span className="whitespace-nowrap tabular-nums text-slate-500">{(selectedSpot.duration_ms / 1000).toFixed(1)}s</span>
            {selectedSpot.decision === 'generate' ? (
              <span className="flex items-center gap-1 text-emerald-800" title="เวลาพูดโดยประมาณ"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />อ่าน ~{(selectedSpotSpeechMs / 1000).toFixed(1)}s</span>
            ) : selectedSpot.decision === 'pending' ? (
              <span className="flex items-center gap-1 text-amber-800"><Clock className="h-3.5 w-3.5" aria-hidden="true" />รอสร้าง</span>
            ) : (
              <span className="flex items-center gap-1 text-slate-600"><MinusCircle className="h-3.5 w-3.5" aria-hidden="true" />ข้าม</span>
            )}
          </div>
        ) : <p className="min-w-0 grow basis-80 text-xs text-slate-500">เลือกช่วงบรรยายบนไทม์ไลน์เพื่อดูเวลา</p>}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {selectedSpot && (
            <button type="button" disabled={!videoUrl} onClick={() => {
              seekToMs(selectedSpot.start_ms);
              if (videoRef.current?.paused) videoRef.current.play().catch(() => {});
            }} title={`เริ่มเล่นจาก ${formatTimestampDisplay(selectedSpot.start_ms)}`} aria-label="เล่นจากช่วงที่เลือก" className={`${controlBase} gap-1.5 border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}>
              <Play className="h-3.5 w-3.5" aria-hidden="true" /><span className="hidden sm:inline">เล่นจากช่วงนี้</span>
            </button>
          )}
          <div role="group" aria-label="ซูมไทม์ไลน์" className="flex shrink-0 items-center gap-0.5 border-l border-slate-200 pl-3">
            <button type="button" onClick={() => setZoomLevel(1)} disabled={zoomLevel === 1} title="แสดงวิดีโอทั้งเรื่องบนไทม์ไลน์" aria-label="แสดงไทม์ไลน์พอดีหน้าจอ" className={timelineControl}>พอดี</button>
            <button type="button" onClick={() => setZoomLevel((z) => Math.max(1, z - 0.5))} disabled={zoomLevel <= 1} title="ย่อไทม์ไลน์" aria-label="ย่อไทม์ไลน์" className={timelineControl}><ZoomOut className="h-4 w-4" aria-hidden="true" /></button>
            <span className="min-w-12 text-center text-xs text-slate-600 tabular-nums" aria-label={`ขนาดไทม์ไลน์ ${Math.round(zoomLevel * 100)} เปอร์เซ็นต์`}>{Math.round(zoomLevel * 100)}%</span>
            <button type="button" onClick={() => setZoomLevel((z) => Math.min(8, z + 0.5))} disabled={zoomLevel >= 8} title="ขยายไทม์ไลน์" aria-label="ขยายไทม์ไลน์" className={timelineControl}><ZoomIn className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 bg-white px-3 py-3">
        <div className="flex min-w-0 overflow-hidden rounded-md border border-slate-200">
          <div className="w-24 sm:w-28 shrink-0 whitespace-nowrap border-r border-slate-200 bg-slate-50 text-xs">
            <div className="flex h-8 items-center border-b border-slate-200 px-3 font-medium text-slate-500">แทร็ก</div>
            {batches.length > 0 && <div className="flex h-9 items-center justify-between gap-2 border-b border-slate-200 px-3 text-slate-600"><span>วิเคราะห์</span><span className="hidden shrink-0 sm:inline tabular-nums">{batches.length}</span></div>}
            <div className="flex h-12 items-center justify-between gap-2 border-b border-slate-200 px-3 text-slate-600"><span>เสียงพูด</span><span className="hidden shrink-0 sm:inline tabular-nums">{speechSegments.length}</span></div>
            <div className="flex h-16 items-center justify-between gap-2 px-3 font-medium text-slate-700"><span>บรรยาย</span><span className="hidden shrink-0 sm:inline tabular-nums">{spots.length}</span></div>
          </div>
          <div ref={timelineScrollContainerRef} className="min-w-0 flex-1 overflow-x-auto pb-1 select-none">
            <div ref={timelineTrackRef} onClick={handleTimelineClick} onMouseMove={handleTimelineMouseMove} onMouseLeave={() => setHoverTimeMs(null)} style={{ width: `${100 * zoomLevel}%` }} className="relative min-w-full overflow-hidden cursor-crosshair bg-white">
              <div
                role="slider" tabIndex={videoUrl ? 0 : -1} aria-disabled={!videoUrl}
                aria-label="ตำแหน่งวิดีโอ ใช้ปุ่มลูกศรซ้ายและขวาเพื่อเลื่อนเวลา"
                aria-valuemin={0} aria-valuemax={durationMs} aria-valuenow={Math.min(durationMs, currentTimeMs)} aria-valuetext={formatTimestampDisplay(currentTimeMs)}
                onKeyDown={(event) => {
                  const nextTime = event.key === 'ArrowLeft' ? currentTimeMs - 1000
                    : event.key === 'ArrowRight' ? currentTimeMs + 1000
                    : event.key === 'Home' ? 0 : event.key === 'End' ? durationMs : null;
                  if (nextTime !== null && videoUrl) { event.preventDefault(); seekToMs(nextTime); }
                }}
                className="relative h-8 border-b border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
              >
                {ticks.map((tickMs, idx) => (
                  <div key={idx} style={{ left: `${tickMs / effectiveDurationMs * 100}%` }} className="pointer-events-none absolute top-0 bottom-0 w-0">
                    <div className="h-1.5 w-px bg-slate-300" />
                    <span className={`absolute bottom-1 whitespace-nowrap font-mono text-xs text-slate-500 tabular-nums ${idx === 0 ? 'translate-x-2' : idx === ticks.length - 1 ? '-translate-x-full pr-2' : '-translate-x-1/2'}`}>{formatCompactTime(tickMs)}</span>
                  </div>
                ))}
              </div>
              {batches.length > 0 && (
                <div className="relative h-9 border-b border-slate-200 bg-slate-50/60">
                  {batches.map((b) => (
                    <div key={b.batch_id} style={{ left: `${Math.max(0, b.batch_start_ms / effectiveDurationMs * 100)}%`, width: `${Math.max(0.5, (b.batch_end_ms - b.batch_start_ms) / effectiveDurationMs * 100)}%` }} className={`pointer-events-none absolute top-0.5 bottom-0.5 flex items-center justify-between overflow-hidden border-r border-slate-200 px-1.5 text-xs ${b.status === 'processing' ? 'bg-amber-100 text-slate-900' : b.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : b.status === 'failed' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-500'}`}>
                      <span className="truncate">ชุด {b.batch_index}</span>{b.status === 'processing' && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />}
                    </div>
                  ))}
                </div>
              )}
              <div className="relative h-12 border-b border-slate-200">
                {speechSegments.map((seg, index) => (
                  <div key={index} style={{ left: `${Math.max(0, seg.start_ms / effectiveDurationMs * 100)}%`, width: `${Math.max(0.2, (seg.end_ms - seg.start_ms) / effectiveDurationMs * 100)}%` }} title={`เสียงพูด ${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)}`} className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-xs bg-slate-600/85" />
                ))}
              </div>
              <div className="relative h-16 bg-slate-50/40">
                {spots.map((spot, index) => {
                  const leftPct = Math.max(0, spot.start_ms / effectiveDurationMs * 100);
                  const widthPct = Math.max(0.4, (spot.end_ms - spot.start_ms) / effectiveDurationMs * 100);
                  const isSelected = spot.spot_id === selectedSpotId;
                  const colorClasses = spot.decision === 'generate'
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-800'
                    : spot.decision === 'skip'
                    ? 'bg-slate-300 hover:bg-slate-400 text-slate-800 border-slate-400'
                    : 'bg-amber-400 hover:bg-amber-500 text-slate-950 border-amber-600';
                  return (
                    <button key={spot.spot_id} type="button" aria-pressed={isSelected} aria-label={`ช่วงบรรยายที่ ${index + 1} · ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)} · ${decisionLabels[spot.decision]}`} onClick={(event) => {
                      event.stopPropagation(); onSelectSpot(spot.spot_id, true); seekToMs(spot.start_ms);
                    }} style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={`${spot.spot_id} · ${formatTimestampDisplay(spot.start_ms)} – ${formatTimestampDisplay(spot.end_ms)}${spot.text ? `: ${spot.text}` : ''}`} className={`absolute top-1 bottom-1 flex min-h-0 min-w-0 cursor-pointer items-center justify-center overflow-hidden rounded-xs border px-1 transition-colors ${colorClasses} ${isSelected ? 'z-20 ring-2 ring-slate-900 ring-offset-1' : 'z-10'}`}>
                      {timelineViewportWidth * zoomLevel * widthPct / 100 >= 36 && <span className="truncate font-mono text-xs font-semibold tabular-nums">{spot.spot_id.replace('spot_', '#')}</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ left: `${playheadPercent}%` }} className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-red-600"><div className="-mt-0.5 -ml-1 h-2.5 w-2.5 rotate-45 bg-red-600" /></div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-slate-600" aria-label="สถานะช่วงบรรยาย">
          <span className="mr-auto hidden sm:inline font-mono tabular-nums text-slate-500" title="ตำแหน่งเมาส์" aria-hidden="true">{hoverTimeMs !== null ? monitorTime(hoverTimeMs) : '\u00a0'}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-emerald-700" aria-hidden="true" />มีบทบรรยาย</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-amber-400" aria-hidden="true" />รอสร้าง</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-slate-300" aria-hidden="true" />ข้าม</span>
        </div>
      </div>
    </section>
  );
};
