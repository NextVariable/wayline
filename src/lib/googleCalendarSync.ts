import {samePlace} from './placeIdentity';
import {isCalendarEntry,type CalendarEntry} from './calendarEvents';
import type {Place} from '../types/place';
/** One Google connection per workspace. Replace its managed cache, retaining file/manual events. */
export function mergeGoogleSnapshot(previous:CalendarEntry[],incoming:unknown,connectionId:string):CalendarEntry[]{
  if(!Array.isArray(incoming) || incoming.length>5000 || !incoming.every(e=>isCalendarEntry(e)&&e.google?.connectionId===connectionId))throw new Error('Google 日历结果不完整，保留原记录');
  const byId=new Map(previous.map(e=>[e.id,e]));
  const next=(incoming as CalendarEntry[]).map(e=>{const old=byId.get(e.id);const same=old?.location===e.location;return {...e,place:same?old?.place:undefined,placeResolution:same?old?.placeResolution:undefined,routeIndex:old?.routeIndex,routeReason:old?.routeReason};});
  if(previous.filter(e=>!e.google).length+next.length>7000)throw new Error('日历事件过多，保留原记录');
  return [...previous.filter(e=>!e.google),...next].sort((a,b)=>a.start.localeCompare(b.start));
}
export function reconcileCalendarRoute(route:Place[],previous:CalendarEntry[],next:CalendarEntry[]){
  const events=next.map(e=>({...e})),byId=new Map(events.map(e=>[e.id,e]));const result:Place[]=[];
  const put=(place:Place,ids:string[])=>{
    const existing=result.find(p=>samePlace(p,place));
    if(existing){if(existing.calendarEventIds)existing.calendarEventIds=Array.from(new Set([...existing.calendarEventIds,...ids]));return;}
    result.push({...place,calendarEventIds:ids});
  };
  route.forEach((stop,index)=>{
    if(!stop.calendarEventIds?.length){result.push(stop);return;}
    for(const id of stop.calendarEventIds){const e=byId.get(id);if(!e)continue;if(!e.place){e.routeIndex=index;e.routeReason=stop.reason;continue;}put({...e.place,reason:stop.reason},[id]);delete e.routeIndex;delete e.routeReason;}
  });
  for(const e of events.filter(e=>e.routeIndex!==undefined&&e.place).sort((a,b)=>a.routeIndex!-b.routeIndex!)){
    const existing=result.find(p=>samePlace(p,e.place!));
    if(existing){if(existing.calendarEventIds)existing.calendarEventIds=Array.from(new Set([...existing.calendarEventIds,e.id]));}
    else result.splice(Math.min(e.routeIndex!,result.length),0,{...e.place!,reason:e.routeReason??e.place!.reason,calendarEventIds:[e.id]});delete e.routeIndex;delete e.routeReason;
  }
  return {events,route:result};
}
/** Keep calendar data and its automatically managed stops consistent on storage failure. */
export function persistCalendarState(owner:string,events:CalendarEntry[],route:Place[],storage:Storage=localStorage){
  const keys=[`whatto.calendarEvents.${owner}`,`whatto.tripDraft.${owner}`],old=keys.map(key=>storage.getItem(key));
  try{storage.setItem(keys[0],JSON.stringify(events));storage.setItem(keys[1],JSON.stringify(route));}
  catch{keys.forEach((key,i)=>{try{if(old[i]===null)storage.removeItem(key);else storage.setItem(key,old[i]!);}catch{/* Report failure; never report a successful sync. */}});throw new Error('本机空间不足，日历更新尚未保存，请清理后重试');}
}
