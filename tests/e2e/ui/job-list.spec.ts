import { expect, test } from '@playwright/test';

test('job list loading, filtering, sorting, deletion, inline rename, responsive layout, pagination, and error views', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const spot = {
    spot_id: 'one',
    start_ms: 1000,
    end_ms: 5000,
    duration_ms: 4000,
    original_start_ms: 1000,
    original_end_ms: 5000,
    decision: 'generate',
    text: 'บทเดิม',
    is_edited: false,
  };
  const job = {
    schema_version: 3,
    job_id: 'job_old',
    title: 'old',
    mode: 'generate',
    status: 'READY',
    video_metadata: {
      fileName: 'old.mp4',
      fileSize: 1,
      mimeType: 'video/mp4',
      width: 854,
      height: 480,
      durationMs: 10000,
      videoCodec: 'avc1',
      audioCodec: 'mp4a.40.2',
      hasAudioTrack: true,
    },
    vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [] },
    batches: [],
    spots: [spot],
  };

  interface JobRow {
    job_id: string;
    title?: string;
    file_name: string;
    updated_at: string;
    size_bytes: number;
    is_upload: boolean;
    is_processing: boolean;
    mode?: string;
    status?: string;
    duration_ms?: number;
    spot_count?: number;
    progress_percent?: number;
    error_message?: string;
  }

  let jobs: JobRow[] = [
    {
      job_id: 'job_old',
      file_name: 'old.mp4',
      updated_at: '2026-11-20T03:00:00Z',
      size_bytes: 1234,
      is_upload: false,
      is_processing: false,
      mode: 'generate',
      status: 'READY',
      duration_ms: 754000,
      spot_count: 14,
    },
    {
      job_id: 'job_busy',
      file_name: 'busy.mp4',
      updated_at: '2026-11-19T03:00:00Z',
      size_bytes: 5678,
      is_upload: false,
      is_processing: true,
      mode: 'generate',
      status: 'ANALYZING',
      duration_ms: 360000,
      spot_count: 0,
      progress_percent: 60,
    },
    {
      job_id: 'job_review',
      title: 'บทเรียนที่ 1',
      file_name: 'lesson.mp4',
      updated_at: '2026-11-18T03:00:00Z',
      size_bytes: 0,
      is_upload: false,
      is_processing: false,
      mode: 'review',
      status: 'READY',
      duration_ms: 185000,
      spot_count: 8,
    },
    {
      job_id: 'job_upload',
      file_name: 'อัปโหลดไม่เสร็จ (job_upload)',
      updated_at: '2026-11-17T03:00:00Z',
      size_bytes: 99,
      is_upload: true,
      is_processing: false,
    },
  ];
  let deleted: string[] = [];
  let listFails = false;
  let listRequests = 0;
  let nextListResponse: Promise<void> | undefined;
  let renameRequests = 0;
  let nextRenameResponse: Promise<boolean> | undefined;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (url.endsWith('/api/jobs')) {
      listRequests++;
      const snapshot = { jobs };
      const pending = nextListResponse;
      nextListResponse = undefined;
      await pending;
      return listFails ? route.fulfill({ status: 500, json: { error: 'fixture' } }) : route.fulfill({ json: snapshot });
    }
    if (url.endsWith('/api/jobs/job_old') && request.method() === 'GET') {
      return route.fulfill({ json: { job, isRunning: false } });
    }
    if (url.endsWith('/api/jobs/job_old') && request.method() === 'PATCH') {
      renameRequests++;
      const pending = nextRenameResponse;
      nextRenameResponse = undefined;
      if (pending && !(await pending)) {
        return route.fulfill({ status: 500, json: { error: 'บันทึกชื่อไม่สำเร็จ' } });
      }
      job.title = request.postDataJSON().title;
      jobs = jobs.map((item) => (item.job_id === 'job_old' ? { ...item, title: job.title } : item));
      return route.fulfill({ json: { job } });
    }
    if (url.endsWith('/api/jobs/job_broken')) return route.fulfill({ status: 500, json: { error: 'fixture' } });
    const removed = /\/api\/jobs\/(job_\w+)\/files$/.exec(url);
    if (removed && request.method() === 'DELETE') {
      deleted.push(removed[1]);
      jobs = jobs.filter((item) => item.job_id !== removed[1]);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  let releaseInitialList!: () => void;
  nextListResponse = new Promise<void>((resolve) => {
    releaseInitialList = resolve;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const list = page.getByRole('table', { name: 'งานที่บันทึกไว้' });
  const skeletons = page.locator('[data-slot="skeleton"]');
  await list.waitFor();
  await skeletons.first().waitFor();
  expect(await list.getAttribute('aria-busy'), 'Initial list load marks the table busy').toBe('true');
  expect(await skeletons.filter({ visible: true }).count(), 'Initial loading renders visible skeleton placeholders').toBeGreaterThanOrEqual(4);
  expect(await list.getByRole('link').count(), 'No job links appear while loading skeletons are shown').toBe(0);
  releaseInitialList();

  const listed = () => page.getByRole('link', { name: /^เปิดงาน (old\.mp4|งานเก่าที่เปลี่ยนชื่อ)$/ }).first().waitFor();
  await listed();
  expect(await skeletons.count(), 'Skeleton placeholders clear once jobs load').toBe(0);
  const rows = list.locator('tbody tr');
  expect(await rows.count(), 'Every Job and Unfinished Upload is listed').toBe(4);
  const heightOf = async (locator: ReturnType<typeof page.locator>) => Math.round((await locator.boundingBox())!.height);
  expect(await heightOf(page.getByRole('button', { name: 'งานใหม่' })), 'The page action is a 40px button (DESIGN › Buttons)').toBe(40);
  expect(await heightOf(page.getByRole('link', { name: 'เปิดงาน old.mp4' })), 'Row actions are 36px buttons').toBe(36);
  expect(await heightOf(page.getByRole('button', { name: 'ลบงาน old.mp4' })), 'Delete action is an exposed 36px button').toBe(36);
  expect((await rows.first().textContent())?.includes('old.mp4'), 'Most recently changed Job comes first').toBe(true);
  expect(await list.getByText('ตรวจแก้ SRT').filter({ visible: true }).count(), 'Review Mode Job is tagged with its mode').toBe(1);
  expect(
    (await page.getByRole('link', { name: 'เปิดงาน บทเรียนที่ 1' }).count()) === 1 && (await list.getByText('lesson.mp4').count()) === 1,
    'A titled Job shows its title with the file name below'
  ).toBe(true);
  expect(await list.getByText('กำลังวิเคราะห์ 60%').filter({ visible: true }).count(), 'An analysing Job shows its status and progress').toBe(1);
  expect(await list.getByText('12:34').filter({ visible: true }).count(), 'A saved Job shows its video duration').toBe(1);
  expect(await list.getByText('14 จุด').filter({ visible: true }).count(), 'A saved Job shows its AD spot count').toBe(1);
  expect(await page.getByRole('button', { name: 'ลบงาน busy.mp4' }).isDisabled(), 'A Job being analysed cannot be deleted').toBe(true);
  const uploadRow = rows.filter({ hasText: '#upload' });
  expect(await uploadRow.getByRole('link').count(), 'An Unfinished Upload can only be deleted').toBe(0);
  expect((await uploadRow.innerText()).includes('0.1 KB'), 'An upload shows its size before deletion').toBe(true);

  const search = page.getByRole('searchbox', { name: 'ค้นหาชื่องานหรือชื่อไฟล์' });
  const modeFilter = page.getByRole('combobox', { name: 'กรองตามโหมด' });
  const statusFilter = page.getByRole('combobox', { name: 'กรองตามสถานะ' });

  await modeFilter.click();
  await page.getByRole('option', { name: /ตรวจแก้ SRT/ }).click();
  expect(
    (await rows.count()) === 1 && ((await rows.first().textContent())?.includes('บทเรียนที่ 1') ?? false),
    'Mode filter narrows to Review Mode Jobs'
  ).toBe(true);
  expect(new URL(page.url()).searchParams.get('mode'), 'Mode filter syncs mode query param').toBe('review');
  await modeFilter.click();
  await page.getByRole('option', { name: /ทั้งหมด/ }).click();
  expect(await rows.count(), 'All mode filter restores every Job').toBe(4);
  expect(new URL(page.url()).search, 'Clearing mode filter removes query params').toBe('');

  await statusFilter.click();
  await page.getByRole('option', { name: /กำลังดำเนินการ/ }).click();
  expect(
    (await rows.count()) === 1 && ((await rows.first().textContent())?.includes('busy.mp4') ?? false),
    'Status filter narrows to Processing Jobs'
  ).toBe(true);
  await modeFilter.click();
  await page.getByRole('option', { name: /สร้างบทบรรยาย/ }).click();
  await statusFilter.click();
  await page.getByRole('option', { name: /พร้อมแก้/ }).click();
  expect(
    (await rows.count()) === 1 && ((await rows.first().textContent())?.includes('old.mp4') ?? false),
    'Combined mode and status filters narrow to matching Jobs'
  ).toBe(true);

  await page.reload();
  await page.getByRole('link', { name: 'เปิดงาน old.mp4' }).waitFor();
  expect(await rows.count(), 'Reload preserves filtered rows from URL query params').toBe(1);
  expect(new URL(page.url()).searchParams.get('mode'), 'Reload preserves mode query param').toBe('generate');
  expect(new URL(page.url()).searchParams.get('status'), 'Reload preserves status query param').toBe('ready');

  const clearFilters = page.getByRole('button', { name: 'ล้างตัวกรอง' });
  await clearFilters.click();
  expect(await rows.count(), 'Toolbar reset button restores every Job').toBe(4);
  expect(new URL(page.url()).search, 'Toolbar reset button clears URL query params').toBe('');
  expect(await clearFilters.count(), 'Toolbar reset button hides when unfiltered').toBe(0);

  const durationHeader = list.getByRole('columnheader', { name: 'ความยาว' });
  await durationHeader.getByRole('button', { name: 'ความยาว' }).click();
  expect(
    (await durationHeader.getAttribute('aria-sort')) === 'descending' && ((await rows.first().textContent())?.includes('old.mp4') ?? false),
    'Sorting by duration puts the longest Job first'
  ).toBe(true);
  await durationHeader.getByRole('button', { name: 'ความยาว' }).click();
  expect(
    (await durationHeader.getAttribute('aria-sort')) === 'ascending' && ((await rows.first().textContent())?.includes('#upload') ?? false),
    'Toggling duration sort puts the shortest or unmeasured row first'
  ).toBe(true);
  const updatedHeader = list.getByRole('columnheader', { name: 'แก้ล่าสุด' });
  await updatedHeader.getByRole('button', { name: 'แก้ล่าสุด' }).click();
  expect(
    (await updatedHeader.getAttribute('aria-sort')) === 'descending' && ((await rows.first().textContent())?.includes('old.mp4') ?? false),
    'Sorting by last updated restores newest-first order'
  ).toBe(true);

  await search.fill('lesson');
  expect(await rows.count(), 'Search filters matching Jobs').toBe(1);
  await page.locator('button[aria-label="ล้างคำค้นหา"]').click();
  expect(
    (await search.inputValue()) === '' && (await search.evaluate((el) => el === document.activeElement)) && (await rows.count()) === 4,
    'Clear-search button empties and focuses the field and restores all rows'
  ).toBe(true);

  const uploadDelete = page.getByRole('button', { name: /^ลบไฟล์อัปโหลด #upload ขนาด 0\.1 KB อัปเดตล่าสุด/ });
  const refresh = page.getByRole('button', { name: 'รีเฟรชรายการงาน' });
  const confirmDialog = page.getByRole('alertdialog', { name: 'ยืนยันการลบงาน' });
  await uploadDelete.click();
  await confirmDialog.waitFor();
  expect(
    (await confirmDialog.innerText()).includes('#upload') && (await confirmDialog.innerText()).includes('0.1 KB'),
    'The confirmation identifies the same file'
  ).toBe(true);
  await confirmDialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await confirmDialog.waitFor({ state: 'hidden' });
  expect(deleted.length, 'Cancelling the confirm sends no delete').toBe(0);

  let releaseStaleList!: () => void;
  nextListResponse = new Promise<void>((resolve) => {
    releaseStaleList = resolve;
  });
  const staleListRequest = page.waitForRequest((request) => request.url().endsWith('/api/jobs'));
  await refresh.click();
  await staleListRequest;
  await uploadDelete.click();
  await confirmDialog.getByRole('button', { name: 'ลบงาน' }).click();
  await uploadDelete.waitFor({ state: 'hidden' });
  expect(deleted, 'Confirmed delete removes the Unfinished Upload').toEqual(['job_upload']);
  releaseStaleList();
  await list.and(page.locator('[aria-busy="false"]')).waitFor();
  expect(await uploadDelete.count(), 'A stale list response cannot restore a deleted upload').toBe(0);
  await confirmDialog.waitFor({ state: 'hidden' });
  expect(await search.evaluate((el) => el === document.activeElement), 'Deleting a row moves focus to the remaining list').toBe(true);

  const openJob = page.getByRole('link', { name: 'เปิดงาน old.mp4' });
  expect(await openJob.getAttribute('href'), 'Opening a Job is a native link to its workspace').toBe('/jobs/job_old');
  await openJob.focus();
  await page.keyboard.press('Enter');
  const line = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await line.waitFor();
  expect(new URL(page.url()).pathname, 'Opening a Job moves to its URL').toBe('/jobs/job_old');
  expect(await page.locator('main').evaluate((el) => document.activeElement === el), 'Keyboard focus moves to the opened workspace').toBe(true);
  await page.reload();
  await line.waitFor();
  expect(await line.inputValue(), 'Reload stays on the same Job').toBe('บทเดิม');
  await line.fill('แก้แต่บันทึกไม่ผ่าน');
  await page.getByText('บันทึกไม่สำเร็จ', { exact: false }).waitFor();
  const leaveDialog = page.getByRole('alertdialog', { name: 'ออกจากหน้านี้?' });
  await page.goBack();
  await leaveDialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await leaveDialog.waitFor({ state: 'hidden' });
  expect(
    new URL(page.url()).pathname === '/jobs/job_old' && (await line.inputValue()) === 'แก้แต่บันทึกไม่ผ่าน',
    'Declining Back keeps the Job and its URL'
  ).toBe(true);
  await page.goBack();
  await leaveDialog.getByRole('button', { name: 'ออกจากหน้านี้' }).click();
  await listed();
  expect(new URL(page.url()).pathname, 'Back returns to the Job List').toBe('/');

  await page.getByRole('link', { name: 'เปิดงาน old.mp4' }).click();
  await line.waitFor();
  const header = page.getByRole('banner');
  const headerHeights = async () => {
    const heights: number[] = [];
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      heights.push(await heightOf(header));
    }
    return heights.join(', ');
  };
  const idleHeaderHeights = await headerHeights();
  const titleButton = page.getByRole('button', { name: 'เปลี่ยนชื่องาน: old', exact: true });
  const rename = page.getByRole('textbox', { name: 'ชื่องาน', exact: true });
  const idleBorder = await titleButton.evaluate((el) => getComputedStyle(el).borderColor);
  await titleButton.hover();
  await page.getByRole('tooltip').filter({ hasText: /^แก้ไขชื่อ$/ }).waitFor();
  expect(await titleButton.evaluate((el) => getComputedStyle(el).borderColor) !== idleBorder, 'Hover reveals a border around the title').toBe(true);
  await titleButton.focus();
  await titleButton.press('Enter');
  expect(await rename.evaluate((el) => el === document.activeElement), 'Opening inline rename focuses the title field').toBe(true);
  await rename.fill('ชื่อที่ยกเลิก');
  const info = page.getByRole('button', { name: 'ข้อมูลวิดีโอ', exact: true });
  expect(
    await header.getByRole('button', { name: /^(บันทึกชื่อ|ยกเลิกการเปลี่ยนชื่อ)$/ }).count(),
    'The title editor has no confirmation buttons'
  ).toBe(0);
  await rename.press('Escape');
  await rename.waitFor({ state: 'hidden' });
  expect(await titleButton.evaluate((el) => el === document.activeElement), 'Escape discards the draft and returns focus to the title').toBe(true);
  expect(renameRequests, 'Cancelling rename sends no PATCH').toBe(0);

  await titleButton.click();
  expect(await rename.inputValue(), 'Reopening rename starts with the saved title').toBe('old');
  await rename.fill('งานเก่าที่เปลี่ยนชื่อ');
  let finishRename!: (ok: boolean) => void;
  nextRenameResponse = new Promise<boolean>((resolve) => {
    finishRename = resolve;
  });
  try {
    await header.click({ position: { x: 700, y: 24 } });
    await page.getByText('กำลังบันทึกชื่อ…', { exact: true }).waitFor();
    expect(await rename.isEditable(), 'The title stays read-only while saving').toBe(false);
    const savingHeights = await headerHeights();
    expect(savingHeights, `Saving a title must keep the header height at 320px and 1440px (${idleHeaderHeights} → ${savingHeights})`).toBe(
      idleHeaderHeights
    );
  } finally {
    finishRename(false);
  }
  await page.getByText('บันทึกชื่อไม่สำเร็จ', { exact: true }).waitFor();
  expect(await rename.inputValue(), 'A failed save keeps the typed title').toBe('งานเก่าที่เปลี่ยนชื่อ');
  expect(await headerHeights(), 'A failed rename does not expand the header').toBe(idleHeaderHeights);

  const logo = header.getByRole('link', { name: 'TCC Envisio รายการงาน' });
  await logo.click();
  const leaveTitle = page.getByRole('alertdialog', { name: 'กลับไปรายการงาน?' });
  await leaveTitle.getByText('ชื่องานที่แก้ยังไม่ได้บันทึกและจะหายไป', { exact: true }).waitFor();
  await leaveTitle.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await leaveTitle.waitFor({ state: 'hidden' });
  expect(await rename.inputValue(), 'Staying in the editor preserves the failed rename draft').toBe('งานเก่าที่เปลี่ยนชื่อ');
  await rename.press('Enter');
  const saveAcknowledgement = header.getByRole('status').getByText('บันทึกชื่อบนเซิร์ฟเวอร์แล้ว', { exact: true });
  await saveAcknowledgement.waitFor();
  expect(await headerHeights(), 'A saved title does not expand the header').toBe(idleHeaderHeights);
  expect(renameRequests, 'Retry submits exactly one new rename request').toBe(2);
  const renamedTitle = page.getByRole('button', { name: 'เปลี่ยนชื่องาน: งานเก่าที่เปลี่ยนชื่อ', exact: true });
  expect(
    await renamedTitle.getAttribute('aria-describedby'),
    'The title exposes the server acknowledgement'
  ).toBe(await saveAcknowledgement.getAttribute('id'));
  expect(await renamedTitle.evaluate((el) => el === document.activeElement), 'Successful rename returns focus to the new title').toBe(true);

  const summary = page.getByRole('tooltip').filter({ hasText: 'old.mp4' });
  await info.hover();
  await summary.getByText('old.mp4', { exact: true }).waitFor();
  expect(await info.getAttribute('aria-describedby'), 'The info button describes the hover summary').toBe(await summary.getAttribute('id'));
  await page.mouse.move(0, 150);
  await summary.waitFor({ state: 'hidden' });
  await renamedTitle.focus();
  await page.keyboard.press('Tab');
  await summary.getByText('old.mp4', { exact: true }).waitFor();
  await info.click();
  const videoDetails = page.getByRole('dialog', { name: 'ข้อมูลวิดีโอ', exact: true });
  await videoDetails.getByText('old.mp4', { exact: true }).waitFor();
  await videoDetails.getByText('854 × 480', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await videoDetails.waitFor({ state: 'hidden' });
  expect(await info.evaluate((el) => el === document.activeElement), 'Escape returns focus to the video information button').toBe(true);

  const statusPill = page.getByRole('button', { name: /ดูรายละเอียดการทำงาน$/ });
  await statusPill.click();
  await page.getByRole('heading', { name: 'รายละเอียดการทำงาน' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'รายละเอียดการทำงาน' }).waitFor({ state: 'hidden' });
  await logo.click();
  await listed();
  expect(new URL(page.url()).pathname, 'The logo leads back to the Job List').toBe('/');
  await page.getByRole('link', { name: 'เปิดงาน งานเก่าที่เปลี่ยนชื่อ' }).waitFor();

  await page.getByRole('button', { name: 'งานใหม่' }).click();
  await page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' }).waitFor();
  expect(new URL(page.url()).pathname, 'New Job starts at /new').toBe('/new');
  await page.getByRole('button', { name: 'ยกเลิก' }).click();
  await listed();

  const longTitle = 'ละครโทรทัศน์ชุดการเดินทางของชุมชนริมแม่น้ำ ฉบับตรวจแก้บทบรรยายภาพ ตอน 08';
  const baseRow = jobs[0];
  jobs = [
    { ...baseRow, title: longTitle, file_name: 'community_episode_08_mix_v4.mp4', status: 'FAILED', error_message: 'วิเคราะห์ช่วงที่ 2 ไม่สำเร็จ' },
    { ...baseRow, job_id: 'job_upload1', file_name: 'อัปโหลดไม่เสร็จ (job_upload1)', size_bytes: 1024, is_upload: true },
    { ...baseRow, job_id: 'job_upload2', file_name: 'อัปโหลดไม่เสร็จ (job_upload2)', size_bytes: 2048, is_upload: true },
  ];
  await page.reload();
  const title = list.getByRole('link', { name: longTitle, exact: true });
  await title.waitFor();
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await title.evaluate((el) => el.getBoundingClientRect().width >= 120 && el.scrollWidth <= el.clientWidth + 1),
      `Long names remain readable at width ${width}`
    ).toBe(true);
    const row = rows.filter({ has: page.getByRole('link', { name: longTitle, exact: true }) });
    const open = row.getByRole('link', { name: `เปิดงาน ${longTitle}` });
    const remove = row.getByRole('button', { name: `ลบงาน ${longTitle}` });
    expect((await open.boundingBox())!.y, `Row actions stay on one line at width ${width}`).toBe((await remove.boundingBox())!.y);
    expect((await open.innerText()) === '' && (await remove.innerText()) === '', 'Row actions show only icons').toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  const largeText = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  expect(
    await list.evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth + 1),
    'The table fits at 200% text size'
  ).toBe(true);
  await largeText.evaluate((el) => (el as HTMLStyleElement).remove());

  const failure = list.getByRole('button', { name: /ดูรายละเอียด: วิเคราะห์ไม่สำเร็จ/ });
  await failure.focus();
  await page.keyboard.press('Enter');
  const failureMessage = page.getByText('วิเคราะห์ช่วงที่ 2 ไม่สำเร็จ', { exact: true });
  await failureMessage.waitFor();
  await page.keyboard.press('Escape');
  await failureMessage.waitFor({ state: 'hidden' });
  expect(await failure.evaluate((el) => el === document.activeElement), 'Closing failure details restores focus').toBe(true);
  for (const [id, size] of [
    ['upload1', '1.0 KB'],
    ['upload2', '2.0 KB'],
  ] as const) {
    const row = rows.filter({ hasText: `#${id}` });
    expect(
      (await row.getByRole('button', { name: `ลบไฟล์อัปโหลด #${id}` }).isVisible()) && (await row.innerText()).includes(size),
      'Uploads are distinguishable before deletion on a narrow screen'
    ).toBe(true);
    expect(await row.locator('time').filter({ visible: true }).count(), 'Upload time is visible on a narrow screen').toBe(1);
  }

  let finishRefresh!: () => void;
  nextListResponse = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  const previousRequests = listRequests;
  await refresh.click();
  expect(
    (await list.getAttribute('aria-busy')) === 'true' && (await refresh.isDisabled()),
    'An in-flight refresh is announced and the control is disabled'
  ).toBe(true);
  await refresh.dispatchEvent('click');
  expect(listRequests, 'Refresh does not start an overlapping request').toBe(previousRequests + 1);
  finishRefresh();
  await page.getByText('อัปเดตรายการงานแล้ว', { exact: true }).waitFor({ state: 'attached' });

  jobs = [{ ...baseRow, status: 'ANALYZING', is_processing: true, progress_percent: 65 }];
  await refresh.click();
  await list.getByText('กำลังวิเคราะห์ 65%', { exact: true }).filter({ visible: true }).waitFor();
  jobs = [{ ...baseRow, status: 'READY', is_processing: false }];
  await list.getByText('พร้อมแก้', { exact: true }).filter({ visible: true }).waitFor({ timeout: 8000 });
  expect(await list.getByRole('button', { name: /ลบงาน/ }).isEnabled(), 'Processing status refreshes automatically').toBe(true);

  jobs = Array.from({ length: 1000 }, (_, index) => ({
    ...baseRow,
    job_id: `job_episode_${index}`,
    title: `รายการตรวจแก้ ${index}`,
    file_name: `episode_${index}.mp4`,
  }));
  await page.reload();
  await list.getByRole('link', { name: 'เปิดงาน รายการตรวจแก้ 0', exact: true }).waitFor();
  expect(await rows.count(), 'The first page only renders 25 of 1,000 Jobs').toBe(25);
  await page.getByRole('button', { name: 'หน้าถัดไป' }).click();
  await list.getByRole('link', { name: 'เปิดงาน รายการตรวจแก้ 25', exact: true }).waitFor();
  await search.fill('EPISODE_999');
  await list.getByRole('link', { name: 'เปิดงาน รายการตรวจแก้ 999', exact: true }).waitFor();
  expect(await rows.count(), 'Search finds results across pages by the original file name').toBe(1);
  await search.fill('ไม่พบแน่');
  await page.getByText('ไม่พบงานที่ตรงกับการค้นหา', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'ล้างการค้นหา' }).press('Enter');
  await list.getByRole('link', { name: 'เปิดงาน รายการตรวจแก้ 0', exact: true }).waitFor();
  expect(await search.evaluate((el) => el === document.activeElement), 'Clearing the search returns focus to its field').toBe(true);

  jobs = jobs.slice(0, 1);
  await page.reload();
  await page.getByRole('button', { name: 'ลบงาน รายการตรวจแก้ 0' }).click();
  await confirmDialog.getByRole('button', { name: 'ลบงาน' }).click();
  await page.getByText('ยังไม่มีงาน', { exact: true }).waitFor();
  await confirmDialog.waitFor({ state: 'hidden' });
  const newJob = page.getByRole('button', { name: 'งานใหม่' });
  expect(await newJob.evaluate((el) => el === document.activeElement), 'Deleting the last row focuses the empty-state action').toBe(true);
  await newJob.click();
  await page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' }).waitFor();

  await page.goto('/jobs/job_missing');
  await page.getByRole('heading', { name: 'ไม่พบงานนี้' }).waitFor();
  await page.goto('/jobs/job_broken');
  await page.getByRole('heading', { name: 'เปิดงานไม่สำเร็จ' }).waitFor();
  listFails = true;
  await page.goto('/');
  await page.getByText('โหลดรายการงานไม่สำเร็จ').waitFor();
  expect(await page.getByRole('button', { name: 'งานใหม่' }).isVisible(), 'A new Job can start when the list fails to load').toBe(true);
});
