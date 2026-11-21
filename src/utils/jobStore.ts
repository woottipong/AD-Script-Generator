import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ADSpot, JobMode, JobStatus, PersistedJobState } from '../types/ad';

const JOB_ID_PATTERN = /^job_[a-zA-Z0-9_-]+$/;

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value);
}

type StoredJobSummary = {
  job_id: string;
  file_name: string;
  updated_at: string;
  size_bytes: number;
  is_upload: boolean;
  title?: string;
  mode?: JobMode;
  status?: JobStatus;
};

/** Everything a Job holds except its VAD output and AD Spots. */
export type JobMeta = Omit<PersistedJobState, 'vad_output' | 'spots'>;

const SCHEMA = `
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  file_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  video_source_kind TEXT NOT NULL,
  video_source_json TEXT NOT NULL,
  video_metadata_json TEXT NOT NULL,
  vad_config_json TEXT NOT NULL,
  ad_settings_json TEXT,
  srt_source_json TEXT,
  batches_json TEXT NOT NULL,
  gemini_file_uri TEXT,
  gemini_file_name TEXT,
  gemini_file_mime_type TEXT,
  gemini_file_expires_at TEXT,
  progress_stage TEXT,
  progress_percent REAL,
  active_model TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at DESC);
CREATE TABLE IF NOT EXISTS job_spots (
  job_id TEXT NOT NULL,
  spot_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  decision TEXT NOT NULL,
  text TEXT NOT NULL,
  reason TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  original_start_ms INTEGER NOT NULL,
  original_end_ms INTEGER NOT NULL,
  PRIMARY KEY (job_id, spot_id),
  FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_spots_order ON job_spots(job_id, position);
`;

type JobRow = Record<string, string | number | null>;

const optional = <T>(value: unknown): T | undefined => (value === null ? undefined : value as T);
const parsed = <T>(value: unknown): T | undefined => (value === null ? undefined : JSON.parse(value as string) as T);

/** Rebuilds the Job fields, leaving out the ones never set so a load matches what was saved. */
function metaFromRow(row: JobRow): JobMeta {
  const meta = {
    schema_version: row.schema_version as PersistedJobState['schema_version'],
    job_id: row.job_id as string,
    title: row.title as string,
    mode: row.mode as JobMode,
    video_source: JSON.parse(row.video_source_json as string),
    srt_source: parsed<PersistedJobState['srt_source']>(row.srt_source_json),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    status: row.status as JobStatus,
    video_metadata: JSON.parse(row.video_metadata_json as string),
    vad_config: JSON.parse(row.vad_config_json as string),
    ad_settings: parsed<PersistedJobState['ad_settings']>(row.ad_settings_json),
    gemini_file_uri: optional<string>(row.gemini_file_uri),
    gemini_file_name: optional<string>(row.gemini_file_name),
    gemini_file_mime_type: optional<string>(row.gemini_file_mime_type),
    gemini_file_expires_at: optional<string>(row.gemini_file_expires_at),
    batches: JSON.parse(row.batches_json as string),
    progress_stage: optional<string>(row.progress_stage),
    progress_percent: optional<number>(row.progress_percent),
    active_model: optional<string>(row.active_model),
    error_message: optional<string>(row.error_message),
  };
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)) as JobMeta;
}

function spotFromRow(row: JobRow): ADSpot {
  const spot: ADSpot = {
    spot_id: row.spot_id as string,
    start_ms: row.start_ms as number,
    end_ms: row.end_ms as number,
    duration_ms: row.duration_ms as number,
    decision: row.decision as ADSpot['decision'],
    text: row.text as string,
    is_edited: row.is_edited === 1,
    original_start_ms: row.original_start_ms as number,
    original_end_ms: row.original_end_ms as number,
  };
  if (row.reason !== null) spot.reason = row.reason as string;
  return spot;
}

