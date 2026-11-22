async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  let listAnswer = 'ok';
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', name: 'ผู้เขียน ทดสอบ', allJobs: false } });
    if (url.endsWith('/api/jobs')) {
      if (listAnswer === 'session-ended') return route.fulfill({ status: 401, json: { error: 'กรุณาเข้าสู่ระบบอีกครั้ง', code: 'UNAUTHENTICATED' } });
      if (listAnswer === 'other-401') return route.fulfill({ status: 401, json: { error: 'Gemini permission denied' } });
      return route.fulfill({ json: { jobs: [] } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });
  // The preview server has no sign-in route; answering it lets the test see where the page went.
  await page.route('**/auth/**', route => route.fulfill({ contentType: 'text/html', body: '<p>sign-in</p>' }));

  await page.goto('http://127.0.0.1:4173/');
  const account = page.getByRole('button', { name: 'บัญชี author@example.com' });
  await account.waitFor();
  await account.click();
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).waitFor();
  assert(await page.getByRole('menu').getByText('author@example.com').isVisible(), 'The account menu names the signed-in Author');
  assert(await page.getByRole('menu').getByText('ผู้เขียน ทดสอบ').isVisible(), 'The account menu shows the Author\'s name');
  assert(await page.getByRole('menu').getByText('เห็นเฉพาะงานของตัวเอง').isVisible(), 'The account menu shows the Author\'s access');
  await page.getByRole('menuitem', { name: 'ออกจากระบบ' }).click();
  await page.waitForURL('**/auth/logout');

  listAnswer = 'other-401';
  await page.goto('http://127.0.0.1:4173/');
  await page.getByText('โหลดรายการงานไม่สำเร็จ').waitFor();
  assert(!page.url().includes('/auth/'), 'A 401 that is not about the session stays on the page');

  listAnswer = 'session-ended';
  await page.goto('http://127.0.0.1:4173/?q=1');
  await page.waitForURL('**/auth/login?*');
  const target = new URL(page.url());
  assert(target.searchParams.get('returnTo') === '/?q=1', `A 401 sends the Author to sign in and back to the same page, got ${page.url()}`);
}
