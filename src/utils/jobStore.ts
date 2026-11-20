import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PersistedJobState } from '../types/ad';

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
};

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
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

function writeAtomically(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * Owns the on-disk Job layout: `<dataDir>/<job_id>/job.json`, `<dataDir>/<job_id>/source_video.mp4`,
 * and the `<dataDir>/active_job.json` pointer.
 */
export function createJobStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const pointerPath = path.join(dataDir, 'active_job.json');

  function dirOf(jobId: string): string {
    if (!isJobId(jobId)) throw new Error('Invalid job ID');
    return path.join(dataDir, jobId);
  }

  function isInsideDataDir(dir: string): boolean {
    return fs.lstatSync(dir).isDirectory() && path.dirname(fs.realpathSync(dir)) === fs.realpathSync(dataDir);
  }

  /** Lenient read for the request path: any unreadable job is reported as missing. */
  function load(jobId: string): PersistedJobState | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dirOf(jobId), 'job.json'), 'utf-8')) as PersistedJobState;
    } catch {
      return null;
    }
  }

  function save(job: PersistedJobState, activate = true): void {
    const jobDir = dirOf(job.job_id);
    fs.mkdirSync(jobDir, { recursive: true });
    job.updated_at = new Date().toISOString();
    writeAtomically(path.join(jobDir, 'job.json'), JSON.stringify(job, null, 2));
    if (activate) {
      writeAtomically(pointerPath, JSON.stringify({ active_job_id: job.job_id, updated_at: job.updated_at }, null, 2));
    }
  }

  /** Strict pointer read: a missing pointer is null, a corrupt one throws. */
  function activeJobId(): string | null {
    try {
      const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
      if (typeof pointer.active_job_id !== 'string') throw new Error('Invalid active pointer');
      return pointer.active_job_id;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  function loadActive(): PersistedJobState | null {
    try {
      const jobId = activeJobId();
      return jobId ? load(jobId) : null;
    } catch {
      return null;
    }
  }

  function clearActive(jobId: string): void {
    if (activeJobId() === jobId) fs.unlinkSync(pointerPath);
  }

  function findStored(jobId: string): { dir: string; job: PersistedJobState } | null {
    if (!isJobId(jobId)) return null;
    const dir = path.join(dataDir, jobId);
    try {
      if (!isInsideDataDir(dir)) return null;
      const file = path.join(dir, 'job.json');
      if (!fs.lstatSync(file).isFile()) return null;
      const job = JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedJobState;
      if (job.job_id !== jobId || !job.video_metadata || typeof job.video_metadata.fileName !== 'string') return null;
      return { dir, job };
    } catch (err) {
      if (isMissing(err) || err instanceof SyntaxError) return null;
      throw err;
    }
  }

  function findUnfinishedUpload(jobId: string): { dir: string; updatedAt: string } | null {
    if (!isJobId(jobId)) return null;
    const dir = path.join(dataDir, jobId);
    try {
      if (!isInsideDataDir(dir)) return null;
      const entries = fs.readdirSync(dir);
      if (entries.length !== 1 || entries[0] !== 'source_video.mp4') return null;
      const stat = fs.lstatSync(path.join(dir, 'source_video.mp4'));
      return stat.isFile() ? { dir, updatedAt: stat.mtime.toISOString() } : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  function list(): StoredJobSummary[] {
    return fs.readdirSync(dataDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry): StoredJobSummary[] => {
      const stored = findStored(entry.name);
      if (stored) {
        return [{ job_id: entry.name, file_name: stored.job.video_metadata.fileName,
          updated_at: stored.job.updated_at, size_bytes: sizeOf(stored.dir), is_upload: false }];
      }
      const upload = findUnfinishedUpload(entry.name);
      if (!upload) return [];
      return [{ job_id: entry.name, file_name: `อัปโหลดไม่เสร็จ (${entry.name})`,
        updated_at: upload.updatedAt, size_bytes: sizeOf(upload.dir), is_upload: true }];
    });
  }

  /** Directory of a stored job or unfinished upload that may be deleted, or null when there is none. */
  function filesDir(jobId: string): string | null {
    return (findStored(jobId) || findUnfinishedUpload(jobId))?.dir ?? null;
  }

  return { dirOf, load, save, activeJobId, loadActive, clearActive, list, filesDir };
}
