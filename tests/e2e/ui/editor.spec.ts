import { expect, test } from '@playwright/test';

test('spot list filtering, searching, editing, transport toggles, and tooltips', async ({ page }) => {
  const spot = (id: string, start: number, decision: string, text: string, reason: string) => ({
    spot_id: id,
    start_ms: start,
    end_ms: start + 4000,
    duration_ms: 4000,
    original_start_ms: start,
    original_end_ms: start + 4000,
    decision,
    text,
    reason,
    is_edited: false,
  });
  const spots = [
    spot('one', 1000, 'generate', 'ช้างเดิน', ''),
    spot('two', 5000, 'skip', '', 'เหตุผลนก'),
    spot('three', 9000, 'generate', 'ปลาแหวกว่าย', ''),
    spot('four', 13000, 'pending', '', ''),
  ];
  const job = {
    schema_version: 3,
    job_id: 'fixture',
    title: 'fixture',
    mode: 'generate',
    status: 'READY',
    video_metadata: {
      fileName: 'fixture.mp4',
      fileSize: 1,
      mimeType: 'video/mp4',
      width: 854,
      height: 480,
      durationMs: 18000,
      videoCodec: 'avc1',
      audioCodec: 'mp4a.40.2',
      hasAudioTrack: true,
    },
    vad_output: { duration_ms: 18000, speech_segments: [], candidate_spots: [] },
    batches: [],
    spots,
  };

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/api/me')) return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
    if (new URL(url).pathname === '/api/jobs/fixture') return route.fulfill({ json: { job, isRunning: false } });
    if (url.endsWith('/spots')) {
      job.spots = route.request().postDataJSON().spots;
      return route.fulfill({ json: { job } });
    }
    return route.fulfill({ status: 404, json: { error: 'fixture' } });
  });

  await page.goto('/jobs/fixture');
  const list = page.getByRole('list', { name: 'รายการช่วงบรรยาย' });
  await list.waitFor();
  const listNames = async () => list.getByRole('listitem').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label')));

  expect(await page.getByRole('button', { name: 'ส่งออก JSON' }).count(), 'JSON export should not be available').toBe(0);
  expect(await page.getByRole('button', { name: 'ส่งออก SRT' }).isEnabled(), 'SRT export should be available').toBe(true);
  expect(await listNames(), 'Initial global order incorrect').toEqual([
    'ช่วงบรรยายที่ 1',
    'ช่วงบรรยายที่ 2',
    'ช่วงบรรยายที่ 3',
    'ช่วงบรรยายที่ 4',
  ]);

  const filter = page.getByRole('combobox', { name: 'แสดง' });
  const pickFilter = async (name: RegExp) => {
    await filter.click();
    await page.getByRole('option', { name }).click();
  };
  await pickFilter(/^ข้ามการบรรยาย/);
  expect(await listNames(), 'Skip global order incorrect').toEqual(['ช่วงบรรยายที่ 2']);

  const search = page.getByRole('searchbox', { name: 'ค้นหาบทบรรยายหรือเวลา' });
  await search.fill('นก');
  expect(await listNames(), 'Reason search incorrect').toEqual(['ช่วงบรรยายที่ 2']);
  await search.fill('ไม่พบ');
  expect(await page.getByText('ไม่พบจุดบรรยายที่ตรงกับตัวกรองหรือคำค้นหา').isVisible(), 'Empty search missing').toBe(true);

  await search.fill('');
  await pickFilter(/^ทั้งหมด/);
  await page.getByRole('button', { name: /เลือกช่วงที่ 3 เวลา/ }).click();
  const text = page.getByRole('textbox', { name: 'บทบรรยายที่ 3', exact: true });
  await text.fill('ปลาใหม่');
  await page.getByText('บันทึกบนเซิร์ฟเวอร์แล้ว').waitFor();
  expect(job.spots[2].text, 'Edit not persisted').toBe('ปลาใหม่');

  const decision = page.getByRole('group', { name: 'เลือกการบรรยายจุดที่ 3' });
  expect(await decision.getByRole('button', { name: 'บรรยาย' }).getAttribute('aria-pressed'), 'Narrate is the pressed decision').toBe('true');
  await decision.getByRole('button', { name: 'บรรยาย' }).click();
  expect(await decision.getByRole('button', { name: 'บรรยาย' }).getAttribute('aria-pressed'), 'Pressing the chosen decision keeps it').toBe('true');

  await search.fill('ปลาใหม่');
  expect(await listNames(), 'Edited text search incorrect').toEqual(['ช่วงบรรยายที่ 3']);
  await search.fill('');
  await page.getByRole('button', { name: /เลือกช่วงที่ 1 เวลา/ }).click();
  await page.getByRole('button', { name: 'เดินหน้า 5 วินาที' }).click();
  const active = await page.getByRole('listitem', { name: 'ช่วงบรรยายที่ 2' }).getByText('ตำแหน่งวิดีโอ').count();
  expect(active, 'Active playback marker not visible at boundary').toBe(1);

  const loop = page.getByRole('button', { name: 'วนซ้ำช่วงที่เลือก' });
  expect(await loop.getAttribute('aria-pressed'), 'Loop starts off').toBe('false');
  await loop.click();
  expect(await loop.getAttribute('aria-pressed'), 'Loop toggles on').toBe('true');
  await loop.click();

  expect(
    await page.getByRole('group', { name: 'เล่นและเลื่อนเวลา' }).locator('[title]').count(),
    'Transport buttons use tooltips, not title attributes'
  ).toBe(0);
  await page.getByRole('group', { name: 'เล่นและเลื่อนเวลา' }).getByRole('button', { name: 'เล่นวิดีโอ' }).hover();
  const tip = page.locator('[data-slot=tooltip-content]');
  await tip.waitFor();
  expect((await tip.textContent())?.includes('Alt + P'), 'The play tooltip names its shortcut').toBe(true);
  await page.mouse.move(5, 5);
});
