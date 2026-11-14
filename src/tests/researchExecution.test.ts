import {expect,it,vi} from 'vitest';
// @ts-expect-error Server boundary.
import {researchPublicEvents} from '../../server/public-research.mjs';
// @ts-expect-error Server boundary.
import {cacheTravelServices} from '../../server/research-cache.mjs';
it('discovers and opens public venue sources without requiring pasted links or transmitting meeting notes',async()=>{
 const queries:string[]=[];
 const result=await researchPublicEvents('客户张先生私人会面 电话123456',{places:[{name:'国家会展中心',city:'上海'}],search:async(query:string)=>{queries.push(query);return [{title:'国家会展中心（上海）',url:'https://www.neccsh.com/contact'}];},readPage:async()=>'<title>国家会展中心（上海）</title><p>国家会展中心 上海市青浦区崧泽大道333号</p>'});
 expect(queries.join()).toContain('国家会展中心');expect(queries.join()).not.toContain('张先生');expect(queries.join()).not.toContain('123456');
 expect(result).toEqual(expect.arrayContaining([expect.objectContaining({status:'retrieved',url:'https://www.neccsh.com/contact',discovered:true})]));
});
it('does not publish irrelevant search hits or search snippets as opened venue evidence',async()=>{
 const result=await researchPublicEvents('',{places:[{name:'国家会展中心',city:'上海'}],search:async()=>[{title:'家具特卖',url:'https://example.org/a',description:'国家会展中心附近'}],readPage:async()=>'<title>家具</title><p>促销</p>'});
 expect(result.some((s:any)=>s.status==='retrieved')).toBe(false);
});
it('keeps distinct modes and departure slots out of the same cached road observation',async()=>{
 const route=vi.fn(async(input:any)=>({source:'amap',mode:input.mode,departure:input.departure}));
 const services=cacheTravelServices({route});const places=[{name:'A',lat:31,lng:121},{name:'B',lat:31.1,lng:121.1}];
 await services.route({places,mode:'walking'});const driving=await services.route({places,mode:'driving'});
 expect(driving.mode).toBe('driving');
 await services.route({places,mode:'transit',departure:'2026-11-02T09:00:00+08:00'});
 await services.route({places,mode:'transit',departure:'2026-11-02T18:00:00+08:00'});expect(route).toHaveBeenCalledTimes(4);
});

