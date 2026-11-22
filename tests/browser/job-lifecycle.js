async page => {
  await page.unrouteAll({ behavior: 'wait' });
  let patchCalls = 0;
  const spot = {spot_id:'test_1', start_ms:1000,end_ms:5000,duration_ms:4000,original_start_ms:1000,original_end_ms:5000,decision:'generate',text:'บทเดิม',is_edited:false};
  const job = {schema_version:3,job_id:'job_test',title:'fixture',mode:'generate',status:'READY',video_metadata:{fileName:'fixture.mp4',fileSize:123,mimeType:'video/mp4',width:854,height:480,durationMs:10000,videoCodec:'avc1',audioCodec:'mp4a.40.2',hasAudioTrack:true},vad_output:{duration_ms:10000,speech_segments:[],candidate_spots:[]},batches:[],spots:[spot]};
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/api/jobs/job_test')) return route.fulfill({json:{job,isRunning:false}});
    if (url.endsWith('/spots')) { patchCalls++; if (patchCalls===1) return route.fulfill({status:500,json:{error:'synthetic failure'}}); await new Promise(r=>setTimeout(r,400)); job.spots = route.request().postDataJSON().spots; return route.fulfill({json:{job}}); }
    return route.fulfill({status:404,json:{error:'fixture'}});
  });
  await page.goto('http://127.0.0.1:4173/jobs/job_test');
  await page.getByRole('textbox',{name:'บทบรรยายที่ 1',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'บทบรรยายที่ 1',exact:true}).fill('บทแก้ไข');
  await page.getByText('บันทึกไม่สำเร็จ', {exact:false}).waitFor();
  const retained = await page.getByRole('textbox',{name:'บทบรรยายที่ 1',exact:true}).inputValue();
  if (retained !== 'บทแก้ไข') throw new Error('Edit lost after failed save');
  const logo = page.getByRole('link', { name: 'TCC Envisio รายการงาน' });
  await logo.click();
  const leaveDialog = page.getByRole('alertdialog', { name: 'กลับไปรายการงาน?' });
  await leaveDialog.waitFor();
  if (!(await leaveDialog.textContent()).includes('ยังบันทึกไม่สำเร็จ')) throw new Error('Leaving with a failed save did not warn');
  await page.keyboard.press('Escape');
  await leaveDialog.waitFor({ state: 'hidden' });
  if (new URL(page.url()).pathname !== '/jobs/job_test') throw new Error('Declining the warning left the job');
  if (!(await logo.evaluate((el) => el === document.activeElement))) throw new Error('Focus did not return to the control that asked');
  await page.getByRole('button',{name:'ลองบันทึกอีกครั้ง'}).click();
  const saving = await page.getByText('กำลังบันทึกการแก้ไข…').count();
  if (saving !== 1) throw new Error('Saving status was not shown before acknowledgement');
  await page.getByText('บันทึกบนเซิร์ฟเวอร์แล้ว').waitFor();
  if (patchCalls !== 2) throw new Error('Expected a failed save and a retry');
  await page.reload();
  await page.getByRole('textbox',{name:'บทบรรยายที่ 1',exact:true}).waitFor();
  if (await page.getByRole('textbox',{name:'บทบรรยายที่ 1',exact:true}).inputValue() !== 'บทแก้ไข') throw new Error('Saved edit did not survive reload');
  return {leaveWarned:true, restored:true, errorRetained:retained, savingIndicator:saving, acknowledged:true, patchCalls};
}
