const canonical=v=>String(v||'').replace(/\s|站$/g,'');
const clock=v=>typeof v==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
function validate(query,codes){
  if(!/^\d{4}-\d\d-\d\d$/.test(query.date || '') || !Number.isFinite(Date.parse(query.date)) || new Date(query.date).toISOString().slice(0,10)!==query.date || !Array.isArray(codes) || codes.length!==2 || !codes.every(c=>/^[A-Z]{3}$/.test(c)))throw new Error('车次查询条件无效');
}
/** Field positions follow the pinned 12306 client. Boarding date comes from the dated official request, not start_train_date. */
export function parseOfficialTickets(raw,query,codes){
  validate(query,codes);
  const data=raw?.data;
  if(raw?.status===true && Array.isArray(data?.result) && data.result.length===0)return {candidates:[]};
  if(raw?.status!==true || !Array.isArray(data?.result) || !data.map || codes.some((c,i)=>canonical(data.map[c])!==canonical(i?query.destination:query.origin)))throw new Error('官网返回的车站身份尚未核对');
  const candidates=data.result.flatMap(value=>{
    if(typeof value!=='string' || value.length>10000)return [];
    const r=value.split('|');
    if(r[6]!==codes[0] || r[7]!==codes[1] || !/^[GDCZTKYLS]\d{1,5}$/.test(r[3]) || !clock(r[8]) || !clock(r[9]) || !/^\d{1,3}:[0-5]\d$/.test(r[10]))return [];
    const [hours,minutes]=r[10].split(':').map(Number);
    const departure=`${query.date}T${r[8]}:00+08:00`,duration=hours*60+minutes;
    const arrivalLocal=new Date(Date.parse(departure)+(duration+8*60)*60000).toISOString();
    if(duration<=0 || duration>7*1440 || arrivalLocal.slice(11,16)!==r[9])return [];
    const arrival=arrivalLocal.slice(0,19)+'+08:00';
    if(query.earliestDeparture && Date.parse(departure)<Date.parse(query.earliestDeparture) || query.latestArrival && Date.parse(arrival)>Date.parse(query.latestArrival))return [];
    const seatOptions=[['二等座',30],['一等座',31],['商务座',32],['硬卧',28],['软卧',23],['硬座',29]].map(([name,index])=>{
      const value=String(r[index]||'');const count=/^\d{1,5}$/.test(value)?Number(value):null;
      return {name,price:null,count,status:count!==null?(count>0?'available':'unavailable'):value==='有'?'available':value==='无'?'unavailable':'unknown'};
    });
    return [{number:r[3],origin:query.origin,destination:query.destination,departure,arrival,seatOptions,availability:'unknown',price:null,verified:false,source:'12306 官网原始查询参考（非开放API，余票需复核）',checkedAt:new Date().toISOString()}];
  });
  return {candidates:candidates.slice(0,30)};
}
/** Read-only website fallback; no login, purchase, CAPTCHA solving or credential persistence. */
export async function queryOfficialRail(query,codes,{fetchImpl=fetch}={}){
  validate(query,codes);
  const init='https://kyfw.12306.cn/otn/leftTicket/init';
  const page=await fetchImpl(init,{signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!page.ok)throw new Error('铁路官网暂不可读取');
  const html=await page.text();if(html.length>1000000)throw new Error('铁路页面响应过长');
  const endpoint=html.match(/\bCLeftTicketUrl\s*=\s*['"](leftTicket\/query[A-Za-z]*)['"]/)?.[1];
  if(!endpoint)throw new Error('铁路官网查询格式已变化');
  const cookies=(page.headers?.getSetCookie?.() || []).map(c=>c.split(';')[0]).join('; ');
  const params=new URLSearchParams({'leftTicketDTO.train_date':query.date,'leftTicketDTO.from_station':codes[0],'leftTicketDTO.to_station':codes[1],purpose_codes:'ADULT'});
  const response=await fetchImpl('https://kyfw.12306.cn/otn/'+endpoint+'?'+params,{headers:{Accept:'application/json',Referer:init,'Cache-Control':'no-cache',...(cookies?{Cookie:cookies}:{})},signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)throw new Error('铁路官网暂不可读取');
  const text=await response.text();if(text.length>2000000)throw new Error('铁路响应过长');
  try{return parseOfficialTickets(JSON.parse(text),query,codes);}catch{throw new Error('铁路官网未返回符合日期和车站条件的数据');}
}
