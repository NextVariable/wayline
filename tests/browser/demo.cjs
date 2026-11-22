const {chromium}=require(process.env.WAYLINE_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:'+(process.env.WAYLINE_E2E_PORT || '18945');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Shanghai'});
await context.addInitScript(()=>{
  localStorage.setItem('whatto.calendarEvents.guest',JSON.stringify([{id:'real-guest-event'}]));
});
const page=await context.newPage();page.setDefaultTimeout(7000);
const providerCalls=[];
let recording=false;
await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(url.hostname)){
    if(recording && /google|gmail|amap|accounts\./i.test(url.hostname)) providerCalls.push(url.href);
    return route.abort();
  }
  if(recording && /\/api\/(route|suggest|resources|calendar\/google|calendar\/places|auth\/gmail)/.test(url.pathname)) providerCalls.push(url.pathname);
  return route.continue();
});
await page.goto(base);
await page.getByRole('button',{name:'资料与备份'}).click();
await page.getByRole('button',{name:'体验演示工作区'}).click();
const banner=page.locator('.demo-banner');
await banner.waitFor();
assert.match(await banner.innerText(),/合成数据/);
recording=true;providerCalls.length=0;
await page.waitForTimeout(800);

const state=()=>page.evaluate(()=>({
  keys:Object.keys(localStorage),
  guest:localStorage.getItem('whatto.calendarEvents.guest'),
  demo:localStorage.getItem('whatto.calendarEvents.demo:wayline'),
  active:localStorage.getItem('whatto.activeUser'),
}));
let current=await state();
assert.ok(current.keys.includes('whatto.calendarEvents.demo:wayline'));
assert.ok(!current.keys.includes('whatto.userPlaces.demo:wayline'));
assert.ok(!current.keys.some(key=>key.includes('google:')));
assert.ok(!(current.active||'').includes('demo:wayline'));
assert.ok((current.guest||'').includes('real-guest-event'));

await page.locator('.today-actions').waitFor();
assert.ok(await page.locator('.today-actions li').count()>0);
assert.ok(await page.getByText(/时间重叠|时间冲突|待确认/).count()>0);
await page.locator('.global-city-trigger').waitFor();
assert.match(await page.locator('.global-city-trigger').getAttribute('aria-label'),/上海/);

const tripEntry=page.locator('[data-library-destination="business-trips"]');
if(await tripEntry.count()){
  await tripEntry.first().click();
  await page.locator('.business-trips-panel').waitFor();
  await page.locator('.business-trip-row').first().click();
  await page.getByText('苏州').first().waitFor();
  await page.locator('.trip-actions').waitFor();
  assert.ok(await page.locator('.trip-actions li').count()>0);
  assert.ok(await page.locator('.trip-action-uncertain, .trip-actions li[data-status="uncertain"]').count()>0);
}

await page.reload();
await page.locator('.demo-banner').waitFor();
await page.locator('.today-actions').waitFor();
const reanchored=await page.evaluate(()=>{
  const events=JSON.parse(localStorage.getItem('whatto.calendarEvents.demo:wayline')||'[]');
  const today=new Date();
  const key=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const d=new Date(events[0]?.start);
  const first=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return {today:key,first};
});
assert.equal(reanchored.first,reanchored.today);

await eventReset(page);
current=await state();
assert.ok(current.keys.includes('whatto.calendarEvents.demo:wayline'));
assert.ok((current.guest||'').includes('real-guest-event'));

assert.deepEqual(providerCalls,[],'demo must not query calendar, Gmail, routes or place providers');

await page.getByRole('button',{name:'退出演示'}).click();
await banner.waitFor({state:'detached'});
current=await state();
assert.ok(!current.keys.includes('whatto.calendarEvents.demo:wayline'));
assert.ok((current.guest||'').includes('real-guest-event'));
console.log('demo PASS');
await context.close();
}finally{await browser.close();}
async function eventReset(page){
  await page.getByRole('button',{name:'重置演示'}).click();
  await page.locator('.demo-banner').waitFor();
}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
