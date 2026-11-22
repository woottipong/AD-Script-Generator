async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const spot = { spot_id: 'one', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'pending', text: '', is_edited: false };
  const completed = { ...spot, spot_id: 'two', start_ms: 6000, end_ms: 10000, original_start_ms: 6000, original_end_ms: 10000, decision: 'generate', text: 'บทที่สร้างแล้ว' };
  const batch = { batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 10000, window_start_ms: 0, window_end_ms: 10000, candidate_spots: [spot], status: 'pending', retry_count: 0 };
  const job = { schema_version: 3, job_id: 'job_fixture', title: 'fixture', mode: 'generate', status: 'VAD_READY', video_metadata: { fileName: 'fixture.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true }, vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [spot] }, batches: [batch], spots: [spot, completed] };
  let started = false, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    if (route.request().url().endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    const request = route.request(), url = request.url();
    if (url.endsWith('/api/jobs/job_fixture') && request.method() === 'GET') return route.fulfill({ json: { job, isRunning: false } });
    if (url.endsWith('/start')) { started = true; await held; return route.fulfill({ json: { job, isRunning: true } }); }
    if (request.method() === 'DELETE') throw new Error('Leaving a job must not delete it');
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  await page.goto('http://127.0.0.1:4173/jobs/job_fixture');
  const resume = page.getByRole('button', { name: 'ทำต่อจากชุดที่ค้าง' });
  const manage = page.getByRole('button', { name: 'จัดการงาน', exact: true });
  await resume.waitFor();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 900 });
  const compactStatus = page.getByRole('button', { name: /มีงานที่ยังไม่เสร็จ.*ดูรายละเอียดการทำงาน/ }).getByText('งานค้าง', { exact: true });
  if (!(await compactStatus.isVisible() && await compactStatus.evaluate(el => el.parentElement.scrollWidth <= el.parentElement.clientWidth + 1))) {
    throw new Error('The pending status is readable beside Resume on a narrow screen');
  }
  if (viewport) await page.setViewportSize(viewport);
  if (await page.getByRole('banner').getByRole('button', { name: 'ส่งออก SRT', exact: true }).isVisible()) throw new Error('Resume is the sole primary action');
  await manage.click();
  await page.getByRole('menuitem', { name: 'ส่งออก SRT', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await resume.click();
  for (let i = 0; i < 100 && !started; i++) await page.waitForTimeout(50);
  if (!started) throw new Error('Resume did not start');
  const confirmReset = page.getByRole('alertdialog', { name: 'เริ่มงานใหม่และออกจากงานปัจจุบัน?' });
  await manage.click();
  await page.getByRole('menuitem', { name: 'เริ่มงานใหม่' }).click();
  await page.mouse.click(8, 8);
  await page.waitForTimeout(300);
  if (!await confirmReset.isVisible()) throw new Error('A click outside dismissed the confirmation');
  await confirmReset.getByRole('button', { name: 'ยกเลิก' }).click();
  await confirmReset.waitFor({ state: 'hidden' });
  if (new URL(page.url()).pathname !== '/jobs/job_fixture') throw new Error('Cancelling the reset left the job');
  await page.waitForTimeout(200);
  if (!(await manage.evaluate((el) => el === document.activeElement))) throw new Error('Focus did not return to the menu that asked');
  await manage.click();
  await page.getByRole('menuitem', { name: 'เริ่มงานใหม่' }).click();
  await confirmReset.getByRole('button', { name: 'เริ่มงานใหม่' }).click();
  const chooser = page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' });
  await chooser.waitFor();
  if (new URL(page.url()).pathname !== '/new') throw new Error('Reset did not move to a new job');
  release();
  await page.waitForTimeout(500);
  if (!await chooser.isVisible()) throw new Error('Late resume restored the old job');
  await page.reload();
  await chooser.waitFor();
  if (new URL(page.url()).pathname !== '/new') throw new Error('Old job returned after reload');
  await page.goBack();
  await page.getByRole('button', { name: 'ทำต่อจากชุดที่ค้าง' }).waitFor();
  if (new URL(page.url()).pathname !== '/jobs/job_fixture') throw new Error('Back did not reopen the job');
  return { resetCancellable: true, lateResumeCleared: true, oldJobRestored: false, backReopenedJob: true };
}
