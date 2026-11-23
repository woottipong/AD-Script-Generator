import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { ensureVideoFixtures, REVIEW_1080P_PATH, REVIEW_SRT_PATH } from '../fixtures';

test.beforeAll(() => {
  ensureVideoFixtures();
});

test('review restore for URL and local sources, responsive header layout, and re-pick without re-scan', async ({ page }) => {
  const fixtureSize = fs.statSync(REVIEW_1080P_PATH).size;

  const spot = {
    spot_id: 'cue_001',
    start_ms: 1000,
    end_ms: 3000,
    duration_ms: 2000,
    original_start_ms: 1000,
    original_end_ms: 3000,
    decision: 'generate',
    text: 'บทที่บันทึกไว้',
  };
  const jobTitle = 'ละครโทรทัศน์ชุดการเดินทางของชุมชนริมแม่น้ำ ฉบับตรวจแก้บทบรรยายภาพ ตอน 08';
  const reviewJob = (video_source: Record<string, unknown>) => ({
    job_id: 'job_review_restore',
    schema_version: 3,
    title: jobTitle,
    mode: 'review',
    status: 'READY',
    video_source,
    srt_source: { file_name: 'lesson.srt', cue_count: 1, imported_at: '2026-11-21T00:00:00Z' },
    video_metadata: {
      fileName: 'ad-review-1080p.mp4',
      fileSize: fixtureSize,
      mimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      durationMs: 12000,
      videoCodec: 'avc1',
      audioCodec: 'mp4a.40.2',
      hasAudioTrack: true,
    },
    vad_output: {
      duration_ms: 12000,
      speech_segments: [{ start_ms: 5000, end_ms: 6000 }],
      candidate_spots: [],
      waveform: { sampleIntervalMs: 20, peaksBase64: 'AAAA' },
    },
    batches: [],
    spots: [spot],
  });

  let current = reviewJob({ kind: 'url', url: 'https://media.invalid/lesson.mp4' });
  let scanStarted = false;

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (new URL(url).pathname === '/api/jobs/job_review_restore') return route.fulfill({ json: { job: current, isRunning: false } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  page.on('worker', () => {
    scanStarted = true;
  });

  await page.goto('/jobs/job_review_restore');
  const line = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await line.waitFor();
  expect(await line.inputValue(), 'Saved Review Mode lines are restored').toBe('บทที่บันทึกไว้');
  expect(await page.locator('video').getAttribute('src'), 'URL source plays straight from the link').toBe('https://media.invalid/lesson.mp4');
  expect(await page.getByText('เลือกวิดีโอเดิมอีกครั้ง').count(), 'URL source needs no re-pick').toBe(0);
  expect(await page.getByRole('button', { name: /สร้างบทบรรยายภาพ|ทำต่อจากชุดที่ค้าง/ }).count(), 'Generate controls stay hidden').toBe(0);

  const initialViewport = page.viewportSize();
  const header = page.getByRole('banner');
  const title = header.getByRole('button', { name: `เปลี่ยนชื่องาน: ${jobTitle}`, exact: true });
  const info = header.getByRole('button', { name: 'ข้อมูลวิดีโอ', exact: true });
  const status = header.getByRole('button', { name: /ตรวจแก้ SRT · 1 บรรทัด.*ดูรายละเอียดการทำงาน$/ });
  const exportSrt = header.getByRole('button', { name: 'ส่งออก SRT', exact: true });
  const manage = header.getByRole('button', { name: 'จัดการงาน', exact: true });
  const usesJobTitleTypography = (el: HTMLElement) => {
    const { fontWeight, fontSize, lineHeight } = getComputedStyle(el);
    const size = parseFloat(fontSize);
    return fontWeight === '700' && size === 16 && Math.abs(parseFloat(lineHeight) / size - 1.35) < 0.01;
  };
  await title.waitFor();

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const [titleBox, infoBox, statusBox, exportBox, menuBox] = (
      await Promise.all([title, info, status, exportSrt, manage].map((control) => control.boundingBox()))
    ).map((b) => b!);
    const centerY = (box: { y: number; height: number }) => box.y + box.height / 2;
    expect(titleBox.x + titleBox.width <= infoBox.x + 1, `Video info follows the title at width ${width}`).toBe(true);
    expect(
      statusBox.x + statusBox.width <= exportBox.x + 1 && exportBox.x + exportBox.width <= menuBox.x + 1,
      `Actions retain their order at width ${width}`
    ).toBe(true);
    expect(
      Math.abs(centerY(statusBox) - centerY(menuBox)) <= 1 && Math.abs(centerY(exportBox) - centerY(menuBox)) <= 1,
      `All actions share one row at width ${width}`
    ).toBe(true);
    expect(menuBox.x + menuBox.width <= width, `The menu fits on screen at width ${width}`).toBe(true);
    if (width < 1024) {
      expect(titleBox.y + titleBox.height < statusBox.y, `The title has its own row at width ${width}`).toBe(true);
    } else {
      expect(Math.abs(centerY(titleBox) - centerY(statusBox)) <= 1, `The title and actions share a row at width ${width}`).toBe(true);
    }
    if (width < 640) {
      expect((await status.innerText()).trim(), 'The mobile status uses the short visible label').toBe('1 บรรทัด');
    }
    if (width === 320 || width === 1440) {
      const headerBefore = (await header.boundingBox())!;
      expect(await title.evaluate(usesJobTitleTypography), `The Job Title matches the design typography at width ${width}`).toBe(true);
      await title.click();
      const field = header.getByRole('textbox', { name: 'ชื่องาน', exact: true });
      const [fieldBox, headerEditing] = (await Promise.all([field.boundingBox(), header.boundingBox()])).map((b) => b!);
      expect(await field.evaluate(usesJobTitleTypography), `The rename field matches the design typography at width ${width}`).toBe(true);
      expect(
        Math.abs(fieldBox.x - titleBox.x) <= 1 && fieldBox.y - headerEditing.y === titleBox.y - headerBefore.y,
        'Renaming starts at the original title position'
      ).toBe(true);
      expect(headerEditing.height, 'Editing the title does not resize the header').toBe(headerBefore.height);
      if (width === 320) {
        expect(
          fieldBox.width >= 145 && (await info.isVisible()),
          'The title input and video information both fit on a narrow header'
        ).toBe(true);
      }
      await field.press('Escape');
    }
  }
  if (initialViewport) await page.setViewportSize(initialViewport);

  current = reviewJob({ kind: 'local_file', file_name: 'ad-review-1080p.mp4', file_size: fixtureSize });
  await page.reload();
  await line.waitFor();
  expect(await page.getByText('เลือกวิดีโอเดิมอีกครั้งเพื่อเล่นและดูเทียบ').isVisible(), 'Local source asks for the original file').toBe(true);
  expect(await page.getByRole('button', { name: 'เลือกวิดีโอเดิม', exact: true }).isVisible(), 'Re-picking the file is a real button').toBe(true);
  expect(await page.locator('video').count(), 'No video plays before the file is picked').toBe(0);
  expect(await page.getByRole('button', { name: 'ส่งออก SRT' }).isVisible(), 'SRT export works while waiting for the file').toBe(true);

  const repick = page.getByLabel('เลือกวิดีโอเดิมของงานนี้');
  await repick.setInputFiles(REVIEW_SRT_PATH);
  await page.getByText(/ไฟล์นี้ไม่ใช่วิดีโอเดิมของงาน/).waitFor();
  expect(await page.locator('video').count(), 'A different file is rejected').toBe(0);

  await repick.setInputFiles(REVIEW_1080P_PATH);
  await page.locator('video').waitFor();
  expect((await page.locator('video').getAttribute('src'))?.startsWith('blob:'), 'The original file plays after it is picked').toBe(true);
  expect(await page.getByText('เลือกวิดีโอเดิมอีกครั้งเพื่อเล่นและดูเทียบ').count(), 'Re-pick prompt goes away').toBe(0);
  expect(scanStarted, 'Restoring never re-scans the audio').toBe(false);
});
