import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const VIDEO = '/private/tmp/claude-502/-Users-iwoody--claude-spares-spare-MiZEPz/29c82e2f-ab0f-40fe-b6b4-b905d8c76686/scratchpad/bench/long-480p.mp4';
const OUT = '/private/tmp/claude-502/-Users-iwoody--claude-spares-spare-MiZEPz/29c82e2f-ab0f-40fe-b6b4-b905d8c76686/scratchpad/bench/rerender-results.jsonl';
const RUNS = Number(process.env.RUNS || 5);
const WINDOW_MS = 7000;
const SPOTS = 300;

const spots = Array.from({ length: SPOTS }, (_, i) => ({
  spot_id: `spot_${i}`, start_ms: i * 6000, end_ms: i * 6000 + 4000, duration_ms: 4000,
  original_start_ms: i * 6000, original_end_ms: i * 6000 + 4000,
  decision: i % 5 === 0 ? 'skip' : 'generate', text: i % 5 === 0 ? '' : `ชายหนุ่มเดินเข้ามาในห้องแล้วหยิบจดหมายบนโต๊ะขึ้นมาอ่าน ${i}`,
  reason: i % 5 === 0 ? 'มีเสียงพูด' : undefined, is_edited: false,
}));
const peaks = Buffer.from(Array.from({ length: 90_000 }, (_, i) => (i * 37) % 255)).toString('base64');
const baseJob = {
  schema_version: 3, job_id: 'job_measure', title: 'measure', mode: 'generate', status: 'READY',
  video_source: { kind: 'server_copy', local_file_path: '/x.mp4' },
  created_at: '2026-11-23T00:00:00Z', updated_at: '2026-11-23T00:00:00Z',
  video_metadata: { fileName: 'measure.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480, durationMs: 1_800_000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
  vad_config: { speechThreshold: 0.5, minSpeechDurationMs: 250, minSilenceDurationMs: 100, speechPaddingMs: 30, minAdGapMs: 3000 },
  vad_output: {
    duration_ms: 1_800_000,
    speech_segments: Array.from({ length: 900 }, (_, i) => ({ start_ms: i * 2000, end_ms: i * 2000 + 1500 })),
    candidate_spots: spots.map(({ spot_id, start_ms, end_ms, duration_ms }) => ({ spot_id, start_ms, end_ms, duration_ms })),
    waveform: { sampleIntervalMs: 20, peaksBase64: peaks },
  },
  batches: [{ batch_id: 'batch_1', batch_index: 1, batch_start_ms: 0, batch_end_ms: 1_800_000, status: 'completed', retry_count: 0, candidate_spots: [] }],
  spots,
};

for (let run = 1; run <= RUNS; run++) {
  test(`measure editor main-thread cost run ${run}`, async ({ page }) => {
    test.setTimeout(120_000);
    let analyzing = false;
    let polls = 0;
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/me') return route.fulfill({ json: { email: 'author@example.com', allJobs: false } });
      if (url.pathname === '/api/jobs/job_measure/video') {
        return route.fulfill({ status: 200, contentType: 'video/mp4', body: fs.readFileSync(VIDEO) });
      }
      if (url.pathname === '/api/jobs/job_measure') {
        if (url.searchParams.get('view') === 'progress') polls++;
        const job = analyzing
          ? { ...baseJob, status: 'ANALYZING', progress_stage: 'กำลังวิเคราะห์ ชุดที่ 1/1', progress_percent: 40, batches: [{ ...baseJob.batches[0], status: 'processing' }] }
          : baseJob;
        return route.fulfill({ json: { job, isRunning: analyzing } });
      }
      return route.fulfill({ json: { ok: true } });
    });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const busy = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = (name: string) => metrics.find((m) => m.name === name)!.value;
      return { task: get('TaskDuration'), script: get('ScriptDuration') };
    };
    const windowCost = async (label: string, extra: () => Promise<Record<string, number>> = async () => ({})) => {
      const before = await busy();
      const t0 = Date.now();
      await page.waitForTimeout(WINDOW_MS);
      const after = await busy();
      const seconds = (Date.now() - t0) / 1000;
      return {
        label, run, seconds,
        taskMsPerSec: +((after.task - before.task) * 1000 / seconds).toFixed(1),
        scriptMsPerSec: +((after.script - before.script) * 1000 / seconds).toFixed(1),
        ...(await extra()),
      };
    };
    const results: object[] = [];

    for (const throttle of [1, 4]) {
      analyzing = false;
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await page.goto('/jobs/job_measure');
      const list = page.getByRole('list', { name: 'รายการช่วงบรรยาย' });
      await list.waitFor();
      expect(await list.getByRole('listitem').count(), 'all spots render').toBe(SPOTS);
      const video = page.locator('video').first();
      await video.waitFor({ state: 'attached' });
      await page.waitForTimeout(1500);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

      results.push({ ...(await windowCost('idle-paused')), throttle });

      await video.evaluate(async (v: HTMLVideoElement) => { v.muted = true; await v.play(); });
      await page.waitForTimeout(1000);
      const startTime = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
      if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
      results.push({
        ...(await windowCost('playing', async () => ({
          videoAdvancedSec: +((await video.evaluate((v: HTMLVideoElement) => v.currentTime)) - startTime).toFixed(2),
        }))),
        throttle,
      });
      if (process.env.PROFILE) fs.writeFileSync(`${OUT}.playing-${throttle}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
      await video.evaluate((v: HTMLVideoElement) => v.pause());

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      analyzing = true;
      await page.goto('/jobs/job_measure');
      await list.waitFor();
      await page.waitForTimeout(1500);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const pollsBefore = polls;
      if (process.env.PROFILE) await cdp.send('Profiler.start');
      results.push({ ...(await windowCost('analyzing-polling', async () => ({ polls: polls - pollsBefore }))), throttle });
      if (process.env.PROFILE) fs.writeFileSync(`${OUT}.polling-${throttle}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    fs.appendFileSync(OUT, results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
}
