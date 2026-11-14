import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDecipheriv} from 'node:crypto';
// @ts-expect-error server
import {openResearchCache} from '../../server/persistent-research-cache.mjs';
// @ts-expect-error server
import {cacheTravelServices} from '../../server/research-cache.mjs';
it('reuses unchanged provider research across restarts and refreshes changed room dates only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wayline-resume-'));
 const calls={findHotels:vi.fn(async()=>({candidates:[{name:'酒店甲'}]})),findStations:vi.fn(async()=>({candidates:[{name:'上海虹桥站'}]})),hotelOffer:vi.fn(async(q:any)=>({scope:q,availability:'available'}))};
 const q={hotel:{name:'酒店甲',id:'h'},checkIn:'2026-11-02',checkOut:'2026-11-03',travelers:2,rooms:1,roomType:'twin'};
 const first=cacheTravelServices(calls,{persistent:await openResearchCache(dir)});
 await first.findHotels({place:{name:'会场',lat:31,lng:121}});await first.findStations({city:'上海'});await first.hotelOffer(q);
 const second=cacheTravelServices(calls,{persistent:await openResearchCache(dir)});
 await second.findHotels({place:{name:'会场',lat:31,lng:121}});await second.findStations({city:'上海'});await second.hotelOffer(q);await second.hotelOffer({...q,checkIn:'2026-11-04',checkOut:'2026-11-05'});
 expect(calls.findHotels).toHaveBeenCalledTimes(1);expect(calls.findStations).toHaveBeenCalledTimes(1);expect(calls.hotelOffer).toHaveBeenCalledTimes(2);
});
it('retains encrypted attempts without credentials, private notes or cached failures',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wayline-journal-'));const cache=await openResearchCache(dir);
 await expect(cache.lookup('secret query notes',async()=>{throw Error('token=private');},{kind:'rail'})).rejects.toThrow('token=private');
 const resumed=await openResearchCache(dir);expect(resumed.history()[0]).toMatchObject({kind:'rail',outcome:'failed',attempts:1});
 expect(JSON.stringify(resumed.history())).not.toContain('secret query');expect(JSON.stringify(resumed.history())).not.toContain('token=private');
 const retry=vi.fn(async()=>({candidates:[{number:'G1'}]}));await resumed.lookup('secret query notes',retry,{kind:'rail'});expect(retry).toHaveBeenCalledOnce();
 expect(resumed.history()[0]).toMatchObject({outcome:'found',attempts:2});
 const envelope=JSON.parse(await readFile(join(dir,'research.enc'),'utf8'));
 const cipher=createDecipheriv('aes-256-gcm',await readFile(join(dir,'research.key')),Buffer.from(envelope.iv,'base64'));
 cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
 const plain=Buffer.concat([cipher.update(Buffer.from(envelope.body,'base64')),cipher.final()]);
 expect(envelope.body).not.toBe(plain.toString('base64'));
 const decoded=JSON.parse(plain.toString('utf8'));
 expect(decoded.entries[0][1].value).toEqual({candidates:[{number:'G1'}]});
 expect(plain.toString('utf8')).not.toContain('secret query notes');
 expect(plain.toString('utf8')).not.toContain('token=private');
});
it('keeps generic hotel search and brand searches in separate cache entries',async()=>{
 const findHotels=vi.fn(async(q:any)=>({candidates:[{name:q.keywords||'generic'}]}));
 const svc=cacheTravelServices({findHotels});const place={name:'会场',lat:31,lng:121};
 await svc.findHotels({place});await svc.findHotels({place,keywords:'全季酒店'});await svc.findHotels({place,keywords:'全季酒店'});
 expect(findHotels).toHaveBeenCalledTimes(2);
});
it('retries mixed public results after restart instead of caching failed pages as successful research',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wayline-partial-'));const first=await openResearchCache(dir);
 await first.lookup('research',async()=>[{status:'retrieved',url:'https://example.com/a'},{status:'unavailable',url:'https://example.com/b'}]);
 const resumed=await openResearchCache(dir);expect(resumed.history()[0].outcome).toBe('partial');const run=vi.fn(async()=>[{status:'retrieved',url:'https://example.com/a'},{status:'retrieved',url:'https://example.com/b'}]);
 await resumed.lookup('research',run);await resumed.lookup('research',run);expect(run).toHaveBeenCalledOnce();
});
it('keeps successful public page bodies while retrying the failed research batch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wayline-pages-'));const cache=await openResearchCache(dir);const good=vi.fn(async()=>'<html>公开资料</html>');
 await cache.lookup('page-a',good,{kind:'publicPage'});await cache.lookup('batch',async()=>[{status:'retrieved'},{status:'unavailable'}]);
 const resumed=await openResearchCache(dir);expect(await resumed.lookup('page-a',good,{kind:'publicPage'})).toContain('公开资料');expect(good).toHaveBeenCalledOnce();
});
// @ts-expect-error server
import {researchPublicEvents} from '../../server/public-research.mjs';
it('preserves the original observation time when a successful page is reused in a partial retry',async()=>{
 const observedAt=Date.now()-60000;
 const result=await researchPublicEvents('https://example.com/a',{readPage:async()=>({html:'<title>资料</title>公开说明',observedAt})});
 expect(result[0].status).toBe('retrieved');expect(result[0].observedAt).toBe(observedAt);
});
