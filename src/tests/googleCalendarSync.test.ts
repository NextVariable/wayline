import {it,expect,vi} from 'vitest';
import {mergeGoogleSnapshot,reconcileCalendarRoute,persistCalendarState} from '../lib/googleCalendarSync';
import {calendarContext,readCalendarEntries,type CalendarEntry} from '../lib/calendarEvents';
import {initialUserPlaces} from './fixtures/userPlaces';
const place={...initialUserPlaces[0],id:'old',name:'上海虹桥站',city:'上海',lat:31.19,lng:121.32,reason:'自己的备注'};
const updated={...place,id:'new',name:'上海国家会展中心',address:'上海市崧泽大道333号',lat:31.18,lng:121.30,reason:''};
const event=(patch:Partial<CalendarEntry>={}):CalendarEntry=>({id:'google:connection:work:meeting',uid:'meeting',title:'会议',location:place.name,description:'会议资料',start:'2026-10-30T01:00:00.000Z',end:'2026-10-30T02:00:00.000Z',allDay:false,timezone:'Asia/Shanghai',calendar:'工作',google:{connectionId:'connection',calendarId:'work',eventId:'meeting',updated:'now',originalStart:null},...patch});
it('replaces the Google snapshot including cancellations, retaining file events and local place binding',()=>{
 const previous=[event({place}),{...event(),id:'file',google:undefined}];
 const next=mergeGoogleSnapshot(previous,[event({start:'2026-10-31T01:00:00.000Z',end:'2026-10-31T02:00:00.000Z'})],'connection');
 expect(next).toHaveLength(2);expect(next.find(e=>e.google)?.place).toEqual(place);
 expect(mergeGoogleSnapshot(next,[],'connection').map(e=>e.id)).toEqual(['file']);
});
it('drops old connection duplicates when reconnecting from another browser session',()=>{
 const prior=event({google:{...event().google!,connectionId:'old'}});expect(mergeGoogleSnapshot([prior],[event()],'connection')).toHaveLength(1);
});
it('rejects an invalid or foreign-connection snapshot without mutating existing data',()=>{
 const previous=[event({place})];expect(()=>mergeGoogleSnapshot(previous,[{...event(),google:{...event().google!,connectionId:'other'}}],'connection')).toThrow();expect(()=>mergeGoogleSnapshot(previous,[null],'connection')).toThrow();expect(previous[0].place).toEqual(place);
});
it('clears old coordinates as soon as the source location changes',()=>{
 const next=mergeGoogleSnapshot([event({place})],[event({location:updated.name})],'connection');expect(next[0].place).toBeUndefined();
 const route=reconcileCalendarRoute([{...place,calendarEventIds:[event().id]}],[event({place})],next);
 expect(route.route).toEqual([]);expect(route.events[0].routeIndex).toBe(0);expect(calendarContext(route.events,'2026-10-30',1)[0]).toContain(updated.name);expect(calendarContext(route.events,'2026-10-30',1)[0]).not.toContain(place.address);
});
it('restores a confirmed new place to its pending route order, keeping personal notes',()=>{
 const tagged={...place,calendarEventIds:[event().id]};const next=reconcileCalendarRoute([tagged],[event({place})],[event({location:updated.name,place:updated})]);expect(next.route[0].name).toBe(updated.name);expect(next.route[0].reason).toBe('自己的备注');
 const pending=event({location:updated.name,routeIndex:0,place:updated});const restored=reconcileCalendarRoute([],[],[pending]);expect(restored.route[0].name).toBe(updated.name);expect(restored.events[0].routeIndex).toBeUndefined();
});
it('removes only automatically associated route stops on cancellation',()=>{
 const manual={...place,id:'manual'};const tagged={...updated,calendarEventIds:[event().id]};const next=reconcileCalendarRoute([manual,tagged],[event({place:updated})],[]);expect(next.route).toEqual([manual]);
});
it('keeps a shared stop when one of its associated meetings is cancelled',()=>{
 const second=event({id:'second',place});const next=reconcileCalendarRoute([{...place,calendarEventIds:[event().id,'second']}],[event({place}),second],[second]);expect(next.route).toHaveLength(1);expect(next.route[0].calendarEventIds).toEqual(['second']);
});
it('rolls back local calendar changes if route persistence fails',()=>{
 const values=new Map([['whatto.calendarEvents.guest','old-events'],['whatto.tripDraft.guest','old-route']]);let writes=0;
 const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{if(++writes===2)throw new Error('quota');values.set(k,v);},removeItem:(k:string)=>values.delete(k)} as unknown as Storage;
 expect(()=>persistCalendarState('guest',[event()],[],storage)).toThrow('尚未保存');expect(values.get('whatto.calendarEvents.guest')).toBe('old-events');expect(values.get('whatto.tripDraft.guest')).toBe('old-route');
});
it('changes the planner input when an event is moved or cancelled',()=>{
 const previous=calendarContext([event()],'2026-10-30',1);const moved=calendarContext([event({start:'2026-10-30T03:00:00.000Z',end:'2026-10-30T04:00:00.000Z'})],'2026-10-30',1);expect(moved).not.toEqual(previous);expect(calendarContext([],'2026-10-30',1)).not.toEqual(previous);
});

it('preserves route notes across an unresolved address and later confirmation',()=>{
 const original=event({place});const pending=reconcileCalendarRoute([{...place,calendarEventIds:[original.id]}],[original],[event({location:updated.name})]);
 const polled=mergeGoogleSnapshot(pending.events,[event({location:updated.name})],'connection');
 const restored=reconcileCalendarRoute([],pending.events,[{...polled[0],place:updated}]);expect(restored.route[0].reason).toBe('自己的备注');expect(restored.events[0].routeReason).toBeUndefined();
});
it('keeps a Google snapshot larger than the old file-import limit after refresh',()=>{
 const rows=Array.from({length:2100},(_,i)=>event({id:'event-'+i}));vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify(rows)});try{expect(readCalendarEntries('guest')).toHaveLength(2100);}finally{vi.unstubAllGlobals();}
});
