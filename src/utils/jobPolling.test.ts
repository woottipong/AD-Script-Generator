import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedJobState } from '../types/ad';
import { pollJob, type JobPollEvent } from './jobPolling';

const job = (status: string, batches: string[] = ['pending']): PersistedJobState => ({
  job_id: 'job 1', status,
  batches: batches.map((status) => ({ status })),
  spots: [],
} as unknown as PersistedJobState);

const parseResponse = (response: Response) => response.json();

test('polls until ready, resumes an idle job once and keeps the start error until running', async () => {
  const events: JobPollEvent[] = [];
  const calls: string[] = [];
  const waits: number[] = [];
  let polls = 0;
  await pollJob({
    jobId: 'job 1', token: { aborted: false }, startError: 'start failed', parseResponse,
    wait: async (ms) => { waits.push(ms); },
    fetch: async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (init?.method === 'POST') return Response.json({});
      polls++;
      return Response.json({ job: job(polls === 5 ? 'READY' : 'ANALYZING'), isRunning: polls >= 4 });
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(calls.filter((call) => call.startsWith('POST')).length, 1);
  assert.ok(calls.every((call) => call.includes('job%201')));
  assert.equal(events.filter((event) => event.type === 'start-unconfirmed').length, 3);
  assert.equal(events.at(-1)?.type, 'ready');
  assert.deepEqual(waits, [1400, 1400, 1400, 1400, 1400]);
});

test('reports disconnection after six consecutive errors and recovers on a valid job', async () => {
  const events: JobPollEvent[] = [];
  const waits: number[] = [];
  let calls = 0;
  await pollJob({
    jobId: 'job 1', token: { aborted: false }, parseResponse,
    fetch: async () => {
      calls++;
      if (calls <= 6) throw new Error('offline');
      return Response.json({ job: job('READY'), isRunning: false });
    },
    wait: async (ms) => { waits.push(ms); },
    onEvent: (event) => events.push(event),
  });
  assert.deepEqual(events.map((event) => event.type), ['disconnected', 'snapshot', 'ready']);
  assert.equal(waits.filter((ms) => ms === 1500).length, 6);
});

test('ignores a response received after the job is cancelled', async () => {
  const events: JobPollEvent[] = [];
  const token = { aborted: false };
  let resolveRequest!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveRequest = resolve; });
  const running = pollJob({
    jobId: 'job 1', token, parseResponse,
    wait: async () => {}, fetch: () => pending,
    onEvent: (event) => events.push(event),
  });
  await Promise.resolve();
  token.aborted = true;
  resolveRequest(Response.json({ job: job('READY') }));
  await running;
  assert.deepEqual(events, []);
});

test('uses the start failure when a job reports failure before the runner starts', async () => {
  const events: JobPollEvent[] = [];
  await pollJob({
    jobId: 'job 1', token: { aborted: false }, startError: 'start failed', parseResponse,
    wait: async () => {}, fetch: async () => Response.json({ job: job('FAILED'), isRunning: false }),
    onEvent: (event) => events.push(event),
  });
  assert.deepEqual(events.at(-1), { type: 'failed', message: 'start failed' });
});
