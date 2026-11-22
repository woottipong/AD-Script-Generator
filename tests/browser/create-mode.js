async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const videoPath = '/tmp/ad-generate-480p.mp4';
  await page.addInitScript(() => {
    if (window.createModeScanCount !== undefined) return;
    window.createModeScanCount = 0;
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...options) {
      if (message?.type === 'PROCESS_FILE') window.createModeScanCount++;
      return postMessage.call(this, message, ...options);
    };
  });
  const scanCount = () => page.evaluate(() => window.createModeScanCount);

  const initCalls = [];
  const geminiRequests = [];
  let uploadRequests = 0;
  let approveSave;
  const saveGate = new Promise(resolve => { approveSave = resolve; });
  let releaseLink;
  const linkGate = new Promise(resolve => { releaseLink = resolve; });
  await page.route('https://intake-fixture.invalid/held.mp4', async route => {
    await linkGate;
    await route.abort().catch(() => {});
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/upload/init') return route.fulfill({ json: { uploadId: 'job_generate_' + ++uploadRequests } });
    if (path === '/api/upload/chunk') return route.fulfill({ json: { ok: true } });
    if (path === '/api/jobs/init') {
      const payload = request.postDataJSON();
      initCalls.push(payload);
      if (initCalls.length === 1) {
        await saveGate;
        return route.fulfill({ status: 503, json: { error: 'เซิร์ฟเวอร์ขัดข้องชั่วคราว' } });
      }
      const spots = payload.vad_output.candidate_spots.map(spot => ({
        ...spot, original_start_ms: spot.start_ms, original_end_ms: spot.end_ms, decision: 'pending', text: '', is_edited: false,
      }));
      return route.fulfill({ json: { job: { job_id: payload.uploadId, title: payload.title, status: 'VAD_READY', spots, batches: [] }, isRunning: false } });
    }
    if (path.endsWith('/start') || path.endsWith('/analyze-batch')) geminiRequests.push(path);
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('http://127.0.0.1:4173/new');
  await page.setViewportSize({ width: 390, height: 844 });
  const generate = page.getByRole('button', { name: 'สร้างบทบรรยาย', exact: true });
  const review = page.getByRole('button', { name: 'ตรวจแก้ไฟล์ SRT', exact: true });
  const continueGenerate = page.getByRole('button', { name: 'ตรวจเสียงและเตรียมงาน', exact: true });
  const continueReview = page.getByRole('button', { name: 'เริ่มตรวจแก้', exact: true });
  const title = page.getByRole('textbox', { name: 'ชื่องาน' });
  const video = page.locator('input[type=file][aria-label="เลือกวิดีโอ MP4"]');
  await continueGenerate.waitFor();
  const enlarge = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  for (const button of [continueGenerate, page.getByRole('button', { name: 'ยกเลิก', exact: true })]) {
    assert(await button.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      const card = el.closest('.overflow-hidden').getBoundingClientRect();
      return bounds.left >= card.left && bounds.right <= card.right;
    }), 'Intake actions fit with 200% text sizing');
  }
  await enlarge.evaluate(el => el.remove());

  const dropzone = page.getByText('วางไฟล์ MP4 ที่นี่', { exact: true });
  const transfer = await page.evaluateHandle(() => {
    const files = new DataTransfer();
    files.items.add(new File(['test'], 'draft.txt', { type: 'text/plain' }));
    files.items.add(new File(['test'], 'clip.mp4', { type: 'video/mp4' }));
    return files;
  });
  await dropzone.dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByText('เลือกหรือวางได้ครั้งละหนึ่งไฟล์', { exact: true }).waitFor();
  assert(await continueGenerate.isDisabled(), 'Dropping multiple files does not stage an arbitrary file');
  await video.setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
  await page.getByText('กรุณาเลือกไฟล์วิดีโอ MP4', { exact: true }).waitFor();
  assert(await continueGenerate.isDisabled(), 'An unsupported file cannot start processing');
  await video.setInputFiles({ name: 'unreadable.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') });
  await continueGenerate.click();
  const failedVideo = page.getByRole('alert').filter({ hasText: 'วิดีโอไม่ผ่านสเปค' });
  await failedVideo.waitFor();
  assert(await failedVideo.evaluate(el => el === document.activeElement), 'Failed video inspection focuses its error');
  await video.setInputFiles(videoPath);
  assert(!(await failedVideo.isVisible()), 'Replacing the video clears its inspection error');
  await title.fill('งานสร้างฉบับทดสอบ');
  assert(!(await page.getByText('กรุณาเลือกไฟล์วิดีโอ MP4', { exact: true }).isVisible()), 'Replacing an invalid file clears its error');

  await review.press('Enter');
  await continueReview.waitFor();
  assert(await review.evaluate(el => el === document.activeElement), 'A keyboard mode change restores focus to the selected mode');
  const link = page.locator('#review-link');
  await link.fill('https://intake-fixture.invalid/held.mp4');
  await page.locator('input[type=file][aria-label="เลือกไฟล์ SRT"]').setInputFiles({
    name: 'sample.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nบททดสอบ\n'),
  });
  await title.fill('งานตรวจแก้ฉบับทดสอบ');
  await continueReview.click();
  await page.getByText('กำลังตรวจสอบวิดีโอและ SRT', { exact: true }).waitFor();
  assert(await generate.isDisabled(), 'The selected mode is locked while its file check is running');
  await page.getByRole('button', { name: 'ยกเลิกการตรวจไฟล์', exact: true }).click();
  releaseLink();
  await generate.press('Enter');
  await continueGenerate.waitFor();
  assert(await title.inputValue() === 'งานสร้างฉบับทดสอบ' && await continueGenerate.isEnabled(), 'Generate draft survives a round trip');
  await review.press('Enter');
  await continueReview.waitFor();
  assert(await title.inputValue() === 'งานตรวจแก้ฉบับทดสอบ' && await link.inputValue() === 'https://intake-fixture.invalid/held.mp4' && await continueReview.isEnabled(), 'Cancelled validation preserves the Review draft');
  await page.getByRole('button', { name: 'ล้างไฟล์ SRT', exact: true }).press('Enter');
  assert(await page.getByRole('button', { name: 'เลือกไฟล์ SRT', exact: true }).evaluate(el => el === document.activeElement), 'Clearing a file returns focus to its picker');

  await generate.press('Enter');
  await continueGenerate.click();
  await page.getByRole('progressbar', { name: 'กำลังบันทึกงาน', exact: true }).waitFor({ timeout: 60000 });
  assert(initCalls[0]?.autoStart === false && initCalls[0].vad_output.candidate_spots.length > 0, 'Server acknowledgement follows real audio inspection without starting Gemini');
  approveSave();
  await page.getByText('ยังบันทึกงานไม่สำเร็จ', { exact: true }).waitFor();
  assert(await scanCount() === 1, 'A single audio scan ran before the save failed');
  await page.getByRole('button', { name: 'ลองบันทึกอีกครั้ง', exact: true }).click();
  await page.waitForURL('**/jobs/job_generate_2', { timeout: 15000 });
  assert(await scanCount() === 1, 'Retrying the save reuses the single completed audio scan');
  assert(initCalls.length === 2 && JSON.stringify(initCalls[0].vad_output) === JSON.stringify(initCalls[1].vad_output), 'Both save attempts use the same scan results');
  assert(geminiRequests.length === 0, 'Gemini only starts from the separate workspace action');
  return { preservedDrafts: true, incorrectFilesRejected: true, savedOnRetry: true, reusedScan: true };
}
