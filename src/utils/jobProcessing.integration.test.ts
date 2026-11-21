import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { pollJob } from './jobPolling';
import type { PersistedJobState } from '../types/ad';
import { createJobStore } from './jobStore';

const root = process.cwd();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean | Promise<boolean>, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error('Timed out waiting for server state');
}

async function availablePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

function spot(id: string, start: number) {
  return { spot_id: id, start_ms: start, end_ms: start + 4000, duration_ms: 4000,
    original_start_ms: start, original_end_ms: start + 4000, decision: 'generate', text: 'before', is_edited: true };
}

function makeJob(twoBatches = false) {
  const a = spot('a', 1000);
  const b = spot('b', 7000);
  const batch = (id: string, index: number, candidate: typeof a) => ({
    batch_id: id, batch_index: index, batch_start_ms: 0, batch_end_ms: 20000,
    window_start_ms: 0, window_end_ms: 20000, candidate_spots: [candidate], status: 'pending', retry_count: 0,
  });
  return { job_id: 'job_test', created_at: '2026-01-01', updated_at: '2026-01-01', status: 'VAD_READY',
    video_metadata: { fileName: 'test.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480,
      durationMs: 20000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
    vad_config: {}, vad_output: { duration_ms: 20000, speech_segments: [], candidate_spots: [a, b] },
    gemini_file_name: 'files/example', gemini_file_uri: 'https://fake.invalid/file',
    gemini_file_expires_at: '2099-01-01T00:00:00Z', gemini_file_mime_type: 'video/mp4',
    batches: twoBatches ? [batch('batch_1', 1, a), batch('batch_2', 2, b)] : [batch('batch_1', 1, a)], spots: [a, b] };
}

async function withServer(twoBatches: boolean, action: (ctx: {
  dir: string; request: (suffix?: string, method?: string, body?: unknown) => Promise<Response>; otherJob: () => Promise<Response>
}) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-job-test-'));
  const port = await availablePort();
  fs.writeFileSync(path.join(dir, 'fake.ts'), `import fs from 'node:fs';
const real = globalThis.fetch; let n = 0;
let uploads = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return real(input, init);
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Unexpected network request');
  const pathname = new URL(url).pathname;
  if (pathname.startsWith('/upload/') && pathname.endsWith('/files')) {
    return Response.json({}, { headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/test-upload' } });
  }
  if (pathname === '/test-upload') {
    const id = 'upload-' + ++uploads;
    fs.writeFileSync(id, '1');
    return Response.json({ file: {
      name: 'files/' + id,
      state: fs.existsSync('upload-fail') ? 'FAILED' : 'ACTIVE',
      uri: 'https://fake.invalid/' + id,
      mimeType: 'video/mp4',
    } }, { headers: { 'x-goog-upload-status': 'final' } });
  }
  if (init?.method === 'DELETE') {
    const id = pathname.split('/').at(-1);
    fs.writeFileSync('deleted-' + id, '1');
    while (fs.existsSync('hold-delete')) await new Promise(r => setTimeout(r, 20));
    if (fs.existsSync('delete-fail') || fs.existsSync('delete-fail-once')) {
      fs.rmSync('delete-fail-once', { force: true });
      return Response.json({ error: { code: 500, status: 'INTERNAL' } }, { status: 500 });
    }
    if (fs.existsSync('delete-missing')) return Response.json({ error: { code: 404, status: 'NOT_FOUND' } }, { status: 404 });
    return Response.json({});
  }
  if (pathname.endsWith('/files/example') && fs.existsSync('old-processing')) {
    return Response.json({ name: 'files/example', state: 'PROCESSING' });
  }
  if (url.includes(':generateContent')) {
    const call = ++n; fs.writeFileSync('entered-' + call, '1');
    while (!fs.existsSync('release-' + call) && !fs.existsSync('release-all')) await new Promise(r => setTimeout(r, 20));
    if (fs.existsSync('fail')) return Response.json({ error: { code: 400, message: 'fake failure', status: 'INVALID_ARGUMENT' } }, { status: 400 });
    const spots = ['a', 'b'].map((id) => ({ spot_id: id, decision: 'generate', text: 'AI result' }));
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ spots }) }] }, finishReason: 'STOP' }] });
  }
  const id = pathname.split('/').at(-1);
  return Response.json({ name: 'files/' + id, state: 'ACTIVE', uri: 'https://fake.invalid/' + id, mimeType: 'video/mp4' });
};`);
  const source = path.join(dir, '.data/jobs/job_test/source_video.mp4');
  const seed = createJobStore(path.join(dir, '.data'));
  seed.save({ ...makeJob(twoBatches), schema_version: 3, title: 'test', mode: 'generate', video_source: { kind: 'server_copy', local_file_path: source } } as unknown as PersistedJobState);
  seed.close();
  fs.writeFileSync(source, '1');
  const child = spawn(process.execPath, ['--preload', path.join(dir, 'fake.ts'), path.join(root, 'server.ts')], {
    cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), GEMINI_API_KEY: 'test-only-key' }, stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api/jobs/job_test`;
  const request = (suffix = '', method = 'GET', body?: unknown) => fetch(base + suffix, {
    method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    await until(async () => { try { return (await request()).ok; } catch { return false; } });
    const otherJob = () => fetch(`http://127.0.0.1:${port}/api/jobs/other/start`, { method: 'POST' });
    await action({ dir, request, otherJob });
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), sleep(1000)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const route of ['single batch', 'background'] as const) for (const mode of ['success', 'fail'] as const) {
  test(`${route} preserves another spot edited during ${mode}`, { timeout: 20000 }, async () => {
    await withServer(false, async ({ dir, request }) => {
      const pending = route === 'single batch' ? request('/analyze-batch', 'POST', { batch_id: 'batch_1' }) : undefined;
      if (!pending) assert.equal((await request('/start', 'POST')).status, 200);
      await until(() => fs.existsSync(path.join(dir, 'entered-1')));
      const current = await (await request()).json();
      const spots = current.job.spots.map((item: ReturnType<typeof spot>) => item.spot_id === 'b'
        ? { ...item, text: 'manual edit', start_ms: 7200, duration_ms: 3800 } : item);
      assert.equal((await request('/spots', 'PATCH', { spots })).status, 200);
      if (mode === 'fail') fs.writeFileSync(path.join(dir, 'fail'), '1');
      fs.writeFileSync(path.join(dir, 'release-all'), '1');
      if (pending) assert.equal((await pending).status, mode === 'success' ? 200 : 500);
      await until(async () => !(await (await request()).json()).isRunning);
      const saved = await (await request()).json();
      assert.equal(saved.job.status, mode === 'success' ? 'READY' : 'FAILED');
      assert.equal(saved.job.spots[1].text, 'manual edit');
      assert.equal(saved.job.spots[1].start_ms, 7200);
      assert.equal(saved.job.batches[0].status, mode === 'success' ? 'completed' : 'failed');
      assert.ok(fs.existsSync(path.join(dir, 'deleted-example')));
      assert.equal(saved.job.gemini_file_name, undefined);
      assert.equal(saved.job.gemini_file_uri, undefined);
      assert.equal(await (await request('/video')).text(), '1');
    });
  });
}

