import type { Place } from "../types/place";
import { isStoredPlace } from "./placeValidation";
import {samePlace} from './placeIdentity';
export interface CalendarEntry {
  id:string; uid:string; title:string; location:string; description:string;
  start:string; end:string; allDay:boolean; timezone:string; calendar:string;
  place?:Place;
  placeResolution?:PlaceResolution;
  routeIndex?:number;
  routeReason?:string;
  google?:{connectionId:string;calendarId:string;eventId:string;updated:string;originalStart:string|null;stale?:boolean};
  /** Set only on events derived in memory from a Wayline schedule, never on synced calendar data. */
  local?:{source:"schedule";origin:"manual"|"intake";sourcePlaceId:string;endPending:boolean};
}
export type PlaceResolutionStatus="auto"|"confirmed"|"ask"|"ambiguous"|"none"|"missing"|"online"|"ignored";
export interface PlaceResolution { status:PlaceResolutionStatus; text:string; suggestion?:Place; candidates?:Place[] }
const RESOLUTION_STATUSES:PlaceResolutionStatus[]=["auto","confirmed","ask","ambiguous","none","missing","online","ignored"];
export function isPlaceResolution(value:unknown):value is PlaceResolution{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const r=value as PlaceResolution;
  return RESOLUTION_STATUSES.includes(r.status)&&typeof r.text==="string"&&r.text.length<=12000&&(r.suggestion===undefined||isStoredPlace(r.suggestion))&&(r.candidates===undefined||Array.isArray(r.candidates)&&r.candidates.length<=5&&r.candidates.every(isStoredPlace));
}
export const calendarKey=(owner:string)=>`whatto.calendarEvents.${owner}`;
export function isCalendarEntry(value:unknown):value is CalendarEntry {
  if(!value || typeof value!=="object")return false;
  const e=value as CalendarEntry;
  return [e.id,e.uid,e.title,e.location,e.description,e.start,e.end,e.timezone,e.calendar].every(v=>typeof v==="string"&&v.length<=12000) && !!e.id && !!e.title && typeof e.allDay==="boolean" && Number.isFinite(Date.parse(e.start)) && Number.isFinite(Date.parse(e.end)) && Date.parse(e.end)>=Date.parse(e.start) && (e.place===undefined || isStoredPlace(e.place)) && (e.placeResolution===undefined || isPlaceResolution(e.placeResolution)) && (e.routeReason===undefined || typeof e.routeReason==="string") && (e.routeIndex===undefined || Number.isInteger(e.routeIndex)&&e.routeIndex>=0&&e.routeIndex<1000) && (e.google===undefined || !!e.google && [e.google.connectionId,e.google.calendarId,e.google.eventId,e.google.updated].every(v=>typeof v==="string"&&v.length<12000) && (e.google.originalStart===null||typeof e.google.originalStart==="string") && (e.google.stale===undefined||typeof e.google.stale==="boolean"));
}
export function readCalendarEntries(owner:string):CalendarEntry[]{
  try{const rows=JSON.parse(localStorage.getItem(calendarKey(owner))??"[]");return Array.isArray(rows)?rows.filter(isCalendarEntry).slice(0,7000):[];}catch{return [];}
}
export function mergeCalendarEntries(previous:CalendarEntry[], incoming:CalendarEntry[]) {
  const rows=new Map(previous.map(e=>[e.id,e]));
  for(const e of incoming){if(!isCalendarEntry(e))throw new Error("日历事件格式无效");const old=rows.get(e.id);const same=old?.location===e.location;rows.set(e.id,{...e,place:e.place??(same?old?.place:undefined),placeResolution:e.placeResolution??(same?old?.placeResolution:undefined)});}
  if(rows.size>7000)throw new Error("最多保留 7000 条日历事件，请先移除旧事件");
  return [...rows.values()].sort((a,b)=>a.start.localeCompare(b.start));
}
export function calendarContext(events:CalendarEntry[], date:string, days:number){
  const from=new Date(date+"T00:00:00"),to=new Date(from);to.setDate(to.getDate()+days);
  const epoch=(value:string,allDay:boolean)=>Date.parse(allDay?value+"T00:00:00":value);
  return events.filter(e=>epoch(e.start,e.allDay)<to.getTime() && (e.end>e.start?epoch(e.end,e.allDay)>from.getTime():epoch(e.end,e.allDay)>=from.getTime())).map(e=>
    `日历事件${e.google?.stale?"（同步暂停，旧安排待核对）":""}：${e.title}；${e.allDay?`全天 ${e.start} 至 ${e.end}（结束日期不包含）`:`${new Date(e.start).toLocaleString("zh-CN")} 至 ${new Date(e.end).toLocaleString("zh-CN")}`}；地点：${e.place?.address || e.location || "未提供，不能假定为线下活动"}；${e.allDay?"全天事件不能当作固定会议时刻。":"以事件起止时间为约束。"}${e.description?`备注：${e.description}`:""}`);
}
export function plannerCommitments(events:CalendarEntry[],places:Place[],date:string,days:number){
  const from=Date.parse(date+'T00:00:00+08:00'),through=from+days*86400000;
  return events.flatMap(e=>{
    if(e.allDay||e.google?.stale||!e.place||Date.parse(e.start)<from||Date.parse(e.end)>through)return [];
    const place_index=places.findIndex(p=>p.calendarEventIds?.includes(e.id)||samePlace(p,e.place!));
    return place_index>=0?[{place_index,start:e.start,end:e.end}]:[];
  }).slice(0,80);
}
