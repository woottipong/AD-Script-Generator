import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ADSpot, JobMode, JobStatus, PersistedJobState } from '../types/ad';

const JOB_ID_PATTERN = /^job_[a-zA-Z0-9_-]+$/;

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value);
}

export type StoredJobSummary = {
  job_id: string;
  file_name: string;
  updated_at: string;
  is_upload: boolean;
  title?: string;
  mode?: JobMode;
  status?: JobStatus;
  duration_ms?: number;
  spot_count?: number;
  progress_percent?: number;
  error_message?: string;
  /** The Job Owner's email; null for a Job with no Job Owner. */
  owner_email?: string | null;
  /** Whether the signed-in Author owns this Job (derived by `GET /api/jobs` from `owner_sub`). */
  is_owner?: boolean;
};

/** Internal store list item carrying `owner_sub` so `GET /api/jobs` can derive `is_owner` without leaking `sub`. */
export type StoredJobRecord = StoredJobSummary & { owner_sub?: string | null };

/** Everything a Job holds except its VAD output and AD Spots. */
export type JobMeta = Omit<PersistedJobState, 'vad_output' | 'spots'>;

type AnalysisAdmission = { authorSub: string; day: string; limit: number };

/**
 * Schema changes in order: a database at `user_version` N has run the first N. A released migration is
 * never edited; a schema change is a new entry at the end, which every database runs once on next start.
 */
const MIGRATIONS = [
  `CREATE TABLE jobs (
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
  CREATE INDEX idx_jobs_updated ON jobs(updated_at DESC);
  CREATE TABLE job_spots (
    job_id TEXT NOT NULL,
    spot_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    decision TEXT NOT NULL,
    text TEXT NOT NULL,
    reason TEXT,
    original_start_ms INTEGER NOT NULL,
    original_end_ms INTEGER NOT NULL,
    PRIMARY KEY (job_id, spot_id),
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
  );
  CREATE INDEX idx_job_spots_order ON job_spots(job_id, position);`,
  // Job Owner (ADR-0004): Jobs created before sign-in keep null and have no Job Owner.
  `ALTER TABLE jobs ADD COLUMN owner_sub TEXT;
  ALTER TABLE jobs ADD COLUMN owner_email TEXT;
  CREATE INDEX idx_jobs_owner ON jobs(owner_sub);`,
  `CREATE TABLE ai_daily_usage (
    author_sub TEXT NOT NULL,
    usage_day TEXT NOT NULL,
    job_id TEXT NOT NULL,
    PRIMARY KEY (author_sub, usage_day, job_id)
  );
  CREATE TABLE ai_analysis_stops (
    job_id TEXT NOT NULL,
    author_sub TEXT NOT NULL,
    stopped_at TEXT NOT NULL
  );`,
];