for (const route of ['single batch', 'background'] as const) {
  test(`${route} keeps the Gemini file until the final batch finishes`, { timeout: 20000 }, async () => {
    await withServer(true, async ({ dir, request }) => {
      const first = route === 'single batch' ? request('/analyze-batch', 'POST', { batch_id: 'batch_1' }) : undefined;
      if (!first) assert.equal((await request('/start', 'POST')).status, 200);
      await until(() => fs.existsSync(path.join(dir, 'entered-1')));
      fs.writeFileSync(path.join(dir, 'release-1'), '1');
      if (first) assert.equal((await first).status, 200);
      const second = route === 'single batch' ? request('/analyze-batch', 'POST', { batch_id: 'batch_2' }) : undefined;
      await until(() => fs.existsSync(path.join(dir, 'entered-2')));
      assert.equal(fs.existsSync(path.join(dir, 'deleted-example')), false);
      fs.writeFileSync(path.join(dir, 'delete-missing'), '1');
      fs.writeFileSync(path.join(dir, 'hold-delete'), '1');
      fs.writeFileSync(path.join(dir, 'release-2'), '1');
      await until(() => fs.existsSync(path.join(dir, 'deleted-example')));
      const duringDeletion = await (await request()).json();
      assert.equal(duringDeletion.job.batches[1].status, 'completed');
      assert.equal(duringDeletion.job.spots[1].text, 'AI result');
      fs.unlinkSync(path.join(dir, 'hold-delete'));
      if (second) assert.equal((await second).status, 200);
      await until(async () => !(await (await request()).json()).isRunning);
      const { job } = await (await request()).json();
      assert.equal(job.status, 'READY');
      assert.equal(job.gemini_file_name, undefined);
      assert.ok(fs.existsSync(path.join(dir, 'deleted-example')));
    });
  });
}

