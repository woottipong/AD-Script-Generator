import { useEffect, useState } from 'react';
import { FileVideo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { formatCompactTime } from '../utils/formatters';
import type { ProcessingFeedback } from '../utils/processingFeedback';
import { focusIntakeFeedback } from './IntakeShell';

/** Header-only MP4 checks usually finish well under this, so the status screen would only flash. */
const REVEAL_DELAY_MS = 300;

/** True once `checking` has stayed on for REVEAL_DELAY_MS; callers keep the form (inert) until then. */
export function useRevealSlowCheck(checking: boolean): boolean {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
    if (!checking) return;
    const timer = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [checking]);
  return checking && revealed;
}

export function VideoProcessingStatus({
  feedback,
  fileName,
  onCancel,
}: {
  feedback: ProcessingFeedback;
  fileName?: string;
  onCancel: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [feedback.title]);

  const percent = feedback.percent !== undefined && feedback.percent > 0 ? Math.min(100, feedback.percent) : null;

  return (
    <div
      ref={focusIntakeFeedback}
      tabIndex={-1}
      className="w-full text-left motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <Spinner aria-hidden="true" className="size-5 shrink-0 text-primary" />
        <h2 className="min-w-0 text-base sm:text-lg font-semibold leading-snug text-foreground">
          <span role="status">{feedback.title}</span>
        </h2>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          เวลาที่ใช้ {formatCompactTime(elapsedMs)}
        </span>
      </div>

      {fileName && (
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border border-border/75 bg-surface-subtle/80 px-3 py-2">
          <FileVideo aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium text-foreground" title={fileName}>
            {fileName}
          </span>
        </div>
      )}
      <p className="mt-2 text-sm text-muted-foreground">{feedback.description}</p>

      <Progress
        className="mt-4"
        value={percent}
        aria-label={feedback.title}
        getAriaValueText={() => (feedback.percent !== undefined ? `${feedback.percent}%${feedback.detail ? ` · ${feedback.detail}` : ''}` : feedback.description)}
      />
      {(feedback.detail || feedback.percent !== undefined) && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
          {feedback.detail && <p className="min-w-0">{feedback.detail}</p>}
          {feedback.percent !== undefined && (
            <span className="ml-auto shrink-0 font-medium text-foreground">{feedback.percent}%</span>
          )}
        </div>
      )}

      <div className="-mx-5 -mb-5 mt-6 flex flex-wrap items-center justify-between gap-2.5 border-t border-border bg-muted/35 px-5 py-4 sm:-mx-7 sm:-mb-7 sm:px-7">
        <p className="text-xs text-muted-foreground">กำลังตรวจสอบบนเครื่องของคุณ</p>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onCancel}
          className="h-auto min-h-10 py-2 pointer-coarse:min-h-11"
        >
          ยกเลิกการตรวจไฟล์
        </Button>
      </div>
    </div>
  );
}
