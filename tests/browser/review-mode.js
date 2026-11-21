async page => {
  await page.unrouteAll({ behavior: 'wait' });
  let created = null;
  let patched = null, renamed = null;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = request.url();
    if (url.endsWith('/api/jobs/review') && request.method() === 'POST') {
      created = request.postDataJSON();
      return route.fulfill({ json: { job: { ...created, job_id: 'job_review_fixture', schema_version: 3, title: created.title, mode: 'review', status: 'READY', batches: [], created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' }, isRunning: false } });
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
  await page.goto('http://127.0.0.1:4173/new');
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  assert(await page.getByRole('button', { name: /สร้างบทบรรยาย/ }).isVisible(), 'Generate Mode card is offered');
  await page.getByRole('button', { name: /แก้ไข SRT ที่มีอยู่/ }).click();
  const process = page.getByRole('button', { name: 'ประมวลผล' });
  assert(await process.isDisabled(), 'Process waits for both files');
  await page.getByLabel('เลือกวิดีโอ MP4').setInputFiles('/tmp/ad-review-1080p.mp4');
  await page.getByLabel('เลือกไฟล์ SRT').setInputFiles('/tmp/ad-review.srt');
  const titleField = page.getByRole('textbox', { name: 'ชื่องาน' });
  assert(await titleField.inputValue() === 'ad-review-1080p', 'Job Title defaults to the video file name');
  await titleField.fill('ตรวจบท ตอนที่ 1');
  await page.getByLabel('เลือกวิดีโอ MP4').setInputFiles('/tmp/ad-review-1080p.mp4');
  assert(await titleField.inputValue() === 'ตรวจบท ตอนที่ 1', 'Choosing the video again keeps a typed title');
  await process.click();
  const firstLine = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await firstLine.waitFor({ timeout: 60000 });
  for (let i = 0; i < 100 && !created; i++) await page.waitForTimeout(50);
  assert(created, 'Review Mode job was created on the server');
  assert(created.title === 'ตรวจบท ตอนที่ 1', 'The typed Job Title is sent when the Job is created');
  for (let i = 0; i < 100 && new URL(page.url()).pathname !== '/jobs/job_review_fixture'; i++) await page.waitForTimeout(50);
  assert(new URL(page.url()).pathname === '/jobs/job_review_fixture', 'The new Job opens at its own URL');
  assert(created.video_source.kind === 'local_file' && created.video_source.file_name === 'ad-review-1080p.mp4', 'Video source is the local file');
  assert(created.video_metadata.height === 1080, '1080p video is accepted');
  assert(created.vad_output.waveform && created.vad_output.waveform.peaksBase64.length > 0, 'Audio of a moov-at-end MP4 was decoded');
  assert(created.spots.length === 4 && created.srt_source.cue_count === 4, 'Cues after the video end or without duration are left out');
  assert(created.spots[2].text === 'หญิงยิ้ม\nแล้วเดินออกไป', 'Multi-line cue text is kept');
  assert(await page.getByText('ไม่ได้นำเข้า 2 บรรทัดจาก SRT').isVisible(), 'Skipped lines are reported');
  assert(await firstLine.inputValue() === 'ชายเปิดประตู', 'Formatting tags are stripped');
  assert(await page.getByRole('button', { name: /สร้างบทบรรยายภาพ|ทำต่อจากชุดที่ค้าง/ }).count() === 0, 'Generate controls are hidden');
  assert(await page.getByText(/ตรวจแก้ SRT · 4 บรรทัด/).count() > 0, 'Header shows Review Mode status');
  const warningOption = await page.locator('#spot-filter option[value="needs_check"]').textContent();
  const warningCount = Number(/\((\d+)\)/.exec(warningOption)[1]);
  assert(warningCount >= 3, `Overlapping and short lines are flagged (${warningCount})`);
  assert(await page.getByText('ทับบรรทัดอื่น').count() >= 2, 'Both overlapping lines show the warning');
  assert(await page.getByText('สั้นกว่า 0.5 วินาที').count() >= 1, 'Short line shows the warning');
  assert(await page.getByText(/บรรทัดที่มีคำเตือน|ข้อความเกินเวลา/).count() === 0, 'No warning banners above the list');
  await page.locator('summary', { hasText: 'ต้องตรวจ' }).click();
  await page.getByRole('button', { name: /ทับบรรทัดอื่น/ }).click();
  const jumped = page.getByRole('listitem').filter({ has: page.getByRole('textbox', { name: /^บทบรรยายที่ \d+$/ }) });
  assert(await jumped.getByText('ทับบรรทัดอื่น').count() === 1, 'Jump opens a line that overlaps another');
  const checkMenu = page.locator('details', { has: page.locator('summary', { hasText: 'ต้องตรวจ' }) });
  await page.locator('summary', { hasText: 'ต้องตรวจ' }).click();
  await page.keyboard.press('Escape');
  assert(!(await checkMenu.evaluate(el => el.open)), 'Escape closes the check menu');
  await page.locator('summary', { hasText: 'ต้องตรวจ' }).click();
  await page.locator('video').click({ position: { x: 10, y: 10 } });
  assert(!(await checkMenu.evaluate(el => el.open)), 'Clicking outside closes the check menu');
  await page.locator('summary', { hasText: 'ต้องตรวจ' }).click();
  await page.getByRole('button', { name: 'แสดงเฉพาะบรรทัดที่ต้องตรวจ' }).click();
  const shown = await page.getByRole('list', { name: 'รายการช่วงบรรยาย' }).getByRole('listitem').count();
  assert(shown === warningCount, 'Warning filter lists only flagged lines');
  await page.locator('#spot-filter').selectOption('all');
  await page.getByRole('listitem', { name: 'ช่วงบรรยายที่ 1' }).click();
  assert(await page.getByRole('button', { name: 'ส่งออก SRT' }).isVisible(), 'SRT export is available');
  await firstLine.fill('ชายเปิดประตูห้อง');
  for (let i = 0; i < 100 && !patched; i++) await page.waitForTimeout(50);
  assert(patched && patched[0].text === 'ชายเปิดประตูห้อง', 'Text edit is saved to the Review Mode job');
  await page.getByText('บันทึกบนเซิร์ฟเวอร์แล้ว').waitFor();
  await page.locator('summary', { hasText: 'ตรวจบท ตอนที่ 1' }).click();
  const rename = page.locator('#job-title');
  await rename.fill('ตรวจบท ตอนที่ 1 (แก้)');
  await page.getByRole('button', { name: 'บันทึกชื่อ' }).click();
  await page.getByText('บันทึกชื่อบนเซิร์ฟเวอร์แล้ว').waitFor();
  assert(renamed === 'ตรวจบท ตอนที่ 1 (แก้)', 'Renaming in the editor saves the Job Title');
  assert(await page.locator('summary', { hasText: 'ตรวจบท ตอนที่ 1 (แก้)' }).count() === 1, 'The header shows the new title');
  return { titled: true, renamed: true, modeChooser: true, reviewJobCreated: true, generateHidden: true, warnings: warningCount, skippedReported: true, savedEdit: true };
}
