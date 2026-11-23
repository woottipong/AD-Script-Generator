import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { REVIEW_SRT_PATH } from '../fixtures';

async function checkReviewVideoUrl(page: Page, videoUrl: string, durationMs: number, seekSeconds: number) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (url.endsWith('/api/jobs/review') && request.method() === 'POST') {
      return route.fulfill({
        json: { job: { ...request.postDataJSON(), job_id: 'job_review_url', schema_version: 3, mode: 'review', status: 'READY', batches: [] }, isRunning: false },
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
  await expect(process, 'A non-.mp4 link cannot be processed').toBeDisabled();
  await link.fill(videoUrl);
  await expect(process, 'An .mp4 link with an SRT can be processed').toBeEnabled();

  const [request] = await Promise.all([
    page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/jobs/review', { timeout: 0 }),
    process.click(),
  ]);
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).waitFor();
  const created: { vad_output: { duration_ms: number; speech_segments: unknown[] } } = request.postDataJSON();
  expect(created).toMatchObject({
    video_source: { kind: 'url', url: videoUrl },
    video_metadata: { height: 1080 },
  });
  expect(Math.abs(created.vad_output.duration_ms - durationMs), 'Scan covered the whole video').toBeLessThan(2000);
  expect(created.vad_output.speech_segments.length, 'Speech was detected').toBeGreaterThan(0);

  const video = page.locator('video');
  await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 30_000 }).toBeGreaterThan(0);
  await video.evaluate((video: HTMLVideoElement, seconds) => { video.currentTime = seconds; }, seekSeconds);
  await expect.poll(() => video.evaluate((video: HTMLVideoElement) => ({
    src: video.currentSrc,
    landed: Math.round(video.currentTime),
    seeking: video.seeking,
  })), { timeout: 30_000 }).toEqual({ src: videoUrl, landed: seekSeconds, seeking: false });
}

test('review mode from a cross-origin MP4 URL scans audio and seeks cleanly', async ({ page }) => {
  test.setTimeout(60_000);
  const video = readFileSync(new URL('../../fixtures/review-url-speech.mp4', import.meta.url));
  const requests = { head: 0, partial: 0 };
  const media = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      }).end();
      return;
    }

    if (req.method === 'HEAD') {
      requests.head++;
      res.writeHead(200, { 'Content-Length': video.length }).end();
      return;
    }

    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { 'Content-Length': video.length }).end(video);
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = Number(match?.[1]);
    const end = match?.[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1;
    if (!match || !(start <= end)) {
      res.writeHead(416, { 'Content-Range': `bytes */${video.length}` }).end();
      return;
    }
    requests.partial++;
    res.writeHead(206, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${video.length}`,
    }).end(video.subarray(start, end + 1));
  });

  await once(media.listen(0, '127.0.0.1'), 'listening');
  try {
    const address = media.address();
    if (!address || typeof address === 'string') throw new Error('MP4 fixture server did not bind a TCP port');
    await checkReviewVideoUrl(page, `http://127.0.0.1:${address.port}/speech.mp4`, 14_000, 6);
    expect(requests.head, 'The browser probed the MP4 over HTTP').toBeGreaterThan(0);
    expect(requests.partial, 'The browser fetched MP4 byte ranges').toBeGreaterThan(0);
  } finally {
    const closed = once(media, 'close');
    media.close();
    media.closeAllConnections();
    await closed;
  }
});

test('review mode from an external MP4 URL scans audio and seeks cleanly', async ({ page }) => {
  test.skip(process.env.RUN_EXTERNAL_MP4_SMOKE !== '1', 'Set RUN_EXTERNAL_MP4_SMOKE=1 to check the public video host');
  test.setTimeout(5 * 60_000);
  const videoUrl =
    'https://drive.rtt.in.th/archive/%E0%B8%AA%E0%B8%AA%E0%B8%A7%E0%B8%97.%202567/%E0%B8%84%E0%B8%93%E0%B8%B4%E0%B8%95%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B8%9E%E0%B8%B7%E0%B9%89%E0%B8%99%E0%B8%90%E0%B8%B2%E0%B8%99/%E0%B8%84%E0%B8%93%E0%B8%B4%E0%B8%95%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B8%9E%E0%B8%B7%E0%B9%89%E0%B8%99%E0%B8%90%E0%B8%B2%E0%B8%99%20%E0%B8%A1.5/%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201/3.%E0%B9%80%E0%B8%A5%E0%B8%82%E0%B8%A2%E0%B8%81%E0%B8%81%E0%B8%B3%E0%B8%A5%E0%B8%B1%E0%B8%87%20%E0%B8%95%E0%B8%AD%E0%B8%99%203%20%E0%B8%A1.5%20%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201.mp4';
  await checkReviewVideoUrl(page, videoUrl, 1_483_000, 600);
});
