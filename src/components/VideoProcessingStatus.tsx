import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatCompactTime } from '../utils/formatters';
import type { ProcessingFeedback } from '../utils/processingFeedback';

export function VideoProcessingStatus({ feedback }: { feedback: ProcessingFeedback }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [feedback.title]);

  return (
    <div className="w-full max-w-lg mx-auto rounded-xl border border-brand-200 bg-brand-50 p-4 sm:p-6 text-left">
      <div className="flex items-center gap-3">
        <Loader2 className="w-6 h-6 shrink-0 animate-spin text-brand-700" aria-hidden="true" />
        <h2 className="min-w-0 text-lg sm:text-xl font-semibold leading-snug text-slate-900">
          <span role="status">{feedback.title}</span>
        </h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-brand-900">{feedback.description}</p>
      {(feedback.detail || feedback.percent !== undefined) && <div className="mt-5 flex items-end justify-between gap-3 text-sm text-brand-900 tabular-nums">
        {feedback.detail && <p className="min-w-0 leading-relaxed">{feedback.detail}</p>}
        {feedback.percent !== undefined && <span className="ml-auto shrink-0 text-3xl font-semibold leading-none text-brand-800">{feedback.percent}%</span>}
      </div>}
      <div className="mt-3">
        <div
          role="progressbar"
          aria-label={feedback.title}
          aria-valuenow={feedback.percent}
          aria-valuetext={feedback.percent !== undefined ? `${feedback.percent}%${feedback.detail ? ` · ${feedback.detail}` : ''}` : feedback.description}
          aria-valuemin={0}
          aria-valuemax={100}
          className="relative h-2 overflow-hidden rounded-full bg-brand-100"
        >
          {feedback.percent !== undefined && feedback.percent > 0 ? (
            <div
              className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, feedback.percent)}%` }}
            >
              <div className="progress-shimmer-sweep absolute inset-0" />
            </div>
          ) : (
            <>
              <div className="progress-indeterminate-primary absolute inset-0" />
              <div className="progress-indeterminate-secondary absolute inset-0" />
            </>
          )}
        </div>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-brand-900">
        <span>เวลาที่ใช้ในช่วงนี้</span><span className="tabular-nums">{formatCompactTime(elapsedMs)}</span>
      </p>
    </div>
  );
}
