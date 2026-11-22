async page => {
  const baseUrl = new URL(page.url()).origin;
  await page.unrouteAll({ behavior: 'wait' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  let allJobs = true;
  let meEmail = 'a@example.com';
  const longTitle = 'ละครโทรทัศน์ชุดการเดินทางของชุมชนริมแม่น้ำ ฉบับตรวจแก้บทบรรยายภาพ ตอน 08';
  const jobs = [
    { job_id: 'job_a', title: 'งานของเอ', file_name: 'a.mp4', updated_at: '2026-11-20T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 60000, spot_count: 3, owner_email: 'a@example.com' },
    { job_id: 'job_b', title: 'งานของบี', file_name: 'b.mp4', updated_at: '2026-11-19T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'review', status: 'READY', duration_ms: 60000, spot_count: 2, owner_email: 'b@example.com' },
    { job_id: 'job_legacy', title: 'งานเก่า', file_name: 'old.mp4', updated_at: '2026-11-18T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 60000, spot_count: 1, owner_email: null },
    { job_id: 'job_long', title: longTitle, file_name: 'river_ep08.mp4', updated_at: '2026-11-17T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 60000, spot_count: 1, owner_email: 'c@example.com' },
  ];
  let currentJobs = jobs;
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: meEmail, allJobs } });
    if (url.endsWith('/api/jobs')) return route.fulfill({ json: { jobs: allJobs ? currentJobs : currentJobs.slice(0, 1) } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto(`${baseUrl}/`);
  const table = page.getByRole('table', { name: 'งานที่บันทึกไว้' });
  const longLink = table.getByRole('link', { name: longTitle, exact: true });
  await longLink.waitFor();
  for (const [width, height, expectOwnerColumn] of [[920, 800, false], [1100, 800, false], [1120, 800, false], [1280, 900, true]]) {
    await page.setViewportSize({ width, height });
    assert(await longLink.evaluate(el => el.getBoundingClientRect().width >= 120 && el.scrollWidth <= el.clientWidth + 1), `Title remains readable without overflow at ${width}x${height}`);
    assert(await table.getByRole('columnheader', { name: 'เจ้าของ' }).isVisible() === expectOwnerColumn, `Owner column visibility matches width budget at ${width}x${height}`);
    assert(await table.getByRole('row', { name: /งานของบี/ }).getByText('b@example.com').filter({ visible: true }).count() === 1, `Each row names its Job Owner at ${width}x${height}`);
    assert(await table.getByRole('row', { name: /งานเก่า/ }).getByText('ไม่มีเจ้าของ').filter({ visible: true }).count() === 1, `A Job with no Job Owner says so at ${width}x${height}`);
  }

  const search = page.getByRole('searchbox');
  await search.fill('b@example');
  await page.getByText('พบ 1 รายการ').waitFor();
  assert(await table.getByRole('link', { name: 'งานของบี', exact: true }).isVisible(), 'Search finds Jobs by owner email');
  assert(!(await table.getByRole('link', { name: 'งานของเอ', exact: true }).isVisible()), 'Search hides other owners');
  await search.fill('');

  const scope = page.getByRole('group', { name: 'กรองตามเจ้าของ' });
  const mine = scope.getByRole('button', { name: /งานของฉัน/ });
  assert((await mine.textContent()).includes('1'), 'The my-Jobs filter counts the signed-in Author\'s Jobs');
  await mine.click();
  await page.getByText('พบ 1 รายการ').waitFor();
  assert(await table.getByRole('link', { name: 'งานของเอ', exact: true }).isVisible(), 'งานของฉัน keeps the Author\'s own Job');
  assert(!(await table.getByRole('link', { name: 'งานของบี', exact: true }).isVisible()), 'งานของฉัน hides other owners');
  assert(await table.getByRole('columnheader', { name: 'เจ้าของ' }).count() === 0, 'The owner column hides when every row is the Author\'s own');
  await scope.getByRole('button', { name: /ทุกคน/ }).click();
  await table.getByRole('link', { name: 'งานของบี', exact: true }).waitFor();

  allJobs = false;
  await page.goto(`${baseUrl}/`);
  await table.getByRole('link', { name: 'งานของเอ', exact: true }).waitFor();
  assert(await table.getByRole('columnheader', { name: 'เจ้าของ' }).count() === 0, 'An Author without All-Jobs Access sees no owner column');
  assert(await page.getByRole('group', { name: 'กรองตามเจ้าของ' }).count() === 0, 'Without All-Jobs Access every Job is the Author\'s own, so there is no owner filter');
  await page.getByRole('searchbox').fill('a@example');
  await page.getByText('ไม่พบงานที่ตรงกับการค้นหา').waitFor();

  allJobs = true;
  meEmail = 'old@example.com';
  currentJobs = [
    { job_id: 'job_renamed_owner', title: 'งานเปลี่ยนอีเมล', file_name: 'renamed.mp4', updated_at: '2026-11-20T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'generate', status: 'READY', duration_ms: 60000, spot_count: 1, owner_email: 'new@example.com', is_owner: true },
    { job_id: 'job_same_email_not_owner', title: 'งานคนอื่นอีเมลซ้ำ', file_name: 'other.mp4', updated_at: '2026-11-19T03:00:00Z', size_bytes: 1, is_upload: false, is_processing: false, mode: 'review', status: 'READY', duration_ms: 60000, spot_count: 1, owner_email: 'old@example.com', is_owner: false },
  ];
  await page.goto(`${baseUrl}/`);
  await table.getByRole('link', { name: 'งานเปลี่ยนอีเมล', exact: true }).waitFor();
  assert((await mine.textContent()).includes('1'), 'is_owner counts owned Jobs even when session email differs from owner_email');
  await mine.click();
  await page.getByText('พบ 1 รายการ').waitFor();
  assert(await table.getByRole('link', { name: 'งานเปลี่ยนอีเมล', exact: true }).isVisible(), 'งานของฉัน keeps a Job with is_owner: true when owner_email changed');
  assert(!(await table.getByRole('link', { name: 'งานคนอื่นอีเมลซ้ำ', exact: true }).isVisible()), 'งานของฉัน excludes a Job with is_owner: false');
}
