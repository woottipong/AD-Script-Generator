import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { ensureVideoFixtures, REVIEW_1080P_PATH, REVIEW_SRT_PATH } from '../fixtures';

test.beforeAll(() => {
  ensureVideoFixtures();
});

test('review mode creation, queued rename, warnings filter, spot save, and creation failure', async ({ page }) => {
  test.setTimeout(60_000);

  let created: {
    title: string;
    video_source: { kind: string; file_name?: string };
    video_metadata: { height: number };
    vad_output: { waveform?: { peaksBase64: string } };
    spots: Array<{ text: string }>;
    srt_source: { cue_count: number };
  } | null = null;
  let patched: Array<{ text: string }> | null = null;
  let renamed: string | null = null;
  let rejectCreation = false;
  let releaseCreation!: () => void;
  const creationPending = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (url.endsWith('/api/jobs/review') && request.method() === 'POST') {
      if (rejectCreation) return route.fulfill({ status: 500, json: { error: 'บันทึกงานตรวจแก้ไม่สำเร็จ' } });
      created = request.postDataJSON();
      await creationPending;
      return route.fulfill({
        json: {
          job: {
            ...created,
            job_id: 'job_review_fixture',
            schema_version: 3,
            title: created!.title,
            mode: 'review',
            status: 'READY',
            batches: [],
            created_at: '2026-11-20T00:00:00Z',
            updated_at: '2026-11-20T00:00:00Z',
          },
          isRunning: false,
        },
      });
    }
    if (url.endsWith('/api/jobs/job_review_fixture') && request.method() === 'PATCH') {
      renamed = request.postDataJSON().title;
      return route.fulfill({ json: { job: { job_id: 'job_review_fixture', title: renamed } } });
    }
    if (url.endsWith('/api/jobs/job_review_fixture/spots')) {
      patched = request.postDataJSON().spots;
      return route.fulfill({ json: { job: { job_id: 'job_review_fixture', spots: patched } } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/new');
  await page.getByRole('button', { name: 'สร้างบทบรรยาย', exact: true }).waitFor();
  await page.getByRole('button', { name: /ตรวจแก้ไฟล์ SRT/ }).click();
  const process = page.getByRole('button', { name: 'เริ่มตรวจแก้' });
  await process.waitFor();
  expect(await process.isDisabled(), 'Process waits for both files').toBe(true);

  const link = page.getByPlaceholder('https://…/video.mp4');
  await link.fill('https://example.com/video.mov');
  expect(
    (await link.getAttribute('aria-invalid')) === 'true' &&
      (await page.getByText('ลิงก์ต้องขึ้นต้นด้วย http หรือ https และลงท้ายด้วย .mp4').isVisible()),
    'A non-.mp4 link is marked invalid with the reason'
  ).toBe(true);
  await link.fill('');

  await page.getByLabel('เลือกวิดีโอ MP4').setInputFiles(REVIEW_1080P_PATH);
  await page.getByLabel('เลือกไฟล์ SRT').setInputFiles(REVIEW_SRT_PATH);
  const titleField = page.getByRole('textbox', { name: 'ชื่องาน' });
  expect(await titleField.inputValue(), 'Job Title defaults to the video file name').toBe('ad-review-1080p');
  await titleField.fill('ตรวจบท ตอนที่ 1');
  await page.getByLabel('เลือกวิดีโอ MP4').setInputFiles(REVIEW_1080P_PATH);
  expect(await titleField.inputValue(), 'Choosing the video again keeps a typed title').toBe('ตรวจบท ตอนที่ 1');

  const firstLine = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  const editingTitle = page.getByRole('textbox', { name: 'ชื่องาน', exact: true });
  try {
    await process.click();
    await firstLine.waitFor({ timeout: 55_000 });
    await expect.poll(() => created, { message: 'Review Mode job was sent to the server' }).toBeTruthy();
    expect(created!.title, 'The typed Job Title is sent when the Job is created').toBe('ตรวจบท ตอนที่ 1');
    await page.getByRole('button', { name: 'เปลี่ยนชื่องาน: ตรวจบท ตอนที่ 1', exact: true }).click();
    await editingTitle.fill('ตรวจบท ตอนที่ 1 ระหว่างสร้าง');
    await editingTitle.press('Tab');
    expect(
      !(await editingTitle.isEditable()) && renamed === null,
      'Leaving the title field queues the rename until the Job exists'
    ).toBe(true);
  } finally {
    releaseCreation();
  }

  await expect
    .poll(() => new URL(page.url()).pathname, { message: 'The new Job opens at its own URL' })
    .toBe('/jobs/job_review_fixture');
  const queuedTitle = page.getByRole('button', { name: 'เปลี่ยนชื่องาน: ตรวจบท ตอนที่ 1 ระหว่างสร้าง', exact: true });
  await queuedTitle.waitFor();
  expect(renamed, 'The queued title saves once the server creates the Job').toBe('ตรวจบท ตอนที่ 1 ระหว่างสร้าง');
  expect(
    created!.video_source.kind === 'local_file' && created!.video_source.file_name === 'ad-review-1080p.mp4',
    'Video source is the local file'
  ).toBe(true);
  expect(created!.video_metadata.height, '1080p video is accepted').toBe(1080);
  expect(
    Boolean(created!.vad_output.waveform && created!.vad_output.waveform.peaksBase64.length > 0),
    'Audio of a moov-at-end MP4 was decoded'
  ).toBe(true);
  expect(
    created!.spots.length === 4 && created!.srt_source.cue_count === 4,
    'Cues after the video end or without duration are left out'
  ).toBe(true);
  expect(created!.spots[2].text, 'Multi-line cue text is kept').toBe('หญิงยิ้ม\nแล้วเดินออกไป');
  expect(await page.getByText('ไม่ได้นำเข้า 2 บรรทัดจาก SRT').isVisible(), 'Skipped lines are reported').toBe(true);

  const skippedToggle = page.getByRole('button', { name: 'ไม่ได้นำเข้า 2 บรรทัดจาก SRT' });
  expect(await page.getByText('เริ่มหลังวิดีโอจบ').count(), 'Skipped lines stay folded until asked for').toBe(0);
  await skippedToggle.click();
  await page.getByText('เริ่มหลังวิดีโอจบ').first().waitFor();
  expect(await skippedToggle.getAttribute('aria-expanded'), 'The fold reports its state').toBe('true');
  await skippedToggle.click();

  expect(await firstLine.inputValue(), 'Formatting tags are stripped').toBe('ชายเปิดประตู');
  expect(await page.getByRole('button', { name: /สร้างบทบรรยายภาพ|ทำต่อจากชุดที่ค้าง/ }).count(), 'Generate controls are hidden').toBe(0);
  expect(await page.getByText(/ตรวจแก้ SRT · 4 บรรทัด/).count(), 'Header shows Review Mode status').toBeGreaterThan(0);

  const filter = page.getByRole('combobox', { name: 'แสดง' });
  await filter.click();
  const warningOption = await page.getByRole('option', { name: /^ต้องตรวจ/ }).textContent();
  await page.keyboard.press('Escape');
  const warningCount = Number(/\((\d+)\)/.exec(warningOption!)![1]);
  expect(warningCount, `Overlapping and short lines are flagged (${warningCount})`).toBeGreaterThanOrEqual(3);
  expect(await page.getByText('ทับบรรทัดอื่น').count(), 'Both overlapping lines show the warning').toBeGreaterThanOrEqual(2);
  expect(await page.getByText('สั้นกว่า 0.5 วินาที').count(), 'Short line shows the warning').toBeGreaterThanOrEqual(1);
  expect(await page.getByText(/บรรทัดที่มีคำเตือน|ข้อความเกินเวลา/).count(), 'No warning banners above the list').toBe(0);

  const checkTrigger = page.getByRole('button', { name: /^ต้องตรวจ \d+$/ });
  const checkMenu = page.getByRole('menu');
  await checkTrigger.click();
  await page.getByRole('menuitem', { name: /ทับบรรทัดอื่น/ }).click();
  const jumped = page.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: /^บทบรรยายที่ \d+$/ }) });
  expect(await jumped.getByText('ทับบรรทัดอื่น').count(), 'Jump opens a line that overlaps another').toBe(1);
  await checkMenu.waitFor({ state: 'hidden' });

  await checkTrigger.click();
  await checkMenu.waitFor();
  await page.keyboard.press('Escape');
  await checkMenu.waitFor({ state: 'hidden' });
  expect(await checkTrigger.evaluate((el) => el === document.activeElement), 'Escape returns focus to the check menu button').toBe(true);

  await checkTrigger.click();
  await checkMenu.waitFor();
  await page.locator('video').click({ position: { x: 10, y: 10 } });
  await checkMenu.waitFor({ state: 'hidden' });

  await checkTrigger.click();
  await page.getByRole('menuitem', { name: 'แสดงเฉพาะบรรทัดที่ต้องตรวจ' }).click();
  const shown = await page.getByRole('list', { name: 'รายการช่วงบรรยาย' }).getByRole('listitem').count();
  expect(shown, 'Warning filter lists only flagged lines').toBe(warningCount);

  await filter.click();
  await page.getByRole('option', { name: /^ทั้งหมด/ }).click();
  await page.getByRole('listitem', { name: 'ช่วงบรรยายที่ 1' }).click();
  expect(await page.getByRole('button', { name: 'ส่งออก SRT' }).isVisible(), 'SRT export is available').toBe(true);
  await firstLine.fill('ชายเปิดประตูห้อง');
  await expect
    .poll(() => patched?.[0]?.text, { message: 'Text edit is saved to the Review Mode job' })
    .toBe('ชายเปิดประตูห้อง');
  await page.getByText('บันทึกบนเซิร์ฟเวอร์แล้ว').waitFor();

  await queuedTitle.click();
  await editingTitle.fill('ตรวจบท ตอนที่ 1 (แก้)');
  await editingTitle.press('Tab');
  await page.getByText('บันทึกชื่อบนเซิร์ฟเวอร์แล้ว').waitFor();
  expect(renamed, 'Renaming in the editor saves the Job Title').toBe('ตรวจบท ตอนที่ 1 (แก้)');
  expect(
    await page.getByRole('button', { name: 'เปลี่ยนชื่องาน: ตรวจบท ตอนที่ 1 (แก้)', exact: true }).isVisible(),
    'The header shows the new title'
  ).toBe(true);

  rejectCreation = true;
  await page.goto('/new');
  await page.getByRole('button', { name: /ตรวจแก้ไฟล์ SRT/ }).click();
  await page.getByLabel('เลือกไฟล์ SRT').setInputFiles(REVIEW_SRT_PATH);
  await page.getByText('ad-review.srt', { exact: true }).waitFor();
  await page.getByLabel('เลือกวิดีโอ MP4').setInputFiles(REVIEW_1080P_PATH);
  await page.getByText('ad-review-1080p.mp4', { exact: true }).waitFor();
  await process.click();
  await page.getByText(/บันทึกงานตรวจแก้ไม่สำเร็จ/).waitFor({ timeout: 55_000 });
  const header = page.getByRole('banner');
  await header.getByRole('button', { name: 'เปลี่ยนชื่องาน: ad-review-1080p', exact: true }).click();
  await editingTitle.fill('ชื่องานเฉพาะในหน้านี้');
  await editingTitle.press('Tab');
  const localTitle = header.getByRole('button', { name: 'เปลี่ยนชื่องาน: ชื่องานเฉพาะในหน้านี้', exact: true });
  const localNotice = localTitle.getByText('ชื่ออยู่เฉพาะในหน้านี้', { exact: true });
  await localNotice.waitFor();
  await localTitle.click();
  await editingTitle.fill('ชื่อที่ยกเลิก');
  await editingTitle.press('Escape');
  await localNotice.waitFor();
  expect(
    renamed === 'ตรวจบท ตอนที่ 1 (แก้)' && new URL(page.url()).pathname === '/new',
    'Cancelling an edit keeps the original local-only title'
  ).toBe(true);
});

