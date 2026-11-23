import { expect, test } from '@playwright/test';

test('failed save retention, leave warning, retry save, and reload persistence', async ({ page }) => {
  let patchCalls = 0;
  const spot = {
    spot_id: 'test_1',
    start_ms: 1000,
    end_ms: 5000,
    duration_ms: 4000,
    original_start_ms: 1000,
    original_end_ms: 5000,
    decision: 'generate',
    text: 'บทเดิม',
  };
  const job = {
    schema_version: 3,
    job_id: 'job_test',
    title: 'fixture',
    mode: 'generate',
    status: 'READY',
    video_metadata: {
      fileName: 'fixture.mp4',
      fileSize: 123,
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

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (new URL(url).pathname === '/api/jobs/job_test') return route.fulfill({ json: { job, isRunning: false } });
    if (url.endsWith('/spots')) {
      patchCalls++;
      if (patchCalls === 1) return route.fulfill({ status: 500, json: { error: 'synthetic failure' } });
      await new Promise((r) => setTimeout(r, 400));
      job.spots = route.request().postDataJSON().spots;
      return route.fulfill({ json: { job } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/jobs/job_test');
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).fill('บทแก้ไข');
  await page.getByText('บันทึกไม่สำเร็จ', { exact: false }).waitFor();
  const retained = await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).inputValue();
  expect(retained, 'Edit lost after failed save').toBe('บทแก้ไข');

  const logo = page.getByRole('link', { name: 'TCC Envisio รายการงาน' });
  await logo.click();
  const leaveDialog = page.getByRole('alertdialog', { name: 'กลับไปรายการงาน?' });
  await leaveDialog.waitFor();
  expect((await leaveDialog.textContent())?.includes('ยังบันทึกไม่สำเร็จ'), 'Leaving with a failed save did not warn').toBe(true);
  await page.keyboard.press('Escape');
  await leaveDialog.waitFor({ state: 'hidden' });
  expect(new URL(page.url()).pathname, 'Declining the warning left the job').toBe('/jobs/job_test');
  expect(await logo.evaluate((el) => el === document.activeElement), 'Focus did not return to the control that asked').toBe(true);

  await page.getByRole('button', { name: 'ลองบันทึกอีกครั้ง' }).click();
  const saving = await page.getByText('กำลังบันทึกการแก้ไข…').count();
  expect(saving, 'Saving status was not shown before acknowledgement').toBe(1);
  await page.getByText('บันทึกบนเซิร์ฟเวอร์แล้ว').waitFor();
  expect(patchCalls, 'Expected a failed save and a retry').toBe(2);

  await page.reload();
  await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).waitFor();
  expect(await page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true }).inputValue(), 'Saved edit did not survive reload').toBe(
    'บทแก้ไข'
  );
});
