import type { ADSpot, PersistedJobState } from '../types/ad';

export type JobSaveStatus = 'saving' | 'saved' | 'error';

export function createJobSaveQueue(
  onStatus: (status: JobSaveStatus) => void,
  request: typeof fetch = fetch,
) {
  let queue: Promise<boolean | void> = Promise.resolve();
  let generation = 0;

  return {
    invalidate() {
      generation++;
      // Saves already sent still finish, but their result belongs to the Job that was left, not the next one.
      queue = queue.then(() => undefined);
    },
    save(jobId: string, spots: ADSpot[]) {
      const current = ++generation;
      onStatus('saving');
      queue = queue.then(async () => {
        if (current !== generation) return;
        try {
          const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/spots`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spots }),
          });
          if (!response.ok) throw new Error('Save failed');
          const data = await response.json() as { job?: PersistedJobState };
          if (data.job?.job_id !== jobId) throw new Error('Save not acknowledged');
          if (current === generation) onStatus('saved');
          return true;
        } catch {
          if (current === generation) onStatus('error');
          return false;
        }
      });
    },
    wait() {
      return queue;
    },
  };
}
