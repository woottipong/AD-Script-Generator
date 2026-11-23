import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures');
const GENERATED_DIR = path.join(FIXTURES_DIR, '.generated');

export const REVIEW_SRT_PATH = path.join(FIXTURES_DIR, 'ad-review.srt');
export const GENERATE_480P_PATH = path.join(GENERATED_DIR, 'ad-generate-480p.mp4');
export const REVIEW_1080P_PATH = path.join(GENERATED_DIR, 'ad-review-1080p.mp4');

function generateIfMissing(targetPath: string, ffmpegArgs: string[]): void {
  if (fs.existsSync(targetPath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(targetPath),
    `.${process.pid}-${Date.now()}-${path.basename(targetPath)}`
  );
  try {
    execFileSync('ffmpeg', ['-y', ...ffmpegArgs, tmpPath], { stdio: 'pipe' });
    if (!fs.existsSync(targetPath)) {
      fs.renameSync(tmpPath, targetPath);
    }
  } finally {
    if (fs.existsSync(tmpPath)) {
      fs.rmSync(tmpPath, { force: true });
    }
  }
}

export function ensureVideoFixtures(): void {
  generateIfMissing(GENERATE_480P_PATH, [
    '-f', 'lavfi', '-i', 'color=c=navy:s=854x480:r=25',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100',
    '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
  ]);
  generateIfMissing(REVIEW_1080P_PATH, [
    '-f', 'lavfi', '-i', 'color=c=navy:s=1920x1080:r=25',
    '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000',
    '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
  ]);
}
