import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Progress } from '@/components/ui/progress';
import { formatCompactTime } from '../utils/formatters';
import type { ProcessingFeedback } from '../utils/processingFeedback';
import { focusIntakeFeedback } from './IntakeShell';

const SPEC_CHECKS = ['รูปแบบไฟล์', 'ความละเอียด', 'แทร็กเสียง'] as const;

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
    <div ref={focusIntakeFeedback} tabIndex={-1} className="w-full text-left">
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
        <p className="mt-1.5 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {fileName}
        </p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">{feedback.description}</p>

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

      <div aria-hidden="true" className="mt-5 grid grid-cols-3 gap-2">
        {SPEC_CHECKS.map((label, index) => (
          <div key={label} className="min-w-0 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div
              data-slot="skeleton"
              className="soft-shimmer mt-1.5 h-3.5 w-16 max-w-full rounded bg-muted"
              style={{ '--shimmer-delay': `${index * 120}ms` } as CSSProperties}
            />
          </div>
        ))}
      </div>

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
