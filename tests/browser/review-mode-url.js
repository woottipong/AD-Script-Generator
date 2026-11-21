async page => {
  const videoUrl = 'https://drive.rtt.in.th/archive/%E0%B8%AA%E0%B8%AA%E0%B8%A7%E0%B8%97.%202567/%E0%B8%84%E0%B8%93%E0%B8%B4%E0%B8%95%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B8%9E%E0%B8%B7%E0%B9%89%E0%B8%99%E0%B8%90%E0%B8%B2%E0%B8%99/%E0%B8%84%E0%B8%93%E0%B8%B4%E0%B8%95%E0%B8%A8%E0%B8%B2%E0%B8%AA%E0%B8%95%E0%B8%A3%E0%B9%8C%E0%B8%9E%E0%B8%B7%E0%B9%89%E0%B8%99%E0%B8%90%E0%B8%B2%E0%B8%99%20%E0%B8%A1.5/%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201/3.%E0%B9%80%E0%B8%A5%E0%B8%82%E0%B8%A2%E0%B8%81%E0%B8%81%E0%B8%B3%E0%B8%A5%E0%B8%B1%E0%B8%87%20%E0%B8%95%E0%B8%AD%E0%B8%99%203%20%E0%B8%A1.5%20%E0%B8%9A%E0%B8%97%E0%B8%97%E0%B8%B5%E0%B9%88%201.mp4';
  await page.unrouteAll({ behavior: 'wait' });
  let created = null;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = request.url();
    if (url.endsWith('/api/jobs/current')) return route.fulfill({ json: { job: null, isRunning: false } });
    if (url.endsWith('/api/jobs/review') && request.method() === 'POST') {
      created = request.postDataJSON();
      return route.fulfill({ json: { job: { ...created, job_id: 'job_review_url', schema_version: 2, mode: 'review', status: 'READY', batches: [] }, isRunning: false } });
    }
    if (url.endsWith('/api/jobs/job_review_url/spots')) return route.fulfill({ json: { job: { job_id: 'job_review_url' } } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: /แก้ไข SRT ที่มีอยู่/ }).click();
  const link = page.getByPlaceholder('https://…/video.mp4');
  const process = page.getByRole('button', { name: 'ประมวลผล' });
  await page.getByLabel('เลือกไฟล์ SRT').setInputFiles('/tmp/ad-review.srt');
  await link.fill('https://example.com/video.mov');
  assert(await process.isDisabled(), 'A non-.mp4 link cannot be processed');
  await link.fill(videoUrl);
  assert(await process.isEnabled(), 'An .mp4 link with an SRT can be processed');
  const started = Date.now();
  await process.click();
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).waitFor({ timeout: 600000 });
  for (let i = 0; i < 200 && !created; i++) await page.waitForTimeout(50);
  assert(created, 'Review Mode job was created');
  assert(created.video_source.kind === 'url' && created.video_source.url === videoUrl, 'Job records the URL source');
  assert(created.video_metadata.height === 1080, '1080p video is accepted');
  assert(Math.abs(created.vad_output.duration_ms - 1483000) < 2000, 'Scan covered the whole video');
  assert(created.vad_output.speech_segments.length > 0, 'Speech was detected in the lecture audio');
  const seek = await page.evaluate(async () => {
    const video = document.querySelector('video');
    const t0 = performance.now();
    video.currentTime = 600;
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    return { src: video.currentSrc, landed: Math.round(video.currentTime), ms: Math.round(performance.now() - t0) };
  });
  assert(seek.src === videoUrl && seek.landed === 600, 'Video plays and seeks from the URL');
  return { urlJob: true, height: created.video_metadata.height, speechSegments: created.vad_output.speech_segments.length, scanSeconds: Math.round((Date.now() - started) / 1000), seekMs: seek.ms };
}
