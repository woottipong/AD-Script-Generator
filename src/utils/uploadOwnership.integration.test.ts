import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import type { PersistedJobState } from '../types/ad';
import { authTestEnv, signedInFetch } from './authTestHelpers';

const authorA = { sub: 'sub-a', email: 'a@example.com', allJobs: false };
const authorB = { sub: 'sub-b', email: 'b@example.com', allJobs: false };
const supervisor = { sub: 'sub-s', email: 'lead@example.com', allJobs: true };

test('an Unfinished Upload belongs to its uploader; others reach it only with All-Jobs Access', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-upload-owner-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api`;
  const as = (author: typeof authorA) => {
    const send = signedInFetch(author);
    return {
      json: (route: string, method: string, body?: unknown) => send(base + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
      chunk: (uploadId: string, offset: number, body: string) => send(`${base}/upload/chunk?uploadId=${uploadId}&offset=${offset}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body }),
      list: async () => ((await (await send(`${base}/jobs`)).json()) as { jobs: { job_id: string }[] }).jobs.map((job) => job.job_id),
    };
  };
  const a = as(authorA), b = as(authorB), lead = as(supervisor);
  const startUpload = async () => ((await (await a.json('/upload/init', 'POST', { fileName: 'a.mp4', fileSize: 3 })).json()) as { uploadId: string }).uploadId;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);

    const abandoned = await startUpload();
    assert.equal((await b.chunk(abandoned, 0, 'abc')).status, 404, 'another Author cannot write to the upload');
    assert.equal((await a.chunk(abandoned, 0, 'abc')).status, 200);
    assert.equal((await b.json(`/upload/${abandoned}/abandon`, 'POST')).status, 404);
    assert.equal((await a.json(`/upload/${abandoned}/abandon`, 'POST')).status, 200);
    assert.deepEqual(await a.list(), [], 'an Unfinished Upload is not in an Author\'s own Job List');
    assert.ok((await lead.list()).includes(abandoned), 'All-Jobs Access lists Unfinished Uploads');
    assert.equal((await b.json(`/jobs/${abandoned}/files`, 'DELETE')).status, 404, 'another Author cannot delete the upload');
    assert.equal((await a.json(`/jobs/${abandoned}/files`, 'DELETE')).status, 200, 'the uploader deletes it after abandoning');
    assert.equal(fs.existsSync(path.join(dir, '.data/jobs', abandoned)), false);

    const kept = await startUpload();
    assert.equal((await a.chunk(kept, 0, 'abc')).status, 200);
    const init = {
      uploadId: kept, autoStart: false,
      video_metadata: { fileName: 'a.mp4', fileSize: 3, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
      vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
      vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [{ spot_id: 'spot_1', start_ms: 1000, end_ms: 5000, duration_ms: 4000 }] },
    };
    const missing = await b.json('/jobs/init', 'POST', { ...init, uploadId: 'job_0_missing' });
    const stolen = await b.json('/jobs/init', 'POST', init);
    assert.equal(stolen.status, missing.status, 'another Author cannot turn the upload into their Job');
    assert.deepEqual(await stolen.json(), await missing.json());
    const created = await a.json('/jobs/init', 'POST', init);
    assert.equal(created.status, 200);
    assert.equal((await created.json() as { job: PersistedJobState }).job.owner_sub, 'sub-a');

    const third = await startUpload();
    assert.equal((await lead.json(`/upload/${third}/abandon`, 'POST')).status, 200, 'All-Jobs Access reaches any upload');
    assert.equal((await lead.json(`/jobs/${third}/files`, 'DELETE')).status, 200);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
