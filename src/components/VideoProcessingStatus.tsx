import { useEffect, useState } from 'react';
import { Check, CheckCircle2, FileVideo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { formatCompactTime } from '../utils/formatters';
import type { ProcessingFeedback } from '../utils/processingFeedback';
import { focusIntakeFeedback } from './IntakeShell';

/** Overview of the hand-off: steps[0] is the file check, steps[1] opens the editor. */
export type IntakeStep = { label: string };

const STEP_STATE_TEXT = { done: 'เสร็จแล้ว', active: 'กำลังทำ', pending: 'ถัดไป' } as const;

export function VideoProcessingStatus({
  feedback,
  fileName,
  steps,
  passed,
  onCancel,
}: {
  feedback: ProcessingFeedback;
  fileName?: string;
  steps: readonly IntakeStep[];
  passed: boolean;
  onCancel: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (passed) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [passed]);

  const percent = passed ? 100 : feedback.percent !== undefined && feedback.percent > 0 ? Math.min(100, feedback.percent) : null;
  const activeStep = passed ? 1 : 0;

  return (
    <div
      ref={focusIntakeFeedback}
      tabIndex={-1}
      className="w-full text-left motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {passed ? (
          <CheckCircle2
            aria-hidden="true"
            className="size-5 shrink-0 text-success-accent motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:fade-in-0 motion-safe:duration-200"
          />
        ) : (
          <Spinner aria-hidden="true" className="size-5 shrink-0 text-primary" />
        )}
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

      <ol aria-label="ขั้นตอน" className="mt-5 flex flex-col gap-3">
        {steps.map((step, index) => {
          const state = index < activeStep ? 'done' : index === activeStep ? 'active' : 'pending';
          return (
            <li key={step.label} aria-current={state === 'active' ? 'step' : undefined} className="relative flex items-start gap-3">
              {index < steps.length - 1 && (
                <span aria-hidden="true" className="absolute top-6 -bottom-2.5 left-2.5 w-px -translate-x-1/2 bg-border" />
              )}
              <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
                {state === 'done' ? (
                  <Check className="size-4 text-success-accent motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in-0 motion-safe:duration-200" />
                ) : state === 'active' ? (
                  <span className="size-2 rounded-full bg-primary ring-4 ring-brand-100 motion-safe:animate-pulse" />
                ) : (
                  <span className="size-2 rounded-full border border-muted-foreground/50" />
                )}
              </span>
              <p
                className={`min-w-0 pt-px text-sm leading-snug transition-colors duration-200 ${
                  state === 'active' ? 'font-medium text-foreground' : state === 'done' ? 'text-foreground/75' : 'text-muted-foreground'
                }`}
              >
                {step.label}
                <span className="sr-only"> ({STEP_STATE_TEXT[state]})</span>
              </p>
            </li>
          );
        })}
      </ol>

      <div className="-mx-5 -mb-5 mt-6 flex flex-wrap items-center justify-between gap-2.5 border-t border-border bg-muted/35 px-5 py-4 sm:-mx-7 sm:-mb-7 sm:px-7">
        <p className="text-xs text-muted-foreground">{passed ? 'ตรวจบนเครื่องของคุณเสร็จแล้ว' : 'กำลังตรวจสอบบนเครื่องของคุณ'}</p>
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
