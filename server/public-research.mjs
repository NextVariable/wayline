import { readPublicPage } from './public-page.mjs';

/** Read public sources, never send private meeting notes to search providers. */
export async function researchPublicEvents(notes = '', { readPage = readPublicPage, places = [], publicEvents = [], search, purpose = 'venue' } = {}) {
  const targets = new Map();
  for (const match of notes.matchAll(/https:\/\/[^\s，。；;）)]+/g)) {
    try { const url = new URL(match[0]); if (targets.size < 2) targets.set(url.href, { url: url.href }); } catch { /* Invalid pasted URL. */ }
  }
  if (search) {
    const activities=publicEvents.filter(e=>typeof e.name==='string' && e.name.length<=100 && notes.includes(e.name) && !/私人|内部|客户|保密|电话|\d{6,}/.test(e.name)).slice(0,3);
    const results=await Promise.all([...activities.map(e=>({...e,activity:true})),...places.slice(0,3)].map(async place=>{
      if(!place?.name?.trim())return [];
      const query=`${place.city || ''} ${place.name} ${place.activity?`${place.date || ''} 官网 活动 时间 地址`:purpose==='hotel'?'官网 行李寄存 退房后 收费':'官网 地址 交通'}`.trim();
      try {const hits=await search(query);return (Array.isArray(hits)?hits:[]).slice(0,2).flatMap(hit=>{
        try {const url=new URL(hit.url);return url.protocol==='https:' && !url.username && !url.password?[{url:url.href,discovered:true,placeName:place.name}]:[];}catch{return [];}
      });}catch{return [];}
    }));
    // Keep activity evidence ahead of general venue pages, regardless of response order.
    for(const row of results.flat())if(!targets.has(row.url))targets.set(row.url,row);
  }
  return Promise.all([...targets.values()].slice(0, 8).map(async target => {
    const { url, discovered, placeName } = target;
    try {
      const page = await readPage(url);
      const html = typeof page==='string'?page:page?.html;
      const observedAt = typeof page==='string'?Date.now():page?.observedAt;
      if(typeof html!=='string'||!Number.isFinite(observedAt)||observedAt<0||observedAt>Date.now())throw new Error('invalid page observation');
      const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || new URL(url).hostname;
      const excerpt = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
      const canon = text => String(text).replace(/[\s（()）·]/g, '').toLowerCase();
      if (!excerpt || discovered && !canon(excerpt).includes(canon(placeName))) throw new Error('unrelated');
      return { url, title, excerpt, status: 'retrieved', observedAt, ...(discovered ? { discovered: true, placeName } : {}) };
    } catch { return { url, title: new URL(url).hostname, status: 'unavailable', observedAt: Date.now(), ...(discovered ? { discovered: true, placeName } : {}) }; }
  }));
}

/** Bind a published range to the named activity, never venue opening hours or private meetings. */
export function publishedEventTimes(event, body, sources) {
  const activity = event.public_event;
  if (event.private !== false || !activity || typeof activity.name !== 'string' || activity.name.length < 3 || !String(body.notes || '').includes(activity.name) || !/公开|大会|论坛|展览|发布会|活动官网/.test(body.notes || '') || !body.dateConfirmed) return null;
  const source = sources.find(s => s.status === 'retrieved' && s.url === activity.source_url && typeof s.excerpt === 'string');
  if (!source || ![event.start,event.end].every(v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::00)?\+08:00$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(Date.parse(v)+8*3600000).toISOString().slice(0,16)===v.slice(0,16))) return null;
  const start = event.start.slice(0,10), end = event.end.slice(0,10);
  const limit = Date.parse(body.date + 'T00:00:00+08:00') + body.days * 86400000;
  if (start !== end || start < body.date || Date.parse(event.end) >= limit || Date.parse(event.end) <= Date.parse(event.start)) return null;
  const index = source.excerpt.indexOf(activity.name); if (index < 0) return null;
  const context = source.excerpt.slice(Math.max(0,index-60), index+activity.name.length+320);
  const venue = body.places?.[event.place_index]?.name;
  if (!venue || !context.includes(venue)) return null;
  const dates = [...context.matchAll(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
  if (!dates.length || dates.some(d=>d!==start) || /开放时间|营业时间|opening hours/i.test(context)) return null;
  const range = new RegExp(`(?<![0-9])${event.start.slice(11,16)}\\s*[-—–~至到]\\s*${event.end.slice(11,16)}(?![0-9])`);
  if (!range.test(context)) return null;
  return { start:event.start, end:event.end, time_source:{url:source.url,observedAt:source.observedAt,kind:'published'} };
}
