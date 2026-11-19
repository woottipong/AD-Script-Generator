import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Film,
  Loader2,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ADSpot, SpeechSegment, VideoMetadata } from '../types/ad';
import {
  formatCompactTime,
  formatTimestampDisplay,
} from '../utils/formatters';

const controlBase = 'video-control inline-flex shrink-0 items-center justify-center gap-1 rounded px-1.5 text-xs transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer';
const transportControl = `${controlBase} text-slate-600 hover:bg-brand-100 hover:text-brand-900`;
const timelineControl = `${controlBase} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
const decisionLabels = { generate: 'มีบทบรรยาย', pending: 'รอสร้าง', skip: 'ข้าม' };
const monitorTime = (ms: number) => formatTimestampDisplay(ms).replace(/^00:/, '');
const MAX_TIMELINE_ZOOM = 64;

interface VideoPreviewTimelineProps {
  videoUrl: string | null;
  videoMetadata: VideoMetadata | null;
  durationMs: number;
  currentTimeMs: number;
  onTimeUpdateMs: (ms: number) => void;
  speechSegments: SpeechSegment[];
  spots: ADSpot[];
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
  selectedSpotId,
  onSelectSpot,
  videoRef,
}) => {
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState<'load' | 'play' | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(Boolean(videoUrl));
  const [isMuted, setIsMuted] = useState(false);
  const [loopSelectedSpot, setLoopSelectedSpot] = useState(false);
  const [showCaptionOverlay, setShowCaptionOverlay] = useState(true);
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
    setVideoError(null);
    setIsVideoLoading(Boolean(videoUrl));
    setIsPlaying(false);
  }, [videoUrl]);

  const playVideo = useCallback(() => {
    videoRef.current?.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setVideoError(videoRef.current?.error ? 'load' : 'play');
      setIsVideoLoading(false);
    });
  }, [videoRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== 'p' || !videoUrl) return;
      const video = videoRef.current;
      if (!video) return;
      event.preventDefault();
      if (video.paused) {
        if (selectedSpot && (video.currentTime * 1000 < selectedSpot.start_ms || video.currentTime * 1000 >= selectedSpot.end_ms)) {
          video.currentTime = selectedSpot.start_ms / 1000;
        }
        playVideo();
      } else {
        video.pause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoUrl, videoRef, selectedSpot, playVideo]);

  useEffect(() => {
    const container = timelineScrollContainerRef.current;
    if (!container || !selectedSpot) return;
    const center = (selectedSpot.start_ms + selectedSpot.end_ms) / 2 / effectiveDurationMs;
    container.scrollLeft = Math.max(0, center * container.scrollWidth - container.clientWidth / 2);
  }, [selectedSpotId, selectedSpot?.start_ms, selectedSpot?.end_ms, zoomLevel, effectiveDurationMs, timelineViewportWidth]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handlePlay = () => { setIsPlaying(true); setVideoError(null); };
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
      playVideo();
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

  return (
    <section aria-label="วิดีโอและไทม์ไลน์" className="flex flex-col lg:h-full min-h-0 bg-white lg:overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col bg-slate-950 lg:flex-1">
        <div className="relative aspect-video min-h-0 max-h-[38vh] w-full overflow-hidden lg:aspect-auto lg:max-h-none lg:flex-1">
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain cursor-pointer"
                playsInline
                onLoadStart={() => { setIsVideoLoading(true); setVideoError(null); }}
                onCanPlay={() => { setIsVideoLoading(false); setVideoError(null); }}
                onError={() => { setVideoError('load'); setIsVideoLoading(false); setIsPlaying(false); }}
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
              {videoError || isVideoLoading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 px-6 py-4 text-center text-white">
                  {videoError ? <AlertTriangle className="h-6 w-6 text-amber-300" aria-hidden="true" /> : <Loader2 className="h-6 w-6 animate-spin text-brand-300" aria-hidden="true" />}
                  <div role={videoError ? 'alert' : 'status'} className="max-w-sm space-y-2">
                    <p className="text-sm font-semibold">{videoError === 'load' ? 'ยังเปิดวิดีโอไม่ได้' : videoError === 'play' ? 'ยังเล่นวิดีโอไม่ได้' : 'กำลังโหลดวิดีโอ'}</p>
                    {videoError && <p className="text-xs leading-relaxed text-slate-300">ยังแก้บทได้ตามปกติ แต่ควรเปิดวิดีโอเพื่อตรวจเทียบก่อนส่งออก</p>}
                  </div>
                  {videoError && <button type="button" onClick={() => {
                    if (videoError === 'play') { playVideo(); return; }
                    setVideoError(null);
                    setIsVideoLoading(true);
                    videoRef.current?.load();
                  }} className="rounded-md border border-slate-500 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer">{videoError === 'load' ? 'ลองโหลดวิดีโออีกครั้ง' : 'ลองเล่นอีกครั้ง'}</button>}
                </div>
              ) : null}
              {showCaptionOverlay && !videoError && !isVideoLoading && activeSubtitleSpot && (
                <div
                  aria-live="polite"
                  aria-label="บทบรรยายภาพ ณ เวลาปัจจุบัน"
                  className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center"
                >
                  <button
                    type="button"
                    onClick={() => onSelectSpot(activeSubtitleSpot.spot_id, false)}
                    className="pointer-events-auto flex max-h-[48%] max-w-[min(94%,42rem)] items-start gap-2.5 overflow-y-auto rounded-lg border border-white/15 bg-slate-950/80 px-3 py-2 text-left shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-950/90 focus-visible:outline-brand-400 cursor-pointer"
                  >
                    <span className="mt-0.5 shrink-0 rounded bg-brand-600 px-1.5 py-0.5 text-xs font-semibold leading-none tracking-wide text-white tabular-nums">
                      AD {spots.indexOf(activeSubtitleSpot) + 1}
                    </span>
                    <p className="min-w-0 text-xs sm:text-sm font-medium leading-relaxed text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]">
                      {activeSubtitleSpot.text}
                    </p>
                  </button>
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

        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-200 bg-white px-3 py-2">
          <div role="group" aria-label="เล่นและเลื่อนเวลา" className="flex items-center gap-0.5">
            <button type="button" onClick={() => seekToMs(currentTimeMs - 5000)} disabled={!videoUrl} title="ย้อนกลับ 5 วินาที" aria-label="ย้อนกลับ 5 วินาที" className={`${transportControl} font-mono tabular-nums`}>−5s</button>
            <button type="button" onClick={() => seekToMs(currentTimeMs - 1000)} disabled={!videoUrl} title="ย้อนกลับ 1 วินาที" aria-label="ย้อนกลับ 1 วินาที" className={`${transportControl} font-mono tabular-nums`}>−1s</button>
            <button type="button" onClick={togglePlayPause} disabled={!videoUrl} title={isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} className={`${controlBase} bg-brand-700 text-white hover:bg-brand-800`}>
              {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => seekToMs(currentTimeMs + 1000)} disabled={!videoUrl} title="เดินหน้า 1 วินาที" aria-label="เดินหน้า 1 วินาที" className={`${transportControl} font-mono tabular-nums`}>+1s</button>
            <button type="button" onClick={() => seekToMs(currentTimeMs + 5000)} disabled={!videoUrl} title="เดินหน้า 5 วินาที" aria-label="เดินหน้า 5 วินาที" className={`${transportControl} font-mono tabular-nums`}>+5s</button>
          </div>
          <div role="group" aria-label="เลือกช่วงบรรยาย" className="flex items-center gap-0.5 border-l border-slate-200 pl-2">
            <button type="button" onClick={() => prevSpot && onSelectSpot(prevSpot.spot_id, true)} disabled={!prevSpot} title="ช่วงก่อนหน้า (Alt + ↑)" aria-label="ช่วงบรรยายก่อนหน้า" className={transportControl}><SkipBack className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => nextSpot && onSelectSpot(nextSpot.spot_id, true)} disabled={!nextSpot} title="ช่วงถัดไป (Alt + ↓)" aria-label="ช่วงบรรยายถัดไป" className={transportControl}><SkipForward className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <div role="group" aria-label="ตัวเลือกการเล่น" className="flex items-center gap-0.5 sm:border-l sm:border-slate-200 sm:pl-2">
            <button type="button" onClick={() => setLoopSelectedSpot((prev) => !prev)} disabled={!selectedSpot} title="วนซ้ำช่วงที่เลือก" aria-label="วนซ้ำช่วงที่เลือก" aria-pressed={loopSelectedSpot} className={`${controlBase} ${loopSelectedSpot ? 'bg-brand-100 text-brand-900 ring-1 ring-inset ring-brand-300 hover:bg-brand-200/70' : 'text-slate-600 hover:bg-brand-100 hover:text-brand-900'}`}><Repeat className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => setShowCaptionOverlay((prev) => !prev)} disabled={!videoUrl} title={showCaptionOverlay ? 'ซ่อนบทบรรยายบนวิดีโอ' : 'แสดงบทบรรยายบนวิดีโอ'} aria-label={showCaptionOverlay ? 'ซ่อนบทบรรยายบนวิดีโอ' : 'แสดงบทบรรยายบนวิดีโอ'} aria-pressed={showCaptionOverlay} className={`${controlBase} ${showCaptionOverlay ? 'bg-brand-100 text-brand-900 ring-1 ring-inset ring-brand-300 hover:bg-brand-200/70' : 'text-slate-600 hover:bg-brand-100 hover:text-brand-900'}`}><Subtitles className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={toggleMute} disabled={!videoUrl} title={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'} aria-label={isMuted ? 'เปิดเสียง' : 'ปิดเสียง'} aria-pressed={isMuted} className={`${controlBase} ${isMuted ? 'bg-brand-100 text-brand-900 ring-1 ring-inset ring-brand-300 hover:bg-brand-200/70' : 'text-slate-600 hover:bg-brand-100 hover:text-brand-900'}`}>{isMuted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}</button>
          </div>
          <div className="ml-auto whitespace-nowrap font-mono text-xs tabular-nums text-slate-600" title={`${formatTimestampDisplay(currentTimeMs)} / ${formatTimestampDisplay(videoUrl ? effectiveDurationMs : 0)}`}>
            <span className="font-semibold text-brand-950">{monitorTime(currentTimeMs)}</span><span className="mx-1.5" aria-hidden="true">/</span><span>{formatCompactTime(videoUrl ? effectiveDurationMs : 0)}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-y border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        <div className="flex min-w-0 items-center gap-3">
          {selectedSpot ? (
            <span className="font-semibold text-slate-900 tabular-nums" aria-label={`ช่วงที่เลือก ${selectedSpotIndex + 1} จาก ${spots.length}`}>
              ช่วง {selectedSpotIndex + 1}/{spots.length}
            </span>
          ) : (
            <span className="text-slate-500">ไทม์ไลน์</span>
          )}
          <div className="hidden xl:flex items-center gap-3 text-slate-600" aria-label="สถานะช่วงบรรยาย">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-brand-700" aria-hidden="true" />บรรยาย</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-amber-300" aria-hidden="true" />รอ</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-slate-300" aria-hidden="true" />ข้าม</span>
          </div>
          {hoverTimeMs !== null && (
            <span className="hidden sm:inline font-mono tabular-nums text-slate-500" title="ตำแหน่งเมาส์" aria-hidden="true">
              {monitorTime(hoverTimeMs)}
            </span>
          )}
        </div>
        <div role="group" aria-label="ซูมไทม์ไลน์" className="ml-auto flex shrink-0 items-center gap-0.5">
          {selectedSpot && selectedSpot.duration_ms / effectiveDurationMs * timelineViewportWidth * zoomLevel < 24 && zoomLevel < MAX_TIMELINE_ZOOM && (
            <button type="button" onClick={() => setZoomLevel(Math.min(MAX_TIMELINE_ZOOM, Math.max(zoomLevel, 48 * effectiveDurationMs / selectedSpot.duration_ms / timelineViewportWidth)))} className={`${timelineControl} underline underline-offset-2`}>ซูมช่วงนี้</button>
          )}
          <button type="button" onClick={() => setZoomLevel(1)} disabled={zoomLevel === 1} title="แสดงวิดีโอทั้งเรื่องบนไทม์ไลน์" aria-label="แสดงไทม์ไลน์พอดีหน้าจอ" className={timelineControl}>พอดี</button>
          <button type="button" onClick={() => setZoomLevel((z) => Math.max(1, z > 8 ? z / 1.5 : z - 0.5))} disabled={zoomLevel <= 1} title="ย่อไทม์ไลน์" aria-label="ย่อไทม์ไลน์" className={timelineControl}><ZoomOut className="h-4 w-4" aria-hidden="true" /></button>
          <span className="min-w-11 text-center text-xs text-slate-600 tabular-nums" aria-label={`ขนาดไทม์ไลน์ ${Math.round(zoomLevel * 100)} เปอร์เซ็นต์`}>{Math.round(zoomLevel * 100)}%</span>
          <button type="button" onClick={() => setZoomLevel((z) => Math.min(MAX_TIMELINE_ZOOM, z >= 8 ? z * 1.5 : z + 0.5))} disabled={zoomLevel >= MAX_TIMELINE_ZOOM} title="ขยายไทม์ไลน์" aria-label="ขยายไทม์ไลน์" className={timelineControl}><ZoomIn className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>

      <div className="flex shrink-0 min-w-0 overflow-hidden bg-white">
        <div className="w-20 sm:w-24 shrink-0 whitespace-nowrap border-r border-slate-200 bg-slate-50 text-xs">
          <div className="flex h-7 items-center border-b border-slate-200 px-3 font-medium text-slate-500">เวลา</div>
          <div className="flex h-10 items-center justify-between gap-1.5 border-b border-slate-200 px-3 text-slate-600"><span>เสียงพูด</span><span className="hidden shrink-0 sm:inline tabular-nums text-slate-400">{speechSegments.length}</span></div>
          <div className="flex h-16 items-center justify-between gap-1.5 px-3 font-medium text-slate-700"><span>บรรยาย</span><span className="hidden shrink-0 sm:inline tabular-nums text-slate-500">{spots.length}</span></div>
        </div>
        <div ref={timelineScrollContainerRef} className="min-w-0 flex-1 overflow-x-auto select-none">
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
              className="relative h-7 border-b border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
            >
              {ticks.map((tickMs, idx) => (
                <div key={idx} style={{ left: `${tickMs / effectiveDurationMs * 100}%` }} className="pointer-events-none absolute top-0 bottom-0 w-0">
                  <div className="h-1.5 w-px bg-slate-300" />
                  <span className={`absolute bottom-1 whitespace-nowrap font-mono text-xs text-slate-500 tabular-nums ${idx === 0 ? 'translate-x-2' : idx === ticks.length - 1 ? '-translate-x-full pr-2' : '-translate-x-1/2'}`}>{formatCompactTime(tickMs)}</span>
                </div>
              ))}
            </div>
            <div className="relative h-10 border-b border-slate-200">
              {speechSegments.map((seg, index) => (
                <div key={index} style={{ left: `${Math.max(0, seg.start_ms / effectiveDurationMs * 100)}%`, width: `${Math.max(0.2, (seg.end_ms - seg.start_ms) / effectiveDurationMs * 100)}%` }} title={`เสียงพูด ${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)}`} className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-xs bg-slate-400/75" />
              ))}
            </div>
            <div className="relative h-16 bg-slate-50/40">
              {spots.map((spot, index) => {
                const trackWidth = timelineViewportWidth * zoomLevel;
                const left = Math.max(0, spot.start_ms / effectiveDurationMs * trackWidth);
                const width = Math.max(1, (spot.end_ms - spot.start_ms) / effectiveDurationMs * trackWidth);
                const padding = Math.max(0, (32 - width) / 2);
                const previous = spots[index - 1];
                const next = spots[index + 1];
                // Share the space between spots without overlapping neighboring hit targets.
                const hitLeft = Math.max(0, left - padding, previous ? (previous.end_ms + spot.start_ms) / 2 / effectiveDurationMs * trackWidth : 0);
                const hitRight = Math.min(trackWidth, left + width + padding, next ? (spot.end_ms + next.start_ms) / 2 / effectiveDurationMs * trackWidth : trackWidth);
                const isSelected = spot.spot_id === selectedSpotId;
                const colorClasses = spot.decision === 'generate'
                  ? 'bg-brand-700 group-hover:bg-brand-800 text-white border-brand-800'
                  : spot.decision === 'skip'
                  ? 'bg-slate-300 group-hover:bg-slate-400 text-slate-800 border-slate-400'
                  : 'bg-amber-100 group-hover:bg-amber-200 text-amber-950 border-amber-400';
                return (
                  <button key={spot.spot_id} type="button" aria-pressed={isSelected} aria-label={`ช่วงบรรยายที่ ${index + 1} · ${formatTimestampDisplay(spot.start_ms)} ถึง ${formatTimestampDisplay(spot.end_ms)} · ${decisionLabels[spot.decision]}`} onClick={(event) => {
                    event.stopPropagation(); onSelectSpot(spot.spot_id, true); seekToMs(spot.start_ms);
                  }} style={{ left: hitLeft, width: Math.max(1, hitRight - hitLeft) }} title={`ช่วง ${index + 1} · ${formatTimestampDisplay(spot.start_ms)} – ${formatTimestampDisplay(spot.end_ms)}${spot.text ? `: ${spot.text}` : ''}`} className={`group absolute top-0 bottom-0 min-h-0 min-w-0 cursor-pointer rounded px-0 ${isSelected ? 'z-20' : 'z-10'}`}>
                    <span style={{ left: left - hitLeft, width }} className={`pointer-events-none absolute top-1.5 bottom-1.5 flex items-center justify-center overflow-hidden rounded-xs border transition-colors ${colorClasses} ${isSelected ? 'ring-2 ring-brand-950 ring-offset-1' : ''}`}>
                      {width >= 24 && <span className="truncate font-mono text-xs font-semibold tabular-nums">{index + 1}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ left: `${playheadPercent}%` }} className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-red-600"><div className="-mt-0.5 -ml-1 h-2.5 w-2.5 rotate-45 bg-red-600" /></div>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
};
