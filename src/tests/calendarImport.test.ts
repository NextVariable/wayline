import { describe,it,expect } from "vitest";
import { parseCalendarFile } from "../lib/calendarImport";
import { mergeCalendarEntries,calendarContext } from "../lib/calendarEvents";
const wrap=(...rows:string[])=>['BEGIN:VCALENDAR','VERSION:2.0',...rows,'END:VCALENDAR'].join('\r\n');
const event=(body:string)=>'BEGIN:VEVENT\r\n'+body+'\r\nEND:VEVENT';
const read=(text:string)=>parseCalendarFile(text,'2026-10-29','2026-11-02');
describe('Google and Apple calendar import',()=>{
 it('preserves title, unescaped location, notes and timed duration without invented coordinates',()=>{
  const e=read(wrap(event('UID:meeting\r\nSUMMARY:客户会议\r\nLOCATION:上海虹桥站\\, 二层\r\nDESCRIPTION:带合同\\n双人会议\r\nDTSTART;TZID=Asia/Shanghai:20261030T090000\r\nDTEND;TZID=Asia/Shanghai:20261030T103000'))).events[0];
  expect(e.start).toBe('2026-10-30T01:00:00.000Z');expect(e.end).toBe('2026-10-30T02:30:00.000Z');expect(e.location).toBe('上海虹桥站, 二层');expect(e.description).toContain('\n');expect(e.place).toBeUndefined();
 });
 it('handles IANA daylight saving time even when VTIMEZONE was omitted',()=>{
  const result=parseCalendarFile(wrap(event('UID:ny\r\nSUMMARY:NY\r\nDTSTART;TZID=America/New_York:20260701T090000\r\nDTEND;TZID=America/New_York:20260701T100000')),'2026-07-01','2026-07-01');
  expect(result.events[0].start).toBe('2026-07-01T13:00:00.000Z');
 });
 it('keeps UTC and floating times distinct',()=>{
  const result=read(wrap(event('UID:z\r\nSUMMARY:UTC\r\nDTSTART:20261030T010000Z\r\nDTEND:20261030T020000Z'),event('UID:f\r\nSUMMARY:Local\r\nDTSTART:20261030T090000\r\nDTEND:20261030T100000')));
  expect(result.events.find(e=>e.uid==='z')?.start).toBe('2026-10-30T01:00:00.000Z');expect(result.events.find(e=>e.uid==='f')?.timezone).toContain('源未指定时区');
 });
 it('expands repeat rules with exceptions and preserves replacement occurrence titles',()=>{
  const result=read(wrap(event('UID:r\r\nSUMMARY:例会\r\nDTSTART:20261029T010000Z\r\nDTEND:20261029T020000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20261030T010000Z'),event('UID:r\r\nRECURRENCE-ID:20261031T010000Z\r\nSUMMARY:延期会议\r\nDTSTART:20261031T030000Z\r\nDTEND:20261031T040000Z')));
  expect(result.events).toHaveLength(3);expect(result.events.find(e=>e.title==='延期会议')?.start).toBe('2026-10-31T03:00:00.000Z');
 });
 it('excludes cancelled events and reports unsupported timezone or absent UID',()=>{
  const result=read(wrap(event('UID:c\r\nSTATUS:CANCELLED\r\nDTSTART:20261030T010000Z'),event('UID:b\r\nSUMMARY:Bad TZ\r\nDTSTART;TZID=Not/AZone:20261030T010000'),event('SUMMARY:No UID\r\nDTSTART:20261030T010000Z')));
  expect(result.events).toHaveLength(0);expect(result.warnings).toHaveLength(2);
 });
 it('retains all-day end date as exclusive rather than inventing a meeting time',()=>{
  const result=read(wrap(event('UID:all\r\nSUMMARY:出差\r\nDTSTART;VALUE=DATE:20261029\r\nDTEND;VALUE=DATE:20261031')));expect(result.events[0]).toMatchObject({allDay:true,start:'2026-10-29',end:'2026-10-31'});
  expect(calendarContext(result.events,'2026-10-31',1)).toEqual([]);expect(calendarContext(result.events,'2026-10-29',1)[0]).toContain('不能当作固定会议时刻');
 });
 it('updates repeated imports by stable UID and occurrence, retaining missing location as missing',()=>{
  const e=read(wrap(event('UID:same\r\nSUMMARY:第一次\r\nDTSTART:20261030T010000Z\r\nDTEND:20261030T020000Z'))).events[0];const result=mergeCalendarEntries([e],[{...e,title:'变更'}]);expect(result).toHaveLength(1);expect(result[0].title).toBe('变更');expect(result[0].place).toBeUndefined();expect(calendarContext(result,'2026-10-30',1)[0]).toContain('未提供');
 });
 it('rejects malformed files, oversized files and invalid ranges without an import',()=>{
  expect(()=>read('not a calendar')).toThrow();expect(()=>read('a'.repeat(2_000_001))).toThrow('2MB');expect(()=>parseCalendarFile(wrap(),'2026-11-01','2026-10-01')).toThrow();expect(()=>parseCalendarFile(wrap(),'2026-01-01','2028-01-01')).toThrow();
 });
});

it("imports an override moved into range from a recurrence outside the window",()=>{
 const result=read(wrap(event('UID:moved\r\nSUMMARY:Original\r\nDTSTART:20261110T010000Z\r\nDTEND:20261110T020000Z\r\nRRULE:FREQ=DAILY;COUNT=2'),event('UID:moved\r\nRECURRENCE-ID:20261110T010000Z\r\nSUMMARY:Moved in\r\nDTSTART:20261030T010000Z\r\nDTEND:20261030T020000Z')));
 expect(result.events).toHaveLength(1);expect(result.events[0].title).toBe('Moved in');
});
it("uses embedded VTIMEZONE definitions instead of assuming a local timezone",()=>{
 const zone=['BEGIN:VTIMEZONE','TZID:Custom/Fixed','BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:+0830','TZOFFSETTO:+0830','END:STANDARD','END:VTIMEZONE'].join('\r\n');
 const result=read(wrap(zone,event('UID:zone\r\nSUMMARY:Fixed\r\nDTSTART;TZID=Custom/Fixed:20261030T090000\r\nDTEND;TZID=Custom/Fixed:20261030T100000')));
 expect(result.events[0].start).toBe('2026-10-30T00:30:00.000Z');
});
