import type { PersistedJobState } from '../types/ad';

export type JobPollEvent =
  | { type: 'snapshot'; job: PersistedJobState }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'start-unconfirmed'; message: string }
  | { type: 'disconnected' };

type JobPollResponse = { job?: PersistedJobState; isRunning?: boolean; error?: string };

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
      const response = await request(`/api/jobs/${encodeURIComponent(jobId)}`);
      const data = await parseResponse(response);
      if (token.aborted) return;
      if (!response.ok || data?.job?.job_id !== jobId || !Array.isArray(data.job.batches) || !Array.isArray(data.job.spots)) {
        throw new Error(data?.error || 'ไม่พบสถานะงานประมวลผลบนเซิร์ฟเวอร์');
      }

      consecutiveErrors = 0;
      const job = data.job;
      const isRunning = Boolean(data.isRunning);
      if (isRunning) startError = undefined;
      onEvent({ type: 'snapshot', job });

      if (job.status === 'READY' || (job.batches.length > 0 && job.batches.every((batch) => batch.status === 'completed'))) {
        onEvent({ type: 'ready' });
        return;
      }
      if (job.status === 'FAILED') {
        onEvent({ type: 'failed', message: startError || job.error_message || 'เกิดข้อผิดพลาดระหว่างการวิเคราะห์วิดีโอด้วย Gemini' });
        return;
      }
      if (!isRunning && startError) {
        onEvent({ type: 'start-unconfirmed', message: `${startError} กำลังตรวจสถานะงานอีกครั้ง` });
      }
      if (!isRunning) {
        idlePollsWithoutRunner++;
        if (idlePollsWithoutRunner >= 2 && !autoResumedOnce) {
          autoResumedOnce = true;
          idlePollsWithoutRunner = 0;
          await request(`/api/jobs/${encodeURIComponent(jobId)}/start`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
          }).catch(() => {});
        }
      } else {
        idlePollsWithoutRunner = 0;
      }
    } catch {
      if (token.aborted) return;
      consecutiveErrors++;
      if (consecutiveErrors === 6) onEvent({ type: 'disconnected' });
      await wait(1500);
    }
  }
}