// @ts-expect-error Server boundary.
import { createPublicSearch } from '../../server/public-search.mjs';
it('uses keyless access without credentials or paid fallback when rate limited',async()=>{
 const fetchImpl=vi.fn(async(_url:string,_options:any)=>({ok:false,status:429}));
 const search=createPublicSearch({keyless:true,tavilyKey:'must-not-use',apiKey:'must-not-use',fetchImpl});
 await expect(search('上海 会场 官网')).rejects.toThrow('公开资料搜索暂不可用');
 expect(fetchImpl).toHaveBeenCalledTimes(1);
 expect(fetchImpl.mock.calls[0][1].headers).toEqual({'Content-Type':'application/json','X-Tavily-Access-Mode':'keyless'});
});
it('uses authenticated public search and rejects non-HTTPS results', async () => {
  const fetchImpl=vi.fn(async(_url:string,_options:unknown)=>({ok:true,json:async()=>({web:{results:[{title:'官网',url:'https://example.com/a'},{title:'bad',url:'http://example.com/b'}]}})}));
  const search=createPublicSearch({apiKey:'test-only-key',fetchImpl});
  expect(await search('上海 会展中心')).toEqual([{title:'官网',url:'https://example.com/a'}]);
  expect(fetchImpl.mock.calls[0][0]).toContain('api.search.brave.com');
});
it('does not silently substitute generated research when search is unconfigured',async()=>{
  await expect(createPublicSearch()('上海 会展中心')).rejects.toThrow('公开资料搜索尚未配置');
});
// @ts-expect-error Server boundary.
import { readTrainOffers } from '../../server/journey-suppliers.mjs';
it('rejects a successful ticket response for a different station or date instead of admitting it into the trip',()=>{
 const q={origin:'苏州站',destination:'上海虹桥站',date:'2026-11-02'};
 const r={from_station:'苏州',to_station:'上海松江',start_date:'2026-10-31',start_train_code:'G1',start_time:'10:00',arrive_time:'11:00',arrive_date:'2026-10-31'};
 expect(()=>readTrainOffers([r],q)).toThrow('日期或车站');
 expect(readTrainOffers([{...r,to_station:'上海虹桥',start_date:q.date,arrive_date:q.date}],q).candidates[0].availability).toBe('unknown');
});
// @ts-expect-error Server boundary.
import { openResearchCache } from '../../server/persistent-research-cache.mjs';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('reuses encrypted research after restart, expires observations and never stores failed lookups',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wayline-research-'));let now=1000;
 const first=await openResearchCache(dir,{now:()=>now,ttl:100});
 await first.lookup('public-venue-query',async()=>({url:'https://example.com',excerpt:'公开会场'}));
 const second=await openResearchCache(dir,{now:()=>now,ttl:100});
 const network=vi.fn(async()=>({url:'https://example.com/new'}));
 expect((await second.lookup('public-venue-query',network)).excerpt).toBe('公开会场');
 expect(network).not.toHaveBeenCalled();
 now=1200;await second.lookup('public-venue-query',network);expect(network).toHaveBeenCalledTimes(1);
 await expect(second.lookup('failed',async()=>{throw Error('failure');})).rejects.toThrow('failure');
 const retry=vi.fn(async()=>({status:'retrieved'}));await second.lookup('failed',retry);expect(retry).toHaveBeenCalledTimes(1);
 expect((await readFile(join(dir,'research.enc'),'utf8'))).not.toContain('example.com');
 expect((await stat(join(dir,'research.key'))).mode&0o777).toBe(0o600);
});
it('supports the no-card Tavily search API without sending credentials in URLs',async()=>{
 const fetchImpl=vi.fn(async(_url:string,_options:any)=>({ok:true,json:async()=>({results:[{title:'场地官网',url:'https://example.com/venue'}]})}));
 const search=createPublicSearch({tavilyKey:'test-secret',fetchImpl});
 expect(await search('上海 会场 官网')).toEqual([{title:'场地官网',url:'https://example.com/venue'}]);
 expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tavily.com/search');
 expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({query:'上海 会场 官网',search_depth:'basic'});
 expect(fetchImpl.mock.calls[0][0]).not.toContain('test-secret');
});
it('actively searches an explicitly public activity by name and date, not only its venue',async()=>{
 const queries:string[]=[];
 await researchPublicEvents('参加上海商务论坛，这是公开活动。',{places:[],publicEvents:[{name:'上海商务论坛',city:'上海',date:'2026-11-02'}],search:async(q:string)=>{queries.push(q);return [];}});
 expect(queries.join()).toContain('上海商务论坛');expect(queries.join()).toContain('2026-11-02');
});
// @ts-expect-error Server boundary.
import { parseOfficialTickets } from '../../server/official-rail.mjs';
it('binds official raw tickets to exact boarding stations and requested date, not the train origin date',()=>{
 const row=Array(57).fill('');Object.assign(row,{3:'G101',6:'SZH',7:'AOH',8:'23:30',9:'00:30',10:'01:00',11:'Y',13:'20261101',30:'8'});
 const wrong=row.slice();wrong[7]='AHH';
 const query={origin:'苏州站',destination:'上海虹桥站',date:'2026-11-02'};
 const result=parseOfficialTickets({status:true,data:{result:[wrong.join('|'),row.join('|')],map:{SZH:'苏州',AOH:'上海虹桥',AHH:'上海松江'}}},query,['SZH','AOH']);
 expect(result.candidates).toHaveLength(1);expect(result.candidates[0]).toMatchObject({departure:'2026-11-02T23:30:00+08:00',arrival:'2026-11-03T00:30:00+08:00',verified:false,price:null});
 expect(result.candidates[0].seatOptions.find((s:any)=>s.name==='二等座').count).toBe(8);
});
it('does not accept official rows with inconsistent clocks or unknown station identity',()=>{
 expect(()=>parseOfficialTickets({status:true,data:{result:['nonempty'],map:{}}},{origin:'苏州站',destination:'上海虹桥站',date:'2026-11-02'},['SZH','AOH'])).toThrow('车站');
});
it('keeps an official empty ticket result empty without inventing seats or reporting malformed identity',()=>{
 expect(parseOfficialTickets({status:true,data:{result:[],map:{}}},{origin:'苏州站',destination:'上海虹桥站',date:'2026-11-02'},['SZH','AOH'])).toEqual({candidates:[]});
});
it('actively researches luggage policy pages with public hotel identity and keeps search snippets out of evidence',async()=>{
 const search=vi.fn(async(_query:string)=>[{url:'https://example.com/hotel',title:'免费24小时寄存'}]);
 const readPage=vi.fn(async()=>'<title>上海测试酒店</title><p>上海测试酒店提供行李寄存，详情咨询前台。</p>');
 const rows=await researchPublicEvents('',{places:[{name:'上海测试酒店',city:'上海'}],purpose:'hotel',search,readPage});
 expect(search.mock.calls[0][0]).toContain('官网 行李寄存 退房后 收费');
 expect(rows[0]).toMatchObject({status:'retrieved',placeName:'上海测试酒店'});
 expect(rows[0].excerpt).not.toContain('免费24小时');
});
