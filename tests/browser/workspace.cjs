const {chromium, webkit, devices}=require(process.env.WAYLINE_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:'+(process.env.WAYLINE_E2E_PORT || '18945');
// All external endpoints below are fulfilled locally or blocked.
const redirect=(route,path)=>route.fulfill({contentType:'text/html',body:'<meta http-equiv="refresh" content="0;url='+base+path+'">'});
(async()=>{
for(const device of ['desktop','iPhone 13','Pixel 7']){
const browser=device==='iPhone 13'? await webkit.launch({headless:true}) : await chromium.launch({channel:'chrome',headless:true});
try {
const context=await browser.newContext({...device==='desktop'?{viewport:{width:1440,height:900}}:devices[device],timezoneId:'Asia/Shanghai'});
const page=await context.newPage();page.setDefaultTimeout(7000);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const events=['会场甲','会场乙'].map((location,i)=>({id:'g'+i,uid:'u'+i,title:'测试会议'+i,location,description:'',start:day+(i?'T10:20:00+08:00':'T09:00:00+08:00'),end:day+(i?'T11:00:00+08:00':'T10:00:00+08:00'),allDay:false,timezone:'Asia/Shanghai',calendar:'测试',google:{connectionId:'test',eventId:String(i),calendarId:'work',updated:'',originalStart:null}}));
const calendars=[{id:'work',summary:'工作',primary:true},{id:'shared',summary:'共享'}];
let signedIn=false, connected=false, denyCalendar=true, selected=[], selectionFailed=true, routeFailed=true, payload=[], syncError='', bookingPhase='confirmed';
await context.route('**/*',async r=>{
 const u=new URL(r.request().url());
 if(u.hostname==='accounts.google.com'){
   if(u.pathname==='/test-login'){signedIn=true;return redirect(r,'/');}
   if(denyCalendar){denyCalendar=false;return redirect(r,'/?calendar=denied');}
   connected=true;return redirect(r,'/?calendar=connected');
 }
 if(u.hostname==='uri.amap.com')return r.fulfill({contentType:'text/html',body:'<title>模拟导航</title>导航'});
 if(u.hostname!=='127.0.0.1')return r.abort();
 if(u.pathname==='/api/auth/me')return r.fulfill({json:{configured:true,signedIn,account:{id:'owner',email:'qa@example.test',name:'QA'}}});
 if(u.pathname==='/api/auth/google/start')return r.fulfill({json:{url:'https://accounts.google.com/test-login'}});
 if(u.pathname==='/api/auth/gmail/status'){
   const old={id:'inbound',train:'G102',origin:'苏州站',destination:'上海虹桥站',departAt:day+'T08:00:00+08:00',arriveAt:day+'T09:08:00+08:00'};
   const replacement={...old,id:'new-inbound',train:'G103',arriveAt:day+'T08:50:00+08:00'};
   const history={id:'cancelled',kind:'rail',state:'cancelled',number:'G298',from:'上海虹桥站',to:'苏州站',start:day+'T17:00:00+08:00',observedAt:Date.now()};
   const inboundCancellation={id:old.id,kind:'rail',state:'cancelled',number:old.train,from:old.origin,to:old.destination,start:old.departAt,end:old.arriveAt,observedAt:Date.now()};
   return r.fulfill({json:{enabled:true,connected:true,lastSync:Date.now(),
     orders:bookingPhase==='confirmed'?[old]:bookingPhase==='replacement'?[replacement]:[],
     changes:bookingPhase==='confirmed'?[history]:[history,inboundCancellation]}});
 }
 if(u.pathname==='/api/suggest'){
   const {keyword,city}=r.request().postDataJSON();
   return r.fulfill({json:[{name:keyword,city,lat:31.19,lng:121.31,address:'合成站点',isMatched:true,coordinateSystem:'GCJ02'}]});
 }
 if(u.pathname==='/api/workspace')return r.fulfill({json:{version:0,workspace:null}});
 if(u.pathname==='/api/calendar/google/connect')return r.fulfill({json:{url:'https://accounts.google.com/test-calendar'}});
 if(u.pathname==='/api/calendar/google/status')return r.fulfill({json:{configured:true,connected:connected&&u.searchParams.get('owner')==='google:owner',connectionId:'test',selected,calendars,lastSync:selected.length?Date.now():null,events:payload,error:syncError}});
 if(u.pathname==='/api/calendar/google/select'){
   const submitted=r.request().postDataJSON().calendarIds;
   assert.deepEqual(submitted,device==='desktop'?['work']:['shared']);
   await new Promise(resolve=>setTimeout(resolve,300));
   if(selectionFailed){selectionFailed=false;return r.fulfill({status:502,json:{error:'样本暂时无法同步'}});}
   selected=submitted;payload=events;return r.fulfill({json:{ok:true}});
 }
 if(u.pathname==='/api/calendar/places'){const {items}=r.request().postDataJSON();return r.fulfill({json:{results:items.map(({text})=>text==='会场乙'?{text,status:'ambiguous',candidates:[{name:text,city:'上海',address:'测试路100号',lat:31.2,lng:121.5}]}:{text,status:'found',place:{name:text,city:'上海',address:text,lat:31.2,lng:121.43}})}});}
 if(u.pathname==='/api/route'){if(routeFailed)return r.fulfill({status:503,json:{error:'样本限流'}});const {mode,places}=r.request().postDataJSON();return r.fulfill({json:{source:'amap',observedAt:Date.now(),mode,legs:[{from:places[0].name,to:places[1].name,distance:7000,duration:mode==='driving'?900:1800,points:places.map(p=>({latitude:p.lat,longitude:p.lng}))}]}});}
 return r.continue();
});
await page.goto(base+'/');
await page.getByRole('button',{name:'用 Google 登录，连接日历'}).click();
await page.getByRole('button',{name:'连接 Google 日历',exact:true}).click();
await page.getByText('未连接 Google 日历，可重新授权').waitFor();
await page.getByRole('button',{name:'连接 Google 日历',exact:true}).click();
const def=page.getByRole('button',{name:'同步「工作」'});
await def.waitFor();
if(device!=='desktop'){
 await page.getByRole('button',{name:'选择其他日历'}).click();
 assert.ok(await page.getByRole('checkbox',{name:'工作（主日历）'}).isChecked());
 await page.getByRole('checkbox',{name:'工作（主日历）'}).uncheck();
 await page.getByRole('checkbox',{name:'共享'}).check();
 await page.getByRole('button',{name:'同步所选日历'}).click();
}else { await def.focus(); await page.keyboard.press('Enter'); }
await page.getByText('正在首次同步…').waitFor();
await page.getByRole('alert').filter({hasText:'样本暂时无法同步'}).waitFor();
await page.getByRole('button',{name:'重试同步',exact:true}).click();
await page.getByRole('button',{name:'1 个日程没有地点'}).click();
await page.getByRole('button',{name:/会场乙.*测试路/}).click();
const retry=page.getByRole('button',{name:'重试',exact:true});await retry.waitFor();
await context.setOffline(true);
await page.waitForFunction(()=>!navigator.onLine);
routeFailed=false;
await context.setOffline(false);
await page.getByText('差 10 分钟',{exact:true}).waitFor();
await page.getByRole('button',{name:'打车',exact:true}).click();
await page.locator('.today-leg[data-status="ok"]').waitFor();
const link=page.locator('.today-navigation');
const href=new URL(await link.getAttribute('href'));assert.equal(href.searchParams.get('mode'),'car');assert.equal(href.searchParams.get('callnative'),device==='desktop'?'0':'1');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.locator('.leaflet-container').first().waitFor();
assert.ok(await page.locator('.today-stop').nth(1).isVisible());
if(device!=='desktop'){
 assert.ok((await link.boundingBox()).height>=44);
 await link.click();await page.waitForURL('https://uri.amap.com/**');await page.goBack();
}else {const popup=page.waitForEvent('popup');await link.click();await (await popup).close();}
await page.reload();
await page.locator('.today-leg[data-status="ok"] .today-leg-summary button[aria-pressed="true"]').waitFor();
assert.equal(await page.getByRole('button',{name:'打车',exact:true}).getAttribute('aria-pressed'),'true');
syncError='样本旧快照';await page.reload();await page.getByText('日历待同步，暂不判断能否准时').waitFor();assert.equal(await page.locator('.today-leg[data-status="ok"]').count(),0);
syncError='';payload=[];await page.reload();await page.getByText('已同步 · 此时间范围内没有日程').waitFor();assert.equal(await page.locator('.today-leg').count(),0);
{
  payload=events;
  await page.evaluate(()=>localStorage.setItem('wayline.businessTrips.google:owner',JSON.stringify({home:'苏州',boundaries:{}})));
  await page.reload();
  await page.getByRole('button',{name:'1 个日程没有地点'}).click();
  await page.getByRole('button',{name:'是',exact:true}).click();
  await page.locator('.today-stop').nth(1).waitFor();
  await page.locator('[data-library-destination="business-trips"]').click();
  await page.locator('.business-trip-row').click();
  await page.getByText('订单与会议时间冲突',{exact:true}).waitFor();
  await page.getByText('订单收到取消通知',{exact:true}).waitFor();
  await page.locator('.trip-order-row').filter({hasText:'G102'}).waitFor();
  await page.locator('.trip-connections > summary').click();
  await page.getByRole('button',{name:'驾车',exact:true}).click();
  const commuteLink=page.locator('.business-commute-navigation');
  if(device==='desktop'){
    const popup=page.waitForEvent('popup');
    await commuteLink.click();
    await (await popup).close();
  } else {
    await commuteLink.click();
    await page.waitForURL('https://uri.amap.com/**');
    await page.goBack();
  }
  const commuteButton=page.getByRole('button',{name:'驾车',exact:true});
  await commuteButton.waitFor();
  assert.equal(await commuteButton.getAttribute('aria-pressed'),'true');
  await page.locator('.business-commute-navigation').waitFor();
  const openRisks=async()=>{
    const risks=page.locator('details.trip-risk-list');
    if (await risks.getAttribute('open')===null) await risks.locator('summary').click();
  };
  const inboundMissing=page.locator('.trip-risk-list li').filter({hasText:'未见已订交通'}).filter({hasText:'苏州 → 上海'});
  bookingPhase='cancelled';
  await page.evaluate(()=>window.dispatchEvent(new Event('wayline:gmail-change')));
  await page.locator('.trip-order-row').filter({hasText:'G102'}).getByText(/收到取消通知/).waitFor();
  await openRisks();
  await inboundMissing.waitFor();
  assert.equal(await page.getByText('订单与会议时间冲突',{exact:true}).count(),0);
  bookingPhase='replacement';
  await page.evaluate(()=>window.dispatchEvent(new Event('wayline:gmail-change')));
  await page.locator('.trip-order-row').filter({hasText:'G103'}).waitFor();
  assert.equal(await inboundMissing.count(),0);
  const details=page.locator('details.trip-connections');
  if (await details.getAttribute('open')===null) await details.locator('summary').click();
  await page.getByRole('button',{name:'查到站后接驳'}).click();
  await openRisks();
  await page.getByText('按查询耗时，城际接驳时间不足',{exact:true}).waitFor();
  await page.getByText(/可用 10 分钟.*差 5 分钟/).waitFor();
  const tripPanel=page.locator('.business-trips-panel');
  await tripPanel.getByRole('button',{name:'行程',exact:true}).click();
  await tripPanel.getByRole('button',{name:'地点',exact:true}).click();
  await page.locator('[data-library-destination="saved"]').click();
  await page.locator('.saved-place-aliases > summary').click();
  await page.getByText('会场乙 → 会场乙',{exact:true}).waitFor();
  await page.getByRole('button',{name:'移除「会场乙」的地点别名'}).click();
  await page.locator('.saved-place-aliases').waitFor({state:'detached'});
}
console.log(device,'PASS');await context.close();
}finally{await browser.close();}
}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