test('retry uploads the local video and cleans up even if Gemini rejects the uploaded file', { timeout: 20000 }, async () => {
  await withServer(false, async ({ dir, request }) => {
    const initial = request('/analyze-batch', 'POST', { batch_id: 'batch_1' });
    await until(() => fs.existsSync(path.join(dir, 'entered-1')));
    fs.writeFileSync(path.join(dir, 'fail'), '1');
    fs.writeFileSync(path.join(dir, 'release-all'), '1');
    assert.equal((await initial).status, 500);

    fs.writeFileSync(path.join(dir, 'upload-fail'), '1');
    assert.equal((await request('/start', 'POST')).status, 200);
    await until(async () => !(await (await request()).json()).isRunning);
    const { job } = await (await request()).json();
    assert.ok(fs.existsSync(path.join(dir, 'deleted-upload-1')), job.error_message);
    assert.equal(job.status, 'FAILED');
    assert.equal(job.gemini_file_name, undefined);

    fs.unlinkSync(path.join(dir, 'fail'));
    fs.unlinkSync(path.join(dir, 'upload-fail'));
    assert.equal((await request('/start', 'POST')).status, 200);
    await until(async () => !(await (await request()).json()).isRunning);
    assert.ok(fs.existsSync(path.join(dir, 'deleted-upload-2')));
    const saved = await (await request()).json();
    assert.equal(saved.job.status, 'READY');
    assert.equal(saved.job.spots[0].text, 'AI result');
  });
});

test('starting a completed job retries failed Gemini deletion without repeating analysis', { timeout: 20000 }, async () => {
  await withServer(false, async ({ dir, request }) => {
    fs.writeFileSync(path.join(dir, 'delete-fail'), '1');
    fs.writeFileSync(path.join(dir, 'release-all'), '1');
    assert.equal((await request('/start', 'POST')).status, 200);
    await until(async () => !(await (await request()).json()).isRunning);
    assert.ok(fs.existsSync(path.join(dir, 'deleted-example')));
    const { job } = await (await request()).json();
    assert.equal(job.status, 'READY');
    assert.equal(job.spots[0].text, 'AI result');
    assert.equal(job.gemini_file_name, 'files/example');

    fs.unlinkSync(path.join(dir, 'delete-fail'));
    fs.unlinkSync(path.join(dir, 'deleted-example'));
    fs.writeFileSync(path.join(dir, 'hold-delete'), '1');
    const retry = await request('/start', 'POST');
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).isRunning, true);
    await until(() => fs.existsSync(path.join(dir, 'deleted-example')));
    assert.equal((await (await request('/start', 'POST')).json()).isRunning, true);
    const duringRetry = await (await request()).json();
    duringRetry.job.spots[0].text = 'edited during cleanup retry';
    assert.equal((await request('/spots', 'PATCH', { spots: duringRetry.job.spots })).status, 200);
    fs.unlinkSync(path.join(dir, 'hold-delete'));
    await until(async () => !(await (await request()).json()).isRunning);
    assert.ok(fs.existsSync(path.join(dir, 'deleted-example')));
    assert.equal(fs.existsSync(path.join(dir, 'upload-1')), false);
    assert.equal(fs.existsSync(path.join(dir, 'entered-2')), false);
    const saved = await (await request()).json();
    assert.equal(saved.job.status, 'READY');
    assert.equal(saved.job.spots[0].text, 'edited during cleanup retry');
    assert.equal(saved.job.gemini_file_name, undefined);
    assert.equal(await (await request('/video')).text(), '1');
  });
});

