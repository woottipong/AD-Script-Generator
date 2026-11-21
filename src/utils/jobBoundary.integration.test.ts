import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import type { PersistedJobState } from '../types/ad';
import { createJobStore } from './jobStore';

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
    assert.equal((await chunk(uploadId, 3)).status, 200);
    const savedVadJob = await json('/jobs/init', 'POST', {
      uploadId,
      autoStart: false,
      title: 'งานที่สแกนเสร็จแล้ว',
      video_metadata: { fileName: 'a.mp4', fileSize: 6, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
      vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
      vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [{ spot_id: 'spot_1', start_ms: 1000, end_ms: 5000, duration_ms: 4000 }] },
    });
    assert.equal(savedVadJob.status, 200);
    const savedVadData = await savedVadJob.json() as { job: PersistedJobState; isRunning: boolean };
    assert.equal(savedVadData.isRunning, false);
    assert.equal(savedVadData.job.status, 'VAD_READY');
    assert.equal(savedVadData.job.title, 'งานที่สแกนเสร็จแล้ว');
    assert.equal((await json(`/jobs/${uploadId}/spots`, 'PATCH', {
      spots: [{ ...savedVadData.job.spots[0], decision: 'generate', text: 'เขียนเองก่อนรัน AI', is_edited: true }],
    })).status, 200, 'a VAD_READY job saved after upload can be edited immediately');
    const spot = { spot_id: 'a', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'generate' as const, text: 'text', is_edited: false };
    const jobDir = path.join(dir, '.data/jobs/job_fixture');
    const seed = createJobStore(path.join(dir, '.data'));
    seed.save({
      schema_version: 3, job_id: 'job_fixture', title: 'a', mode: 'generate', video_source: { kind: 'server_copy', local_file_path: path.join(jobDir, 'source_video.mp4') },
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', status: 'READY', spots: [spot], batches: [],
      vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
      vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [] },
      video_metadata: { fileName: 'a.mp4', fileSize: 3, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
    } satisfies PersistedJobState);
    seed.close();
    fs.writeFileSync(path.join(jobDir, 'source_video.mp4'), 'abc');
    assert.equal((await chunk('job_fixture', 0)).status, 409);
    const patch = (spots: unknown) => json('/jobs/job_fixture/spots', 'PATCH', { spots });
    assert.equal((await patch([])).status, 400);
    assert.equal((await patch([spot, spot])).status, 400);
    assert.equal((await patch([{ ...spot, original_start_ms: 0 }])).status, 400);
    assert.equal((await patch([{ ...spot, duration_ms: 12 }])).status, 400);
    assert.equal((await patch([{ ...spot, text: 'edited' }])).status, 200);
    const saved = (await fetch(`${base}/jobs/job_fixture`).then(r => r.json()) as { job: PersistedJobState }).job;
    assert.equal(saved.spots[0].text, 'edited');
    const video = await fetch(`${base}/jobs/job_fixture/video`);
    assert.equal(video.status, 200, 'a Generate Mode job streams its server copy');
    assert.equal(await video.text(), 'abc');

    const next = { spot_id: 'cue_002', start_ms: 8000, end_ms: 9000, duration_ms: 1000, original_start_ms: 8000, original_end_ms: 9000, decision: 'generate', text: 'บรรทัดถัดไป', is_edited: false };
    const cue = { spot_id: 'cue_001', start_ms: 5500, end_ms: 6500, duration_ms: 1000, original_start_ms: 5500, original_end_ms: 6500, decision: 'generate', text: 'ทับเสียงพูด', is_edited: false };
    const reviewBody = {
      video_metadata: { fileName: 'lesson.mp4', fileSize: 71225137, mimeType: 'video/mp4', width: 1920, height: 1080, durationMs: 10000, videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
      vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
      vad_output: { duration_ms: 10000, speech_segments: [{ start_ms: 6000, end_ms: 7000 }], candidate_spots: [] },
      video_source: { kind: 'local_file', file_name: 'lesson.mp4', file_size: 71225137 },
      srt_source: { file_name: 'lesson.srt', cue_count: 2 },
      spots: [cue, next],
    };
    assert.equal((await json('/jobs/review', 'POST', { ...reviewBody, spots: [] })).status, 400);
    const created = await json('/jobs/review', 'POST', reviewBody);
    assert.equal(created.status, 200);
    const { job: reviewJob } = await created.json() as { job: { job_id: string; title: string; mode: string; status: string; batches: unknown[] } };
    assert.equal(reviewJob.title, 'lesson', 'the Job Title defaults to the video file name');
    assert.equal(reviewJob.mode, 'review');
    assert.equal(reviewJob.status, 'READY');
    assert.deepEqual(reviewJob.batches, []);
    const reviewDir = path.join(dir, '.data/jobs', reviewJob.job_id);
    assert.deepEqual(fs.readdirSync(reviewDir), ['vad_output.json'], 'Review Mode keeps no video on the server');
    assert.ok(fs.existsSync(path.join(dir, '.data/envisio.db')), 'Jobs are stored in the database');
    assert.equal((await fetch(`${base}/jobs/${reviewJob.job_id}`).then(r => r.json()) as { job: { job_id: string } }).job.job_id, reviewJob.job_id);
    assert.equal((await json(`/jobs/${reviewJob.job_id}/spots`, 'PATCH', { spots: [{ ...cue, text: 'แก้คำผิด', is_edited: true }, next] })).status, 200, 'text edit on a line overlapping speech saves');
    assert.equal((await json(`/jobs/${reviewJob.job_id}/spots`, 'PATCH', { spots: [{ ...cue, end_ms: 8500, duration_ms: 3000 }, next] })).status, 400, 'retiming into a neighbour is rejected');
    assert.equal((await json(`/jobs/${reviewJob.job_id}/spots`, 'PATCH', { spots: [{ ...cue, end_ms: 7900, duration_ms: 2400 }, next] })).status, 200, 'retiming over speech up to the neighbour saves');
    assert.equal((await json(`/jobs/${reviewJob.job_id}/start`, 'POST', {})).status, 409);
    assert.equal((await json(`/jobs/${reviewJob.job_id}/analyze-batch`, 'POST', { batch_id: 'batch_1' })).status, 409);
    assert.equal((await fetch(`${base}/jobs/${reviewJob.job_id}/video`)).status, 404);

    const rename = (jobId: string, title: unknown) => json(`/jobs/${jobId}`, 'PATCH', { title });
    const renamed = await rename(reviewJob.job_id, '  บทเรียนที่ 1  ');
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json() as { job: { title: string } }).job.title, 'บทเรียนที่ 1');
    assert.equal((await fetch(`${base}/jobs/${reviewJob.job_id}`).then(r => r.json()) as { job: { title: string } }).job.title, 'บทเรียนที่ 1', 'the new title is stored');
    assert.equal((await rename(reviewJob.job_id, '   ')).status, 400, 'a rename cannot clear the title');
    assert.equal((await rename(reviewJob.job_id, 'ก'.repeat(121))).status, 400);
    assert.equal((await rename('job_missing', 'ชื่อ')).status, 404);
    const titled = await json('/jobs/review', 'POST', { ...reviewBody, title: 'ตั้งชื่อเอง' });
    assert.equal((await titled.json() as { job: { title: string } }).job.title, 'ตั้งชื่อเอง');
    assert.equal((await json('/jobs/review', 'POST', { ...reviewBody, title: 'ก'.repeat(121) })).status, 400);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
