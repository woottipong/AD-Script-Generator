import assert from 'node:assert/strict';
import test from 'node:test';
import type { ADSpot } from '../types/ad';
import { createJobSaveQueue, type JobSaveStatus } from './jobSaveQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function spot(text: string): ADSpot {
  return {
    spot_id: 'spot', start_ms: 1000, end_ms: 5000, duration_ms: 4000,
    original_start_ms: 1000, original_end_ms: 5000, decision: 'generate', text, is_edited: true,
  };
}

function acknowledged(jobId: string) {
  return Response.json({ job: { job_id: jobId } });
}

test('serializes saves and skips intermediate edits while retaining the latest', async () => {
  const first = deferred<Response>();
  const calls: { url: string; body: string }[] = [];
  const statuses: JobSaveStatus[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return calls.length === 1 ? first.promise : acknowledged('job');
  };
  const queue = createJobSaveQueue((status) => statuses.push(status), request);

  queue.save('job', [spot('first')]);
  await Promise.resolve();
  queue.save('job', [spot('middle')]);
  queue.save('job', [spot('last')]);
  assert.equal(calls.length, 1);
  first.resolve(acknowledged('job'));
  assert.equal(await queue.wait(), true);
  assert.deepEqual(calls.map(({ body }) => JSON.parse(body).spots[0].text), ['first', 'last']);
  assert.deepEqual(statuses, ['saving', 'saving', 'saving', 'saved']);
});

test('reports failure until a later save is acknowledged for the same job', async () => {
  const replies = [
    new Response('', { status: 500 }),
    acknowledged('another-job'),
    acknowledged('job'),
  ];
  const statuses: JobSaveStatus[] = [];
  const queue = createJobSaveQueue((status) => statuses.push(status), async () => replies.shift()!);

  queue.save('job', [spot('first')]);
  assert.equal(await queue.wait(), false);
  queue.save('job', [spot('retry')]);
  assert.equal(await queue.wait(), false);
  queue.save('job', [spot('retry again')]);
  assert.equal(await queue.wait(), true);
  assert.deepEqual(statuses, ['saving', 'error', 'saving', 'error', 'saving', 'saved']);
});

test('invalidating a job suppresses an old response without blocking a later save', async () => {
  const pending = deferred<Response>();
  const statuses: JobSaveStatus[] = [];
  let calls = 0;
  const queue = createJobSaveQueue((status) => statuses.push(status), async () => {
    calls++;
    return calls === 1 ? pending.promise : acknowledged('new');
  });

  queue.save('old', [spot('old')]);
  await Promise.resolve();
  queue.invalidate();
  queue.save('new', [spot('new')]);
  pending.resolve(acknowledged('old'));
  assert.equal(await queue.wait(), true);
  assert.deepEqual(statuses, ['saving', 'saving', 'saved']);
});
