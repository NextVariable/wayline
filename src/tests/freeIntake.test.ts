import {expect,it} from 'vitest';
// @ts-expect-error server module
import {extractFreeBrief,extractPlaceCandidates} from '../../server/free-intake.mjs';
const body={date:'2026-11-02',dateConfirmed:true,days:2,places:[{name:'国家会展中心(上海)',city:'上海',lat:31.18,lng:121.29}],notes:'从苏州的苏州站出发。2026-11-02 国家会展中心(上海)10:00至17:00会面；2026-11-03 国家会展中心(上海)10:00至12:00会面。两人一间双床，没有已订项目。先放行李，返程最晚20:00回到苏州站。'};
it('does not invent a meeting end from an unrelated dinner or return time',()=>{
 const b={...body,notes:'2026-11-02 国家会展中心(上海)10:00开会。晚上18:00吃饭。返程最晚20:00。'};
 const e=extractFreeBrief(b).events[0];expect(e.start).toContain('T10:00');expect(e.end).toBeUndefined();
});
it('binds Chinese dated and relative-day ranges to the named venue',()=>{
 const b={...body,notes:'2026年11月2日 国家会展中心(上海)下午三点至下午五点开会；第二天 国家会展中心(上海)10:00-12:00会面。'};
 const raw=extractFreeBrief(b);expect(raw.events[0].start).toBe('2026-11-02T15:00:00+08:00');expect(raw.events[1].start).toBe('2026-11-03T10:00:00+08:00');
});
it('does not turn ambiguous morning/afternoon or unconfirmed dates into a time commitment',()=>{
 expect(extractFreeBrief({...body,notes:'国家会展中心(上海)三点开会'}).events[0].start).toBeUndefined();
 expect(extractFreeBrief({...body,dateConfirmed:false}).events.every((e:any)=>!e.start&&!e.end)).toBe(true);
});
it('discovers an explicitly public activity name, without treating a customer meeting as public',()=>{
 const raw=extractFreeBrief({...body,notes:'第二天在国家会展中心(上海)参加中国国际进口博览会，公开活动时间请查询。'});
 expect(raw.events[0]).toMatchObject({private:false,public_event:{name:'中国国际进口博览会'}});
 expect(extractFreeBrief(body).events.every((e:any)=>e.private!==false)).toBe(true);
});
it('never fabricates coordinates or certainty while extracting place names',()=>{
 const rows=extractPlaceCandidates('明天去上海国家会展中心开会，住一晚，从虹桥返程。','苏州');
 expect(rows).toContainEqual(expect.objectContaining({name:'国家会展中心',city:'上海'}));
 expect(rows.every((p:any)=>p.lat===undefined&&p.lng===undefined&&p.isMatched!==true)).toBe(true);
});
it('rejects invalid calendar dates, missing offsets and negative place indices',()=>{
 for(const entry of [{place_index:0,start:'2026-02-30T10:00:00+08:00',end:'2026-02-30T12:00:00+08:00'},{place_index:0,start:'2026-11-02T10:00:00',end:'2026-11-02T12:00:00'},{place_index:-1,start:'2026-11-02T10:00:00Z',end:'2026-11-02T12:00:00Z'}])expect(extractFreeBrief({...body,notes:'',commitments:[entry]}).events[0].start).toBeUndefined();
});
it('rejects a nonexistent calendar day even when JavaScript normalizes it inside the trip window',()=>{
 const b={...body,date:'2026-02-28',days:3,notes:'',commitments:[{place_index:0,start:'2026-02-30T10:00:00+08:00',end:'2026-02-30T12:00:00+08:00'}]};
 expect(extractFreeBrief(b).events[0].start).toBeUndefined();
});