test('review mode accepts a public Google Drive SRT link with inline error, retry, and verification card', async ({ page }) => {
  test.setTimeout(60_000);

  const srtContent = fs.readFileSync(REVIEW_SRT_PATH, 'utf8');
  let fetchAttempts = 0;
  let created: {
    title: string;
    srt_source: { file_name: string; cue_count: number };
    spots: Array<{ text: string }>;
  } | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (url.endsWith('/api/review/fetch-srt') && request.method() === 'POST') {
      fetchAttempts += 1;
      if (fetchAttempts === 1) {
        return route.fulfill({
          status: 400,
          json: { error: 'ไฟล์นี้ไม่ได้ตั้งเป็นสาธารณะ กรุณาเปิดสิทธิ์ “ทุกคนที่มีลิงก์” ใน Google Drive' },
        });
      }
      return route.fulfill({
        json: {
          file_name: 'drive-ad-script.srt',
          content: srtContent,
          size_bytes: Buffer.byteLength(srtContent, 'utf8'),
          cue_count: 6,
        },
      });
    }
    if (url.endsWith('/api/jobs/review') && request.method() === 'POST') {
      created = request.postDataJSON();
      return route.fulfill({
        json: {
          job: {
            ...created,
            job_id: 'job_review_gdrive',
            schema_version: 3,
            mode: 'review',
            status: 'READY',
            batches: [],
            created_at: '2026-11-20T00:00:00Z',
            updated_at: '2026-11-20T00:00:00Z',
          },
          isRunning: false,
        },
      });
    }
    if (url.endsWith('/api/jobs/job_review_gdrive/spots')) {
      return route.fulfill({ json: { job: { job_id: 'job_review_gdrive' } } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/new');
  await page.getByRole('button', { name: /ตรวจแก้ไฟล์ SRT/ }).click();
  await page.getByLabel('เลือกวิดีโอ MP4').setInputFiles(REVIEW_1080P_PATH);

  const srtLinkInput = page.getByPlaceholder('https://drive.google.com/file/d/…/view');
  const process = page.getByRole('button', { name: 'เริ่มตรวจแก้' });

  await srtLinkInput.fill('https://example.com/script.srt');
  await page.getByText('กรุณาวางลิงก์ไฟล์ Google Drive เช่น https://drive.google.com/file/d/…/view').waitFor();
  expect(await srtLinkInput.getAttribute('aria-invalid')).toBe('true');
  expect(await process.isDisabled()).toBe(true);

  await srtLinkInput.fill('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing');
  await page.getByText('กำลังตรวจสอบและดึงไฟล์ SRT จาก Google Drive…').waitFor();
  await page.getByText('ไฟล์นี้ไม่ได้ตั้งเป็นสาธารณะ กรุณาเปิดสิทธิ์ “ทุกคนที่มีลิงก์” ใน Google Drive').waitFor();
  const retryButton = page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true });
  await retryButton.waitFor();
  expect(await process.isDisabled(), 'Process stays disabled when Drive SRT fetch fails').toBe(true);

  await retryButton.click();
  await page.getByText('drive-ad-script.srt', { exact: true }).waitFor();
  await page.getByText(/6 บรรทัด/).waitFor();
  expect(fetchAttempts).toBe(2);
  expect(await process.isEnabled(), 'Process enables once Drive SRT is verified').toBe(true);

  await page.getByRole('button', { name: 'แก้ไขลิงก์', exact: true }).click();
  await srtLinkInput.waitFor();
  await page.getByRole('button', { name: 'ล้างลิงก์ไฟล์ SRT', exact: true }).click();
  expect(await srtLinkInput.inputValue(), 'Clicking clear while editing a verified Drive SRT link clears the link').toBe('');
  expect(await page.getByText('drive-ad-script.srt', { exact: true }).count(), 'Verified card clears when link is cleared').toBe(0);
  expect(await process.isDisabled(), 'Process disables after clearing Drive SRT link').toBe(true);

  await srtLinkInput.fill('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing');
  await page.getByText('drive-ad-script.srt', { exact: true }).waitFor();
  expect(await process.isEnabled(), 'Process re-enables once Drive SRT is re-verified').toBe(true);

  await process.click();
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).waitFor({ timeout: 55_000 });
  await expect
    .poll(() => new URL(page.url()).pathname, { message: 'Opens the created Review Mode job' })
    .toBe('/jobs/job_review_gdrive');
  expect(created!.srt_source.file_name).toBe('drive-ad-script.srt');
  expect(created!.srt_source.cue_count).toBe(4);
});

