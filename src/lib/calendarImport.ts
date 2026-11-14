import ICAL from "ical.js";
import type { CalendarEntry } from "./calendarEvents";
type Time=InstanceType<typeof ICAL.Time>;
function stamp(t:Time, component:InstanceType<typeof ICAL.Component>, property:string):{value:string;zone:string}{
  if(t.isDate)return {value:t.toString().slice(0,10),zone:"全天"};
  const raw=(component.getFirstProperty(property) ?? component.getFirstProperty("dtstart"))?.getParameter("tzid");
  const zone=typeof raw==="string"?raw:t.zone.tzid;
  if(zone && zone!=="floating" && zone!=="local" && t.zone.tzid==="floating"){
    // The file omitted VTIMEZONE. Use IANA rules when the identifier is supported.
    const formatter=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    const wall=Date.UTC(t.year,t.month-1,t.day,t.hour,t.minute,t.second);
    let instant=wall;
    for(let i=0;i<4;i++){
      const parts=Object.fromEntries(formatter.formatToParts(instant).map(p=>[p.type,p.value]));
      const represented=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
      const delta=wall-represented;if(!delta)return {value:new Date(instant).toISOString(),zone};instant+=delta;
    }
    throw new Error("事件所在时区的时刻无效");
  }
  if(zone==="floating" || zone==="local")return {value:new Date(t.year,t.month-1,t.day,t.hour,t.minute,t.second).toISOString(),zone:"本地时间（源未指定时区）"};
  return {value:t.toJSDate().toISOString(),zone:zone==="floating"?"本地时间（源未指定时区）":zone};
}
export function parseCalendarFile(text:string, from:string, through:string):{events:CalendarEntry[];warnings:string[]}{
  if(text.length>2_000_000)throw new Error("日历文件超过 2MB，请按日历分别导出");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(through)||from>through)throw new Error("请选择有效的日期范围");
  const lower=new Date(from+"T00:00:00").getTime(),upperDate=new Date(through+"T00:00:00");upperDate.setDate(upperDate.getDate()+1);const upper=upperDate.getTime();
  if(!Number.isFinite(lower)||!Number.isFinite(upper)||upper-lower>367*86400000)throw new Error("一次最多导入一年内的事件");
  let root:InstanceType<typeof ICAL.Component>;
  try{root=new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/,"")));}catch{throw new Error("无法读取日历，请选择 Google 或 Apple 导出的 .ics 文件");}
  if(root.name!=="vcalendar")throw new Error("不是有效的日历文件");
  if(String(root.getFirstPropertyValue("method")).toUpperCase()==="CANCEL")throw new Error("这是取消通知，请在原日历确认变更；不会自动删除已有事件");
  const components=root.getAllSubcomponents("vevent");if(components.length>2000)throw new Error("事件过多，请缩小导出范围");
  const events:CalendarEntry[]=[],warnings:string[]=[];let iterations=0;
  const calendar=String(root.getFirstPropertyValue("x-wr-calname")||"导入的日历");
  for(const component of components){
    if(component.hasProperty("recurrence-id"))continue;
    const name=String(component.getFirstPropertyValue("summary")||"未命名事件");
    if(String(component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED")continue;
    try{
      if(!component.hasProperty("dtstart"))throw new Error("缺少开始时间");
      const event=new ICAL.Event(component);const uid=event.uid;
      if(!uid)throw new Error("缺少事件标识，无法防止重复导入");
      const iterator=event.iterator();
      for(let count=0;count<20000;count++){
        if(++iterations>50000)throw new Error("重复规则过多，请缩小日历文件范围");
        const occurrence=iterator.next();if(!occurrence)break;
        const detail=event.getOccurrenceDetails(occurrence),item=detail.item;
        const start=stamp(detail.startDate,item.component,"dtstart"),end=stamp(detail.endDate,item.component,"dtend");
        if(Date.parse(start.value)>=upper && !event.isRecurring())break;
        // An overridden occurrence can move across the window; stop on the original recurrence only.
        if(Date.parse(stamp(occurrence,component,"dtstart").value)>=upper)break;
        if(String(item.component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED")continue;
        if(detail.startDate.isDate ? (start.value>through || (end.value>start.value ? end.value<=from : start.value<from)) : (Date.parse(start.value)>=upper || (Date.parse(end.value)>Date.parse(start.value)?Date.parse(end.value)<=lower:Date.parse(end.value)<lower)))continue;
        if(Date.parse(end.value)<Date.parse(start.value))throw new Error("结束时间早于开始时间");
        events.push({id:`ical:${encodeURIComponent(uid)}:${occurrence.toString()}`,uid,title:item.summary||name,location:item.location||"",description:item.description||"",start:start.value,end:end.value,allDay:detail.startDate.isDate,timezone:start.zone,calendar});
        if(events.length>500)throw new Error("范围内超过 500 条事件，请缩小导入日期");
        if(count===19999)throw new Error("重复规则过多，请缩小日历文件范围");
      }
    }catch(e){warnings.push(`${name}：${e instanceof Error?e.message:"无法识别事件"}`);}
  }
  // Detached or moved overrides may have an original recurrence outside the import window.
  for(const component of components.filter(c=>c.hasProperty("recurrence-id"))){
    if(String(component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED")continue;
    try{
      const item=new ICAL.Event(component);if(!item.uid||!component.hasProperty("dtstart"))continue;
      const start=stamp(item.startDate,component,"dtstart"),end=stamp(item.endDate,component,"dtend");
      if(item.startDate.isDate ? (start.value>through || (end.value>start.value?end.value<=from:start.value<from)) : (Date.parse(start.value)>=upper || (Date.parse(end.value)>Date.parse(start.value)?Date.parse(end.value)<=lower:Date.parse(end.value)<lower)))continue;
      const recurrence=component.getFirstPropertyValue("recurrence-id") as Time;
      events.push({id:`ical:${encodeURIComponent(item.uid)}:${recurrence.toString()}`,uid:item.uid,title:item.summary||"未命名事件",location:item.location||"",description:item.description||"",start:start.value,end:end.value,allDay:item.startDate.isDate,timezone:start.zone,calendar});
    }catch(e){warnings.push(`重复事件变更：${e instanceof Error?e.message:"无法识别"}`);}
  }
  // Fail closed on resource limits rather than silently presenting an incomplete recurrence series.
  if(iterations>50000 || events.length>500 || warnings.some(w=>/重复规则过多/.test(w)))throw new Error("日历重复规则或事件数量过多，请缩小文件或日期范围");
  return {events:[...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>a.start.localeCompare(b.start)),warnings};
}
