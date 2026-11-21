async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const spot = { spot_id: 'one', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'generate', text: 'บทเดิม', is_edited: false };
  const job = { schema_version: 3, job_id: 'job_old', title: 'old', mode: 'generate', status: 'READY', video_metadata: { fileName: 'old.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true }, vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [] }, batches: [], spots: [spot] };
  let jobs = [
    { job_id: 'job_old', file_name: 'old.mp4', updated_at: '2026-11-20T03:00:00Z', size_bytes: 1234, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 754000, spot_count: 14 },
    { job_id: 'job_busy', file_name: 'busy.mp4', updated_at: '2026-11-19T03:00:00Z', size_bytes: 5678, is_upload: false, is_processing: true, mode: 'generate', status: 'ANALYZING', duration_ms: 360000, spot_count: 0, progress_percent: 60 },
    { job_id: 'job_review', title: 'บทเรียนที่ 1', file_name: 'lesson.mp4', updated_at: '2026-11-18T03:00:00Z', size_bytes: 0, is_upload: false, is_processing: false, mode: 'review', status: 'READY', duration_ms: 185000, spot_count: 8 },
    { job_id: 'job_upload', file_name: 'อัปโหลดไม่เสร็จ (job_upload)', updated_at: '2026-11-17T03:00:00Z', size_bytes: 99, is_upload: true, is_processing: false },
  ];
  let deleted = [], listFails = false;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = request.url();
    if (url.endsWith('/api/jobs')) return listFails ? route.fulfill({ status: 500, json: { error: 'fixture' } }) : route.fulfill({ json: { jobs } });
    if (url.endsWith('/api/jobs/job_old') && request.method() === 'GET') return route.fulfill({ json: { job, isRunning: false } });
    if (url.endsWith('/api/jobs/job_old') && request.method() === 'PATCH') {
      job.title = request.postDataJSON().title;
      jobs = jobs.map((item) => item.job_id === 'job_old' ? { ...item, title: job.title } : item);
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

  await page.goto('http://127.0.0.1:4173/');
  const list = page.getByRole('table', { name: 'งานที่บันทึกไว้' });
  const listed = () => page.getByRole('button', { name: /^เปิดงาน (old\.mp4|งานเก่าที่เปลี่ยนชื่อ)$/ }).first().waitFor();
  await listed();
  const rows = list.locator('tbody tr');
  assert(await rows.count() === 4, 'Every Job and Unfinished Upload is listed');
  const heightOf = async (locator) => Math.round((await locator.boundingBox()).height);
  assert(await heightOf(page.getByRole('button', { name: 'งานใหม่' })) === 40, 'The page action is a 40px button (DESIGN › Buttons)');
  assert(await heightOf(page.getByRole('button', { name: 'เปิดงาน old.mp4' })) === 36, 'Row actions are 36px buttons');
  assert(await heightOf(page.getByRole('button', { name: 'ลบงาน old.mp4' })) === 36, 'Delete action is an exposed 36px button');
  assert((await rows.first().textContent()).includes('old.mp4'), 'Most recently changed Job comes first');
  assert(await list.getByText('ตรวจแก้ SRT').filter({ visible: true }).count() === 1, 'Review Mode Job is tagged with its mode');
  assert(await page.getByRole('button', { name: 'เปิดงาน บทเรียนที่ 1' }).count() === 1 && await list.getByText('lesson.mp4').count() === 1, 'A titled Job shows its title with the file name below');
  assert(await list.getByText('กำลังวิเคราะห์ 60%').filter({ visible: true }).count() === 1, 'An analysing Job shows its status and progress');
  assert(await list.getByText('12:34').filter({ visible: true }).count() === 1, 'A saved Job shows its video duration');
  assert(await list.getByText('14 จุด').filter({ visible: true }).count() === 1, 'A saved Job shows its AD spot count');
  assert(await page.getByRole('button', { name: 'ลบงาน busy.mp4' }).isDisabled(), 'A Job being analysed cannot be deleted');
  assert(await page.getByRole('button', { name: 'เปิดงาน อัปโหลดไม่สมบูรณ์' }).count() === 0, 'An Unfinished Upload can only be deleted');

  const uploadDelete = page.getByRole('button', { name: 'ลบงาน อัปโหลดไม่สมบูรณ์' });
  const confirmDialog = page.getByRole('alertdialog', { name: 'ยืนยันการลบงาน' });
  await uploadDelete.click();
  await confirmDialog.waitFor();
  await confirmDialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await confirmDialog.waitFor({ state: 'hidden' });
  assert(deleted.length === 0, 'Cancelling the confirm sends no delete');
  await uploadDelete.click();
  await confirmDialog.getByRole('button', { name: 'ลบงาน' }).click();
  await uploadDelete.waitFor({ state: 'hidden' });
  assert(JSON.stringify(deleted) === '["job_upload"]', 'Confirmed delete removes the Unfinished Upload');

  await page.getByRole('button', { name: 'เปิดงาน old.mp4' }).click();
  const line = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await line.waitFor();
  assert(new URL(page.url()).pathname === '/jobs/job_old', 'Opening a Job moves to its URL');
  await page.reload();
  await line.waitFor();
  assert(await line.inputValue() === 'บทเดิม', 'Reload stays on the same Job');
  await line.fill('แก้แต่บันทึกไม่ผ่าน');
  await page.getByText('บันทึกไม่สำเร็จ', { exact: false }).waitFor();
  const leaveDialog = page.getByRole('alertdialog', { name: 'ออกจากหน้านี้?' });
  await page.goBack();
  await leaveDialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await leaveDialog.waitFor({ state: 'hidden' });
  assert(new URL(page.url()).pathname === '/jobs/job_old' && await line.inputValue() === 'แก้แต่บันทึกไม่ผ่าน', 'Declining Back keeps the Job and its URL');
  await page.goBack();
  await leaveDialog.getByRole('button', { name: 'ออกจากหน้านี้' }).click();
  await listed();
  assert(new URL(page.url()).pathname === '/', 'Back returns to the Job List');

  await page.getByRole('button', { name: 'เปิดงาน old.mp4' }).click();
  await line.waitFor();
  const details = page.getByRole('button', { name: 'รายละเอียดงาน: old' });
  await details.click();
  await page.locator('#job-title').fill('งานเก่าที่เปลี่ยนชื่อ');
  await page.getByRole('button', { name: 'บันทึกชื่อ' }).click();
  await page.getByText('บันทึกชื่อบนเซิร์ฟเวอร์แล้ว').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#job-title').waitFor({ state: 'hidden' });
  const renamedDetails = page.getByRole('button', { name: 'รายละเอียดงาน: งานเก่าที่เปลี่ยนชื่อ' });
  assert(await renamedDetails.evaluate((el) => el === document.activeElement), 'Escape closes the Job details and returns focus to its button');
  const statusPill = page.getByRole('button', { name: /ดูรายละเอียดการทำงาน$/ });
  await statusPill.click();
  await page.getByRole('heading', { name: 'รายละเอียดการทำงาน' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'รายละเอียดการทำงาน' }).waitFor({ state: 'hidden' });
  await page.getByRole('link', { name: 'TCC Envisio รายการงาน' }).click();
  await listed();
  assert(new URL(page.url()).pathname === '/', 'The logo leads back to the Job List');
  await page.getByRole('button', { name: 'เปิดงาน งานเก่าที่เปลี่ยนชื่อ' }).waitFor();

  await page.getByRole('button', { name: 'งานใหม่' }).click();
  await page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' }).waitFor();
  assert(new URL(page.url()).pathname === '/new', 'New Job starts at /new');
  await page.getByRole('button', { name: 'ยกเลิก' }).click();
  await listed();

  jobs = [];
  await page.reload();
  await page.getByText('ยังไม่มีงาน', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'งานใหม่' }).click();
  await page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' }).waitFor();

  await page.goto('http://127.0.0.1:4173/jobs/job_missing');
  await page.getByRole('heading', { name: 'ไม่พบงานนี้' }).waitFor();
  await page.goto('http://127.0.0.1:4173/jobs/job_broken');
  await page.getByRole('heading', { name: 'เปิดงานไม่สำเร็จ' }).waitFor();
  listFails = true;
  await page.goto('http://127.0.0.1:4173/');
  await page.getByText('โหลดรายการงานไม่สำเร็จ').waitFor();
  assert(await page.getByRole('button', { name: 'งานใหม่' }).isVisible(), 'A new Job can start when the list fails to load');
  return { renamedShowsInList: true, listFailureStillOffersNewJob: true, listed: true, processingProtected: true, uploadDeleteOnly: true, reopened: true, reloadKept: true, backToList: true, newJob: true, emptyState: true, missingJobReported: true, loadFailureReported: true };
}
