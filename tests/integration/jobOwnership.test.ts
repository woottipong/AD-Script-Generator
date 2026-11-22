import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import type { PersistedJobState } from '../../src/types/ad';
import { authTestEnv, signedInFetch } from './helpers/auth';
import { createJobStore } from '../../src/utils/jobStore';

const authorA = { sub: 'sub-a', email: 'a@example.com', allJobs: false };
const authorB = { sub: 'sub-b', email: 'b@example.com', allJobs: false };
const supervisor = { sub: 'sub-s', email: 'lead@example.com', allJobs: true };

const spot = { spot_id: 'cue_1', start_ms: 1000, end_ms: 4000, duration_ms: 3000, original_start_ms: 1000, original_end_ms: 4000, decision: 'generate' as const, text: 'บท' };
const reviewBody = {
  video_metadata: { fileName: 'lesson.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
  vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
  vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [] },
  video_source: { kind: 'local_file', file_name: 'lesson.mp4', file_size: 1 },
  srt_source: { file_name: 'lesson.srt', cue_count: 1 },
  spots: [spot],
};

function seededJob(jobId: string, owner?: { sub: string; email: string }): PersistedJobState {
  return {
    schema_version: 3, job_id: jobId, title: jobId, mode: 'review',
    ...(owner ? { owner_sub: owner.sub, owner_email: owner.email } : {}),
    video_source: { kind: 'url', url: 'https://example.invalid/v.mp4' },
    srt_source: { file_name: 'v.srt', cue_count: 1, imported_at: '2026-01-01T00:00:00.000Z' },
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', status: 'READY',
    video_metadata: reviewBody.video_metadata, vad_config: reviewBody.vad_config, vad_output: reviewBody.vad_output,
    batches: [], spots: [spot],
  };
}

