async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const results = [];
  for (let run = 0; run < 5; run++) {
    for (const [version, port] of [['baseline', 4174], ['candidate', 4175]]) {
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.getByRole('list', { name: 'รายการช่วงบรรยาย' }).waitFor();
      const count = await page.getByRole('listitem').count();
      if (count !== 300) throw new Error(`Expected 300 spots, found ${count}`);
      const video = page.locator('video');
      await video.waitFor();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const before = await cdp.send('Performance.getMetrics');
      await video.evaluate(element => element.play());
      await page.waitForTimeout(3000);
      const state = await video.evaluate(element => ({ time: element.currentTime, paused: element.paused, ready: element.readyState }));
      await video.evaluate(element => element.pause());
      const after = await cdp.send('Performance.getMetrics');
      await cdp.detach();
      if (state.paused || state.time < 2.5 || state.ready < 2) throw new Error(`Video did not play: ${JSON.stringify(state)}`);
      const delta = name => after.metrics.find(metric => metric.name === name).value - before.metrics.find(metric => metric.name === name).value;
      results.push({ version, run: run + 1, videoSeconds: state.time, taskSeconds: delta('TaskDuration'), scriptSeconds: delta('ScriptDuration') });
    }
  }
  return { spotCount: 300, results };
}
