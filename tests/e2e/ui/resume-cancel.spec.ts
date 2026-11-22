import { expect, test } from '@playwright/test';

test('resume job, narrow status badge, reset confirmation, late response ignore, and browser back', async ({ page }) => {
  const spot = {
    spot_id: 'one',
    start_ms: 1000,
    end_ms: 5000,
    duration_ms: 4000,
    original_start_ms: 1000,
    original_end_ms: 5000,
    decision: 'pending',
    text: '',
    is_edited: false,
  };
  const completed = {
    ...spot,
    spot_id: 'two',
    start_ms: 6000,
    end_ms: 10000,
    original_start_ms: 6000,
    original_end_ms: 10000,
    decision: 'generate',
    text: 'บทที่สร้างแล้ว',
  };
  const batch = {
    batch_id: 'batch_1',
    batch_index: 1,
    batch_start_ms: 0,
    batch_end_ms: 10000,
    window_start_ms: 0,
    window_end_ms: 10000,
    candidate_spots: [spot],
    status: 'pending',
    retry_count: 0,
  };
  const job = {
    schema_version: 3,
    job_id: 'job_fixture',
    title: 'fixture',
    mode: 'generate',
    status: 'VAD_READY',
    video_metadata: {
      fileName: 'fixture.mp4',
      fileSize: 1,
      mimeType: 'video/mp4',
      width: 854,
      height: 480,
      durationMs: 10000,
      videoCodec: 'avc1',
      audioCodec: 'mp4a.40.2',
      hasAudioTrack: true,
    },
    vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [spot] },
    batches: [batch],
    spots: [spot, completed],
  };

  let started = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (url.endsWith('/api/jobs/job_fixture') && request.method() === 'GET') {
      return route.fulfill({ json: { job, isRunning: false } });
    }
    if (url.endsWith('/start')) {
      started = true;
      await held;
      return route.fulfill({ json: { job, isRunning: true } });
    }
    if (request.method() === 'DELETE') throw new Error('Leaving a job must not delete it');
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/jobs/job_fixture');
  const resume = page.getByRole('button', { name: 'ทำต่อจากชุดที่ค้าง' });
  const manage = page.getByRole('button', { name: 'จัดการงาน', exact: true });
  await resume.waitFor();

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 900 });
  const compactStatus = page.getByRole('button', { name: /มีงานที่ยังไม่เสร็จ.*ดูรายละเอียดการทำงาน/ }).getByText('งานค้าง', { exact: true });
  expect(
    (await compactStatus.isVisible()) && (await compactStatus.evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth + 1)),
    'The pending status is readable beside Resume on a narrow screen'
  ).toBe(true);
  if (viewport) await page.setViewportSize(viewport);

  expect(
    await page.getByRole('banner').getByRole('button', { name: 'ส่งออก SRT', exact: true }).isVisible(),
    'Resume is the sole primary action'
  ).toBe(false);
  await manage.click();
  await page.getByRole('menuitem', { name: 'ส่งออก SRT', exact: true }).waitFor();
  await page.keyboard.press('Escape');

  await resume.click();
  await expect.poll(() => started, { message: 'Resume did not start' }).toBe(true);

  const confirmReset = page.getByRole('alertdialog', { name: 'เริ่มงานใหม่และออกจากงานปัจจุบัน?' });
  await manage.click();
  await page.getByRole('menuitem', { name: 'เริ่มงานใหม่' }).click();
  await page.mouse.click(8, 8);
  await page.waitForTimeout(300);
  expect(await confirmReset.isVisible(), 'A click outside dismissed the confirmation').toBe(true);

  await confirmReset.getByRole('button', { name: 'ยกเลิก' }).click();
  await confirmReset.waitFor({ state: 'hidden' });
  expect(new URL(page.url()).pathname, 'Cancelling the reset left the job').toBe('/jobs/job_fixture');
  await page.waitForTimeout(200);
  expect(await manage.evaluate((el) => el === document.activeElement), 'Focus did not return to the menu that asked').toBe(true);

  await manage.click();
  await page.getByRole('menuitem', { name: 'เริ่มงานใหม่' }).click();
  await confirmReset.getByRole('button', { name: 'เริ่มงานใหม่' }).click();
  const chooser = page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' });
  await chooser.waitFor();
  expect(new URL(page.url()).pathname, 'Reset did not move to a new job').toBe('/new');

  release();
  await page.waitForTimeout(500);
  expect(await chooser.isVisible(), 'Late resume restored the old job').toBe(true);
  await page.reload();
  await chooser.waitFor();
  expect(new URL(page.url()).pathname, 'Old job returned after reload').toBe('/new');

  await page.goBack();
  await page.getByRole('button', { name: 'ทำต่อจากชุดที่ค้าง' }).waitFor();
  expect(new URL(page.url()).pathname, 'Back did not reopen the job').toBe('/jobs/job_fixture');
});
