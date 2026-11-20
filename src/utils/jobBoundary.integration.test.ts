import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

test('HTTP boundaries reject invalid uploads and preserve stored spot bounds', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-boundary-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const root = process.cwd();
  const child = spawn(process.execPath, [path.join(root, 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api`;
  const json = (route: string, method: string, body: unknown) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);
    assert.equal((await json('/upload/init', 'POST', { fileName: 'a.mp4', fileSize: -1 })).status, 400);
    assert.equal((await json('/upload/init', 'POST', { fileName: 'a.mp4', fileSize: 2000 * 1024 * 1024 + 1 })).status, 400);
    const init = await json('/upload/init', 'POST', { fileName: 'a.mp4', fileSize: 6 });
    assert.equal(init.status, 200);
    const { uploadId } = await init.json() as { uploadId: string };
    const chunk = (id: string, offset: number) => fetch(`${base}/upload/chunk?uploadId=${encodeURIComponent(id)}&offset=${offset}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'abc' });
    assert.equal((await chunk('invalid/../id', 0)).status, 400);
    assert.equal((await chunk(uploadId, 2000 * 1024 * 1024)).status, 413);
    assert.equal((await chunk(uploadId, 0)).status, 200);
    assert.equal((await json('/jobs/init', 'POST', { uploadId, video_metadata: '{' })).status, 400);
    assert.equal((await json('/jobs/init', 'POST', { uploadId, video_metadata: {} })).status, 400);
    const spot = { spot_id: 'a', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'generate', text: 'text', is_edited: false };
    const jobDir = path.join(dir, '.data/jobs/job_fixture'); fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'source_video.mp4'), 'abc');
    fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify({ job_id: 'job_fixture', status: 'READY', spots: [spot], vad_output: { duration_ms: 10000, speech_segments: [] }, video_metadata: { fileName: 'a.mp4' } }));
    assert.equal((await chunk('job_fixture', 0)).status, 409);
    const patch = (spots: unknown) => json('/jobs/job_fixture/spots', 'PATCH', { spots });
    assert.equal((await patch([])).status, 400);
    assert.equal((await patch([spot, spot])).status, 400);
    assert.equal((await patch([{ ...spot, original_start_ms: 0 }])).status, 400);
    assert.equal((await patch([{ ...spot, duration_ms: 12 }])).status, 400);
    assert.equal((await patch([{ ...spot, text: 'edited' }])).status, 200);
    const saved = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
    assert.equal(saved.spots[0].text, 'edited');
    assert.equal(saved.schema_version, 2, 'legacy job is rewritten as schema version 2 on save');
    assert.equal(saved.mode, 'generate');
    assert.equal(saved.video_source.kind, 'server_copy');
    assert.equal(saved.local_file_path, undefined);
    const video = await fetch(`${base}/jobs/job_fixture/video`);
    assert.equal(video.status, 200, 'legacy job video still streams from its server copy');
    assert.equal(await video.text(), 'abc');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
