/** Deterministic intake: explicit user facts only, with no network or model calls. */
import {mentionsPlaceName} from '../shared/intent-places.mjs';
const cn={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
const num=s=>/^\d+$/.test(s)?Number(s):s.includes('十')?((s.split('十')[0]?cn[s.split('十')[0]]:1)*10+(s.split('十')[1]?cn[s.split('十')[1]]:0)):cn[s];
const dayAfter=(date,n)=>new Date(Date.parse(date+'T12:00:00+08:00')+n*86400000).toISOString().slice(0,10);
const validDay=v=>/^\d{4}-\d\d-\d\d$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const token='(?:(?:上午|下午|晚上|中午|早上|凌晨)\\s*)?(?:\\d{1,2}[:：]\\d{2}|[零〇一二两三四五六七八九十\\d]{1,3}[点时](?:半|[零〇一二两三四五六七八九十\\d]{1,3}分?)?)';
function clock(text,inherited){
 const colon=text.match(/(\d{1,2})[:：](\d{2})/);const chinese=text.match(/([零〇一二两三四五六七八九十\d]{1,3})[点时](半|[零〇一二两三四五六七八九十\d]{1,3}分?)?/);
 if(!colon&&!chinese)return null;
 let h=colon?Number(colon[1]):num(chinese[1]),m=colon?Number(colon[2]):chinese[2]==='半'?30:chinese[2]?num(chinese[2].replace('分','')):0;
 const period=text.match(/上午|下午|晚上|中午|早上|凌晨/)?.[0]||inherited;
 if(!colon&&!period&&h<=12)return null;
 if(/下午|晚上|中午/.test(period||'')&&h<12)h+=12;
 if(/上午|早上|凌晨/.test(period||'')&&h===12)h=0;
 return h>=0&&h<=23&&m>=0&&m<=59?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:null;
}
function dateIn(text,body){
 if(!body.dateConfirmed||!validDay(body.date))return null;
 const full=text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
 let day=full?`${full[1]}-${full[2].padStart(2,'0')}-${full[3].padStart(2,'0')}`:null;
 if(!full){const relative=text.match(/第([一二三四五六七1234567])天/);day=relative?dayAfter(body.date,num(relative[1])-1):/次日|翌日|第二天/.test(text)?dayAfter(body.date,1):body.date;}
 return validDay(day)&&day>=body.date&&day<=dayAfter(body.date,body.days-1)?day:null;
}
function timesIn(context,body){
 const day=dateIn(context,body);if(!day)return {};
 const range=context.match(new RegExp(`(${token})\\s*(?:至|到|[-—–~～])\\s*(${token})`));
 const first=range?.[1]||context.match(new RegExp(token))?.[0];if(!first)return {};
 const start=clock(first),end=range?clock(range[2],first.match(/上午|下午|晚上|中午|早上|凌晨/)?.[0]):null;
 return {...(start?{start:`${day}T${start}:00+08:00`}:{}),...(start&&end&&end>start?{end:`${day}T${end}:00+08:00`}:{})};
}
export function validCommitments(body){
 if(!Array.isArray(body.commitments)||body.commitments.length>80)return [];
 return body.commitments.flatMap(e=>{
  if(!e||e.stale||e.allDay||!Number.isInteger(e.place_index)||!body.places[e.place_index])return [];
  const toLocal=v=>typeof v==='string'&&validDay(v.slice(0,10))&&Number(v.slice(11,13))<24&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+8*3600000).toISOString().slice(0,19)+'+08:00':null;
  const start=toLocal(e.start),end=toLocal(e.end);
  if(!body.dateConfirmed||!validDay(body.date)||!start||!end||end<=start||start.slice(0,10)<body.date||Date.parse(end)>Date.parse(dayAfter(body.date,body.days)+'T00:00:00+08:00'))return [];
  return [{place_index:e.place_index,start,end,private:true}];
 });
}
export function extractFreeBrief(body){
 const notes=[body.notes||'',...(body.constraints||[])].join('\n');
 const structured=validCommitments(body);const events=[...structured];
 for(const [place_index,place] of body.places.entries()){
  const contexts=notes.split(/[。；;\n]/).filter(s=>mentionsPlaceName(s,place));
  for(const context of contexts){
   // A sentence mentioning two different venues is ambiguous; don't borrow their times.
   if(body.places.some((p,i)=>i!==place_index&&p.name!==place.name&&mentionsPlaceName(context,p)))continue;
   const publicName=context.match(/(?:参加|出席|参观)\s*([^，,。；;\n]{3,60}?(?:博览会|大会|论坛|展览|发布会))/)?.[1];
   const event={place_index,...timesIn(context,body),private:!publicName,...(publicName?{public_event:{name:publicName}}:{})};
   if(!events.some(e=>e.place_index===place_index&&e.start===event.start&&e.end===event.end))events.push(event);
  }
  if(!events.some(e=>e.place_index===place_index))events.push({place_index,private:true});
 }
 const from=notes.match(/从([^，。；;\n]{2,70}?)出发/)?.[1];
 const origin=from?.split('的').at(-1)?.trim(),origin_city=from?.includes('的')?from.split('的')[0].trim():undefined;
 const destination=notes.match(/(?:回到|返回|返程至|返程到)([^，。；;\n\s]{2,60}?)(?=[。；;\n，]|$)/)?.[1];
 const hotelQuote=notes.match(/(?:已订|已预订|订好)([^，。；;\n]{2,80}?(?:酒店|宾馆|旅馆|客栈)(?:[（(][^）)]+[）)])?)/)?.[0];
 const rail={};
 for(const clause of notes.split(/[。；;\n]/)){
  const number=clause.match(/(?:^|[^A-Z0-9])([GDCZTKYLS]\d{1,5})(?!\d)/)?.[1];
  const stations=[...clause.matchAll(/[\u4e00-\u9fff]{2,20}站/g)].map(m=>m[0].replace(/^(?:去程|返程|回程|从|到|至)+/,''));
  const tokens=[...clause.matchAll(new RegExp(token,'g'))].map(m=>clock(m[0])).filter(Boolean);
  if(!number||stations.length!==2||tokens.length!==2||!body.dateConfirmed)continue;
  const direction=/返程|回程/.test(clause)?'return':'outbound';
  const day=clause.match(/20\d\d[-年/]/)?dateIn(clause,body):direction==='return'?dayAfter(body.date,body.days-1):body.date;
  if(!day)continue;
  rail[direction]={number,origin:stations[0],destination:stations[1],departure:`${day}T${tokens[0]}:00+08:00`,arrival:`${day}T${tokens[1]}:00+08:00`,...(/已订|已购|订好/.test(clause)?{booking_quote:clause.trim()}:{})};
 }
 return {events,...(origin?{origin}:{}),...(origin_city?{origin_city}:{}),...(/不住宿|不用住|不住酒店|当天往返/.test(notes)?{stay_required:false}:{}),journey:{rail,...(origin?{origin}:{}),...(destination?{destination}:{}),...(hotelQuote?{hotel:hotelQuote.replace(/^(?:已预订|已订|订好)/,''),hotel_booking_quote:hotelQuote}:{})}};
}
export function completeFreePublicEvents(body,events,sources){
 return events.map(event=>{
  if(event.private!==false||!event.public_event?.name)return event;
  for(const source of sources){
   if(source.status!=='retrieved'||typeof source.excerpt!=='string')continue;
   const index=source.excerpt.indexOf(event.public_event.name);if(index<0)continue;
   const context=source.excerpt.slice(Math.max(0,index-60),index+event.public_event.name.length+320);
   const times=timesIn(context,body);
   if(times.start&&times.end)return {...event,...times,public_event:{...event.public_event,source_url:source.url}};
  }
  return event;
 });
}
export { extractPlaceCandidates } from '../shared/intent-places.mjs';
