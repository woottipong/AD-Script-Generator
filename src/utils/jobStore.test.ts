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
