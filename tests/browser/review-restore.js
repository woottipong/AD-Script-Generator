async page => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.unrouteAll({ behavior: 'wait' });
  await page.setContent('<input type="file">');
  await page.locator('input').setInputFiles('/tmp/ad-review-1080p.mp4');
  const fixtureSize = await page.locator('input').evaluate((input) => input.files[0].size);

  const spot = { spot_id: 'cue_001', start_ms: 1000, end_ms: 3000, duration_ms: 2000, original_start_ms: 1000, original_end_ms: 3000, decision: 'generate', text: 'บทที่บันทึกไว้', is_edited: true };
  const reviewJob = (video_source) => ({
    job_id: 'job_review_restore', schema_version: 3, title: 'lesson', mode: 'review', status: 'READY', video_source,
    srt_source: { file_name: 'lesson.srt', cue_count: 1, imported_at: '2026-11-21T00:00:00Z' },
    video_metadata: { fileName: 'ad-review-1080p.mp4', fileSize: fixtureSize, mimeType: 'video/mp4', width: 1920, height: 1080, durationMs: 12000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
    vad_output: { duration_ms: 12000, speech_segments: [{ start_ms: 5000, end_ms: 6000 }], candidate_spots: [], waveform: { sampleIntervalMs: 20, peaksBase64: 'AAAA' } },
    batches: [], spots: [spot],
  });
  let current = reviewJob({ kind: 'url', url: 'https://media.invalid/lesson.mp4' });
  let scanStarted = false;
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/api/jobs/job_review_restore')) return route.fulfill({ json: { job: current, isRunning: false } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  page.on('worker', () => { scanStarted = true; });

  await page.goto('http://127.0.0.1:4173/jobs/job_review_restore');
  const line = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await line.waitFor();
  assert(await line.inputValue() === 'บทที่บันทึกไว้', 'Saved Review Mode lines are restored');
  assert(await page.locator('video').getAttribute('src') === 'https://media.invalid/lesson.mp4', 'URL source plays straight from the link');
  assert(await page.getByText('เลือกวิดีโอเดิมอีกครั้ง').count() === 0, 'URL source needs no re-pick');
  assert(await page.getByRole('button', { name: /สร้างบทบรรยายภาพ|ทำต่อจากชุดที่ค้าง/ }).count() === 0, 'Generate controls stay hidden');

  current = reviewJob({ kind: 'local_file', file_name: 'ad-review-1080p.mp4', file_size: fixtureSize });
  await page.reload();
  await line.waitFor();
  assert(await page.getByText('เลือกวิดีโอเดิมอีกครั้งเพื่อเล่นและดูเทียบ').isVisible(), 'Local source asks for the original file');
  assert(await page.getByRole('button', { name: 'เลือกวิดีโอเดิม', exact: true }).isVisible(), 'Re-picking the file is a real button');
  assert(await page.locator('video').count() === 0, 'No video plays before the file is picked');
  assert(await page.getByRole('button', { name: 'ส่งออก SRT' }).isVisible(), 'SRT export works while waiting for the file');
  const repick = page.getByLabel('เลือกวิดีโอเดิมของงานนี้');
  await repick.setInputFiles('/tmp/ad-review.srt');
  await page.getByText(/ไฟล์นี้ไม่ใช่วิดีโอเดิมของงาน/).waitFor();
  assert(await page.locator('video').count() === 0, 'A different file is rejected');
  await repick.setInputFiles('/tmp/ad-review-1080p.mp4');
  await page.locator('video').waitFor();
  assert((await page.locator('video').getAttribute('src')).startsWith('blob:'), 'The original file plays after it is picked');
  assert(await page.getByText('เลือกวิดีโอเดิมอีกครั้งเพื่อเล่นและดูเทียบ').count() === 0, 'Re-pick prompt goes away');
  assert(!scanStarted, 'Restoring never re-scans the audio');
  return { urlRestored: true, localRepickRequired: true, wrongFileRejected: true, rescanned: scanStarted };
}
