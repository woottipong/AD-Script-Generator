import { expect, test } from '@playwright/test';
import { ensureVideoFixtures, GENERATE_480P_PATH } from '../fixtures';

test.beforeAll(() => {
  ensureVideoFixtures();
});

test('generate intake validation, draft preservation, single VAD scan, and save retry', async ({ page }) => {
  test.setTimeout(60_000);

  await page.addInitScript(() => {
    const win = window as unknown as { generateModeScanCount?: number };
    if (win.generateModeScanCount !== undefined) return;
    win.generateModeScanCount = 0;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: { type?: string }, ...options: unknown[]) {
      if (message?.type === 'PROCESS_FILE') win.generateModeScanCount = (win.generateModeScanCount ?? 0) + 1;
      return postMessage.apply(this, [message, ...(options as [StructuredSerializeOptions?])]);
    };
  });
  const scanCount = () => page.evaluate(() => (window as unknown as { generateModeScanCount?: number }).generateModeScanCount ?? 0);

  const initCalls: Array<{ autoStart?: boolean; vad_output: { candidate_spots: Array<{ start_ms: number; end_ms: number }> } }> = [];
  const geminiRequests: string[] = [];
  let uploadRequests = 0;
  let approveSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    approveSave = resolve;
  });
  let releaseLink!: () => void;
  const linkGate = new Promise<void>((resolve) => {
    releaseLink = resolve;
  });

  await page.route('https://intake-fixture.invalid/held.mp4', async (route) => {
    await linkGate;
    await route.abort().catch(() => {});
  });
  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/api/me')) {
      return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    }
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/upload/init') return route.fulfill({ json: { uploadId: `job_generate_${++uploadRequests}` } });
    if (pathname === '/api/upload/chunk') return route.fulfill({ json: { ok: true } });
    if (pathname === '/api/jobs/init') {
      const payload = request.postDataJSON();
      initCalls.push(payload);
      if (initCalls.length === 1) {
        await saveGate;
        return route.fulfill({ status: 503, json: { error: 'เซิร์ฟเวอร์ขัดข้องชั่วคราว' } });
      }
      const spots = payload.vad_output.candidate_spots.map((spot: { start_ms: number; end_ms: number }) => ({
        ...spot,
        original_start_ms: spot.start_ms,
        original_end_ms: spot.end_ms,
        decision: 'pending',
        text: '',
      }));
      return route.fulfill({
        json: { job: { job_id: payload.uploadId, title: payload.title, status: 'VAD_READY', spots, batches: [] }, isRunning: false },
      });
    }
    if (pathname.endsWith('/start') || pathname.endsWith('/analyze-batch')) geminiRequests.push(pathname);
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/new');
  await page.setViewportSize({ width: 390, height: 844 });
  const generate = page.getByRole('button', { name: 'สร้างบทบรรยาย', exact: true });
  const review = page.getByRole('button', { name: 'ตรวจแก้ไฟล์ SRT', exact: true });
  const continueGenerate = page.getByRole('button', { name: 'เริ่มเตรียมงาน', exact: true });
  const continueReview = page.getByRole('button', { name: 'เริ่มตรวจแก้', exact: true });
  const title = page.getByRole('textbox', { name: 'ชื่องาน' });
  const video = page.locator('input[type=file][aria-label="เลือกวิดีโอ MP4"]');
  await continueGenerate.waitFor();

  const enlarge = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  for (const button of [continueGenerate, page.getByRole('button', { name: 'ยกเลิก', exact: true })]) {
    expect(
      await button.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        const card = el.closest('.overflow-hidden')!.getBoundingClientRect();
        return bounds.left >= card.left && bounds.right <= card.right;
      }),
      'Intake actions fit with 200% text sizing'
    ).toBe(true);
  }
  await enlarge.evaluate((el) => (el as HTMLStyleElement).remove());

  const dropzone = page.getByText('วางไฟล์ MP4 ที่นี่', { exact: true });
  const transfer = await page.evaluateHandle(() => {
    const files = new DataTransfer();
    files.items.add(new File(['test'], 'draft.txt', { type: 'text/plain' }));
    files.items.add(new File(['test'], 'clip.mp4', { type: 'video/mp4' }));
    return files;
  });
  await dropzone.dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByText('เลือกหรือวางได้ครั้งละหนึ่งไฟล์', { exact: true }).waitFor();
  expect(await continueGenerate.isDisabled(), 'Dropping multiple files does not stage an arbitrary file').toBe(true);

  await video.setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
  await page.getByText('กรุณาเลือกไฟล์วิดีโอ MP4', { exact: true }).waitFor();
  expect(await continueGenerate.isDisabled(), 'An unsupported file cannot start processing').toBe(true);

  await video.setInputFiles({ name: 'unreadable.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') });
  await continueGenerate.click();
  const failedVideo = page.getByRole('alert').filter({ hasText: 'วิดีโอไม่ผ่านสเปค' });
  await failedVideo.waitFor();
  expect(await failedVideo.evaluate((el) => el === document.activeElement), 'Failed video inspection focuses its error').toBe(true);

  await video.setInputFiles(GENERATE_480P_PATH);
  expect(await failedVideo.isVisible(), 'Replacing the video clears its inspection error').toBe(false);
  await title.fill('งานสร้างฉบับทดสอบ');
  expect(
    await page.getByText('กรุณาเลือกไฟล์วิดีโอ MP4', { exact: true }).isVisible(),
    'Replacing an invalid file clears its error'
  ).toBe(false);

  await review.press('Enter');
  await continueReview.waitFor();
  expect(await review.evaluate((el) => el === document.activeElement), 'A keyboard mode change restores focus to the selected mode').toBe(true);
  const link = page.locator('#review-link');
  await link.fill('https://intake-fixture.invalid/held.mp4');
  await page.locator('input[type=file][aria-label="เลือกไฟล์ SRT"]').setInputFiles({
    name: 'sample.srt',
    mimeType: 'text/plain',
    buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nบททดสอบ\n'),
  });
  await title.fill('งานตรวจแก้ฉบับทดสอบ');
  await continueReview.click();
  await page.getByText('กำลังตรวจสอบวิดีโอและ SRT', { exact: true }).waitFor();
  expect(await generate.isDisabled(), 'The selected mode is locked while its file check is running').toBe(true);
  await page.getByRole('button', { name: 'ยกเลิกการตรวจไฟล์', exact: true }).click();
  releaseLink();

  await generate.press('Enter');
  await continueGenerate.waitFor();
  expect(
    (await title.inputValue()) === 'งานสร้างฉบับทดสอบ' && (await continueGenerate.isEnabled()),
    'Generate draft survives a round trip'
  ).toBe(true);
  await review.press('Enter');
  await continueReview.waitFor();
  expect(
    (await title.inputValue()) === 'งานตรวจแก้ฉบับทดสอบ' &&
      (await link.inputValue()) === 'https://intake-fixture.invalid/held.mp4' &&
      (await continueReview.isEnabled()),
    'Cancelled validation preserves the Review draft'
  ).toBe(true);
  await page.getByRole('button', { name: 'ล้างไฟล์ SRT', exact: true }).press('Enter');
  expect(
    await page.getByRole('button', { name: 'เลือกไฟล์จากเครื่อง (SRT)', exact: true }).evaluate((el) => el === document.activeElement),
    'Clearing a file returns focus to its picker'
  ).toBe(true);

  await generate.press('Enter');
  await continueGenerate.click();
  await page.getByRole('progressbar', { name: 'กำลังบันทึกงาน', exact: true }).waitFor({ timeout: 60_000 });
  expect(
    initCalls[0]?.autoStart === false && initCalls[0].vad_output.candidate_spots.length > 0,
    'Server acknowledgement follows real audio inspection without starting Gemini'
  ).toBe(true);
  approveSave();
  await page.getByText('ยังบันทึกงานไม่สำเร็จ', { exact: true }).waitFor();
  expect(await scanCount(), 'A single audio scan ran before the save failed').toBe(1);
  await page.getByRole('button', { name: 'ลองบันทึกอีกครั้ง', exact: true }).click();
  await page.waitForURL('**/jobs/job_generate_2', { timeout: 15_000 });
  expect(await scanCount(), 'Retrying the save reuses the single completed audio scan').toBe(1);
  expect(
    initCalls.length === 2 && JSON.stringify(initCalls[0].vad_output) === JSON.stringify(initCalls[1].vad_output),
    'Both save attempts use the same scan results'
  ).toBe(true);
  expect(geminiRequests.length, 'Gemini only starts from the separate workspace action').toBe(0);
});