test('an Author sees and acts on only their own Jobs; others answer like a missing Job', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-ownership-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const seed = createJobStore(path.join(dir, '.data'));
  seed.save(seededJob('job_b', authorB));
  seed.save(seededJob('job_legacy'));
  seed.close();
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api`;
  const as = (author: typeof authorA & { canGenerateAi?: boolean }) => {
    const send = signedInFetch(author);
    return (route: string, method = 'GET', body?: unknown) => send(base + route, {
      method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const a = as(authorA), b = as({ ...authorB, canGenerateAi: true }), lead = as(supervisor);
  const ids = async (response: Response) => ((await response.json()) as { jobs: { job_id: string }[] }).jobs.map((job) => job.job_id).sort();
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);

    const created = await a('/jobs/review', 'POST', reviewBody);
    assert.equal(created.status, 200);
    const { job } = await created.json() as { job: PersistedJobState };
    assert.equal(job.owner_sub, 'sub-a', 'a new Job is owned by the Author who created it');
    assert.equal(job.owner_email, 'a@example.com');

    const listedForA = await a('/jobs');
    const jobsForA = (await listedForA.json() as { jobs: { job_id: string; owner_email: string | null }[] }).jobs;
    assert.deepEqual(jobsForA.map(({ job_id, owner_email }) => ({ job_id, owner_email })), [{ job_id: job.job_id, owner_email: 'a@example.com' }]);
    assert.deepEqual(await ids(await b('/jobs')), ['job_b']);
    assert.deepEqual(await ids(await lead('/jobs')), [job.job_id, 'job_b', 'job_legacy'].sort(), 'All-Jobs Access lists every Job');

    const routes: [string, string, unknown?][] = [
      ['', 'GET'], ['/video', 'GET'], ['', 'PATCH', { title: 'ชื่อใหม่' }], ['', 'PATCH', { title: '' }],
      ['/spots', 'PATCH', { spots: [spot] }], ['/start', 'POST'], ['/analyze-batch', 'POST', {}], ['/files', 'DELETE'],
    ];
    for (const [suffix, method, body] of routes) {
      const missing = await a(`/jobs/job_missing${suffix}`, method, body);
      assert.equal(missing.status, 404, `${method} job_missing${suffix}`);
      const missingBody = await missing.json();
      for (const hidden of ['job_b', 'job_legacy']) {
        const response = await a(`/jobs/${hidden}${suffix}`, method, body);
        assert.equal(response.status, 404, `${method} ${hidden}${suffix}`);
        assert.deepEqual(await response.json(), missingBody, `${method} ${hidden}${suffix} looks like a missing Job`);
      }
    }
    assert.equal((await b('/jobs/job_b')).status, 200, 'the hidden Jobs are untouched');
    assert.equal((await lead('/jobs/job_legacy')).status, 200, 'All-Jobs Access opens a Job with no Job Owner');
    assert.equal((await lead('/jobs/job_b', 'PATCH', { title: 'ส่งต่อให้ทีม' })).status, 200, 'All-Jobs Access acts on another Author\'s Job');
    assert.equal((await lead('/jobs/job_legacy/spots', 'PATCH', { spots: [spot] })).status, 200);
    assert.equal((await lead('/jobs/job_legacy/files', 'DELETE')).status, 200);

    assert.equal((await a(`/jobs/${job.job_id}`, 'PATCH', { title: 'ของฉัน' })).status, 200);
    const renamed = await lead(`/jobs/${job.job_id}`);
    assert.equal((await renamed.json() as { job: PersistedJobState }).job.owner_sub, 'sub-a', 'renaming keeps the Job Owner');
    assert.equal((await a(`/jobs/${job.job_id}/files`, 'DELETE')).status, 200);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing Jobs answer 404 before activeProcessingLock 409 on start and analyze-batch', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-ownership-lock-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));

  fs.writeFileSync(path.join(dir, 'fake.ts'), `import fs from 'node:fs';
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return real(input, init);
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Unexpected network request');
  if (init?.method === 'DELETE') return Response.json({});
  if (url.includes(':generateContent')) {
    fs.writeFileSync('entered', '1');
    while (!fs.existsSync('release')) await new Promise(r => setTimeout(r, 20));
    const spots = [{ spot_id: 'cue_1', decision: 'generate', text: 'บท' }];
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ spots }) }] }, finishReason: 'STOP' }] });
  }
  const id = new URL(url).pathname.split('/').at(-1);
  return Response.json({ name: 'files/' + id, state: 'ACTIVE', uri: 'https://fake.invalid/' + id, mimeType: 'video/mp4' });
};`);

  const source = path.join(dir, '.data/jobs/job_running/source_video.mp4');
  const seed = createJobStore(path.join(dir, '.data'));
  seed.save({
    ...seededJob('job_running', authorB),
    mode: 'generate',
    status: 'VAD_READY',
    video_source: { kind: 'server_copy', local_file_path: source },
    gemini_file_name: 'files/example',
    gemini_file_uri: 'https://fake.invalid/example',
    gemini_file_expires_at: '2099-01-01T00:00:00Z',
    gemini_file_mime_type: 'video/mp4',
    batches: [{
      batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 10000,
      window_start_ms: 0, window_end_ms: 10000, candidate_spots: [spot], status: 'pending', retry_count: 0,
    }],
  });
  seed.save(seededJob('job_b', authorB));
  seed.close();
  fs.writeFileSync(source, '1');

  const child = spawn(process.execPath, ['--preload', path.join(dir, 'fake.ts'), path.join(process.cwd(), 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port), GEMINI_API_KEY: 'test-only-key' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api`;
  const as = (author: typeof authorA & { canGenerateAi?: boolean }) => {
    const send = signedInFetch(author);
    return (route: string, method = 'GET', body?: unknown) => send(base + route, {
      method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const a = as(authorA), b = as({ ...authorB, canGenerateAi: true }), lead = as(supervisor);

  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);

    assert.equal((await b('/jobs/job_running/start', 'POST', { confirmAiCost: true })).status, 200);
    for (let i = 0; i < 200 && !fs.existsSync(path.join(dir, 'entered')); i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(fs.existsSync(path.join(dir, 'entered')), 'activeProcessingLock is held');

    // Existing other Job hits 409, proving the lock is active.
    assert.equal((await lead('/jobs/job_b/start', 'POST')).status, 409);

    for (const [suffix, body] of [['/start', undefined], ['/analyze-batch', {}]] as const) {
      const missingForA = await a(`/jobs/job_missing${suffix}`, 'POST', body);
      assert.equal(missingForA.status, 404, `missing${suffix} for A`);
      const hiddenForA = await a(`/jobs/job_running${suffix}`, 'POST', body);
      assert.equal(hiddenForA.status, 404, `job_running${suffix} for A`);
      assert.deepEqual(await hiddenForA.json(), await missingForA.json());

      const missingForLead = await lead(`/jobs/job_missing${suffix}`, 'POST', body);
      assert.equal(missingForLead.status, 404, `missing${suffix} for lead`);
    }
  } finally {
    fs.writeFileSync(path.join(dir, 'release'), '1');
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/jobs derives is_owner from sub and never leaks owner_sub', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-is-owner-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));

  const seed = createJobStore(path.join(dir, '.data'));
  // Seed supervisor's own Job with an outdated owner_email that differs from supervisor's current session email.
  seed.save(seededJob('job_mine', { sub: supervisor.sub, email: 'old-lead@example.com' }));
  seed.save(seededJob('job_theirs', authorB));
  seed.save(seededJob('job_legacy'));
  seed.close();
  fs.mkdirSync(path.join(dir, '.data/jobs/job_upload'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.data/jobs/job_upload/source_video.mp4'), 'abc');

  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api`;
  const leadSend = signedInFetch(supervisor);
  const bSend = signedInFetch(authorB);
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);

    const leadRes = await leadSend(`${base}/jobs`);
    assert.equal(leadRes.status, 200);
    const { jobs } = (await leadRes.json()) as { jobs: (Record<string, unknown> & { job_id: string; is_owner: boolean; is_upload: boolean })[] };
    const byId = new Map(jobs.map((job) => [job.job_id, job]));

    assert.equal(byId.get('job_mine')?.is_owner, true, 'own Job is_owner=true even when session email differs from owner_email');
    assert.equal(byId.get('job_mine')?.owner_email, 'old-lead@example.com');
    assert.equal(byId.get('job_theirs')?.is_owner, false, 'another Author Job is_owner=false');
    assert.equal(byId.get('job_legacy')?.is_owner, false, 'ownerless Job is_owner=false');
    assert.equal(byId.get('job_upload')?.is_upload, true);
    assert.equal(byId.get('job_upload')?.is_owner, false, 'Unfinished Upload is_owner=false');
    for (const item of jobs) {
      assert.equal('owner_sub' in item, false, `owner_sub must not be returned in /api/jobs (${item.job_id})`);
    }

    const bRes = await bSend(`${base}/jobs`);
    assert.equal(bRes.status, 200);
    const bJobs = ((await bRes.json()) as { jobs: (Record<string, unknown> & { job_id: string; is_owner: boolean })[] }).jobs;
    assert.equal(bJobs.length, 1);
    assert.equal(bJobs[0].job_id, 'job_theirs');
    assert.equal(bJobs[0].is_owner, true);
    assert.equal('owner_sub' in bJobs[0], false);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