/** Brings the database up to the latest schema; each migration commits together with its version number. */
function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) {
    throw new Error(`envisio.db is at schema version ${current}, newer than this server supports (${MIGRATIONS.length}). Deploy the newer server instead of an older one.`);
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

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
    owner_sub: optional<string>(row.owner_sub),
    owner_email: optional<string>(row.owner_email),
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
    original_start_ms: row.original_start_ms as number,
    original_end_ms: row.original_end_ms as number,
  };
  if (row.reason !== null) spot.reason = row.reason as string;
  return spot;
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
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  try {
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }

  const upsertJob = db.prepare(`INSERT INTO jobs (job_id, schema_version, title, mode, status, file_name, duration_ms, video_source_kind,
      video_source_json, video_metadata_json, vad_config_json, ad_settings_json, srt_source_json, batches_json, gemini_file_uri,
      gemini_file_name, gemini_file_mime_type, gemini_file_expires_at, progress_stage, progress_percent, active_model, error_message,
      created_at, updated_at, owner_sub, owner_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET schema_version = excluded.schema_version, title = excluded.title, mode = excluded.mode,
      status = excluded.status, file_name = excluded.file_name, duration_ms = excluded.duration_ms,
      video_source_kind = excluded.video_source_kind, video_source_json = excluded.video_source_json,
      video_metadata_json = excluded.video_metadata_json, vad_config_json = excluded.vad_config_json,
      ad_settings_json = excluded.ad_settings_json, srt_source_json = excluded.srt_source_json, batches_json = excluded.batches_json,
      gemini_file_uri = excluded.gemini_file_uri, gemini_file_name = excluded.gemini_file_name,
      gemini_file_mime_type = excluded.gemini_file_mime_type, gemini_file_expires_at = excluded.gemini_file_expires_at,
      progress_stage = excluded.progress_stage, progress_percent = excluded.progress_percent, active_model = excluded.active_model,
      error_message = excluded.error_message, created_at = excluded.created_at, updated_at = excluded.updated_at`);
  // The Job Owner is written only when the row is first inserted; the upsert above never changes it.
  const deleteSpots = db.prepare('DELETE FROM job_spots WHERE job_id = ?');
  const insertSpot = db.prepare(`INSERT INTO job_spots (job_id, spot_id, position, start_ms, end_ms, duration_ms, decision, text, reason,
      original_start_ms, original_end_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectJob = db.prepare('SELECT * FROM jobs WHERE job_id = ?');
  const selectSpots = db.prepare('SELECT * FROM job_spots WHERE job_id = ? ORDER BY position');
  const summaryQuery = (where: string) => db.prepare(`SELECT j.job_id, j.title, j.mode, j.status, j.file_name, j.duration_ms,
      j.progress_percent, j.error_message, j.updated_at, j.owner_sub, j.owner_email,
      COUNT(CASE WHEN s.decision = 'generate' AND TRIM(s.text) <> '' THEN 1 END) AS spot_count
    FROM jobs j
    LEFT JOIN job_spots s ON s.job_id = j.job_id
    ${where}
    GROUP BY j.job_id
    ORDER BY j.updated_at DESC`);
  const selectSummaries = summaryQuery('');
  const selectOwnedSummaries = summaryQuery('WHERE j.owner_sub = ?');
  const updateOwnerEmailStmt = db.prepare('UPDATE jobs SET owner_email = ? WHERE owner_sub = ?');
  const updateTitle = db.prepare('UPDATE jobs SET title = ?, updated_at = ? WHERE job_id = ?');
  const updateProgress = db.prepare(
    'UPDATE jobs SET progress_stage = ?, progress_percent = ?, active_model = ?, updated_at = ? WHERE job_id = ?',
  );
  const deleteJobRow = db.prepare('DELETE FROM jobs WHERE job_id = ?');
  const selectAiUsage = db.prepare('SELECT job_id FROM ai_daily_usage WHERE author_sub = ? AND usage_day = ?');
  const reserveAiJob = db.prepare(`INSERT OR IGNORE INTO ai_daily_usage (author_sub, usage_day, job_id)
    SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM ai_daily_usage WHERE author_sub = ? AND usage_day = ?) < ?`);
  const setStopping = db.prepare("UPDATE jobs SET status = 'STOPPING', updated_at = ? WHERE job_id = ?");
  const insertAiStop = db.prepare('INSERT INTO ai_analysis_stops (job_id, author_sub, stopped_at) VALUES (?, ?, ?)');

  function aiUsage(authorSub: string, day: string): string[] {
    return selectAiUsage.all(authorSub, day).map((row) => String(row.job_id));
  }

  function reserveAiUsage(authorSub: string, day: string, jobId: string, limit: number): boolean {
    if (reserveAiJob.run(authorSub, day, jobId, authorSub, day, limit).changes) return true;
    return aiUsage(authorSub, day).includes(jobId);
  }

  function recordAiStop(jobId: string, authorSub: string): void {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      setStopping.run(now, jobId);
      insertAiStop.run(jobId, authorSub, now);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

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

  /** The Job's AD Spots in order, without reading its VAD file. */
  function loadSpots(jobId: string): ADSpot[] {
    return isJobId(jobId) ? (selectSpots.all(jobId) as JobRow[]).map(spotFromRow) : [];
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
    return { ...metaFromRow(found), vad_output: vadOutput, spots: loadSpots(jobId) } as PersistedJobState;
  }

  /** VAD output never changes after the Job is created, so only the first save writes its file. */
  function save(job: PersistedJobState, admission?: AnalysisAdmission): boolean {
    const jobDir = dirOf(job.job_id);
    const vadFile = path.join(jobDir, 'vad_output.json');
    const updatedAt = new Date().toISOString();
    const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
    let createdVad = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (admission && !reserveAiUsage(admission.authorSub, admission.day, job.job_id, admission.limit)) {
        db.exec('ROLLBACK');
        return false;
      }
      fs.mkdirSync(jobDir, { recursive: true });
      if (!fs.existsSync(vadFile)) {
        writeAtomically(vadFile, JSON.stringify(job.vad_output, null, 2));
        createdVad = true;
      }
      upsertJob.run(job.job_id, job.schema_version, job.title, job.mode, job.status, job.video_metadata.fileName,
        job.video_metadata.durationMs, job.video_source.kind, JSON.stringify(job.video_source), JSON.stringify(job.video_metadata),
        JSON.stringify(job.vad_config), json(job.ad_settings), json(job.srt_source), JSON.stringify(job.batches),
        job.gemini_file_uri ?? null, job.gemini_file_name ?? null, job.gemini_file_mime_type ?? null, job.gemini_file_expires_at ?? null,
        job.progress_stage ?? null, job.progress_percent ?? null, job.active_model ?? null, job.error_message ?? null,
        job.created_at, updatedAt, job.owner_sub ?? null, job.owner_email ?? null);
      deleteSpots.run(job.job_id);
      job.spots.forEach((spot, position) => {
        insertSpot.run(job.job_id, spot.spot_id, position, spot.start_ms, spot.end_ms, spot.duration_ms, spot.decision, spot.text,
          spot.reason ?? null, spot.original_start_ms, spot.original_end_ms);
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // A Job that was never created must not leave a VAD file that no row or listing can reach.
      if (createdVad) fs.rmSync(vadFile, { force: true });
      throw err;
    }
    job.updated_at = updatedAt;
    return true;
  }

  /** Persists only the live progress fields; returns false when the Job no longer exists. */
  function saveProgress(
    jobId: string,
    progress: Pick<PersistedJobState, 'progress_stage' | 'progress_percent' | 'active_model'>,
  ): boolean {
    return isJobId(jobId) && Number(updateProgress.run(
      progress.progress_stage ?? null, progress.progress_percent ?? null, progress.active_model ?? null,
      new Date().toISOString(), jobId).changes) > 0;
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

  /**
   * Every stored Job and Unfinished Upload, most recently changed first; with `ownerSub`, only that Author's Jobs
   * (an Unfinished Upload has no Job Owner, so it is left out).
   */
  function list(ownerSub?: string): StoredJobRecord[] {
    const rows = (ownerSub === undefined ? selectSummaries.all() : selectOwnedSummaries.all(ownerSub)) as JobRow[];
    const jobs = rows.map((found): StoredJobRecord => {
      const summary: StoredJobRecord = {
        job_id: found.job_id as string, file_name: found.file_name as string, updated_at: found.updated_at as string,
        is_upload: false,
        title: found.title as string, mode: found.mode as JobMode, status: found.status as JobStatus,
        duration_ms: Number(found.duration_ms),
        spot_count: Number(found.spot_count),
        owner_sub: (found.owner_sub as string | null) ?? null,
        owner_email: (found.owner_email as string | null) ?? null,
      };
      const progressPercent = optional<number>(found.progress_percent);
      if (progressPercent !== undefined) summary.progress_percent = progressPercent;
      const errorMessage = optional<string>(found.error_message);
      if (errorMessage !== undefined) summary.error_message = errorMessage;
      return summary;
    });
    if (ownerSub !== undefined) return jobs;
    const uploads = fs.readdirSync(jobsDir).flatMap((name): StoredJobRecord[] => {
      const upload = findUnfinishedUpload(name);
      if (!upload) return [];
      return [{ job_id: name, file_name: `อัปโหลดไม่เสร็จ (${name})`, updated_at: upload.updatedAt, is_upload: true }];
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

  /** Keeps the shown owner email current when an Author's email changes in Keycloak. */
  function updateOwnerEmail(ownerSub: string, email: string): void {
    updateOwnerEmailStmt.run(email, ownerSub);
  }

  function close(): void {
    db.close();
  }

  return { dirOf, exists, loadMeta, loadSpots, load, save, saveProgress, rename, list, deleteJob, updateOwnerEmail,
    aiUsage, recordAiStop, close };
}
