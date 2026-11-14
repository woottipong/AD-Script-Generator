async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const jobs = [
    { job_id: 'job_old', file_name: 'old.mp4', updated_at: '2026-01-01T00:00:00Z', size_bytes: 1234, is_active: false, is_processing: false },
    { job_id: 'job_active', file_name: 'active.mp4', updated_at: '2026-01-01T00:00:00Z', size_bytes: 5678, is_active: true, is_processing: false },
  ];
  let deleted = 0;
  await page.addInitScript(() => {
    let count = 0;
    window.confirm = () => ++count > 1;
  });
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/api/jobs/current')) return route.fulfill({ json: { job: null, isRunning: false } });
    if (url.endsWith('/api/jobs')) return route.fulfill({ json: { jobs } });
    if (url.endsWith('/api/jobs/job_old/files') && route.request().method() === 'DELETE') {
      deleted++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  await page.goto('http://127.0.0.1:4173/');
  await page.getByText('จัดการพื้นที่จัดเก็บ', { exact: true }).click();
  const old = page.getByRole('button', { name: 'ลบงาน old.mp4' });
  await old.waitFor();
  if (await page.getByRole('button', { name: 'ลบงาน active.mp4' }).isEnabled()) throw new Error('Active job is deletable');
  await old.click();
  if (deleted !== 0) throw new Error('Cancellation sent a delete request');
  await old.click();
  await old.waitFor({ state: 'hidden' });
  if (deleted !== 1) throw new Error('Confirmed delete was not sent');
  return { activeProtected: true, cancelProtected: true, confirmedDeletion: true };
}
