import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import type { PersistedJobState } from '../../src/types/ad';
import { createJobStore } from '../../src/utils/jobStore';
import { authTestEnv, signedInFetch } from './helpers/auth';

// Every API call in this file is made by an Author with All-Jobs Access, so seeded Jobs with no Job Owner stay reachable.
const fetch = signedInFetch({ sub: 'sub-test-author', email: 'author@example.com', allJobs: true });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('storage lists every persisted job and deletes any that is not analysing or uploading', { timeout: 20000 }, async () => {
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-storage-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(err => err ? reject(err) : resolve()));
  const data = path.join(dir, '.data/jobs');
  const candidate = { spot_id: 'a', start_ms: 1000, end_ms: 5000, duration_ms: 4000 };
  const batch = { batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 10000, window_start_ms: 0, window_end_ms: 10000, candidate_spots: [candidate], status: 'pending' as const, retry_count: 0 };
  const makeJob = (id: string, extra: Partial<PersistedJobState> = {}): PersistedJobState => ({
    schema_version: 3, job_id: id, title: id, mode: 'generate',
    video_source: { kind: 'server_copy', local_file_path: path.join(data, id, 'source_video.mp4') },
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', status: 'READY',
    video_metadata: { fileName: 'sample.mp4', fileSize: 6, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
    vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
    vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [candidate] },
    batches: [], spots: [], ...extra,
  });
  const processing = {
    status: 'VAD_READY' as const, batches: [batch],
    spots: [{ ...candidate, original_start_ms: 1000, original_end_ms: 5000, decision: 'pending' as const, text: '', is_edited: false }],
    gemini_file_name: 'files/example', gemini_file_uri: 'https://fake.invalid/file', gemini_file_expires_at: '2099-01-01T00:00:00Z',
  };
  const seed = createJobStore(path.join(dir, '.data'));
  seed.save(makeJob('job_old'));
  seed.save(makeJob('job_processing', processing));
  seed.save(makeJob('job_recovering', { ...processing, status: 'ANALYZING', progress_stage: 'stale', batches: [{ ...batch, status: 'processing' }] }));
  seed.close();
  for (const id of ['job_old', 'job_processing', 'job_recovering']) fs.writeFileSync(path.join(data, id, 'source_video.mp4'), 'sample');
  const processingPath = path.join(data, 'job_processing');
  const recoveringPath = path.join(data, 'job_recovering');
  fs.writeFileSync(path.join(dir, 'fake.ts'), `import fs from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) return real(input, init);
  if (url.includes(':generateContent')) {
    fs.writeFileSync('entered', '1');
    while (!fs.existsSync('release')) await new Promise(r => setTimeout(r, 20));
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ spots: [{ spot_id: 'a', decision: 'generate', text: 'result' }] }) }] }, finishReason: 'STOP' }] });
  }
  return Response.json({ name: 'files/example', state: 'ACTIVE', uri: 'https://fake.invalid/file', mimeType: 'video/mp4' });
};`);
  fs.mkdirSync(path.join(data, 'job_upload'));
  fs.writeFileSync(path.join(data, 'job_upload/source_video.mp4'), 'unfinished');
  const outside = path.join(dir, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'source_video.mp4'), 'outside');
  fs.symlinkSync(outside, path.join(data, 'job_link'));
  const child = spawn(process.execPath, ['--preload', path.join(dir, 'fake.ts'), path.join(root, 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port), GEMINI_API_KEY: 'test-only-key' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api/jobs`;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; await sleep(25); }
    assert.ok(ready, 'server starts');
    const listing = await (await fetch(base)).json();
    assert.deepEqual(listing.jobs.map((job: { job_id: string }) => job.job_id).sort(), ['job_old', 'job_processing', 'job_recovering', 'job_upload']);
    assert.equal(listing.jobs.some((job: object) => 'is_active' in job), false, 'there is no active Job');
    const recovered = (await (await fetch(`${base}/job_recovering`)).json()).job;
    assert.equal(recovered.status, 'VAD_READY', 'a Job left analysing by a crash is recovered on startup');
    assert.equal(recovered.batches[0].status, 'pending');
    assert.equal((await fetch(`${base}/current`)).status, 404);
    const upload = await (await fetch(`http://127.0.0.1:${port}/api/upload/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'new.mp4', fileSize: 5 }) })).json();
    assert.equal((await fetch(`${base}/${upload.uploadId}/files`, { method: 'DELETE' })).status, 409);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/upload/${upload.uploadId}/abandon`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${base}/${upload.uploadId}/files`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/job_link/files`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/job_old%2F..%2Fjob_recovering/files`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/job_old/files`, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(path.join(data, 'job_old')), false);
    assert.ok(fs.existsSync(path.join(outside, 'source_video.mp4')), 'a symlink escape is never followed');
    assert.ok(fs.existsSync(recoveringPath));
    assert.ok(fs.existsSync(path.join(data, 'job_upload/source_video.mp4')));
    assert.equal((await fetch(`${base}/job_processing/start`, { method: 'POST' })).status, 200);
    for (let i = 0; i < 200 && !fs.existsSync(path.join(dir, 'entered')); i++) await sleep(25);
    assert.ok(fs.existsSync(path.join(dir, 'entered')), 'Gemini request is running');
    assert.equal((await fetch(`${base}/job_processing`, { method: 'DELETE' })).status, 404, 'there is no active pointer to clear');
    assert.equal((await fetch(`${base}/job_processing/files`, { method: 'DELETE' })).status, 409);
    assert.equal((await fetch(`${base}/job_processing`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'renamed while analysing' }) })).status, 200);
    assert.ok(fs.existsSync(processingPath));
    fs.writeFileSync(path.join(dir, 'release'), '1');
    let status = '';
    for (let i = 0; i < 200; i++) {
      const response = await (await fetch(`${base}/job_processing`)).json();
      status = response.job.status;
      if (status === 'READY') break;
      await sleep(25);
    }
    assert.equal(status, 'READY');
    assert.equal((await (await fetch(`${base}/job_processing`)).json()).job.title, 'renamed while analysing', 'analysis keeps a title renamed meanwhile');
    assert.equal((await fetch(`${base}/job_processing/files`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/job_upload/files`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/job_recovering/files`, { method: 'DELETE' })).status, 200);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), sleep(1000)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
