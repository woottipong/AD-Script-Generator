async page => {
  await page.unrouteAll({ behavior: 'wait' });
  const spot = (id, start, decision, text, reason) => ({spot_id:id,start_ms:start,end_ms:start+4000,duration_ms:4000,original_start_ms:start,original_end_ms:start+4000,decision,text,reason,is_edited:false});
  const spots=[spot('one',1000,'generate','ช้างเดิน',''),spot('two',5000,'skip','','เหตุผลนก'),spot('three',9000,'generate','ปลาแหวกว่าย',''),spot('four',13000,'pending','','')];
  const job={job_id:'fixture',status:'READY',video_metadata:{fileName:'fixture.mp4',fileSize:1,mimeType:'video/mp4',width:854,height:480,durationMs:18000,videoCodec:'avc1',audioCodec:'mp4a.40.2',hasAudioTrack:true},vad_output:{duration_ms:18000,speech_segments:[],candidate_spots:[]},batches:[],spots};
  await page.route('**/api/**', async route => {
    const url=route.request().url();
    if(url.endsWith('/api/jobs/current')) return route.fulfill({json:{job,isRunning:false}});
    if(url.endsWith('/spots')) {job.spots=route.request().postDataJSON().spots; return route.fulfill({json:{job}})}
    return route.fulfill({status:404,json:{error:'fixture'}});
  });
  await page.goto('http://127.0.0.1:4173/');
  const list=page.getByRole('list',{name:'รายการช่วงบรรยาย'}); await list.waitFor();
  const listNames=async()=>await list.getByRole('listitem').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
  const assert=(x,message)=>{if(!x) throw new Error(message)};
  assert(await page.getByRole('button',{name:'ส่งออก JSON'}).count()===0,'JSON export should not be available');
  assert(await page.getByRole('button',{name:'ส่งออก SRT'}).isEnabled(),'SRT export should be available');
  assert(JSON.stringify(await listNames())===JSON.stringify(['ช่วงบรรยายที่ 1','ช่วงบรรยายที่ 2','ช่วงบรรยายที่ 3','ช่วงบรรยายที่ 4']),'Initial global order incorrect');
  const filter=page.locator('#spot-filter'); await filter.selectOption('skip');
  assert(JSON.stringify(await listNames())===JSON.stringify(['ช่วงบรรยายที่ 2']),'Skip global order incorrect');
  const search=page.getByRole('searchbox',{name:'ค้นหาบทบรรยายหรือเวลา'}); await search.fill('นก');
  assert(JSON.stringify(await listNames())===JSON.stringify(['ช่วงบรรยายที่ 2']),'Reason search incorrect');
  await search.fill('ไม่พบ'); assert(await page.getByText('ไม่พบจุดบรรยายที่ตรงกับตัวกรองหรือคำค้นหา').isVisible(),'Empty search missing');
  await search.fill('');await filter.selectOption('all');
  await page.getByRole('button',{name:/เลือกช่วงที่ 3 เวลา/}).click();
  const text=page.getByRole('textbox',{name:'บทบรรยายที่ 3',exact:true}); await text.fill('ปลาใหม่');
  await page.getByText('บันทึกบนเซิร์ฟเวอร์แล้ว').waitFor();
  assert(job.spots[2].text==='ปลาใหม่','Edit not persisted');
  await search.fill('ปลาใหม่'); assert(JSON.stringify(await listNames())===JSON.stringify(['ช่วงบรรยายที่ 3']),'Edited text search incorrect');
  await search.fill(''); await page.getByRole('button',{name:/เลือกช่วงที่ 1 เวลา/}).click();
  await page.getByRole('button',{name:'เดินหน้า 5 วินาที'}).click();
  const active=await page.getByRole('listitem',{name:'ช่วงบรรยายที่ 2'}).getByText('ตำแหน่งวิดีโอ').count();
  assert(active===1,'Active playback marker not visible at boundary');
  return JSON.stringify({initialOrder:true,skipOrder:true,reasonSearch:true,emptySearch:true,selectedEditedAndSaved:true,editedSearch:true,activeMarker:true});
}
