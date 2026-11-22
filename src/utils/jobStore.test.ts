import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ADSpot, PersistedJobState } from '../types/ad';
import { createJobStore, isJobId } from './jobStore';

function withStore(run: (store: ReturnType<typeof createJobStore>, dataDir: string, jobsDir: string) => void | Promise<void>) {
  return async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-job-store-'));
    const store = createJobStore(dataDir);
    try {
      await run(store, dataDir, path.join(dataDir, 'jobs'));
    } finally {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

const spot = (id: string, start: number, text = ''): ADSpot => ({
  spot_id: id, start_ms: start, end_ms: start + 4000, duration_ms: 4000, decision: 'pending', text, is_edited: false,
  original_start_ms: start, original_end_ms: start + 4000,
});

function generateJob(jobId: string, jobsDir: string): PersistedJobState {
  return {
    schema_version: 3, job_id: jobId, title: `งาน ${jobId}`, mode: 'generate',
    video_source: { kind: 'server_copy', local_file_path: path.join(jobsDir, jobId, 'source_video.mp4') },
    created_at: '2026-11-21T00:00:00.000Z', updated_at: '2026-11-21T00:00:00.000Z', status: 'VAD_READY',
    video_metadata: { fileName: `${jobId}.mp4`, fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 20000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
    vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
    vad_output: { duration_ms: 20000, speech_segments: [{ start_ms: 0, end_ms: 1000 }], candidate_spots: [] },
    batches: [{ batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 20000, window_start_ms: 0, window_end_ms: 20000, candidate_spots: [], status: 'pending', retry_count: 0 }],
    spots: [spot('b', 9000), spot('a', 2000, 'บทแรก')],
    gemini_file_name: 'files/x', progress_percent: 12.5,
  };
}

function reviewJob(jobId: string): PersistedJobState {
  return {
    schema_version: 3, job_id: jobId, title: 'บทเรียน', mode: 'review',
    video_source: { kind: 'url', url: 'https://example.invalid/lesson.mp4' },
    srt_source: { file_name: 'lesson.srt', cue_count: 1, imported_at: '2026-11-21T00:00:00.000Z' },
    created_at: '2026-11-21T00:00:00.000Z', updated_at: '2026-11-21T00:00:00.000Z', status: 'READY',
    video_metadata: { fileName: 'lesson.mp4', fileSize: 0, mimeType: 'video/mp4', width: 1920, height: 1080, durationMs: 20000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
    vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 400, speechPaddingMs: 200, minAdGapMs: 3000 },
    vad_output: { duration_ms: 20000, speech_segments: [], candidate_spots: [] },
    batches: [],
    spots: [{ ...spot('cue_001', 500, 'ข้อความ'), decision: 'generate', reason: 'นำเข้า', is_edited: true }],
  };
}

test('accepts only job_ ids made of safe characters', () => {
  assert.equal(isJobId('job_1795_ab-c'), true);
  for (const id of ['job_', 'job_../x', 'other_1', 'job_a/b', 42, undefined]) assert.equal(isJobId(id), false, String(id));
});

test('a Generate Mode job round-trips through the database and its VAD file', withStore((store, dataDir, jobsDir) => {
  const job = generateJob('job_gen', jobsDir);
  store.save(job);
  assert.ok(fs.existsSync(path.join(dataDir, 'envisio.db')));
  assert.deepEqual(fs.readdirSync(path.join(jobsDir, 'job_gen')), ['vad_output.json']);
  assert.equal(store.exists('job_gen'), true);
  assert.equal(store.exists('job_missing'), false);
  assert.deepEqual(store.load('job_gen'), job, 'every field and the spot order come back unchanged');

  const meta = store.loadMeta('job_gen');
  assert.equal(meta?.title, 'งาน job_gen');
  assert.deepEqual(meta?.video_source, job.video_source);
  assert.equal(store.loadMeta('job_missing'), null);
  assert.deepEqual(store.loadSpots('job_gen'), job.spots, 'spots load alone in their saved order');
  assert.deepEqual(store.loadSpots('job_missing'), []);
}));

test('a Review Mode job round-trips, including its SRT source and optional spot fields', withStore((store) => {
  const job = reviewJob('job_rev');
  store.save(job);
  assert.deepEqual(store.load('job_rev'), job);
}));

test('rename changes only the title', withStore(async (store, _dataDir, jobsDir) => {
  const job = generateJob('job_gen', jobsDir);
  store.save(job);
  const savedAt = store.load('job_gen')!.updated_at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.rename('job_gen', 'ชื่อใหม่'), true);
  const renamed = store.load('job_gen')!;
  assert.equal(renamed.title, 'ชื่อใหม่');
  assert.deepEqual(renamed.spots, job.spots);
  assert.ok(renamed.updated_at > savedAt, 'renaming counts as a change');
  assert.equal(store.rename('job_missing', 'x'), false);
}));

test('saveProgress changes only the progress fields and reports a missing job', withStore((store, _dataDir, jobsDir) => {
  const job = { ...generateJob('job_gen', jobsDir), status: 'ANALYZING' as const, active_model: 'gemini-a' };
  store.save(job);

  assert.equal(store.saveProgress('job_gen', { progress_stage: 'ชุดที่ 2/3', progress_percent: 40, active_model: 'gemini-b' }), true);
  const progressed = store.load('job_gen')!;
  assert.equal(progressed.progress_stage, 'ชุดที่ 2/3');
  assert.equal(progressed.progress_percent, 40);
  assert.equal(progressed.active_model, 'gemini-b');
  assert.deepEqual({ ...progressed, progress_stage: undefined, progress_percent: job.progress_percent, active_model: job.active_model, updated_at: job.updated_at },
    { ...job, progress_stage: undefined, updated_at: job.updated_at }, 'spots, title, batches and every other field are unchanged');

  assert.equal(store.saveProgress('job_gen', { progress_percent: 100 }), true);
  const cleared = store.load('job_gen')!;
  assert.equal(cleared.progress_stage, undefined);
  assert.equal(cleared.active_model, undefined);
  assert.equal(cleared.progress_percent, 100);

  assert.equal(store.saveProgress('job_missing', { progress_percent: 1 }), false);
}));

test('saving spots or status again leaves vad_output.json untouched', withStore((store, _dataDir, jobsDir) => {
  const job = generateJob('job_gen', jobsDir);
  store.save(job);
  const vadFile = path.join(jobsDir, 'job_gen', 'vad_output.json');
  const before = fs.statSync(vadFile).mtimeMs;
  fs.utimesSync(vadFile, new Date('2001-01-01'), new Date('2001-01-01'));
  store.save({ ...job, status: 'READY', spots: [{ ...job.spots[0], text: 'แก้แล้ว' }, job.spots[1]] });
  assert.equal(fs.statSync(vadFile).mtime.toISOString(), new Date('2001-01-01').toISOString());
  assert.ok(before > 0);
  const loaded = store.load('job_gen')!;
  assert.equal(loaded.status, 'READY');
  assert.equal(loaded.spots[0].text, 'แก้แล้ว');
  assert.deepEqual(fs.readdirSync(path.join(jobsDir, 'job_gen')), ['vad_output.json'], 'no temp files are left');
}));

test('a save that fails part-way leaves the previous job and spots in place', withStore((store, _dataDir, jobsDir) => {
  const job = generateJob('job_gen', jobsDir);
  store.save(job);
  const broken = { ...job, status: 'READY', spots: [job.spots[0], job.spots[0]] } as PersistedJobState;
  assert.throws(() => store.save(broken), 'a duplicate spot id breaks the insert');
  const loaded = store.load('job_gen')!;
  assert.equal(loaded.status, 'VAD_READY');
  assert.deepEqual(loaded.spots, job.spots);
}));

test('a first save that fails leaves no VAD file behind', withStore((store, _dataDir, jobsDir) => {
  const job = generateJob('job_new', jobsDir);
  assert.throws(() => store.save({ ...job, spots: [job.spots[0], job.spots[0]] }));
  assert.equal(store.exists('job_new'), false);
  assert.equal(fs.existsSync(path.join(jobsDir, 'job_new', 'vad_output.json')), false, 'a failed create leaves no orphan file');
  store.save(job);
  assert.deepEqual(store.load('job_new'), job, 'retrying the create works');
}));

test('load reports a job whose VAD file is missing or corrupt as missing', withStore((store, _dataDir, jobsDir) => {
  store.save(generateJob('job_gone', jobsDir));
  store.save(generateJob('job_bad', jobsDir));
  fs.rmSync(path.join(jobsDir, 'job_gone', 'vad_output.json'));
  fs.writeFileSync(path.join(jobsDir, 'job_bad', 'vad_output.json'), '{bad json');
  assert.equal(store.load('job_gone'), null);
  assert.equal(store.load('job_bad'), null);
  assert.equal(store.load('job_missing'), null);
  assert.equal(store.load('../outside'), null);
  assert.throws(() => store.dirOf('../outside'));
}));

test('list shows jobs and unfinished uploads newest first, and deleteJob removes them but not escapes', withStore(async (store, _dataDir, jobsDir) => {
  store.save(reviewJob('job_old'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.save({ ...generateJob('job_new', jobsDir), status: 'ANALYZING' });
  fs.writeFileSync(path.join(jobsDir, 'job_new', 'source_video.mp4'), 'video');
  fs.mkdirSync(path.join(jobsDir, 'job_upload'));
  fs.writeFileSync(path.join(jobsDir, 'job_upload', 'source_video.mp4'), 'abc');
  fs.utimesSync(path.join(jobsDir, 'job_upload', 'source_video.mp4'), new Date('2001-01-01'), new Date('2001-01-01'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-outside-'));
  fs.writeFileSync(path.join(outside, 'source_video.mp4'), 'abc');
  fs.symlinkSync(outside, path.join(jobsDir, 'job_link'));

  assert.deepEqual(
    store.list().map(({ job_id, title, mode, status, is_upload, duration_ms, spot_count, progress_percent }) => ({
      job_id, title, mode, status, is_upload, duration_ms, spot_count, progress_percent,
    })),
    [
      { job_id: 'job_new', title: 'งาน job_new', mode: 'generate', status: 'ANALYZING', is_upload: false, duration_ms: 20000, spot_count: 0, progress_percent: 12.5 },
      { job_id: 'job_old', title: 'บทเรียน', mode: 'review', status: 'READY', is_upload: false, duration_ms: 20000, spot_count: 1, progress_percent: undefined },
      { job_id: 'job_upload', title: undefined, mode: undefined, status: undefined, is_upload: true, duration_ms: undefined, spot_count: undefined, progress_percent: undefined },
    ],
  );

  assert.equal(store.deleteJob('job_link'), false);
  assert.ok(fs.existsSync(path.join(outside, 'source_video.mp4')), 'a symlink escape is never followed');
  assert.equal(store.deleteJob('job_missing'), false);
  assert.equal(store.deleteJob('job_new'), true);
  assert.equal(store.exists('job_new'), false);
  assert.equal(fs.existsSync(path.join(jobsDir, 'job_new')), false);
  assert.equal(store.deleteJob('job_upload'), true);
  assert.equal(fs.existsSync(path.join(jobsDir, 'job_upload')), false);
  assert.deepEqual(store.list().map((job) => job.job_id), ['job_old']);
  fs.rmSync(outside, { recursive: true, force: true });
}));

test('reopening the database keeps its Jobs', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-job-store-'));
  const job = generateJob('job_gen', path.join(dataDir, 'jobs'));
  try {
    const first = createJobStore(dataDir);
    first.save(job);
    first.close();
    const reopened = createJobStore(dataDir);
    assert.deepEqual(reopened.load('job_gen'), job, 'migrations already applied are not run again');
    reopened.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a database from a newer server is refused instead of being written to', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-job-store-'));
  try {
    const db = new DatabaseSync(path.join(dataDir, 'envisio.db'));
    db.exec('PRAGMA user_version = 99');
    db.close();
    assert.throws(() => createJobStore(dataDir), /schema version 99/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a Job keeps its Job Owner, lists filter by owner, and the owner email can follow the Author', withStore((store, _dataDir, jobsDir) => {
  store.save({ ...generateJob('job_mine', jobsDir), owner_sub: 'sub-a', owner_email: 'a@old.example' });
  store.save({ ...reviewJob('job_theirs'), owner_sub: 'sub-b', owner_email: 'b@example.com' });
  store.save(reviewJob('job_legacy'));
  fs.mkdirSync(path.join(jobsDir, 'job_upload'));
  fs.writeFileSync(path.join(jobsDir, 'job_upload', 'source_video.mp4'), 'abc');

  const { owner_sub: _sub, owner_email: _email, ...withoutOwner } = store.load('job_mine')!;
  store.save({ ...withoutOwner, title: 'renamed' });
  assert.equal(store.loadMeta('job_mine')?.owner_sub, 'sub-a', 'saving a Job never changes its Job Owner');
  assert.equal(store.load('job_mine')?.owner_email, 'a@old.example');
  assert.equal(store.loadMeta('job_legacy')?.owner_sub, undefined, 'a Job made before sign-in has no Job Owner');

  assert.deepEqual(store.list('sub-a').map(({ job_id, owner_email }) => ({ job_id, owner_email })), [{ job_id: 'job_mine', owner_email: 'a@old.example' }]);
  assert.deepEqual(store.list().map((job) => job.job_id).sort(), ['job_legacy', 'job_mine', 'job_theirs', 'job_upload']);
  assert.equal(store.list().find((job) => job.job_id === 'job_legacy')?.owner_email, null);

  store.updateOwnerEmail('sub-a', 'a@new.example');
  assert.equal(store.loadMeta('job_mine')?.owner_email, 'a@new.example');
  assert.equal(store.loadMeta('job_theirs')?.owner_email, 'b@example.com');
}));

test('daily AI quota counts distinct jobs per author and day across connections', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envisio-ai-quota-'));
  const store = createJobStore(dataDir);
  const second = createJobStore(dataDir);
  try {
    for (const jobId of ['job_one', 'job_two', 'job_three']) {
      assert.equal(store.reserveAiUsage('author-a', '2026-11-23', jobId, 3), true);
    }
    assert.equal(second.reserveAiUsage('author-a', '2026-11-23', 'job_one', 3), true);
    assert.equal(second.reserveAiUsage('author-a', '2026-11-23', 'job_four', 3), false);
    assert.equal(second.reserveAiUsage('author-b', '2026-11-23', 'job_four', 3), true);
    assert.equal(second.reserveAiUsage('author-a', '2026-11-24', 'job_four', 3), true);
    assert.equal(store.aiUsage('author-a', '2026-11-23').length, 3);
  } finally {
    second.close();
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a database from before Job Owners upgrades and keeps its Jobs without an owner', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-job-store-'));
  try {
    const first = createJobStore(dataDir);
    first.save(reviewJob('job_before'));
    first.close();
    const db = new DatabaseSync(path.join(dataDir, 'envisio.db'));
    db.exec('DROP TABLE ai_analysis_stops; DROP TABLE ai_daily_usage; DROP INDEX idx_jobs_owner; ALTER TABLE jobs DROP COLUMN owner_sub; ALTER TABLE jobs DROP COLUMN owner_email; PRAGMA user_version = 1');
    db.close();
    const upgraded = createJobStore(dataDir);
    assert.equal(upgraded.load('job_before')?.title, 'บทเรียน');
    assert.equal(upgraded.loadMeta('job_before')?.owner_sub, undefined);
    upgraded.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
