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
    <div className="w-full max-w-lg mx-auto rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:p-6 text-left">
      <div className="flex items-center gap-3">
        <Loader2 className="w-6 h-6 shrink-0 animate-spin text-emerald-700" aria-hidden="true" />
        <h2 className="min-w-0 text-lg sm:text-xl font-semibold leading-snug text-slate-900">
          <span role="status">{feedback.title}</span>
        </h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-emerald-900">{feedback.description}</p>
      {(feedback.detail || feedback.percent !== undefined) && <div className="mt-5 flex items-end justify-between gap-3 text-sm text-emerald-900 tabular-nums">
        {feedback.detail && <p className="min-w-0 leading-relaxed">{feedback.detail}</p>}
        {feedback.percent !== undefined && <span className="ml-auto shrink-0 text-3xl font-semibold leading-none text-emerald-800">{feedback.percent}%</span>}
      </div>}
      {feedback.percent !== undefined && (
        <div className="mt-3">
          <div role="progressbar" aria-label={feedback.title} aria-valuenow={feedback.percent} aria-valuetext={`${feedback.percent}%${feedback.detail ? ` · ${feedback.detail}` : ''}`} aria-valuemin={0} aria-valuemax={100} className="h-3 overflow-hidden rounded-full bg-emerald-100">
            <div className="h-full origin-left rounded-full bg-emerald-600 transition-transform duration-200" style={{ transform: `scaleX(${feedback.percent / 100})` }} />
          </div>
        </div>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-900">
        <span>เวลาที่ใช้ในช่วงนี้</span><span className="tabular-nums">{formatCompactTime(elapsedMs)}</span>
      </p>
    </div>
  );
}
