import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ADSpot, JobMode, SpeechSegment, WaveformEnvelope } from '../types/ad';
import { getProcessingFeedback, type ProcessingProgress } from '../utils/processingFeedback';
import {
  formatCompactTime,
  formatTimestampDisplay,
} from '../utils/formatters';
import {
  DEFAULT_WAVEFORM_SAMPLE_INTERVAL_MS,
  decodeWaveformPeaks,
} from '../utils/waveform';
import { SpotDragMode, computeClampedSpotDrag, findSpotIssues, spotTimingKey } from '../utils/spotTiming';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const decisionLabels = { generate: 'มีบทบรรยาย', pending: 'รอสร้าง', skip: 'ข้าม' };
const monitorTime = (ms: number) => formatTimestampDisplay(ms).replace(/^00:/, '');
const MAX_TIMELINE_ZOOM = 64;

/** A player or zoom control whose name (and shortcut) shows in a tooltip rather than a browser title. */
function WithTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface ActiveSpotDrag {
  spotId: string;
  mode: SpotDragMode;
  pointerId: number;
  startClientX: number;
  originSpot: ADSpot;
  previewStartMs: number;
  previewEndMs: number;
  hasMoved: boolean;
}

interface VideoPreviewTimelineProps {
  mode: JobMode;
  videoUrl: string | null;
  durationMs: number;
  currentTimeMs: number;
  onTimeUpdateMs: (ms: number) => void;
  speechSegments: SpeechSegment[];
  waveform?: WaveformEnvelope;
  spots: ADSpot[];
  selectedSpotId: string | null;
  isAnalyzing?: boolean;
  processingSpotIds?: ReadonlySet<string>;
  detectProgress?: ProcessingProgress | null;
  onSelectSpot: (spotId: string, seekToStart?: boolean) => void;
  onUpdateSpot: (updatedSpot: ADSpot) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const VideoPreviewTimeline: React.FC<VideoPreviewTimelineProps> = ({
  mode,
  videoUrl,
  durationMs,
  currentTimeMs,
  onTimeUpdateMs,
  speechSegments,
  waveform,
  spots,
  selectedSpotId,
  isAnalyzing = false,
  processingSpotIds,
  detectProgress = null,
  onSelectSpot,
  onUpdateSpot,
  videoRef,
}) => {
  const timelineScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState<'load' | 'play' | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(Boolean(videoUrl));
  const [isMuted, setIsMuted] = useState(false);
  const [loopSelectedSpot, setLoopSelectedSpot] = useState(false);
  const [showCaptionOverlay, setShowCaptionOverlay] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hoverTimeMs, setHoverTimeMs] = useState<number | null>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(600);
  const [activeDrag, setActiveDrag] = useState<ActiveSpotDrag | null>(null);

