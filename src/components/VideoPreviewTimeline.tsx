import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Film,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';
import { SimpleTooltip } from '@/components/ui/tooltip';

const decisionLabels = { generate: 'มีบทบรรยาย', pending: 'รอสร้าง', skip: 'ข้าม' };
const monitorTime = (ms: number) => formatTimestampDisplay(ms).replace(/^00:/, '');
const MAX_TIMELINE_ZOOM = 64;

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
  editableSpotIds?: ReadonlySet<string>;
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
  editableSpotIds,
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

    // Clean 1px center baseline (silence stays a crisp continuous hairline without beaded dots)
    const midY = cssHeight / 2;
    ctx.fillStyle = 'rgba(203, 213, 225, 0.7)';
    ctx.fillRect(0, Math.round(midY) - 0.5, cssWidth, 1);

    // High-resolution Retina bars (1.5px bar + 1.5px gap, integer-snapped for crisp edges)
    const barStep = 3;
    const barWidth = 1.5;
    const maxHalfHeight = midY - 3;

    const ambientGrad = ctx.createLinearGradient(0, 3, 0, cssHeight - 3);
    ambientGrad.addColorStop(0, 'rgba(125, 211, 252, 0.85)');
    ambientGrad.addColorStop(0.5, 'rgba(3, 105, 161, 0.82)');
    ambientGrad.addColorStop(1, 'rgba(125, 211, 252, 0.85)');

    const speechGrad = ctx.createLinearGradient(0, 3, 0, cssHeight - 3);
    speechGrad.addColorStop(0, 'rgba(165, 180, 252, 0.92)');
    speechGrad.addColorStop(0.5, 'rgba(79, 70, 229, 0.92)');
    speechGrad.addColorStop(1, 'rgba(165, 180, 252, 0.92)');

    // One path per fill style: three fill() calls per frame instead of one per bar
    const quietBars = new Path2D();
    const ambientBars = new Path2D();
    const speechBars = new Path2D();

    let segIndex = 0;
    const offset = Math.floor(scrollLeft) % barStep;

    // Anchor bars to integer timeline pixels so edges stay sharp while scrolling
    for (let x = -offset; x < cssWidth; x += barStep) {
      const px = Math.round(x);
      const tStart = ((scrollLeft + px) / totalTrackWidth) * effectiveDurationMs;
      const tEnd = ((scrollLeft + px + barStep) / totalTrackWidth) * effectiveDurationMs;
      const bucketStart = Math.max(0, Math.floor(tStart / waveformIntervalMs));
      const bucketEnd = Math.min(
        waveformPeaks.length - 1,
        Math.max(bucketStart, Math.floor(tEnd / waveformIntervalMs))
      );

      let maxPeak = 0;
      for (let b = bucketStart; b <= bucketEnd; b++) {
        if (waveformPeaks[b] > maxPeak) maxPeak = waveformPeaks[b];
      }

      while (segIndex < speechSegments.length && speechSegments[segIndex].end_ms <= tStart) {
        segIndex++;
      }
      const inSpeech = segIndex < speechSegments.length && speechSegments[segIndex].start_ms < tEnd;

      const normalized = Math.min(1, maxPeak / waveformPeakCeiling);
      if (normalized < 0.04) continue;

      // Sharper dynamic curve so transients and micro-pauses read clearly
      const shaped = Math.pow(normalized, 1.55);
      const barHalf = Math.round(shaped * maxHalfHeight * 2) / 2;
      if (barHalf < 1) continue;

      const barH = barHalf * 2;
      const y = midY - barHalf;

      const path = normalized < 0.09 ? quietBars : inSpeech ? speechBars : ambientBars;

      if (barH <= 2) {
        path.rect(px, y, barWidth, barH);
      } else {
        path.roundRect(px, y, barWidth, barH, 0.75);
      }
    }

    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.fill(quietBars);
    ctx.fillStyle = ambientGrad;
    ctx.fill(ambientBars);
    ctx.fillStyle = speechGrad;
    ctx.fill(speechBars);
  }, [waveformPeaks, waveformPeakCeiling, waveformIntervalMs, effectiveDurationMs, zoomLevel, timelineViewportWidth, speechSegments]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  const startSpotDrag = (
    event: React.PointerEvent<HTMLElement>,
    spot: ADSpot,
    mode: SpotDragMode
  ) => {
    if (event.button !== 0 || isAnalyzing) return;
    if (editableSpotIds?.has(spot.spot_id) === false) {
      event.stopPropagation();
      onSelectSpot(spot.spot_id, true);
      return;
    }
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
                className="size-full object-contain cursor-pointer"
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
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stage px-6 py-4 text-center text-stage-foreground">
                  {videoError ? <AlertTriangle className="size-6 text-warning-strong-border" aria-hidden="true" /> : <Spinner className="size-6 text-brand-300" aria-hidden="true" />}
                  <div role={videoError ? 'alert' : 'status'} className="flex w-full max-w-xs flex-col gap-2">
                    <p className="text-sm font-semibold">{videoError === 'load' ? 'ยังเปิดวิดีโอไม่ได้' : videoError === 'play' ? 'ยังเล่นวิดีโอไม่ได้' : 'กำลังโหลดวิดีโอ'}</p>
                    {!videoError && (
                      <div aria-hidden="true" className="relative mx-auto h-1 w-36 overflow-hidden rounded-full bg-stage-foreground/15">
                        <div className="progress-indeterminate-primary absolute inset-0" />
                        <div className="progress-indeterminate-secondary absolute inset-0" />
                      </div>
                    )}
                    {videoError && <p className="text-xs leading-relaxed text-stage-foreground/80">ยังแก้บทได้ตามปกติ แต่ควรเปิดวิดีโอเพื่อตรวจเทียบก่อนส่งออก</p>}
                  </div>
                  {videoError && <button type="button" onClick={() => {
                    if (videoError === 'play') { playVideo(); return; }
                    setVideoError(null);
                    setIsVideoLoading(true);
                    videoRef.current?.load();
                  }} className="rounded-md border border-stage-foreground/30 px-3 py-2 text-xs font-semibold text-stage-foreground hover:bg-stage-foreground/10 cursor-pointer">{videoError === 'load' ? 'ลองโหลดวิดีโออีกครั้ง' : 'ลองเล่นอีกครั้ง'}</button>}
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
                    className="pointer-events-auto flex max-h-[48%] max-w-[min(94%,42rem)] items-start gap-2.5 overflow-y-auto rounded-lg border border-stage-foreground/15 bg-stage/80 px-3 py-2 text-left shadow-lg backdrop-blur-sm transition-colors hover:bg-stage/90 focus-visible:outline-brand-400 cursor-pointer"
                  >
                    <span className="mt-0.5 shrink-0 rounded bg-brand-600 px-1.5 py-0.5 text-xs font-semibold leading-none tracking-wide text-primary-foreground tabular-nums">
                      AD {spots.indexOf(activeSubtitleSpot) + 1}
                    </span>
                    <p className="min-w-0 text-xs sm:text-sm font-medium leading-relaxed text-stage-foreground [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]">
                      {activeSubtitleSpot.text}
                    </p>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-stage-foreground/80">
              <Film className="mb-2 size-8 text-stage-foreground/50" aria-hidden="true" />
              <p className="text-sm font-medium">ยังเปิดวิดีโอไม่ได้</p>
              <p className="mt-1 text-xs">ตรวจสอบข้อความแจ้งปัญหา หรือเลือกวิดีโออีกครั้ง</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border bg-card px-3 py-2">
          <div role="group" aria-label="เล่นและเลื่อนเวลา" className="flex items-center gap-0.5">
            <SimpleTooltip label="ย้อนกลับ 5 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs - 5000)} disabled={!videoUrl} aria-label="ย้อนกลับ 5 วินาที" className="px-2 font-mono text-muted-foreground tabular-nums not-disabled:hover:text-foreground">−5s</Button></SimpleTooltip>
            <SimpleTooltip label="ย้อนกลับ 1 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs - 1000)} disabled={!videoUrl} aria-label="ย้อนกลับ 1 วินาที" className="px-2 font-mono text-muted-foreground tabular-nums not-disabled:hover:text-foreground">−1s</Button></SimpleTooltip>
            <SimpleTooltip label={`${isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} (Alt + P)`}>
              <Button size="icon-sm" onClick={togglePlayPause} disabled={!videoUrl} aria-label={isPlaying ? 'หยุดชั่วคราว' : 'เล่นวิดีโอ'} className="mx-0.5">
                {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </Button>
            </SimpleTooltip>
            <SimpleTooltip label="เดินหน้า 1 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs + 1000)} disabled={!videoUrl} aria-label="เดินหน้า 1 วินาที" className="px-2 font-mono text-muted-foreground tabular-nums not-disabled:hover:text-foreground">+1s</Button></SimpleTooltip>
            <SimpleTooltip label="เดินหน้า 5 วินาที"><Button variant="ghost" size="sm" onClick={() => seekToMs(currentTimeMs + 5000)} disabled={!videoUrl} aria-label="เดินหน้า 5 วินาที" className="px-2 font-mono text-muted-foreground tabular-nums not-disabled:hover:text-foreground">+5s</Button></SimpleTooltip>
          </div>
          <div role="group" aria-label="เลือกช่วงบรรยาย" className="flex items-center gap-0.5 border-l border-border pl-2">
            <SimpleTooltip label="ช่วงก่อนหน้า (Alt + ↑)"><Button variant="ghost" size="icon-sm" onClick={() => prevSpot && onSelectSpot(prevSpot.spot_id, true)} disabled={!prevSpot} aria-label="ช่วงบรรยายก่อนหน้า" className="text-muted-foreground not-disabled:hover:text-foreground"><SkipBack aria-hidden="true" /></Button></SimpleTooltip>
            <SimpleTooltip label="ช่วงถัดไป (Alt + ↓)"><Button variant="ghost" size="icon-sm" onClick={() => nextSpot && onSelectSpot(nextSpot.spot_id, true)} disabled={!nextSpot} aria-label="ช่วงบรรยายถัดไป" className="text-muted-foreground not-disabled:hover:text-foreground"><SkipForward aria-hidden="true" /></Button></SimpleTooltip>
          </div>
          <div role="group" aria-label="ตัวเลือกการเล่น" className="flex items-center gap-0.5 sm:border-l sm:border-border sm:pl-2">
            <SimpleTooltip label="วนซ้ำช่วงที่เลือก"><Toggle variant="soft" size="icon" pressed={loopSelectedSpot} onPressedChange={setLoopSelectedSpot} disabled={!selectedSpot} aria-label="วนซ้ำช่วงที่เลือก"><Repeat aria-hidden="true" /></Toggle></SimpleTooltip>
            <SimpleTooltip label={captionLabel}><Toggle variant="soft" size="icon" pressed={showCaptionOverlay} onPressedChange={setShowCaptionOverlay} disabled={!videoUrl} aria-label={captionLabel}><Subtitles aria-hidden="true" /></Toggle></SimpleTooltip>
            <SimpleTooltip label={muteLabel}><Toggle variant="soft" size="icon" pressed={isMuted} onPressedChange={toggleMute} disabled={!videoUrl} aria-label={muteLabel}>{isMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Toggle></SimpleTooltip>
          </div>
          <div className="ml-auto rounded-md bg-muted/60 px-2.5 py-1 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
            <span className="font-semibold text-brand-950">{monitorTime(currentTimeMs)}</span><span className="mx-1.5 text-muted-foreground/70" aria-hidden="true">/</span><span>{formatCompactTime(videoUrl ? effectiveDurationMs : 0)}</span>
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
          {(() => {
            const legendItems = [
              spots.some((s) => s.decision === 'generate') && { key: 'generate', label: 'บรรยาย', swatch: 'bg-brand-700' },
              spots.some((s) => s.decision === 'pending') && { key: 'pending', label: 'รอ', swatch: 'border border-warning-strong-border bg-warning-strong' },
              spots.some((s) => s.decision === 'skip') && { key: 'skip', label: 'ข้าม', swatch: 'border border-slate-400 bg-slate-300' },
            ].filter(Boolean) as { key: string; label: string; swatch: string }[];
            return legendItems.length > 1 ? (
              <div className="hidden xl:flex items-center gap-3 text-muted-foreground" aria-label="สถานะช่วงบรรยาย">
                {legendItems.map((item) => (
                  <span key={item.key} className="inline-flex items-center gap-1.5">
                    <span className={`size-2.5 rounded-[3px] ${item.swatch}`} aria-hidden="true" />
                    {item.label}
                  </span>
                ))}
              </div>
            ) : null;
          })()}
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
        <div role="group" aria-label="ซูมไทม์ไลน์" className="ml-auto flex shrink-0 items-center gap-1.5">
          {selectedSpot && selectedSpot.duration_ms / effectiveDurationMs * timelineViewportWidth * zoomLevel < 24 && zoomLevel < MAX_TIMELINE_ZOOM && (
            <Button variant="link" size="sm" onClick={() => setZoomLevel(Math.min(MAX_TIMELINE_ZOOM, Math.max(zoomLevel, 48 * effectiveDurationMs / selectedSpot.duration_ms / timelineViewportWidth)))}>ซูมช่วงนี้</Button>
          )}
          {zoomLevel > 1 && (
            <SimpleTooltip label="แสดงวิดีโอทั้งเรื่องบนไทม์ไลน์"><Button variant="ghost" size="xs" onClick={() => setZoomLevel(1)} aria-label="แสดงไทม์ไลน์พอดีหน้าจอ" className="h-7 px-2 text-muted-foreground hover:text-foreground">พอดี</Button></SimpleTooltip>
          )}
          <div className="inline-flex items-center rounded-lg border border-border/70 bg-background p-0.5">
            <SimpleTooltip label="ย่อไทม์ไลน์"><Button variant="ghost" size="icon-xs" onClick={() => setZoomLevel((z) => Math.max(1, z > 8 ? z / 1.5 : z - 0.5))} disabled={zoomLevel <= 1} aria-label="ย่อไทม์ไลน์" className="size-6 text-muted-foreground not-disabled:hover:text-foreground"><ZoomOut aria-hidden="true" /></Button></SimpleTooltip>
            <span className="min-w-11 text-center font-mono text-xs text-muted-foreground tabular-nums" aria-label={`ขนาดไทม์ไลน์ ${Math.round(zoomLevel * 100)} เปอร์เซ็นต์`}>{Math.round(zoomLevel * 100)}%</span>
            <SimpleTooltip label="ขยายไทม์ไลน์"><Button variant="ghost" size="icon-xs" onClick={() => setZoomLevel((z) => Math.min(MAX_TIMELINE_ZOOM, z >= 8 ? z * 1.5 : z + 0.5))} disabled={zoomLevel >= MAX_TIMELINE_ZOOM} aria-label="ขยายไทม์ไลน์" className="size-6 text-muted-foreground not-disabled:hover:text-foreground"><ZoomIn aria-hidden="true" /></Button></SimpleTooltip>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 min-w-0 overflow-hidden bg-card">
        <div className="w-20 sm:w-24 shrink-0 whitespace-nowrap border-r border-border bg-muted/40 text-xs">
          <div className="flex h-7 items-center border-b border-border px-3 font-medium text-muted-foreground">เวลา</div>
          {showWaveformTrack && (
            <div className="flex h-14 items-center border-b border-border px-3 text-muted-foreground">คลื่นเสียง</div>
          )}
          <div className="flex h-7 items-center justify-between gap-1.5 border-b border-border px-3 text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full bg-speech-dot" aria-hidden="true" />เสียงพูด</span>
            <span className="hidden shrink-0 sm:inline tabular-nums text-muted-foreground">{speechSegments.length}</span>
          </div>
          <div className="flex h-14 items-center justify-between gap-1.5 px-3 font-medium text-secondary-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 shrink-0 rounded-full bg-brand-700" aria-hidden="true" />บรรยาย</span>
            <span className="hidden shrink-0 sm:inline tabular-nums text-muted-foreground">{spots.length}</span>
          </div>
        </div>
        <div
          ref={timelineScrollContainerRef}
          onScroll={drawWaveform}
          className="min-w-0 flex-1 overflow-x-auto select-none"
        >
          <div ref={timelineTrackRef} onClick={handleTimelineClick} onMouseMove={handleTimelineMouseMove} onMouseLeave={() => setHoverTimeMs(null)} style={{ width: `${100 * zoomLevel}%` }} className={`relative min-w-full overflow-x-clip bg-card ${activeDrag ? (activeDrag.mode === 'move' ? 'cursor-grabbing' : 'cursor-ew-resize') : effectiveDurationMs > 1 ? 'cursor-crosshair' : 'cursor-default'}`}>
            {ticks.slice(1, -1).map((tickMs, idx) => (
              <div
                key={`grid-${idx}`}
                aria-hidden="true"
                style={{ left: `${tickMs / effectiveDurationMs * 100}%` }}
                className="pointer-events-none absolute top-7 bottom-0 z-[1] w-px bg-border/50"
              />
            ))}
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
              className="relative h-7 border-b border-border bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
            >
              {ticks.map((tickMs, idx) => (
                <div key={idx} style={{ left: `${tickMs / effectiveDurationMs * 100}%` }} className="pointer-events-none absolute top-0 bottom-0 w-0">
                  <div className="h-1.5 w-px bg-input" />
                  <span className={`absolute bottom-1 whitespace-nowrap font-mono text-xs text-slate-500 tabular-nums ${idx === 0 ? 'translate-x-2' : idx === ticks.length - 1 ? '-translate-x-full pr-2' : '-translate-x-1/2'}`}>{formatCompactTime(tickMs)}</span>
                </div>
              ))}
            </div>
            {showWaveformTrack && (
              <div className="relative h-14 border-b border-border bg-gradient-to-b from-surface-subtle/70 via-card to-surface-subtle/70">
                {waveformPeaks.length > 0 ? (
                  <canvas
                    ref={waveformCanvasRef}
                    aria-hidden="true"
                    style={{ width: `${Math.max(1, Math.floor(timelineViewportWidth))}px` }}
                    className="pointer-events-none sticky left-0 block h-full"
                  />
                ) : (
                  <div className="pointer-events-none relative size-full overflow-hidden bg-gradient-to-b from-surface-subtle/70 via-card to-surface-subtle/70">
                    <div aria-hidden="true" className="absolute inset-0 flex items-center justify-between gap-1 px-3 opacity-80">
                      {[24, 38, 18, 44, 30, 52, 22, 40, 28, 48, 20, 34, 46, 26, 36, 50, 20, 42, 30, 44, 24, 38, 48, 22, 34, 42, 26, 36, 20, 40, 28, 46].map((pct, idx) => (
                        <Skeleton
                          key={idx}
                          variant="shimmer"
                          delay={(idx % 8) * 70}
                          style={{ height: `${pct}%` }}
                          className="w-1 flex-1 rounded-full bg-border/80"
                        />
                      ))}
                    </div>
                    <div
                      style={{ width: `${Math.max(1, Math.floor(timelineViewportWidth))}px` }}
                      className="sticky left-0 flex h-full items-center justify-center px-3"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200/80 bg-card/90 px-3 py-1 text-xs font-medium text-brand-900 shadow-xs backdrop-blur-xs tabular-nums">
                        <Spinner className="size-3.5 text-brand-600" aria-hidden="true" />
                        <span>{detectFeedback?.title}</span>
                        {detectPercent !== undefined && <span className="font-semibold text-brand-700">{detectPercent}%</span>}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative h-7 border-b border-border bg-speech-surface/25">
              {isDetecting && speechSegments.length === 0 ? (
                [
                  { left: '4%', width: '12%', delay: 0 },
                  { left: '22%', width: '16%', delay: 140 },
                  { left: '44%', width: '10%', delay: 280 },
                  { left: '61%', width: '18%', delay: 420 },
                  { left: '84%', width: '11%', delay: 560 },
                ].map((capsule, idx) => (
                  <Skeleton
                    key={idx}
                    variant="shimmer"
                    delay={capsule.delay}
                    aria-hidden="true"
                    style={{ left: capsule.left, width: capsule.width }}
                    className="pointer-events-none absolute top-1 bottom-1 rounded-[4px] bg-muted"
                  />
                ))
              ) : (
                speechSegments.map((seg, index) => (
                  <div key={index} style={{ left: `${Math.max(0, seg.start_ms / effectiveDurationMs * 100)}%`, width: `${Math.max(0.2, (seg.end_ms - seg.start_ms) / effectiveDurationMs * 100)}%` }} title={`เสียงพูด ${formatTimestampDisplay(seg.start_ms)} – ${formatTimestampDisplay(seg.end_ms)}`} className="pointer-events-none absolute top-1 bottom-1 rounded-[4px] border border-speech-border/90 bg-speech-capsule/90" />
                ))
              )}
            </div>
            <div className="relative h-14 bg-surface-subtle/40">
              {isDetecting && spots.length === 0 && [
                { left: '16%', width: '7%', delay: 100 },
                { left: '38%', width: '7%', delay: 260 },
                { left: '79%', width: '6%', delay: 420 },
              ].map((block, idx) => (
                <Skeleton
                  key={idx}
                  variant="shimmer"
                  delay={block.delay}
                  aria-hidden="true"
                  style={{ left: block.left, width: block.width }}
                  className="pointer-events-none absolute top-1.5 bottom-1.5 rounded-sm border border-brand-200/70 bg-brand-50/80"
                />
              ))}
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
                const editingDisabled = isAnalyzing || editableSpotIds?.has(spot.spot_id) === false;
                const showHandles = !editingDisabled && width >= 18;
                const colorClasses = spot.decision === 'generate'
                  ? 'bg-brand-700 group-hover:bg-brand-800 text-primary-foreground border-brand-800'
                  : spot.decision === 'skip'
                  ? 'bg-slate-300 group-hover:bg-slate-400 text-slate-800 border-slate-400'
                  : isProcessingSpot
                  ? 'bg-brand-100 text-brand-900 border-brand-400'
                  : 'bg-warning-strong group-hover:brightness-95 text-warning-strong-foreground border-warning-strong-border';
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
                    title={`ช่วง ${index + 1} · ${formatTimestampDisplay(displayStartMs)} – ${formatTimestampDisplay(displayEndMs)}${editingDisabled ? '' : ' (ลากขอบเพื่อปรับเวลา หรือลากกลางเพื่อเลื่อน)'}${spot.text ? `\n${spot.text}` : ''}`}
                    className={`group absolute top-0 bottom-0 touch-none rounded px-0 ${editingDisabled ? 'cursor-pointer' : isDraggingThis ? (activeDrag.mode === 'move' ? 'cursor-grabbing' : 'cursor-ew-resize') : 'cursor-grab'} ${isSelected || isDraggingThis ? 'z-20' : 'z-10'}`}
                  >
                    <span
                      style={{ left: left - hitLeft, width }}
                      className={`absolute top-1.5 bottom-1.5 flex items-center justify-center overflow-hidden rounded-sm border transition-colors ${colorClasses} ${isSelected || isDraggingThis ? 'ring-2 ring-brand-900/90 ring-offset-1 shadow-xs' : hasIssue ? 'ring-2 ring-amber-500 ring-offset-1' : ''}`}
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
                          <span className={`h-4 w-1 rounded-full bg-white/95 transition-opacity ${isSelected || isDraggingThis ? 'opacity-95' : 'opacity-0 group-hover:opacity-100'}`} />
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
                          <span className={`h-4 w-1 rounded-full bg-white/95 transition-opacity ${isSelected || isDraggingThis ? 'opacity-95' : 'opacity-0 group-hover:opacity-100'}`} />
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ left: `${playheadPercent}%` }} className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-red-600"><div className="-mt-0.5 -ml-1 size-2.5 rotate-45 bg-red-600" /></div>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
};
