import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PersistedJobState } from '../types/ad';
import { createJobStore, isJobId } from './jobStore';

function tempStore() {
  const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-job-store-')), 'jobs');
  return { dataDir, store: createJobStore(dataDir) };
}

function job(jobId: string): PersistedJobState {
  return { job_id: jobId, status: 'READY', video_metadata: { fileName: `${jobId}.mp4` }, batches: [], spots: [] } as unknown as PersistedJobState;
}

test('accepts only job_ ids made of safe characters', () => {
  assert.equal(isJobId('job_1795_ab-c'), true);
  for (const id of ['job_', 'job_../x', 'other_1', 'job_a/b', 42, undefined]) assert.equal(isJobId(id), false, String(id));
});

test('save writes job.json and the active pointer, leaving no temp files', () => {
  const { dataDir, store } = tempStore();
  store.save(job('job_a'));
  assert.equal(store.load('job_a')?.job_id, 'job_a');
  assert.equal(store.activeJobId(), 'job_a');
  assert.equal(store.loadActive()?.job_id, 'job_a');
  store.save(job('job_b'), false);
  assert.equal(store.activeJobId(), 'job_a');
  assert.deepEqual(fs.readdirSync(dataDir).filter((name) => name.endsWith('.tmp')), []);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'job_a')), ['job.json']);
});

test('a failed save leaves the previous job.json intact', () => {
  const { dataDir, store } = tempStore();
  store.save(job('job_a'), false);
  fs.mkdirSync(path.join(dataDir, 'job_a', 'job.json.tmp'));
  const changed = { ...job('job_a'), status: 'FAILED' } as PersistedJobState;
  assert.throws(() => store.save(changed, false));
  assert.equal(store.load('job_a')?.status, 'READY');
});

test('a corrupt pointer makes the strict read throw and the lenient read return null', () => {
  const { dataDir, store } = tempStore();
  assert.equal(store.activeJobId(), null);
  fs.writeFileSync(path.join(dataDir, 'active_job.json'), '{bad json');
  assert.throws(() => store.activeJobId());
  assert.equal(store.loadActive(), null);
});

test('clearActive removes the pointer only for the active job', () => {
  const { dataDir, store } = tempStore();
  store.save(job('job_a'));
  store.clearActive('job_b');
  assert.equal(store.activeJobId(), 'job_a');
  store.clearActive('job_a');
  assert.equal(store.activeJobId(), null);
  assert.equal(fs.existsSync(path.join(dataDir, 'job_a', 'job.json')), true);
});

test('load reports unreadable or invalid jobs as missing', () => {
  const { dataDir, store } = tempStore();
  fs.mkdirSync(path.join(dataDir, 'job_broken'));
  fs.writeFileSync(path.join(dataDir, 'job_broken', 'job.json'), '{bad json');
  assert.equal(store.load('job_broken'), null);
  assert.equal(store.load('job_missing'), null);
  assert.equal(store.load('../outside'), null);
  assert.throws(() => store.dirOf('../outside'));
});

test('list and filesDir cover stored jobs and unfinished uploads but not escapes', () => {
  const { dataDir, store } = tempStore();
  store.save(job('job_a'));
  fs.mkdirSync(path.join(dataDir, 'job_upload'));
  fs.writeFileSync(path.join(dataDir, 'job_upload', 'source_video.mp4'), 'abc');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-outside-'));
  fs.writeFileSync(path.join(outside, 'job.json'), JSON.stringify(job('job_link')));
  fs.symlinkSync(outside, path.join(dataDir, 'job_link'));

  const listed = store.list().map(({ job_id, is_upload, size_bytes }) => ({ job_id, is_upload, has_size: size_bytes > 0 }));
  assert.deepEqual(listed.sort((a, b) => a.job_id.localeCompare(b.job_id)), [
    { job_id: 'job_a', is_upload: false, has_size: true },
    { job_id: 'job_upload', is_upload: true, has_size: true },
  ]);
  assert.equal(store.filesDir('job_a'), path.join(dataDir, 'job_a'));
  assert.equal(store.filesDir('job_upload'), path.join(dataDir, 'job_upload'));
  assert.equal(store.filesDir('job_link'), null);
  assert.equal(store.filesDir('job_missing'), null);
});

test('a legacy job without schema_version loads as a Generate Mode job with a server copy', () => {
  const { dataDir, store } = tempStore();
  const legacyDir = path.join(dataDir, 'job_legacy');
  fs.mkdirSync(legacyDir);
  const videoPath = path.join(legacyDir, 'source_video.mp4');
  fs.writeFileSync(path.join(legacyDir, 'job.json'), JSON.stringify({ ...job('job_legacy'), local_file_path: videoPath }));

  const loaded = store.load('job_legacy')!;
  assert.equal(loaded.schema_version, 2);
  assert.equal(loaded.mode, 'generate');
  assert.deepEqual(loaded.video_source, { kind: 'server_copy', local_file_path: videoPath });
  assert.equal('local_file_path' in loaded, false);

  store.save(loaded, false);
  const onDisk = JSON.parse(fs.readFileSync(path.join(legacyDir, 'job.json'), 'utf-8'));
  assert.equal(onDisk.schema_version, 2);
  assert.equal(onDisk.mode, 'generate');
  assert.equal(onDisk.local_file_path, undefined);
});

test('a legacy job that never recorded a video path points at its own source_video.mp4', () => {
  const { dataDir, store } = tempStore();
  fs.mkdirSync(path.join(dataDir, 'job_nopath'));
  fs.writeFileSync(path.join(dataDir, 'job_nopath', 'job.json'), JSON.stringify(job('job_nopath')));
  assert.deepEqual(store.load('job_nopath')!.video_source, {
    kind: 'server_copy',
    local_file_path: path.join(dataDir, 'job_nopath', 'source_video.mp4'),
  });
});

test('a schema version 2 job loads unchanged, including its mode and video source', () => {
  const { store } = tempStore();
  const review = {
    ...job('job_review'), schema_version: 2, mode: 'review',
    video_source: { kind: 'url', url: 'https://example.invalid/clip.mp4' },
    srt_source: { file_name: 'clip.srt', cue_count: 3, imported_at: '2026-11-20T00:00:00Z' },
  } as unknown as PersistedJobState;
  store.save(review, false);
  const loaded = store.load('job_review')!;
  assert.equal(loaded.mode, 'review');
  assert.deepEqual(loaded.video_source, { kind: 'url', url: 'https://example.invalid/clip.mp4' });
  assert.equal(loaded.srt_source?.cue_count, 3);
});