test('failed deletion keeps the old Gemini reference until replacement can proceed', { timeout: 20000 }, async () => {
  await withServer(false, async ({ dir, request }) => {
    for (const name of ['old-processing', 'delete-fail-once', 'release-all']) fs.writeFileSync(path.join(dir, name), '1');
    assert.equal((await request('/start', 'POST')).status, 200);
    await until(async () => !(await (await request()).json()).isRunning);
    const failed = await (await request()).json();
    assert.equal(failed.job.status, 'FAILED');
    assert.equal(failed.job.gemini_file_name, 'files/example');
    assert.equal(fs.existsSync(path.join(dir, 'upload-1')), false);

    assert.equal((await request('/start', 'POST')).status, 200);
    await until(async () => !(await (await request()).json()).isRunning);
    const saved = await (await request()).json();
    assert.equal(saved.job.status, 'READY');
    assert.equal(saved.job.gemini_file_name, undefined);
    assert.ok(fs.existsSync(path.join(dir, 'deleted-upload-1')));
  });
});

test('same-job batch request waits for the running background job', { timeout: 20000 }, async () => {
  await withServer(false, async ({ dir, request, otherJob }) => {
    assert.equal((await request('/start', 'POST')).status, 200);
    await until(() => fs.existsSync(path.join(dir, 'entered-1')));
    const overlapping = request('/analyze-batch', 'POST', { batch_id: 'batch_1' });
    await sleep(300);
    assert.equal(fs.existsSync(path.join(dir, 'entered-2')), false, 'a second Gemini request must not start');
    const current = await (await request()).json();
    assert.equal(current.isRunning, true);
    assert.equal((await otherJob()).status, 409);
    fs.writeFileSync(path.join(dir, 'hold-delete'), '1');
    fs.writeFileSync(path.join(dir, 'release-all'), '1');
    await until(() => fs.existsSync(path.join(dir, 'deleted-example')));
    assert.equal((await otherJob()).status, 409);
    const events: string[] = [];
    const token = { aborted: false };
    const polling = pollJob({
      jobId: 'job_test', token,
      parseResponse: (response) => response.json(),
      fetch: () => request(),
      wait: () => sleep(25),
      onEvent: (event) => events.push(event.type),
    });
    await until(() => events.includes('snapshot'));
    token.aborted = events.includes('ready');
    assert.equal(token.aborted, false, 'reported ready before releasing the lock');
    const { job } = await (await request()).json();
    job.spots[1].text = 'edited during deletion';
    assert.equal((await request('/spots', 'PATCH', { spots: job.spots })).status, 200);
    fs.unlinkSync(path.join(dir, 'hold-delete'));
    await polling;
    assert.equal(events.at(-1), 'ready');
    assert.equal((await overlapping).status, 200);
    const saved = await (await request()).json();
    assert.equal(saved.job.status, 'READY');
    assert.equal(saved.job.spots[1].text, 'edited during deletion');
  });
});

test('a failed job read never replaces the unreadable persisted data', { timeout: 20000 }, async () => {
  await withServer(false, async ({ dir, request, otherJob }) => {
    const pending = request('/analyze-batch', 'POST', { batch_id: 'batch_1' });
    await until(() => fs.existsSync(path.join(dir, 'entered-1')));
    const jobFile = path.join(dir, '.data/jobs/job_test/vad_output.json');
    fs.writeFileSync(jobFile, '{invalid');
    fs.writeFileSync(path.join(dir, 'release-all'), '1');
    assert.equal((await pending).status, 500);
    assert.equal(fs.readFileSync(jobFile, 'utf8'), '{invalid');
    assert.equal((await otherJob()).status, 404);
  });
});
