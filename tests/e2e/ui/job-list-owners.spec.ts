import { expect, test } from '@playwright/test';

test('all-jobs owner column visibility, owner search, and ownership filters', async ({ page }) => {
  let allJobs = true;
  let meEmail = 'a@example.com';
  const longTitle = 'ละครโทรทัศน์ชุดการเดินทางของชุมชนริมแม่น้ำ ฉบับตรวจแก้บทบรรยายภาพ ตอน 08';
  const jobs = [
    {
      job_id: 'job_a',
      title: 'งานของเอ',
      file_name: 'a.mp4',
      updated_at: '2026-11-20T03:00:00Z',
      size_bytes: 1,
      is_upload: false,
      is_processing: false,
      mode: 'generate',
      status: 'READY',
      duration_ms: 60000,
      spot_count: 3,
      owner_email: 'a@example.com',
    },
    {
      job_id: 'job_b',
      title: 'งานของบี',
      file_name: 'b.mp4',
      updated_at: '2026-11-19T03:00:00Z',
      size_bytes: 1,
      is_upload: false,
      is_processing: false,
      mode: 'review',
      status: 'READY',
      duration_ms: 60000,
      spot_count: 2,
      owner_email: 'b@example.com',
    },
    {
      job_id: 'job_legacy',
      title: 'งานเก่า',
      file_name: 'old.mp4',
      updated_at: '2026-11-18T03:00:00Z',
      size_bytes: 1,
      is_upload: false,
      is_processing: false,
      mode: 'generate',
      status: 'READY',
      duration_ms: 60000,
      spot_count: 1,
      owner_email: null,
    },
    {
      job_id: 'job_long',
      title: longTitle,
      file_name: 'river_ep08.mp4',
      updated_at: '2026-11-17T03:00:00Z',
      size_bytes: 1,
      is_upload: false,
      is_processing: false,
      mode: 'generate',
      status: 'READY',
      duration_ms: 60000,
      spot_count: 1,
      owner_email: 'c@example.com',
    },
  ];
  let currentJobs: Array<Record<string, unknown>> = jobs;

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: meEmail, allJobs } });
    if (url.endsWith('/api/jobs')) return route.fulfill({ json: { jobs: allJobs ? currentJobs : currentJobs.slice(0, 1) } });
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/');
  const table = page.getByRole('table', { name: 'งานที่บันทึกไว้' });
  const longLink = table.getByRole('link', { name: longTitle, exact: true });
  await longLink.waitFor();

  for (const [width, height, expectOwnerColumn] of [
    [920, 800, false],
    [1100, 800, false],
    [1120, 800, false],
    [1280, 900, true],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(
      await longLink.evaluate((el) => el.getBoundingClientRect().width >= 120 && el.scrollWidth <= el.clientWidth + 1),
      `Title remains readable without overflow at ${width}x${height}`
    ).toBe(true);
    expect(
      await table.getByRole('columnheader', { name: 'เจ้าของ' }).isVisible(),
      `Owner column visibility matches width budget at ${width}x${height}`
    ).toBe(expectOwnerColumn);
    expect(
      await table.getByRole('row', { name: /งานของบี/ }).getByText('b@example.com').filter({ visible: true }).count(),
      `Each row names its Job Owner at ${width}x${height}`
    ).toBe(1);
    expect(
      await table.getByRole('row', { name: /งานเก่า/ }).getByText('ไม่มีเจ้าของ').filter({ visible: true }).count(),
      `A Job with no Job Owner says so at ${width}x${height}`
    ).toBe(1);
  }

  const search = page.getByRole('searchbox');
  await search.fill('b@example');
  await page.getByText('พบ 1 รายการ').waitFor();
  expect(await table.getByRole('link', { name: 'งานของบี', exact: true }).isVisible(), 'Search finds Jobs by owner email').toBe(true);
  expect(await table.getByRole('link', { name: 'งานของเอ', exact: true }).isVisible(), 'Search hides other owners').toBe(false);
  await search.fill('');

  const scope = page.getByRole('group', { name: 'กรองตามเจ้าของ' });
  const mine = scope.getByRole('button', { name: /งานของฉัน/ });
  expect((await mine.textContent())?.includes('1'), "The my-Jobs filter counts the signed-in Author's Jobs").toBe(true);
  await mine.click();
  await page.getByText('พบ 1 รายการ').waitFor();
  expect(await table.getByRole('link', { name: 'งานของเอ', exact: true }).isVisible(), "งานของฉัน keeps the Author's own Job").toBe(true);
  expect(await table.getByRole('link', { name: 'งานของบี', exact: true }).isVisible(), 'งานของฉัน hides other owners').toBe(false);
  expect(
    await table.getByRole('columnheader', { name: 'เจ้าของ' }).count(),
    "The owner column hides when every row is the Author's own"
  ).toBe(0);
  await scope.getByRole('button', { name: /ทุกคน/ }).click();
  await table.getByRole('link', { name: 'งานของบี', exact: true }).waitFor();

  allJobs = false;
  await page.goto('/');
  await table.getByRole('link', { name: 'งานของเอ', exact: true }).waitFor();
  expect(await table.getByRole('columnheader', { name: 'เจ้าของ' }).count(), 'An Author without All-Jobs Access sees no owner column').toBe(0);
  expect(
    await page.getByRole('group', { name: 'กรองตามเจ้าของ' }).count(),
    "Without All-Jobs Access every Job is the Author's own, so there is no owner filter"
  ).toBe(0);
  await page.getByRole('searchbox').fill('a@example');
  await page.getByText('ไม่พบงานที่ตรงกับการค้นหา').waitFor();

  allJobs = true;
  meEmail = 'old@example.com';
  currentJobs = [
    {
      job_id: 'job_renamed_owner',
      title: 'งานเปลี่ยนอีเมล',
      file_name: 'renamed.mp4',
      updated_at: '2026-11-20T03:00:00Z',
      size_bytes: 1,
      is_upload: false,
      is_processing: false,
      mode: 'generate',
      status: 'READY',
      duration_ms: 60000,
      spot_count: 1,
      owner_email: 'new@example.com',
      is_owner: true,
    },
    {
      job_id: 'job_same_email_not_owner',
      title: 'งานคนอื่นอีเมลซ้ำ',
      file_name: 'other.mp4',
      updated_at: '2026-11-19T03:00:00Z',
      size_bytes: 1,
      is_upload: false,
      is_processing: false,
      mode: 'review',
      status: 'READY',
      duration_ms: 60000,
      spot_count: 1,
      owner_email: 'old@example.com',
      is_owner: false,
    },
  ];
  await page.goto('/');
  await table.getByRole('link', { name: 'งานเปลี่ยนอีเมล', exact: true }).waitFor();
  expect((await mine.textContent())?.includes('1'), 'is_owner counts owned Jobs even when session email differs from owner_email').toBe(true);
  await mine.click();
  await page.getByText('พบ 1 รายการ').waitFor();
  expect(
    await table.getByRole('link', { name: 'งานเปลี่ยนอีเมล', exact: true }).isVisible(),
    'งานของฉัน keeps a Job with is_owner: true when owner_email changed'
  ).toBe(true);
  expect(
    await table.getByRole('link', { name: 'งานคนอื่นอีเมลซ้ำ', exact: true }).isVisible(),
    'งานของฉัน excludes a Job with is_owner: false'
  ).toBe(false);
});
