import {expect,it} from 'vitest';
import {tripWindowFromText} from '../lib/quickIntent';
import {plannerCommitments} from '../lib/calendarEvents';
it('recognizes a multi-day trip from explicit dates without asking for the departure date again',()=>{
 expect(tripWindowFromText('11月2日开会，2026年11月3日返程',new Date('2026-10-30T12:00:00+08:00'))).toEqual({date:'2026-11-02',days:2});
 expect(tripWindowFromText('2026-11-02 开会；2026-11-03 参会',new Date('2026-10-30'))).toEqual({date:'2026-11-02',days:2});
});
it('does not reinterpret invalid or out-of-scope dates as a valid week',()=>{
 expect(tripWindowFromText('2026-02-30开会')).toBeNull();expect(tripWindowFromText('2026-11-02和2026-12-30')).toBeNull();
});
it('passes fresh matched timed calendar commitments as structured original times and excludes unrelated or cancelled old snapshots',()=>{
 const place:any={id:'p',name:'会场甲',city:'上海',lat:31,lng:121,tags:[]};
 const e:any={id:'e',place,start:'2026-11-02T02:00:00Z',end:'2026-11-02T04:00:00Z',allDay:false};
 const rows=plannerCommitments([e,{...e,id:'stale',google:{stale:true}},{...e,id:'all',allDay:true},{...e,id:'other',place:{...place,name:'会场乙',id:'other'}},{...e,id:'outside',start:'2026-12-02T02:00:00Z',end:'2026-12-02T04:00:00Z'}],[place],'2026-11-02',2);
 expect(rows).toEqual([{place_index:0,start:e.start,end:e.end}]);
});
