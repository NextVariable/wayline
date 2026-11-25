import {samePlace} from './placeIdentity';
import {isCalendarEntry,type CalendarEntry,type CalendarField} from './calendarEvents';
import type {Place} from '../types/place';

/** A source deletion sent by the sync service. The event stays cached for History but leaves active views. */
export interface SourceDeletion { id:string; updated?:string; at?:number }

const fieldValue=(entry:CalendarEntry,field:CalendarField)=>entry[field];
export const applyCalendarOverrides=(entry:CalendarEntry,old:CalendarEntry|undefined):CalendarEntry=>{
  const overrides=entry.overrides??old?.overrides;
  if(!overrides||!Object.keys(overrides).length)return entry;
  const next:CalendarEntry={...entry,overrides};
  for(const field of Object.keys(overrides) as CalendarField[]){
    const override=overrides[field]!;
    next[field]=override.value;
    if(entry[field]===override.sourceValue)continue;
    const existing=old?.sourceChange?.find(change=>change.field===field&&change.from===override.sourceValue&&change.to===entry[field]);
    next.sourceChange=[...(next.sourceChange??[]).filter(change=>change.field!==field),
      {field,from:override.sourceValue,to:entry[field],at:existing?.at??Date.now()}];
  }
  return next;
};

/** Record a field-level local edit without touching the read-only source record. */
export function overrideCalendarField(entry:CalendarEntry,field:CalendarField,value:string,at=Date.now()):CalendarEntry{
  return {...entry,[field]:value,overrides:{...entry.overrides,[field]:{value,at,sourceValue:fieldValue(entry,field)}},
    sourceChange:entry.sourceChange?.filter(change=>change.field!==field)};
}

/** Keep the local edit but drop the "source changed" notice. */
export function acknowledgeSourceChange(entry:CalendarEntry,field:CalendarField):CalendarEntry{
  return {...entry,sourceChange:entry.sourceChange?.filter(change=>change.field!==field)};
}

/** Adopt the current source value for one field and remove its local override. */
export function adoptSourceField(entry:CalendarEntry,field:CalendarField):CalendarEntry{
  const change=entry.sourceChange?.find(item=>item.field===field);
  const overrides={...entry.overrides};
  delete overrides[field];
  const sourceChange=entry.sourceChange?.filter(item=>item.field!==field);
  const next:CalendarEntry={...entry,[field]:change?change.to:fieldValue(entry,field)};
  if(Object.keys(overrides).length)next.overrides=overrides;else delete next.overrides;
  if(sourceChange?.length)next.sourceChange=sourceChange;else delete next.sourceChange;
  return next;
}

/**
 * Mark an imported event deleted. A user deletion suppresses the same source key until an explicit
 * re-import; a source deletion can only be revived by a newer source revision.
 */
export function suppressCalendarEntry(entry:CalendarEntry,by:"user"|"source"="user",at=new Date().toISOString()):CalendarEntry{
  return {...entry,google:entry.google&&{...entry.google,deletedAt:at,deletedBy:by}};
}

/** One Google connection per workspace. Replace its managed cache, retaining file/manual events and local edits. */
export function mergeGoogleSnapshot(previous:CalendarEntry[],incoming:unknown,connectionId:string,deleted:SourceDeletion[]=[]):CalendarEntry[]{
  if(!Array.isArray(incoming) || incoming.length>5000 || !incoming.every(e=>isCalendarEntry(e)&&e.google?.connectionId===connectionId))throw new Error('Google 日历结果不完整，保留原记录');
  if(!Array.isArray(deleted)||deleted.length>5000||!deleted.every(item=>item&&typeof item.id==='string'))throw new Error('Google 日历删除记录不完整，保留原记录');
  if (new Set(incoming.map(event => event.id)).size !== incoming.length)
    throw new Error('Google 日历返回了重复标识，保留原记录');
  const byId=new Map(previous.map(e=>[e.id,e]));
  const tombstones=new Map(deleted.map(item=>[item.id,item]));
  const previousGoogle=previous.filter(event=>event.google?.connectionId===connectionId);
  const sourceKey=(event:CalendarEntry)=>event.google?`${event.google.calendarId}:${event.google.eventId}`:"";
  // A user removal follows the source event, not the connection id, so reconnecting cannot resurrect it.
  const userDeleted=new Map(previous.filter(event=>event.google?.deletedBy==="user").map(event=>[sourceKey(event),event]));
  const next=(incoming as CalendarEntry[]).flatMap(source=>{
    const old=byId.get(source.id);
    const suppressed=old?.google?.deletedBy==="user"?old:userDeleted.get(sourceKey(source));
    if(suppressed)return [suppressed];
    const tombstone=tombstones.get(source.id);
    if(tombstone){
      const stamped=tombstone.updated??new Date(tombstone.at??Date.now()).toISOString();
      const base=old??source;
      return [{...base,google:{...base.google!,deletedAt:old?.google?.deletedAt??stamped,deletedBy:'source' as const}}];
    }
    if(old?.google?.deletedBy==='user')return [old];
    if(old?.google?.deletedAt){      // A source deletion only yields to a strictly newer source revision.
      if(!source.google||Date.parse(source.google.updated)<=Date.parse(old.google.deletedAt))return [old];
    }
    if(old?.google&&Date.parse(old.google.updated)>Date.parse(source.google?.updated??''))return [old];
    // A confirmed local place is a field-level override: keep it when the source address changes.
    const confirmedLocation=!!old&&old.location!==source.location&&old.placeResolution?.status==="confirmed"&&!!old.place&&!old.overrides?.location;
    const override=confirmedLocation
      ? {...old!.overrides,location:{value:old!.location,at:Date.now(),sourceValue:old!.location}}
      : old?.overrides?.location;
    const same=old?.location===source.location||!!override;
    const merged=applyCalendarOverrides({...source,
      place:same?old?.place:undefined,
      placeResolution:same?old?.placeResolution:undefined,
      routeIndex:old?.routeIndex,
      routeReason:old?.routeReason,
      ...(confirmedLocation&&{overrides:{...old!.overrides,location:{value:old!.location,at:Date.now(),sourceValue:old!.location}}})},old);
    return [merged];
  });
  // Deleted source records stay cached for History even though the provider no longer returns them.
  const kept=previousGoogle.filter(event=>!next.some(item=>item.id===event.id)&&(event.google?.deletedAt||tombstones.has(event.id)))
    .map(event=>{
      const tombstone=tombstones.get(event.id);
      if(!tombstone||event.google?.deletedAt)return event;
      return {...event,google:{...event.google!,deletedAt:tombstone.updated??new Date(tombstone.at??Date.now()).toISOString(),deletedBy:'source' as const}};
    });
  if(previous.filter(e=>!e.google).length+next.length+kept.length>7000)throw new Error('日历事件过多，保留原记录');
  return [...previous.filter(e=>!e.google),...next,...kept].sort((a,b)=>a.start.localeCompare(b.start));
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
