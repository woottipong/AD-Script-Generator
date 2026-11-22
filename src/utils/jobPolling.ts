import type { PersistedJobState } from '../types/ad';

/** What `GET /api/jobs/:jobId?view=progress` returns: the Job without its VAD output and settings. */
export type JobProgress = Pick<PersistedJobState,
  'job_id' | 'status' | 'batches' | 'spots' | 'progress_stage' | 'progress_percent' | 'active_model' | 'error_message'>;

export type JobPollEvent =
  | { type: 'snapshot'; job: JobProgress }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'start-unconfirmed'; message: string }
  | { type: 'disconnected' };

type JobPollResponse = { job?: JobProgress; isRunning?: boolean; error?: string };

export async function pollJob(options: {
  jobId: string;
  token: { aborted: boolean };
  parseResponse: (response: Response) => Promise<JobPollResponse>;
  onEvent: (event: JobPollEvent) => void;
  startError?: string;
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { jobId, token, parseResponse, onEvent } = options;
  const request = options.fetch ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let startError = options.startError;
  let consecutiveErrors = 0;
  let idlePollsWithoutRunner = 0;
  let autoResumedOnce = false;

  while (!token.aborted) {
    await wait(1400);
    if (token.aborted) return;

    try {
      const response = await request(`/api/jobs/${encodeURIComponent(jobId)}?view=progress`);
      const data = await parseResponse(response);
      if (token.aborted) return;
      if (!response.ok || data?.job?.job_id !== jobId || !Array.isArray(data.job.batches) || !Array.isArray(data.job.spots)) {
        throw new Error(data?.error || 'ไม่พบสถานะงานประมวลผลบนเซิร์ฟเวอร์');
      }

      consecutiveErrors = 0;
      const job = data.job;
      const isRunning = Boolean(data.isRunning);
      onEvent({ type: 'snapshot', job });
      if (isRunning) {
        startError = undefined;
        idlePollsWithoutRunner = 0;
        continue;
      }

      if (job.status === 'READY' || (job.batches.length > 0 && job.batches.every((batch) => batch.status === 'completed'))) {
        onEvent({ type: 'ready' });
        return;
      }
      if (job.status === 'FAILED') {
        onEvent({ type: 'failed', message: startError || job.error_message || 'เกิดข้อผิดพลาดระหว่างการวิเคราะห์วิดีโอด้วย Gemini' });
        return;
      }
      if (startError) {
        onEvent({ type: 'start-unconfirmed', message: `${startError} กำลังตรวจสถานะงานอีกครั้ง` });
      }
      idlePollsWithoutRunner++;
      if (idlePollsWithoutRunner >= 2 && !autoResumedOnce) {
        autoResumedOnce = true;
        idlePollsWithoutRunner = 0;
        await request(`/api/jobs/${encodeURIComponent(jobId)}/start`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    } catch {
      if (token.aborted) return;
      consecutiveErrors++;
      if (consecutiveErrors === 6) onEvent({ type: 'disconnected' });
      await wait(1500);
    }
  }
}
