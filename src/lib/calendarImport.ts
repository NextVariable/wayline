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
export interface CalendarFilePreview {
  events: CalendarEntry[];
  warnings: string[];
  readCount: number;
  outside: number;
  skipped: number;
  fileDuplicates: number;
  recurrenceThrough: string | null;
}

export function parseCalendarFile(text:string, from = "", through = "", today = new Date()):CalendarFilePreview {
  if(text.length>2_000_000)throw new Error("日历文件超过 2MB，请按日历分别导出");
  const validDay = (day: string) => !day || /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day));
  if (!validDay(from) || !validDay(through) || from && through && from > through) throw new Error("请选择有效的日期范围");
  const lower = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
  const lastDay = through ? new Date(through + "T00:00:00") : null;
  if (lastDay) lastDay.setDate(lastDay.getDate() + 1);
  const upper = lastDay?.getTime() ?? Infinity;
  if (Number.isFinite(lower) && Number.isFinite(upper) && upper - lower > 367 * 86400000)
    throw new Error("指定起止日期时，一次最多选择一年");
  const recurringUntil = new Date(today);
  recurringUntil.setDate(recurringUntil.getDate() + 90);
  const recurrenceLimit = new Date(recurringUntil);
  recurrenceLimit.setHours(24, 0, 0, 0);
  const recurrenceStartLimit = through ? upper : recurrenceLimit.getTime();
  const outsideWindow = (start: string, end: string, allDay: boolean) => allDay
    ? !!(through && start > through || from && (end > start ? end <= from : start < from))
    : Date.parse(start) >= upper || (Date.parse(end) > Date.parse(start) ? Date.parse(end) <= lower : Date.parse(end) < lower);
  let root:InstanceType<typeof ICAL.Component>;
  try{root=new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/,"")));}catch{throw new Error("无法读取日历，请选择 Google 或 Apple 导出的 .ics 文件");}
  if(root.name!=="vcalendar")throw new Error("不是有效的日历文件");
  if(String(root.getFirstPropertyValue("method")).toUpperCase()==="CANCEL")throw new Error("这是取消通知，请在原日历确认变更；不会自动删除已有事件");
  const components=root.getAllSubcomponents("vevent");if(components.length>2000)throw new Error("事件过多，请缩小导出范围");
  const events:CalendarEntry[]=[],warnings:string[]=[];
  const replaced = new Set<string>();let iterations=0, outside=0, cancelled=0;
  let recurrenceCapped=false;
  const calendar=String(root.getFirstPropertyValue("x-wr-calname")||"导入的日历");
  for(const component of components){
    if(component.hasProperty("recurrence-id"))continue;
    const name=String(component.getFirstPropertyValue("summary")||"未命名事件");
    if(String(component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED"){cancelled++;continue;}
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
        // Open-ended series use a visible horizon. Single events never inherit it.
        if (event.isRecurring() && Date.parse(stamp(occurrence,component,"dtstart").value) >= recurrenceStartLimit) {
          if (through) outside++;
          else recurrenceCapped = true;
          break;
        }
        if(String(item.component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED"){cancelled++;continue;}
        if (outsideWindow(start.value, end.value, detail.startDate.isDate)) { outside++; continue; }
        if(Date.parse(end.value)<Date.parse(start.value))throw new Error("结束时间早于开始时间");
        events.push({id:`ical:${encodeURIComponent(uid)}:${event.isRecurring() ? occurrence.toString() : "single"}`,uid,title:item.summary||name,location:item.location||"",description:item.description||"",start:start.value,end:end.value,allDay:detail.startDate.isDate,timezone:start.zone,calendar});
        if(events.length>500)throw new Error("范围内超过 500 条事件，请缩小导入日期");
        if(count===19999)throw new Error("重复规则过多，请缩小日历文件范围");
      }
    }catch(e){warnings.push(`${name}：${e instanceof Error?e.message:"无法识别事件"}`);}
  }
  // Detached or moved overrides may have an original recurrence outside the import window.
  for(const component of components.filter(c=>c.hasProperty("recurrence-id"))){
    if(String(component.getFirstPropertyValue("status")).toUpperCase()==="CANCELLED"){cancelled++;continue;}
    try{
      const item=new ICAL.Event(component);if(!item.uid||!component.hasProperty("dtstart"))throw new Error("缺少开始时间或事件标识");
      const start=stamp(item.startDate,component,"dtstart"),end=stamp(item.endDate,component,"dtend");
      if(outsideWindow(start.value, end.value, item.startDate.isDate)){outside++; continue;}
      if(Date.parse(end.value)<Date.parse(start.value))throw new Error("结束时间早于开始时间");
      const recurrence=component.getFirstPropertyValue("recurrence-id") as Time;
      const id = `ical:${encodeURIComponent(item.uid)}:${recurrence.toString()}`;
      if (events.some(entry => entry.id === id)) replaced.add(id);
      events.push({id,uid:item.uid,title:item.summary||"未命名事件",location:item.location||"",description:item.description||"",start:start.value,end:end.value,allDay:item.startDate.isDate,timezone:start.zone,calendar});
    }catch(e){warnings.push(`重复事件变更：${e instanceof Error?e.message:"无法识别"}`);}
  }
  // Fail closed on resource limits rather than silently presenting an incomplete recurrence series.
  if(iterations>50000 || events.length>500 || warnings.some(w=>/重复规则过多/.test(w)))throw new Error("日历重复规则或事件数量过多，请缩小文件或日期范围");
  const unique = new Map(events.map(e=>[e.id,e]));
  const recurrenceThrough = recurrenceCapped
    ? `${recurringUntil.getFullYear()}-${String(recurringUntil.getMonth() + 1).padStart(2, "0")}-${String(recurringUntil.getDate()).padStart(2, "0")}`
    : null;
  return {
    events:[...unique.values()].sort((a,b)=>a.start.localeCompare(b.start)), warnings,
    readCount: components.length, outside, skipped: warnings.length + cancelled,
    fileDuplicates: events.length - unique.size - replaced.size, recurrenceThrough,
  };
}