function sizeOf(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) total += sizeOf(file);
    else if (entry.isFile()) total += fs.lstatSync(file).size;
  }
  return total;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function writeAtomically(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * Owns Job storage: metadata, Analysis Batches and AD Spots in `<dataDir>/envisio.db`, and per-Job files in
 * `<dataDir>/jobs/<job_id>/` (`vad_output.json`, written once, and the Generate Mode `source_video.mp4`).
 * There is no active Job: the client names the Job it opens.
 */
export function createJobStore(dataDir: string) {
  const jobsDir = path.join(dataDir, 'jobs');
  fs.mkdirSync(jobsDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'envisio.db'));
  db.exec(SCHEMA);

  const upsertJob = db.prepare(`INSERT INTO jobs (job_id, schema_version, title, mode, status, file_name, duration_ms, video_source_kind,
      video_source_json, video_metadata_json, vad_config_json, ad_settings_json, srt_source_json, batches_json, gemini_file_uri,
      gemini_file_name, gemini_file_mime_type, gemini_file_expires_at, progress_stage, progress_percent, active_model, error_message,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET schema_version = excluded.schema_version, title = excluded.title, mode = excluded.mode,
      status = excluded.status, file_name = excluded.file_name, duration_ms = excluded.duration_ms,
      video_source_kind = excluded.video_source_kind, video_source_json = excluded.video_source_json,
      video_metadata_json = excluded.video_metadata_json, vad_config_json = excluded.vad_config_json,
      ad_settings_json = excluded.ad_settings_json, srt_source_json = excluded.srt_source_json, batches_json = excluded.batches_json,
      gemini_file_uri = excluded.gemini_file_uri, gemini_file_name = excluded.gemini_file_name,
      gemini_file_mime_type = excluded.gemini_file_mime_type, gemini_file_expires_at = excluded.gemini_file_expires_at,
      progress_stage = excluded.progress_stage, progress_percent = excluded.progress_percent, active_model = excluded.active_model,
      error_message = excluded.error_message, created_at = excluded.created_at, updated_at = excluded.updated_at`);
  const deleteSpots = db.prepare('DELETE FROM job_spots WHERE job_id = ?');
  const insertSpot = db.prepare(`INSERT INTO job_spots (job_id, spot_id, position, start_ms, end_ms, duration_ms, decision, text, reason,
      is_edited, original_start_ms, original_end_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectJob = db.prepare('SELECT * FROM jobs WHERE job_id = ?');
  const selectSpots = db.prepare('SELECT * FROM job_spots WHERE job_id = ? ORDER BY position');
  const selectSummaries = db.prepare('SELECT job_id, title, mode, status, file_name, updated_at FROM jobs ORDER BY updated_at DESC');
  const updateTitle = db.prepare('UPDATE jobs SET title = ?, updated_at = ? WHERE job_id = ?');
  const deleteJobRow = db.prepare('DELETE FROM jobs WHERE job_id = ?');

  function dirOf(jobId: string): string {
    if (!isJobId(jobId)) throw new Error('Invalid job ID');
    return path.join(jobsDir, jobId);
  }

  /** A real folder directly inside `jobsDir`; a symlink pointing elsewhere never counts. */
  function isInsideJobsDir(dir: string): boolean {
    return fs.lstatSync(dir).isDirectory() && path.dirname(fs.realpathSync(dir)) === fs.realpathSync(jobsDir);
  }

  function row(jobId: string): JobRow | undefined {
    return isJobId(jobId) ? selectJob.get(jobId) as JobRow | undefined : undefined;
  }

  function exists(jobId: string): boolean {
    return row(jobId) !== undefined;
  }

  function loadMeta(jobId: string): JobMeta | null {
    const found = row(jobId);
    return found ? metaFromRow(found) : null;
  }

  /** A Job without a readable VAD file is reported as missing; a database failure still throws. */
  function load(jobId: string): PersistedJobState | null {
    const found = row(jobId);
    if (!found) return null;
    let vadOutput: PersistedJobState['vad_output'];
    try {
      vadOutput = JSON.parse(fs.readFileSync(path.join(dirOf(jobId), 'vad_output.json'), 'utf-8'));
    } catch (err) {
      if (isMissing(err) || err instanceof SyntaxError) return null;
      throw err;
    }
    const spots = (selectSpots.all(jobId) as JobRow[]).map(spotFromRow);
    return { ...metaFromRow(found), vad_output: vadOutput, spots } as PersistedJobState;
  }

  /** VAD output never changes after the Job is created, so only the first save writes its file. */
  function save(job: PersistedJobState): void {
    const jobDir = dirOf(job.job_id);
    fs.mkdirSync(jobDir, { recursive: true });
    const vadFile = path.join(jobDir, 'vad_output.json');
    const createsVad = !fs.existsSync(vadFile);
    if (createsVad) writeAtomically(vadFile, JSON.stringify(job.vad_output));
    const updatedAt = new Date().toISOString();
    const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
    db.exec('BEGIN IMMEDIATE');
    try {
      upsertJob.run(job.job_id, job.schema_version, job.title, job.mode, job.status, job.video_metadata.fileName,
        job.video_metadata.durationMs, job.video_source.kind, JSON.stringify(job.video_source), JSON.stringify(job.video_metadata),
        JSON.stringify(job.vad_config), json(job.ad_settings), json(job.srt_source), JSON.stringify(job.batches),
        job.gemini_file_uri ?? null, job.gemini_file_name ?? null, job.gemini_file_mime_type ?? null, job.gemini_file_expires_at ?? null,
        job.progress_stage ?? null, job.progress_percent ?? null, job.active_model ?? null, job.error_message ?? null,
        job.created_at, updatedAt);
      deleteSpots.run(job.job_id);
      job.spots.forEach((spot, position) => {
        insertSpot.run(job.job_id, spot.spot_id, position, spot.start_ms, spot.end_ms, spot.duration_ms, spot.decision, spot.text,
          spot.reason ?? null, spot.is_edited ? 1 : 0, spot.original_start_ms, spot.original_end_ms);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // A Job that was never created must not leave a VAD file that no row or listing can reach.
      if (createsVad) fs.rmSync(vadFile, { force: true });
      throw err;
    }
    job.updated_at = updatedAt;
  }

  function rename(jobId: string, title: string): boolean {
    return isJobId(jobId) && Number(updateTitle.run(title, new Date().toISOString(), jobId).changes) > 0;
  }

  /** A Generate Mode upload whose Job was never created: its folder holds only the video copy. */
  function findUnfinishedUpload(jobId: string): { dir: string; updatedAt: string } | null {
    if (!isJobId(jobId) || exists(jobId)) return null;
    const dir = path.join(jobsDir, jobId);
    try {
      if (!isInsideJobsDir(dir)) return null;
      const entries = fs.readdirSync(dir);
      if (entries.length !== 1 || entries[0] !== 'source_video.mp4') return null;
      const stat = fs.lstatSync(path.join(dir, 'source_video.mp4'));
      return stat.isFile() ? { dir, updatedAt: stat.mtime.toISOString() } : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  function folderSize(jobId: string): number {
    const dir = path.join(jobsDir, jobId);
    try {
      return isInsideJobsDir(dir) ? sizeOf(dir) : 0;
    } catch (err) {
      if (isMissing(err)) return 0;
      throw err;
    }
  }

  /** Every stored Job and Unfinished Upload, most recently changed first. */
  function list(): StoredJobSummary[] {
    const jobs = (selectSummaries.all() as JobRow[]).map((found): StoredJobSummary => ({
      job_id: found.job_id as string, file_name: found.file_name as string, updated_at: found.updated_at as string,
      size_bytes: folderSize(found.job_id as string), is_upload: false,
      title: found.title as string, mode: found.mode as JobMode, status: found.status as JobStatus,
    }));
    const uploads = fs.readdirSync(jobsDir).flatMap((name): StoredJobSummary[] => {
      const upload = findUnfinishedUpload(name);
      if (!upload) return [];
      return [{ job_id: name, file_name: `อัปโหลดไม่เสร็จ (${name})`, updated_at: upload.updatedAt, size_bytes: folderSize(name), is_upload: true }];
    });
    return [...jobs, ...uploads].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  /**
   * Removes a Job (its folder, row and spots) or an Unfinished Upload; false when there is neither.
   * The folder goes first so a failure leaves a row that a retry can still delete.
   */
  function deleteJob(jobId: string): boolean {
    if (exists(jobId)) {
      const dir = dirOf(jobId);
      if (fs.existsSync(dir) && isInsideJobsDir(dir)) fs.rmSync(dir, { recursive: true, force: true });
      deleteJobRow.run(jobId);
      return true;
    }
    const upload = findUnfinishedUpload(jobId);
    if (!upload) return false;
    fs.rmSync(upload.dir, { recursive: true, force: true });
    return true;
  }

  function close(): void {
    db.close();
  }

  return { dirOf, exists, loadMeta, load, save, rename, list, deleteJob, close };
}