  const waveformPeaks = useMemo(
    () => (waveform?.peaksBase64 ? decodeWaveformPeaks(waveform.peaksBase64) : new Uint8Array(0)),
    [waveform?.peaksBase64]
  );
  const waveformPeakCeiling = useMemo(() => {
    if (waveformPeaks.length === 0) return 255;
    // Use 98th percentile peak for clean normalization without letting a single pop flatten the track
    const histogram = new Uint32Array(256);
    for (let i = 0; i < waveformPeaks.length; i++) {
      histogram[waveformPeaks[i]]++;
    }
    const target = Math.floor(waveformPeaks.length * 0.98);
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += histogram[v];
      if (acc >= target) return Math.max(32, v);
    }
    return 255;
  }, [waveformPeaks]);
  const waveformIntervalMs = waveform?.sampleIntervalMs || DEFAULT_WAVEFORM_SAMPLE_INTERVAL_MS;
  const isDetecting = Boolean(detectProgress);
  const detectFeedback = detectProgress ? getProcessingFeedback('DETECTING', detectProgress, [], null) : null;
  const detectPercent = detectFeedback?.percent;
  const showWaveformTrack = waveformPeaks.length > 0 || isDetecting;

  useEffect(() => {
    const container = timelineScrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setTimelineViewportWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const effectiveDurationMs = Math.max(1, durationMs);
  const timingKey = mode === 'review' ? spotTimingKey(spots) : '';
  const issueSpotIds = useMemo(
    () => new Set(mode === 'review' ? findSpotIssues(spots, speechSegments, effectiveDurationMs).keys() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, timingKey, speechSegments, effectiveDurationMs]
  );

  const drawWaveform = useCallback(() => {
    const canvas = waveformCanvasRef.current;
    const scrollContainer = timelineScrollContainerRef.current;
    if (!canvas || !scrollContainer || waveformPeaks.length === 0) return;

    const cssWidth = Math.max(1, Math.floor(timelineViewportWidth));
    const cssHeight = 56; // matches h-14 waveform track height
    const dpr = window.devicePixelRatio || 1;
    const backingW = Math.round(cssWidth * dpr);
    const backingH = Math.round(cssHeight * dpr);
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const totalTrackWidth = Math.max(1, cssWidth * zoomLevel);
    const scrollLeft = scrollContainer.scrollLeft;

    // Crisp center baseline
    const midY = cssHeight / 2;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.fillRect(0, Math.round(midY) - 0.5, cssWidth, 1);

    // Crisp Retina rounded micro-bars (2px bar + 1px gap); the playhead line alone marks position
    const barStep = 3;
    const barWidth = 2;
    const maxHalfHeight = midY - 4;

    const barGrad = ctx.createLinearGradient(0, 4, 0, cssHeight - 4);
    barGrad.addColorStop(0, '#94a3b8');
    barGrad.addColorStop(0.5, '#475569');
    barGrad.addColorStop(1, '#94a3b8');

    // One path per fill style: two fill() calls per frame instead of one per bar
    const quietBars = new Path2D();
    const loudBars = new Path2D();

    // Anchor bars to absolute timeline pixels so each bar keeps its time window while scrolling
    for (let x = -(scrollLeft % barStep); x < cssWidth; x += barStep) {
      const tStart = ((scrollLeft + x) / totalTrackWidth) * effectiveDurationMs;
      const tEnd = ((scrollLeft + x + barStep) / totalTrackWidth) * effectiveDurationMs;
      const bucketStart = Math.max(0, Math.floor(tStart / waveformIntervalMs));
      const bucketEnd = Math.min(
        waveformPeaks.length - 1,
        Math.max(bucketStart, Math.floor(tEnd / waveformIntervalMs))
      );

      let maxPeak = 0;
      for (let b = bucketStart; b <= bucketEnd; b++) {
        if (waveformPeaks[b] > maxPeak) maxPeak = waveformPeaks[b];
      }

      const normalized = Math.min(1, maxPeak / waveformPeakCeiling);
      // Restore crisp peak-to-silence contrast so quiet gaps stay thin and transients pop
      const shaped = Math.pow(normalized, 1.45);
      const barHalf = Math.max(1, Math.round(shaped * maxHalfHeight * 2) / 2);
      const barH = barHalf * 2;
      const y = midY - barHalf;

      const path = normalized < 0.12 ? quietBars : loudBars;

      if (barH <= 2) {
        path.rect(x, y, barWidth, barH);
      } else {
        path.roundRect(x, y, barWidth, barH, 1);
      }
    }

    ctx.fillStyle = '#cbd5e1';
    ctx.fill(quietBars);
    ctx.fillStyle = barGrad;
    ctx.fill(loudBars);
  }, [waveformPeaks, waveformPeakCeiling, waveformIntervalMs, effectiveDurationMs, zoomLevel, timelineViewportWidth]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  const startSpotDrag = (
    event: React.PointerEvent<HTMLElement>,
    spot: ADSpot,
    mode: SpotDragMode
  ) => {
    if (event.button !== 0 || isAnalyzing) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveDrag({
      spotId: spot.spot_id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originSpot: spot,
      previewStartMs: spot.start_ms,
      previewEndMs: spot.end_ms,
      hasMoved: false,
    });
  };

  const handleSpotDragMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.stopPropagation();
    const deltaX = event.clientX - activeDrag.startClientX;
    if (!activeDrag.hasMoved && Math.abs(deltaX) < 3) return;
    const totalTrackWidth = Math.max(1, timelineViewportWidth * zoomLevel);
    const deltaMs = (deltaX / totalTrackWidth) * effectiveDurationMs;
    const clamped = computeClampedSpotDrag(
      activeDrag.originSpot,
      activeDrag.mode,
      deltaMs,
      mode === 'review'
        ? { mode, spots, videoDurationMs: effectiveDurationMs }
        : { mode, speechSegments, videoDurationMs: effectiveDurationMs }
    );
    setActiveDrag((prev) =>
      prev
        ? {
            ...prev,
            hasMoved: true,
            previewStartMs: clamped.start_ms,
            previewEndMs: clamped.end_ms,
          }
        : null
    );
  };

  const finishSpotDrag = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = activeDrag;
    setActiveDrag(null);

    if (cancelled) return;

    if (!drag.hasMoved) {
      onSelectSpot(drag.originSpot.spot_id, true);
      seekToMs(drag.originSpot.start_ms);
      return;
    }

    const changed =
      drag.previewStartMs !== drag.originSpot.start_ms ||
      drag.previewEndMs !== drag.originSpot.end_ms;
    onSelectSpot(drag.originSpot.spot_id, false);
    if (changed) {
      onUpdateSpot({
        ...drag.originSpot,
        start_ms: drag.previewStartMs,
        end_ms: drag.previewEndMs,
        duration_ms: drag.previewEndMs - drag.previewStartMs,
        is_edited: true,
      });
      seekToMs(drag.mode === 'trim-end' ? drag.previewEndMs : drag.previewStartMs);
    }
  };

  const activeSubtitleSpot = spots.find(
    (s) =>
      s.decision === 'generate' &&
      s.text.trim().length > 0 &&
      currentTimeMs >= s.start_ms &&
      currentTimeMs <= s.end_ms
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
    const readyState = videoRef.current?.readyState ?? 0;
    setIsVideoLoading(Boolean(videoUrl) && readyState < 1);
    setIsPlaying(false);
  }, [videoUrl, videoRef]);

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

  const captionLabel = showCaptionOverlay ? 'ซ่อนบทบรรยายบนวิดีโอ' : 'แสดงบทบรรยายบนวิดีโอ';
  const muteLabel = isMuted ? 'เปิดเสียง' : 'ปิดเสียง';
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
    <section aria-label="วิดีโอและไทม์ไลน์" className="flex flex-col lg:h-full min-h-0 bg-card lg:overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col bg-stage lg:flex-1">
        <div className="relative aspect-video min-h-0 max-h-[38vh] w-full overflow-hidden lg:aspect-auto lg:max-h-none lg:flex-1">
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                src={videoUrl}
                preload="auto"
                className="w-full h-full object-contain cursor-pointer"
                playsInline
                onLoadStart={() => {
                  if ((videoRef.current?.readyState ?? 0) < 1) setIsVideoLoading(true);
                  setVideoError(null);
                }}
                onLoadedMetadata={() => { setIsVideoLoading(false); setVideoError(null); }}
                onLoadedData={() => { setIsVideoLoading(false); setVideoError(null); }}
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
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stage px-6 py-4 text-center text-white">
                  {videoError ? <AlertTriangle className="h-6 w-6 text-warning-strong-border" aria-hidden="true" /> : <Loader2 className="h-6 w-6 animate-spin text-brand-300" aria-hidden="true" />}
                  <div role={videoError ? 'alert' : 'status'} className="w-full max-w-xs space-y-2">
                    <p className="text-sm font-semibold">{videoError === 'load' ? 'ยังเปิดวิดีโอไม่ได้' : videoError === 'play' ? 'ยังเล่นวิดีโอไม่ได้' : 'กำลังโหลดวิดีโอ'}</p>
                    {!videoError && (
                      <div aria-hidden="true" className="relative mx-auto h-1 w-36 overflow-hidden rounded-full bg-white/15">
                        <div className="progress-indeterminate-primary absolute inset-0" />
                        <div className="progress-indeterminate-secondary absolute inset-0" />
                      </div>
                    )}
                    {videoError && <p className="text-xs leading-relaxed text-white/80">ยังแก้บทได้ตามปกติ แต่ควรเปิดวิดีโอเพื่อตรวจเทียบก่อนส่งออก</p>}
                  </div>
                  {videoError && <button type="button" onClick={() => {
                    if (videoError === 'play') { playVideo(); return; }
                    setVideoError(null);
                    setIsVideoLoading(true);
                    videoRef.current?.load();
                  }} className="rounded-md border border-white/30 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer">{videoError === 'load' ? 'ลองโหลดวิดีโออีกครั้ง' : 'ลองเล่นอีกครั้ง'}</button>}
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
                    className="pointer-events-auto flex max-h-[48%] max-w-[min(94%,42rem)] items-start gap-2.5 overflow-y-auto rounded-lg border border-white/15 bg-stage/80 px-3 py-2 text-left shadow-lg backdrop-blur-sm transition-colors hover:bg-stage/90 focus-visible:outline-brand-400 cursor-pointer"
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
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-white/80">
              <Film className="mb-2 h-8 w-8 text-white/50" aria-hidden="true" />
              <p className="text-sm font-medium">ยังเปิดวิดีโอไม่ได้</p>
              <p className="mt-1 text-xs">ตรวจสอบข้อความแจ้งปัญหา หรือเลือกวิดีโออีกครั้ง</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border bg-card px-3 py-2">
          <div role="group" aria-label="เล่นและเลื่อนเวลา" className="flex items-center gap-0.5">
            <WithTooltip label="ย้อนกลับ 5 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs - 5000)} disabled={!videoUrl} aria-label="ย้อนกลับ 5 วินาที" className="font-mono tabular-nums">−5s</Button></WithTooltip>
            <WithTooltip label="ย้อนกลับ 1 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs - 1000)} disabled={!videoUrl} aria-label="ย้อนกลับ 1 วินาที" className="font-mono tabular-nums">−1s</Button></WithTooltip>
            <WithTooltip label={`${isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} (Alt + P)`}>
              <Button size="icon-sm" onClick={togglePlayPause} disabled={!videoUrl} aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'}>
                {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </Button>
            </WithTooltip>
            <WithTooltip label="เดินหน้า 1 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs + 1000)} disabled={!videoUrl} aria-label="เดินหน้า 1 วินาที" className="font-mono tabular-nums">+1s</Button></WithTooltip>
            <WithTooltip label="เดินหน้า 5 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs + 5000)} disabled={!videoUrl} aria-label="เดินหน้า 5 วินาที" className="font-mono tabular-nums">+5s</Button></WithTooltip>
          </div>
          <div role="group" aria-label="เลือกช่วงบรรยาย" className="flex items-center gap-0.5 border-l border-border pl-2">
            <WithTooltip label="ช่วงก่อนหน้า (Alt + ↑)"><Button variant="ghost" size="icon-sm" onClick={() => prevSpot && onSelectSpot(prevSpot.spot_id, true)} disabled={!prevSpot} aria-label="ช่วงบรรยายก่อนหน้า"><SkipBack aria-hidden="true" /></Button></WithTooltip>
            <WithTooltip label="ช่วงถัดไป (Alt + ↓)"><Button variant="ghost" size="icon-sm" onClick={() => nextSpot && onSelectSpot(nextSpot.spot_id, true)} disabled={!nextSpot} aria-label="ช่วงบรรยายถัดไป"><SkipForward aria-hidden="true" /></Button></WithTooltip>
          </div>
          <div role="group" aria-label="ตัวเลือกการเล่น" className="flex items-center gap-0.5 sm:border-l sm:border-border sm:pl-2">
            <WithTooltip label="วนซ้ำช่วงที่เลือก"><Toggle size="icon" pressed={loopSelectedSpot} onPressedChange={setLoopSelectedSpot} disabled={!selectedSpot} aria-label="วนซ้ำช่วงที่เลือก"><Repeat aria-hidden="true" /></Toggle></WithTooltip>
            <WithTooltip label={captionLabel}><Toggle size="icon" pressed={showCaptionOverlay} onPressedChange={setShowCaptionOverlay} disabled={!videoUrl} aria-label={captionLabel}><Subtitles aria-hidden="true" /></Toggle></WithTooltip>
            <WithTooltip label={muteLabel}><Toggle size="icon" pressed={isMuted} onPressedChange={toggleMute} disabled={!videoUrl} aria-label={muteLabel}>{isMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Toggle></WithTooltip>
          </div>
          <div className="ml-auto whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
            <span className="font-semibold text-brand-950">{monitorTime(currentTimeMs)}</span><span className="mx-1.5" aria-hidden="true">/</span><span>{formatCompactTime(videoUrl ? effectiveDurationMs : 0)}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-y border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-3">
          {selectedSpot ? (
            <span className="font-semibold text-foreground tabular-nums" aria-label={`ช่วงที่เลือก ${selectedSpotIndex + 1} จาก ${spots.length}`}>
              ช่วง {selectedSpotIndex + 1}/{spots.length}
            </span>
          ) : (
            <span className="text-muted-foreground">ไทม์ไลน์</span>
          )}
          <div className="hidden xl:flex items-center gap-3 text-muted-foreground" aria-label="สถานะช่วงบรรยาย">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-brand-700" aria-hidden="true" />บรรยาย</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-warning-strong-border" aria-hidden="true" />รอ</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-xs bg-input" aria-hidden="true" />ข้าม</span>
          </div>
          {activeDrag?.hasMoved ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-foreground px-2 py-0.5 font-mono text-xs tabular-nums text-background">
              <span>{monitorTime(activeDrag.previewStartMs)} – {monitorTime(activeDrag.previewEndMs)}</span>
              <span className="text-brand-300">{((activeDrag.previewEndMs - activeDrag.previewStartMs) / 1000).toFixed(1)}s</span>
            </span>
          ) : hoverTimeMs !== null && (
            <span className="hidden sm:inline font-mono tabular-nums text-muted-foreground" aria-hidden="true">
              {monitorTime(hoverTimeMs)}
            </span>
          )}
        </div>
        <div role="group" aria-label="ซูมไทม์ไลน์" className="ml-auto flex shrink-0 items-center gap-0.5">
          {selectedSpot && selectedSpot.duration_ms / effectiveDurationMs * timelineViewportWidth * zoomLevel < 24 && zoomLevel < MAX_TIMELINE_ZOOM && (
            <Button variant="link" size="sm" onClick={() => setZoomLevel(Math.min(MAX_TIMELINE_ZOOM, Math.max(zoomLevel, 48 * effectiveDurationMs / selectedSpot.duration_ms / timelineViewportWidth)))}>ซูมช่วงนี้</Button>
          )}
          <WithTooltip label="แสดงวิดีโอทั้งเรื่องบนไทม์ไลน์"><Button variant="ghost" size="sm" onClick={() => setZoomLevel(1)} disabled={zoomLevel === 1} aria-label="แสดงไทม์ไลน์พอดีหน้าจอ">พอดี</Button></WithTooltip>
          <WithTooltip label="ย่อไทม์ไลน์"><Button variant="ghost" size="icon-sm" onClick={() => setZoomLevel((z) => Math.max(1, z > 8 ? z / 1.5 : z - 0.5))} disabled={zoomLevel <= 1} aria-label="ย่อไทม์ไลน์"><ZoomOut aria-hidden="true" /></Button></WithTooltip>
          <span className="min-w-11 text-center text-xs text-muted-foreground tabular-nums" aria-label={`ขนาดไทม์ไลน์ ${Math.round(zoomLevel * 100)} เปอร์เซ็นต์`}>{Math.round(zoomLevel * 100)}%</span>
          <WithTooltip label="ขยายไทม์ไลน์"><Button variant="ghost" size="icon-sm" onClick={() => setZoomLevel((z) => Math.min(MAX_TIMELINE_ZOOM, z >= 8 ? z * 1.5 : z + 0.5))} disabled={zoomLevel >= MAX_TIMELINE_ZOOM} aria-label="ขยายไทม์ไลน์"><ZoomIn aria-hidden="true" /></Button></WithTooltip>
        </div>
      </div>

      <div className="flex shrink-0 min-w-0 overflow-hidden bg-card">
        <div className="w-20 sm:w-24 shrink-0 whitespace-nowrap border-r border-border bg-muted/40 text-xs">
          <div className="flex h-7 items-center border-b border-border px-3 font-medium text-muted-foreground">เวลา</div>
          {showWaveformTrack && (
            <div className="flex h-14 items-center border-b border-border px-3 text-muted-foreground">คลื่นเสียง</div>
          )}
          <div className="flex h-7 items-center justify-between gap-1.5 border-b border-border px-3 text-muted-foreground"><span>เสียงพูด</span><span className="hidden shrink-0 sm:inline tabular-nums text-muted-foreground/80">{speechSegments.length}</span></div>
          <div className="flex h-14 items-center justify-between gap-1.5 px-3 font-medium text-secondary-foreground"><span>บรรยาย</span><span className="hidden shrink-0 sm:inline tabular-nums text-muted-foreground">{spots.length}</span></div>
        </div>
        <div
          ref={timelineScrollContainerRef}
          onScroll={drawWaveform}
          className="min-w-0 flex-1 overflow-x-auto select-none"
        >
          <div ref={timelineTrackRef} onClick={handleTimelineClick} onMouseMove={handleTimelineMouseMove} onMouseLeave={() => setHoverTimeMs(null)} style={{ width: `${100 * zoomLevel}%` }} className={`relative min-w-full overflow-x-clip bg-white ${activeDrag ? (activeDrag.mode === 'move' ? 'cursor-grabbing' : 'cursor-ew-resize') : effectiveDurationMs > 1 ? 'cursor-crosshair' : 'cursor-default'}`}>
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
            {showWaveformTrack && (
              <div className="relative h-14 border-b border-slate-200 bg-white">
                {waveformPeaks.length > 0 ? (
                  <canvas
                    ref={waveformCanvasRef}
                    aria-hidden="true"
                    style={{ width: `${Math.max(1, Math.floor(timelineViewportWidth))}px` }}
                    className="pointer-events-none sticky left-0 block h-full"
                  />
                ) : (
                  <div className="pointer-events-none relative h-full w-full overflow-hidden bg-gradient-to-b from-white via-brand-50/35 to-white">
                    <svg
                      aria-hidden="true"
                      className="waveform-loading-wave-slow absolute inset-y-0 left-0 h-full w-[calc(100%+240px)] blur-[2px]"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id="ad-mist-fill-back" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.16" />
                          <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.34" />
                          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.04" />
                        </linearGradient>
                        <pattern id="ad-loading-wave-soft" width="240" height="56" patternUnits="userSpaceOnUse">
                          <path
                            d="M0 30 Q 60 12, 120 30 T 240 30 L 240 56 L 0 56 Z"
                            fill="url(#ad-mist-fill-back)"
                          />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#ad-loading-wave-soft)" />
                    </svg>
                    <svg
                      aria-hidden="true"
                      className="waveform-loading-wave absolute inset-y-0 left-0 h-full w-[calc(100%+240px)] blur-[1px]"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id="ad-mist-fill-front" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.24" />
                          <stop offset="60%" stopColor="#0284c7" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
                        </linearGradient>
                        <pattern id="ad-loading-wave-main" width="240" height="56" patternUnits="userSpaceOnUse">
                          <path
                            d="M0 28 Q 60 15, 120 28 T 240 28 L 240 56 L 0 56 Z"
                            fill="url(#ad-mist-fill-front)"
                          />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#ad-loading-wave-main)" />
                    </svg>
                    <div
                      style={{ width: `${Math.max(1, Math.floor(timelineViewportWidth))}px` }}
                      className="sticky left-0 flex h-full items-center justify-center px-3"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/75 px-3 py-1 text-xs font-medium text-brand-900 backdrop-blur-xs tabular-nums">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" aria-hidden="true" />
                        <span>{detectFeedback?.title}</span>
                        {detectPercent !== undefined && <span className="font-semibold text-brand-700">{detectPercent}%</span>}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative h-7 border-b border-slate-200 bg-white">
              {isDetecting && speechSegments.length === 0 ? (
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-50/40 via-slate-50/60 to-brand-50/40" />
              ) : (
                speechSegments.map((seg, index) => (
                  <div key={index} style={{ left: `${Math.max(0, seg.start_ms / effectiveDurationMs * 100)}%`, width: `${Math.max(0.2, (seg.end_ms - seg.start_ms) / effectiveDurationMs * 100)}%` }} title={`เสียงพูด ${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)}`} className="pointer-events-none absolute top-1 bottom-1 rounded-xs bg-slate-400/75" />
                ))
              )}
            </div>
            <div className="relative h-14 bg-slate-50/40">
              {activeDrag?.hasMoved && (() => {
                const trackWidth = timelineViewportWidth * zoomLevel;
                const gapLeft = Math.max(0, (activeDrag.originSpot.original_start_ms / effectiveDurationMs) * trackWidth);
                const gapWidth = Math.max(
                  2,
                  ((activeDrag.originSpot.original_end_ms - activeDrag.originSpot.original_start_ms) / effectiveDurationMs) * trackWidth
                );
                return (
                  <div
                    aria-hidden="true"
                    style={{ left: gapLeft, width: gapWidth }}
                    className="pointer-events-none absolute top-1 bottom-1 z-10 rounded-xs border border-dashed border-brand-400 bg-brand-100/45"
                  />
                );
              })()}
              {spots.map((spot, index) => {
                const trackWidth = timelineViewportWidth * zoomLevel;
                const isDraggingThis = activeDrag?.spotId === spot.spot_id;
                const displayStartMs = isDraggingThis ? activeDrag.previewStartMs : spot.start_ms;
                const displayEndMs = isDraggingThis ? activeDrag.previewEndMs : spot.end_ms;
                const left = Math.max(0, (displayStartMs / effectiveDurationMs) * trackWidth);
                const width = Math.max(2, ((displayEndMs - displayStartMs) / effectiveDurationMs) * trackWidth);
                const padding = Math.max(0, (32 - width) / 2);
                const previous = spots[index - 1];
                const next = spots[index + 1];
                // Share the space between spots without overlapping neighboring hit targets.
                const hitLeft = Math.max(0, left - padding, previous ? (previous.end_ms + displayStartMs) / 2 / effectiveDurationMs * trackWidth : 0);
                const hitRight = Math.min(trackWidth, left + width + padding, next ? (displayEndMs + next.start_ms) / 2 / effectiveDurationMs * trackWidth : trackWidth);
                const isSelected = spot.spot_id === selectedSpotId;
                const isProcessingSpot = spot.decision === 'pending' && Boolean(processingSpotIds?.has(spot.spot_id));
                const hasIssue = issueSpotIds.has(spot.spot_id);
                const showHandles = !isAnalyzing && width >= 18;
                const colorClasses = spot.decision === 'generate'
                  ? 'bg-brand-700 group-hover:bg-brand-800 text-white border-brand-800'
                  : spot.decision === 'skip'
                  ? 'bg-slate-300 group-hover:bg-slate-400 text-slate-800 border-slate-400'
                  : isProcessingSpot
                  ? 'bg-brand-100 text-brand-900 border-brand-400'
                  : 'bg-amber-100 group-hover:bg-amber-200 text-amber-950 border-amber-400';
                return (
                  <div
                    key={spot.spot_id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`ช่วงบรรยายที่ ${index + 1} · ${formatTimestampDisplay(displayStartMs)} ถึง ${formatTimestampDisplay(displayEndMs)} · ${decisionLabels[spot.decision]}${hasIssue ? ' · มีคำเตือน' : ''}`}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        onSelectSpot(spot.spot_id, true);
                        seekToMs(spot.start_ms);
                      }
                    }}
                    onPointerDown={(event) => startSpotDrag(event, spot, 'move')}
                    onPointerMove={handleSpotDragMove}
                    onPointerUp={(event) => finishSpotDrag(event, false)}
                    onPointerCancel={(event) => finishSpotDrag(event, true)}
                    style={{ left: hitLeft, width: Math.max(2, hitRight - hitLeft) }}
                    title={`ช่วง ${index + 1} · ${formatTimestampDisplay(displayStartMs)} – ${formatTimestampDisplay(displayEndMs)} (ลากขอบเพื่อปรับเวลา หรือลากกลางเพื่อเลื่อน)${spot.text ? `\n${spot.text}` : ''}`}
                    className={`group absolute top-0 bottom-0 touch-none rounded px-0 ${isAnalyzing ? 'cursor-pointer' : isDraggingThis ? (activeDrag.mode === 'move' ? 'cursor-grabbing' : 'cursor-ew-resize') : 'cursor-grab'} ${isSelected || isDraggingThis ? 'z-20' : 'z-10'}`}
                  >
                    <span
                      style={{ left: left - hitLeft, width }}
                      className={`absolute top-1.5 bottom-1.5 flex items-center justify-center overflow-hidden rounded-xs border transition-colors ${colorClasses} ${isSelected || isDraggingThis ? 'ring-2 ring-brand-950 ring-offset-1' : hasIssue ? 'ring-2 ring-amber-500 ring-offset-1' : ''}`}
                    >
                      {isProcessingSpot && (
                        <span aria-hidden="true" className="progress-shimmer-sweep pointer-events-none absolute inset-0" />
                      )}
                      {showHandles && (
                        <span
                          aria-label={`ลากขอบซ้ายเพื่อปรับเวลาเริ่มช่วงที่ ${index + 1}`}
                          onPointerDown={(event) => startSpotDrag(event, spot, 'trim-start')}
                          onPointerMove={handleSpotDragMove}
                          onPointerUp={(event) => finishSpotDrag(event, false)}
                          onPointerCancel={(event) => finishSpotDrag(event, true)}
                          className="absolute inset-y-0 left-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center hover:bg-black/20"
                        >
                          <span className={`h-4 w-0.5 rounded-full bg-white/90 transition-opacity ${isSelected || isDraggingThis ? 'opacity-90' : 'opacity-0 group-hover:opacity-100'}`} />
                        </span>
                      )}
                      {width >= 24 && (
                        <span className="pointer-events-none truncate px-2 font-mono text-xs font-semibold tabular-nums">
                          {index + 1}
                        </span>
                      )}
                      {showHandles && (
                        <span
                          aria-label={`ลากขอบขวาเพื่อปรับเวลาจบช่วงที่ ${index + 1}`}
                          onPointerDown={(event) => startSpotDrag(event, spot, 'trim-end')}
                          onPointerMove={handleSpotDragMove}
                          onPointerUp={(event) => finishSpotDrag(event, false)}
                          onPointerCancel={(event) => finishSpotDrag(event, true)}
                          className="absolute inset-y-0 right-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center hover:bg-black/20"
                        >
                          <span className={`h-4 w-0.5 rounded-full bg-white/90 transition-opacity ${isSelected || isDraggingThis ? 'opacity-90' : 'opacity-0 group-hover:opacity-100'}`} />
                        </span>
                      )}
                    </span>
                  </div>
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
