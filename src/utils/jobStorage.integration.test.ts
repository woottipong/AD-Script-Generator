import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('storage only lists and deletes inactive persisted jobs', { timeout: 20000 }, async () => {
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-storage-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(err => err ? reject(err) : resolve()));
  fs.symlinkSync(path.join(root, 'src'), path.join(dir, 'src'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'server.ts'), fs.readFileSync(path.join(root, 'server.ts'), 'utf8').replace('const PORT = 3000;', `const PORT = ${port};`));
  const data = path.join(dir, '.data/jobs');
  fs.mkdirSync(data, { recursive: true });
  const makeJob = (id: string) => {
    const jobDir = path.join(data, id); fs.mkdirSync(jobDir);
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ job_id: id, status: 'READY', video_metadata: { fileName: 'sample.mp4' }, batches: [], spots: [], updated_at: '2026-01-01' }));
    fs.writeFileSync(path.join(jobDir, 'source_video.mp4'), 'sample');
  };
  makeJob('job_active'); makeJob('job_old');
  makeJob('job_processing');
  const processingPath = path.join(data, 'job_processing/job.json');
  const processing = JSON.parse(fs.readFileSync(processingPath, 'utf8'));
  processing.status = 'VAD_READY';
  processing.vad_output = { duration_ms: 10000, speech_segments: [], candidate_spots: [{ spot_id: 'a', start_ms: 1000, end_ms: 5000, duration_ms: 4000 }] };
  processing.spots = [{ spot_id: 'a', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'pending', text: '', is_edited: false }];
  processing.batches = [{ batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 10000, window_start_ms: 0, window_end_ms: 10000, candidate_spots: processing.vad_output.candidate_spots, status: 'pending', retry_count: 0 }];
  processing.gemini_file_name = 'files/example';
  processing.gemini_file_uri = 'https://fake.invalid/file';
  processing.gemini_file_expires_at = '2099-01-01T00:00:00Z';
  fs.writeFileSync(processingPath, JSON.stringify(processing));
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
  fs.writeFileSync(path.join(data, 'active_job.json'), JSON.stringify({ active_job_id: 'job_active' }));
  const outside = path.join(dir, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'job.json'), JSON.stringify({ job_id: 'job_link', video_metadata: { fileName: 'outside' } }));
  fs.symlinkSync(outside, path.join(data, 'job_link'));
  const child = spawn(process.execPath, ['--preload', path.join(dir, 'fake.ts'), path.join(dir, 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', GEMINI_API_KEY: 'test-only-key' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api/jobs`;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break; await sleep(25); }
    assert.ok(ready, 'server starts');
    const listing = await (await fetch(base)).json();
    assert.deepEqual(listing.jobs.map((job: { job_id: string }) => job.job_id).sort(), ['job_active', 'job_old', 'job_processing', 'job_upload']);
    assert.equal((await fetch(`${base}/job_active/files`, { method: 'DELETE' })).status, 409);
    const upload = await (await fetch(`http://127.0.0.1:${port}/api/upload/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'new.mp4', fileSize: 5 }) })).json();
    assert.equal((await fetch(`${base}/${upload.uploadId}/files`, { method: 'DELETE' })).status, 409);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/upload/${upload.uploadId}/abandon`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${base}/${upload.uploadId}/files`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/job_link/files`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/job_old%2F..%2Fjob_active/files`, { method: 'DELETE' })).status, 404);
    fs.writeFileSync(path.join(data, 'active_job.json'), '{bad json');
    assert.equal((await fetch(`${base}/job_old/files`, { method: 'DELETE' })).status, 500);
    assert.ok(fs.existsSync(path.join(data, 'job_old/job.json')));
    fs.writeFileSync(path.join(data, 'active_job.json'), JSON.stringify({ active_job_id: 'job_active' }));
    assert.equal((await fetch(`${base}/job_old/files`, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(path.join(data, 'job_old')), false);
    assert.ok(fs.existsSync(path.join(outside, 'job.json')));
    assert.ok(fs.existsSync(path.join(data, 'job_active/job.json')));
    assert.ok(fs.existsSync(path.join(data, 'job_upload/source_video.mp4')));
    assert.equal((await fetch(`${base}/job_processing/start`, { method: 'POST' })).status, 200);
    for (let i = 0; i < 200 && !fs.existsSync(path.join(dir, 'entered')); i++) await sleep(25);
    assert.ok(fs.existsSync(path.join(dir, 'entered')), 'Gemini request is running');
    assert.equal((await fetch(`${base}/job_processing`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/job_processing/files`, { method: 'DELETE' })).status, 409);
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
    assert.equal((await (await fetch(`${base}/current`)).json()).job, null);
    assert.equal((await fetch(`${base}/job_processing/files`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/job_upload/files`, { method: 'DELETE' })).status, 200);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), sleep(1000)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
