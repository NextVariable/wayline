const {chromium, webkit, devices}=require(process.env.WAYLINE_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:'+(process.env.WAYLINE_E2E_PORT || '18945');

// Regression: entering a trip detail inside the demo workspace must always keep a
// visible, usable way back to the real workspace on desktop and mobile.
(async()=>{
const deviceList=(process.env.WAYLINE_E2E_DEVICES||'desktop,iPhone 13').split(',').map(item=>item.trim()).filter(Boolean);
for(const device of deviceList){
  const browser=device==='iPhone 13'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({...(device==='desktop'?{viewport:{width:1440,height:900}}:devices[device]),timezoneId:'Asia/Shanghai'});
    await context.addInitScript(()=>{
      localStorage.setItem('whatto.calendarEvents.guest',JSON.stringify([{id:'real-guest-event'}]));
    });
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(base);
    await page.getByRole('button',{name:'资料与备份'}).click();
    await page.getByRole('button',{name:'体验演示工作区'}).click();
    await page.locator('.demo-banner').waitFor();

    const tripEntry=page.locator('[data-library-destination="business-trips"]');
    assert.ok(await tripEntry.count(),device+': trip entry must exist in the demo workspace');
    await tripEntry.first().click();
    const panel=page.locator('.business-trips-panel');
    await panel.waitFor();
    await page.locator('.business-trip-row').first().click();
    await page.locator('.trip-actions').waitFor();

    // The back action returns from the trip detail to the trip list.
    await panel.locator('.panel-heading').getByRole('button',{name:'行程'}).click();
    await page.locator('.business-trip-row').first().waitFor();
    await page.locator('.business-trip-row').first().click();
    await page.locator('.trip-actions').waitFor();

    const banner=page.locator('.demo-banner');
    const chip=page.locator('.demo-exit-chip');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,device+': overlay header must not overflow horizontally');
    if(device==='desktop'){
      await banner.waitFor();
      await assertClickable(page,banner);
      await banner.getByRole('button',{name:'退出演示'}).click();
    }else{
      await chip.waitFor();
      const box=await chip.boundingBox();
      assert.ok(box&&box.height>=44,device+': demo exit chip must be touch sized: '+(box&&box.height));
      const covered=await chip.evaluate(node=>{
        const rect=node.getBoundingClientRect();
        const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
        return !hit||!hit.closest('.demo-exit-chip');
      });
      assert.equal(covered,false,device+': demo exit chip must not be covered');
      await chip.click();
    }

    await banner.waitFor({state:'detached'});
    await chip.waitFor({state:'detached'});
    await page.locator('.business-trips-panel').waitFor({state:'detached'});
    const after=await page.evaluate(()=>({
      keys:Object.keys(localStorage),
      guest:localStorage.getItem('whatto.calendarEvents.guest'),
    }));
    assert.ok(!after.keys.some(key=>key.endsWith('demo:wayline')),device+': demo keys must be cleared on exit');
    assert.ok((after.guest||'').includes('real-guest-event'),device+': real guest data must survive the demo');
    const city=await page.locator('.global-city-trigger').getAttribute('aria-label');
    assert.ok(!/上海/.test(city||''),device+': real workspace city must be restored, got '+city);
    console.log(device,'demo overlay exit PASS');
    await context.close();
  }finally{await browser.close();}
}

// A signed-in account must come back untouched after the demo workspace is left.
{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Shanghai'});
    await context.addInitScript(()=>{
      localStorage.setItem('whatto.calendarEvents.google:owner',JSON.stringify([{id:'real-owner-event'}]));
    });
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
      if(url.pathname==='/api/auth/me') return route.fulfill({json:{configured:true,signedIn:true,account:{id:'owner',email:'qa@example.test',name:'QA'}}});
      if(url.pathname==='/api/workspace') return route.fulfill({json:{version:0,workspace:null}});
      if(url.pathname==='/api/calendar/google/status') return route.fulfill({json:{configured:false,connected:false}});
      if(url.pathname==='/api/auth/gmail/status') return route.fulfill({json:{enabled:false}});
      return route.continue();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(base);
    const accountEntry=page.getByRole('button',{name:/账号 qa@example\.test/});
    await accountEntry.waitFor();
    await accountEntry.click();
    const panel=page.locator('.account-panel');
    await panel.waitFor();
    // Demo is offered only from the unauthenticated space, so an account can never be
    // switched into the demo owner by accident.
    assert.equal(await panel.getByRole('button',{name:'体验演示工作区'}).count(),0,'signed-in account must not expose the demo workspace');
    const snapshot=await page.evaluate(()=>({
      keys:Object.keys(localStorage),
      owner:localStorage.getItem('whatto.calendarEvents.google:owner'),
      city:localStorage.getItem('whereto:city-view:google:owner'),
    }));
    assert.ok((snapshot.owner||'').includes('real-owner-event'),'account switch: signed-in data must stay intact');
    assert.ok(!snapshot.keys.some(key=>key.endsWith('demo:wayline')),'account switch: no demo data may appear for an account');
    await panel.getByRole('button',{name:'关闭资料与备份'}).click();
    await accountEntry.waitFor();
    console.log('signed-in demo isolation PASS');
    await context.close();
  }finally{await browser.close();}
}

async function assertClickable(page,locator){
  const box=await locator.boundingBox();
  assert.ok(box,'demo banner must be laid out');
  const covered=await locator.evaluate(node=>{
    const rect=node.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
    return !hit||!hit.closest('.demo-banner');
  });
  assert.equal(covered,false,'demo banner must not be covered by another surface');
}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
