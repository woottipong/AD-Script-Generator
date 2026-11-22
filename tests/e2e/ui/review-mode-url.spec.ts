import { expect, test } from '@playwright/test';
import { REVIEW_SRT_PATH } from '../fixtures';

test('review mode from external MP4 URL scans audio and seeks cleanly', async ({ page }) => {
  test.setTimeout(60_000);

  const videoUrl =
    'https://drive.rtt.in.th/archive/%E0%B8%AA%E0%B8%AA%E0%B8%A7%E0%B8%97.%202567/%E0%B8%84%E0%B8%93%E0%B8%B4%E0%B8%95%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B8%9E%E0%B8%B7%E0%B9%89%E0%B8%99%E0%B8%90%E0%B8%B2%E0%B8%99/%E0%B8%84%E0%B8%93%E0%B8%B4%E0%B8%95%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B8%9E%E0%B8%B7%E0%B9%89%E0%B8%99%E0%B8%90%E0%B8%B2%E0%B8%99%20%E0%B8%A1.5/%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201/3.%E0%B9%80%E0%B8%A5%E0%B8%82%E0%B8%A2%E0%B8%81%E0%B8%81%E0%B8%B3%E0%B8%A5%E0%B8%B1%E0%B8%87%20%E0%B8%95%E0%B8%AD%E0%B8%99%203%20%E0%B8%A1.5%20%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201.mp4';
  let created: {
    video_source: { kind: string; url?: string };
    video_metadata: { height: number };
    vad_output: { duration_ms: number; speech_segments: unknown[] };
  } | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (url.endsWith('/api/jobs/review') && request.method() === 'POST') {
      created = request.postDataJSON();
      return route.fulfill({
        json: { job: { ...created, job_id: 'job_review_url', schema_version: 3, mode: 'review', status: 'READY', batches: [] }, isRunning: false },
      });
    }
    if (url.endsWith('/api/jobs/job_review_url/spots')) return route.fulfill({ json: { job: { job_id: 'job_review_url' } } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/new');
  await page.getByRole('button', { name: /ตรวจแก้ไฟล์ SRT/ }).click();
  const link = page.getByPlaceholder('https://…/video.mp4');
  const process = page.getByRole('button', { name: 'เริ่มตรวจแก้' });
  await page.getByLabel('เลือกไฟล์ SRT').setInputFiles(REVIEW_SRT_PATH);
  await link.fill('https://example.com/video.mov');
  expect(await process.isDisabled(), 'A non-.mp4 link cannot be processed').toBe(true);
  await link.fill(videoUrl);
  expect(await process.isEnabled(), 'An .mp4 link with an SRT can be processed').toBe(true);

  await process.click();
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).waitFor({ timeout: 55_000 });
  await expect.poll(() => created, { message: 'Review Mode job was created', timeout: 10_000 }).toBeTruthy();
  expect(created!.video_source.kind === 'url' && created!.video_source.url === videoUrl, 'Job records the URL source').toBe(true);
  expect(created!.video_metadata.height, '1080p video is accepted').toBe(1080);
  expect(Math.abs(created!.vad_output.duration_ms - 1483000) < 2000, 'Scan covered the whole video').toBe(true);
  expect(created!.vad_output.speech_segments.length, 'Speech was detected in the lecture audio').toBeGreaterThan(0);

  const seek = await page.evaluate(async () => {
    const video = document.querySelector('video')!;
    const t0 = performance.now();
    video.currentTime = 600;
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    return { src: video.currentSrc, landed: Math.round(video.currentTime), ms: Math.round(performance.now() - t0) };
  });
  expect(seek.src === videoUrl && seek.landed === 600, 'Video plays and seeks from the URL').toBe(true);
});