test('review mode verifies remote MP4 URL via HEAD with inline error, retry, and verified card', async ({ page }) => {
  test.setTimeout(60_000);

  const remoteMp4Url = 'https://cdn.example.invalid/clips/%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201.mp4';
  let headAttempts = 0;

  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/api/me')) {
      return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.route('https://cdn.example.invalid/**', async (route) => {
    if (route.request().method() !== 'HEAD') {
      return route.fulfill({ status: 404 });
    }
    headAttempts += 1;
    if (headAttempts === 1) {
      return route.fulfill({
        status: 403,
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-length',
        'content-length': String(2 * 1024 * 1024),
      },
    });
  });

  await page.goto('/new');
  await page.getByRole('button', { name: /ตรวจแก้ไฟล์ SRT/ }).click();
  await page.getByLabel('เลือกไฟล์ SRT').setInputFiles(REVIEW_SRT_PATH);

  const videoLinkInput = page.getByPlaceholder('https://…/video.mp4');
  const process = page.getByRole('button', { name: 'เริ่มตรวจแก้' });

  await videoLinkInput.fill(remoteMp4Url);
  await page.getByText('ลิงก์นี้เปิดจากเบราว์เซอร์ไม่ได้ กรุณาดาวน์โหลดแล้วเลือกเป็นไฟล์แทน').waitFor();
  const retryButton = page.getByRole('button', { name: 'ลองอีกครั้ง', exact: true });
  await retryButton.waitFor();
  expect(await process.isDisabled(), 'Process stays disabled when remote MP4 HEAD fails').toBe(true);

  await retryButton.click();
  await page.getByText('บทที่ 1.mp4', { exact: true }).waitFor();
  await page.getByText('2.00 MB · ลิงก์ MP4 พร้อมใช้', { exact: true }).waitFor();
  expect(headAttempts).toBe(2);
  expect(await page.getByRole('textbox', { name: 'ชื่องาน' }).inputValue()).toBe('บทที่ 1');
  expect(await process.isEnabled(), 'Process enables once remote MP4 HEAD succeeds').toBe(true);
});
