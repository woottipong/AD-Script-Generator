async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const spot = { spot_id: 'one', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'generate', text: 'บทเดิม', is_edited: false };
  const job = { schema_version: 3, job_id: 'job_old', title: 'old', mode: 'generate', status: 'READY', video_metadata: { fileName: 'old.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true }, vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [] }, batches: [], spots: [spot] };
  let jobs = [
    { job_id: 'job_old', file_name: 'old.mp4', updated_at: '2026-11-20T03:00:00Z', size_bytes: 1234, is_upload: false, is_processing: false, mode: 'generate', status: 'READY' },
    { job_id: 'job_busy', file_name: 'busy.mp4', updated_at: '2026-11-19T03:00:00Z', size_bytes: 5678, is_upload: false, is_processing: true, mode: 'generate', status: 'ANALYZING' },
    { job_id: 'job_review', title: 'บทเรียนที่ 1', file_name: 'lesson.mp4', updated_at: '2026-11-18T03:00:00Z', size_bytes: 0, is_upload: false, is_processing: false, mode: 'review', status: 'READY' },
    { job_id: 'job_upload', file_name: 'อัปโหลดไม่เสร็จ (job_upload)', updated_at: '2026-11-17T03:00:00Z', size_bytes: 99, is_upload: true, is_processing: false },
  ];
  let deleted = [], listFails = false;
  await page.addInitScript(() => {
    let count = 0;
    window.confirm = () => ++count > 1;
  });
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
  const list = page.getByRole('list', { name: 'งานที่บันทึกไว้' });
  await list.waitFor();
  const rows = list.getByRole('listitem');
  assert(await rows.count() === 4, 'Every Job and Unfinished Upload is listed');
  assert((await rows.first().textContent()).includes('old.mp4'), 'Most recently changed Job comes first');
  assert(await list.getByText('ตรวจแก้ SRT').count() === 1, 'Review Mode Job is tagged with its mode');
  assert(await page.getByRole('button', { name: 'ทำต่อ บทเรียนที่ 1' }).count() === 1 && await list.getByText('lesson.mp4').count() === 1, 'A titled Job shows its title with the file name below');
  assert(await list.getByText('กำลังวิเคราะห์').count() === 1, 'An analysing Job shows its status');
  assert(await page.getByRole('button', { name: 'ลบงาน busy.mp4' }).isDisabled(), 'A Job being analysed cannot be deleted');
  assert(await page.getByRole('button', { name: 'ทำต่อ อัปโหลดไม่เสร็จ' }).count() === 0, 'An Unfinished Upload can only be deleted');

  const removeUpload = page.getByRole('button', { name: 'ลบงาน อัปโหลดไม่เสร็จ' });
  await removeUpload.click();
  assert(deleted.length === 0, 'Cancelling the confirm sends no delete');
  await removeUpload.click();
  await removeUpload.waitFor({ state: 'hidden' });
  assert(JSON.stringify(deleted) === '["job_upload"]', 'Confirmed delete removes the Unfinished Upload');

  await page.getByRole('button', { name: 'ทำต่อ old.mp4' }).click();
  const line = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await line.waitFor();
  assert(new URL(page.url()).pathname === '/jobs/job_old', 'Opening a Job moves to its URL');
  await page.reload();
  await line.waitFor();
  assert(await line.inputValue() === 'บทเดิม', 'Reload stays on the same Job');
  await page.goBack();
  await list.waitFor();
  assert(new URL(page.url()).pathname === '/', 'Back returns to the Job List');

  await page.getByRole('button', { name: 'ทำต่อ old.mp4' }).click();
  await line.waitFor();
  await page.locator('summary', { hasText: 'old' }).first().click();
  await page.locator('#job-title').fill('งานเก่าที่เปลี่ยนชื่อ');
  await page.getByRole('button', { name: 'บันทึกชื่อ' }).click();
  await page.getByText('บันทึกชื่อบนเซิร์ฟเวอร์แล้ว').waitFor();
  await page.getByRole('link', { name: 'TCC Envisio รายการงาน' }).click();
  await list.waitFor();
  assert(new URL(page.url()).pathname === '/', 'The logo leads back to the Job List');
  await page.getByRole('button', { name: 'ทำต่อ งานเก่าที่เปลี่ยนชื่อ' }).waitFor();

  await page.getByRole('button', { name: 'งานใหม่' }).click();
  await page.getByRole('heading', { name: 'เริ่มงานบทบรรยายภาพ' }).waitFor();
  assert(new URL(page.url()).pathname === '/new', 'New Job starts at /new');
  await page.getByRole('button', { name: 'รายการงาน' }).click();
  await list.waitFor();

  jobs = [];
  await page.reload();
  await page.getByRole('heading', { name: 'ยังไม่มีงาน' }).waitFor();
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
