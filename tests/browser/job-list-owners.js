async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  let allJobs = true;
  const jobs = [
    { job_id: 'job_a', title: 'งานของเอ', file_name: 'a.mp4', updated_at: '2026-11-20T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 60000, spot_count: 3, owner_email: 'a@example.com' },
    { job_id: 'job_b', title: 'งานของบี', file_name: 'b.mp4', updated_at: '2026-11-19T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'review', status: 'READY', duration_ms: 60000, spot_count: 2, owner_email: 'b@example.com' },
    { job_id: 'job_legacy', title: 'งานเก่า', file_name: 'old.mp4', updated_at: '2026-11-18T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 60000, spot_count: 1, owner_email: null },
  ];
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'lead@example.com', allJobs } });
    if (url.endsWith('/api/jobs')) return route.fulfill({ json: { jobs: allJobs ? jobs : jobs.slice(0, 1) } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('http://127.0.0.1:4173/');
  const table = page.getByRole('table', { name: 'งานที่บันทึกไว้' });
  await table.getByRole('link', { name: 'งานของเอ', exact: true }).waitFor();
  assert(await table.getByRole('columnheader', { name: 'เจ้าของ' }).isVisible(), 'All-Jobs Access shows the owner column');
  assert(await table.getByRole('row', { name: /งานของบี/ }).getByText('b@example.com').filter({ visible: true }).count() === 1, 'Each row names its Job Owner');
  assert(await table.getByRole('row', { name: /งานเก่า/ }).getByText('ไม่มีเจ้าของ').filter({ visible: true }).count() === 1, 'A Job with no Job Owner says so');

  const search = page.getByRole('searchbox');
  await search.fill('b@example');
  await page.getByText('พบ 1 รายการ').waitFor();
  assert(await table.getByRole('link', { name: 'งานของบี', exact: true }).isVisible(), 'Search finds Jobs by owner email');
  assert(!(await table.getByRole('link', { name: 'งานของเอ', exact: true }).isVisible()), 'Search hides other owners');

  allJobs = false;
  await page.goto('http://127.0.0.1:4173/');
  await table.getByRole('link', { name: 'งานของเอ', exact: true }).waitFor();
  assert(await table.getByRole('columnheader', { name: 'เจ้าของ' }).count() === 0, 'An Author without All-Jobs Access sees no owner column');
  await page.getByRole('searchbox').fill('a@example');
  await page.getByText('ไม่พบงานที่ตรงกับการค้นหา').waitFor();
}
