import { expect, test } from '@playwright/test';

test('sign-in, account menu, 401 session redirect, and sign-out guard', async ({ page }) => {
  let listAnswer: 'ok' | 'session-ended' | 'other-401' = 'ok';
  let me: { email: string; name: string; allJobs: boolean; accessGroups?: string[] } = {
    email: 'author@example.com',
    name: 'ผู้เขียน ทดสอบ',
    allJobs: false,
  };
  const spot = {
    spot_id: 'one',
    start_ms: 1000,
    end_ms: 5000,
    duration_ms: 4000,
    original_start_ms: 1000,
    original_end_ms: 5000,
    decision: 'generate',
    text: 'บทเดิม',
    is_edited: false,
  };
  const job = {
    schema_version: 3,
    job_id: 'job_1',
    title: 'งานทดสอบ',
    mode: 'generate',
    status: 'READY',
    video_metadata: {
      fileName: 'test.mp4',
      fileSize: 1,
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
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: me });
    if (url.endsWith('/api/jobs')) {
      if (listAnswer === 'session-ended') {
        return route.fulfill({ status: 401, json: { error: 'กรุณาเข้าสู่ระบบอีกครั้ง', code: 'UNAUTHENTICATED' } });
      }
      if (listAnswer === 'other-401') {
        return route.fulfill({ status: 401, json: { error: 'Gemini permission denied' } });
      }
      return route.fulfill({ json: { jobs: [] } });
    }
    if (url.endsWith('/api/jobs/job_1') && request.method() === 'GET') {
      return route.fulfill({ json: { job, isRunning: false } });
    }
    if (url.endsWith('/api/jobs/job_1/spots') && request.method() === 'PATCH') {
      return route.fulfill({ status: 500, json: { error: 'บันทึกไม่สำเร็จ' } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  // Static dist server has no sign-in route; answering it lets the test observe redirects.
  await page.route('**/auth/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>sign-in</p>' }));

  await page.goto('/');
  const account = page.getByRole('button', { name: 'บัญชี author@example.com' });
  await account.waitFor();
  await account.click();
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).waitFor();
  expect(await page.getByRole('menu').getByText('author@example.com').isVisible(), 'The account menu names the signed-in Author').toBe(true);
  expect(await page.getByRole('menu').getByText('ผู้เขียน ทดสอบ').isVisible(), "The account menu shows the Author's name").toBe(true);
  expect(await page.getByRole('menu').getByText('เห็นเฉพาะงานของตัวเอง').isVisible(), "The account menu shows the Author's access").toBe(true);
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();
  await page.waitForURL('**/auth/logout');

  me = { email: 'admin@example.com', name: 'เอกชัย', allJobs: true, accessGroups: ['admin'] };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const adminAccount = page.getByRole('button', { name: 'บัญชี admin@example.com' });
  await adminAccount.waitFor();
  expect((await adminAccount.innerText()).trim(), 'A Thai name skips its leading vowel for the avatar initial').toBe('อ');
  await adminAccount.click();
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).waitFor();
  expect(await page.getByRole('menu').getByText('เอกชัย').isVisible(), "The account menu shows the All-Jobs Author's name").toBe(true);
  expect(await page.getByRole('menu').getByText('เห็นงานของทุกคน').isVisible(), 'The account menu shows the All-Jobs Access badge').toBe(true);
  expect(await page.getByRole('menu').getByText('กลุ่ม admin').isVisible(), 'The account menu names the granting access groups').toBe(true);
  await page.keyboard.press('Escape');

  listAnswer = 'other-401';
  await page.goto('/');
  await page.getByText('โหลดรายการงานไม่สำเร็จ').waitFor();
  expect(page.url().includes('/auth/'), 'A 401 that is not about the session stays on the page').toBe(false);

  listAnswer = 'session-ended';
  await page.goto('/?q=1');
  await page.waitForURL('**/auth/login?*');
  const target = new URL(page.url());
  expect(target.searchParams.get('returnTo'), `A 401 sends the Author to sign in and back to the same page, got ${page.url()}`).toBe('/?q=1');

  listAnswer = 'ok';
  await page.goto('/jobs/job_1');
  const line = page.getByRole('textbox', { name: 'บทบรรยายที่ 1', exact: true });
  await line.waitFor();
  await line.fill('แก้แต่บันทึกไม่ผ่าน');
  await page.getByText('บันทึกไม่สำเร็จ', { exact: false }).waitFor();
  await adminAccount.click();
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();
  const signOutDialog = page.getByRole('alertdialog', { name: 'ออกจากระบบ?' });
  await signOutDialog.getByText('การแก้ไขล่าสุดยังบันทึกไม่สำเร็จและจะหายไป', { exact: true }).waitFor();
  await signOutDialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await signOutDialog.waitFor({ state: 'hidden' });
  expect(
    new URL(page.url()).pathname === '/jobs/job_1' && (await line.inputValue()) === 'แก้แต่บันทึกไม่ผ่าน',
    'Declining sign-out keeps the editor and unsaved edit'
  ).toBe(true);
  await adminAccount.click();
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();
  await signOutDialog.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await page.waitForURL('**/auth/logout');
});
