import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

const root = process.cwd();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  fs.symlinkSync(path.join(root, 'src'), path.join(dir, 'src'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
  assert.ok(server.includes('const PORT = 3000;'));
  fs.writeFileSync(path.join(dir, 'server.ts'), server.replace('const PORT = 3000;', `const PORT = ${port};`));
  fs.writeFileSync(path.join(dir, 'fake.ts'), `import fs from 'node:fs';
const real = globalThis.fetch; let n = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return real(input, init);
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Unexpected network request');
  if (url.includes(':generateContent')) {
    const call = ++n; fs.writeFileSync('entered-' + call, '1');
    while (!fs.existsSync('release-' + call) && !fs.existsSync('release-all')) await new Promise(r => setTimeout(r, 20));
    if (fs.existsSync('fail')) return Response.json({ error: { code: 400, message: 'fake failure', status: 'INVALID_ARGUMENT' } }, { status: 400 });
    const id = call >= 3 ? 'b' : 'a';
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ spots: [{ spot_id: id, decision: 'generate', text: 'AI result' }] }) }] }, finishReason: 'STOP' }] });
  }
  return Response.json({ name: 'files/example', state: 'ACTIVE', uri: 'https://fake.invalid/file', mimeType: 'video/mp4' });
};`);
  const jobDir = path.join(dir, '.data/jobs/job_test');
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(makeJob(twoBatches)));
  const child = spawn(process.execPath, ['--preload', path.join(dir, 'fake.ts'), path.join(dir, 'server.ts')], {
    cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', GEMINI_API_KEY: 'test-only-key' }, stdio: 'ignore',
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
      else await until(async () => (await (await request()).json()).job.status === (mode === 'success' ? 'READY' : 'FAILED'));
      const saved = await (await request()).json();
      assert.equal(saved.job.spots[1].text, 'manual edit');
      assert.equal(saved.job.spots[1].start_ms, 7200);
      assert.equal(saved.job.batches[0].status, mode === 'success' ? 'completed' : 'failed');
    });
  });
}

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
    fs.writeFileSync(path.join(dir, 'release-all'), '1');
    assert.equal((await overlapping).status, 200);
    await until(async () => (await (await request()).json()).job.status === 'READY');
  });
});

test('a failed job read never replaces the unreadable persisted data', { timeout: 20000 }, async () => {
  await withServer(false, async ({ dir, request, otherJob }) => {
    const pending = request('/analyze-batch', 'POST', { batch_id: 'batch_1' });
    await until(() => fs.existsSync(path.join(dir, 'entered-1')));
    const jobFile = path.join(dir, '.data/jobs/job_test/job.json');
    fs.writeFileSync(jobFile, '{invalid');
    fs.writeFileSync(path.join(dir, 'release-all'), '1');
    assert.equal((await pending).status, 500);
    assert.equal(fs.readFileSync(jobFile, 'utf8'), '{invalid');
    assert.equal((await otherJob()).status, 404);
  });
});
