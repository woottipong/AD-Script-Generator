async page => {
  await page.unrouteAll({ behavior: 'wait' });
  await page.addInitScript(() => { window.confirm = () => true; });
  const spot = { spot_id: 'one', start_ms: 1000, end_ms: 5000, duration_ms: 4000, original_start_ms: 1000, original_end_ms: 5000, decision: 'pending', text: '', is_edited: false };
  const batch = { batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 10000, window_start_ms: 0, window_end_ms: 10000, candidate_spots: [spot], status: 'pending', retry_count: 0 };
  const job = { job_id: 'job_fixture', status: 'VAD_READY', video_metadata: { fileName: 'fixture.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 10000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true }, vad_output: { duration_ms: 10000, speech_segments: [], candidate_spots: [spot] }, batches: [batch], spots: [spot] };
  let active = true, started = false, deletes = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = request.url();
    if (url.endsWith('/api/jobs/current')) return route.fulfill({ json: { job: active ? job : null, isRunning: false } });
    if (url.endsWith('/start')) { started = true; await held; active = true; return route.fulfill({ json: { job, isRunning: true } }); }
    if (url.endsWith('/api/jobs/job_fixture') && request.method() === 'DELETE') { active = false; deletes++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'ทำต่อจากชุดที่ค้าง' }).click();
  for (let i = 0; i < 100 && !started; i++) await page.waitForTimeout(50);
  if (!started) throw new Error('Resume did not start');
  await page.getByText('จัดการ', { exact: true }).click();
  await page.getByRole('button', { name: 'เริ่มงานใหม่' }).click();
  for (let i = 0; i < 100 && deletes < 1; i++) await page.waitForTimeout(50);
  if (deletes !== 1) throw new Error('Reset did not clear the active job');
  release();
  for (let i = 0; i < 100 && deletes < 2; i++) await page.waitForTimeout(50);
  if (deletes !== 2 || active) throw new Error('Late resume restored the old job');
  await page.reload();
  if (!await page.getByRole('heading', { name: 'สร้างบทบรรยายภาพ' }).isVisible()) throw new Error('Old job returned after reload');
  return { lateResumeCleared: true, oldJobRestored: false };
}
