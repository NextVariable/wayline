import { queryOfficialRail } from './official-rail.mjs';
import { createRequire } from 'node:module';
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const canonical=v=>String(v||'').replace(/\s|站$/g,'');
/** Parsed fields from the pinned query client; never turn a timetable into confirmed seats. */
export function readTrainSeatOptions(row) {
  return (Array.isArray(row.prices)?row.prices:[]).slice(0,16).flatMap(seat=>{
    if(!seat||typeof seat.seat_name!=='string'||!seat.seat_name.trim()||seat.seat_name.length>40)return [];
    const raw=String(seat.num??'').trim(),count=/^\d{1,5}$/.test(raw)?Number(raw):null;
    const status=count!==null?(count>0?'available':'unavailable'):['有','充足'].includes(raw)?'available':['无','售罄'].includes(raw)?'unavailable':'unknown';
    return [{name:seat.seat_name,price:finite(seat.price)&&seat.price>0?seat.price:null,count,status}];
  });
}
/** Only documented read operations on a fixed public host; no orders or credential forwarding. */
export function createJourneySuppliers({fetchImpl=fetch,resolvePlace}={}) {
  const post=async(operation,params)=>{
    // These are read operations only. Retry one short transient outage; never orders.
    let response;
    for(let attempt=0;attempt<2;attempt++){
      response=await fetchImpl(`https://api.tourmind.com/skill/toc/${operation}`,{method:'POST',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});
      if(response.ok)break;
      const retryAfter=response.headers?.get?.('retry-after');
      if(attempt===1||![429,502,503,504].includes(response.status)||(retryAfter&&(!/^\d+$/.test(retryAfter)||Number(retryAfter)>1)))throw new Error('住宿供给暂不可用');
      await response.body?.cancel?.();
      await new Promise(resolve=>setTimeout(resolve,retryAfter?Number(retryAfter)*1000:300));
    }
    const text=await response.text();if(text.length>2000000)throw new Error('住宿响应过长');
    const raw=JSON.parse(text);if(raw?.ok!==true||!raw.data||typeof raw.data!=='object')throw new Error('住宿供给未返回有效结果');return raw.data;
  };
  return {
    async discoverHotels({place,checkIn,checkOut,travelers,rooms}) {
      const found=await post('search_location',{keyword:place.city+' '+place.name});
      let rows=Array.isArray(found.hotels)?found.hotels:[];
      const center=found.place;
      const canon=s=>canonical(s).replace(/火车|铁路/g,'');
      const matching=center&&canon(center.name)===canon(place.name)&&String(center.formatted_address||'').includes(String(place.city||'').replace(/市$/,''))&&Number.isFinite(center.latitude)&&Number.isFinite(center.longitude);
      if(matching&&checkIn&&checkOut&&Number.isInteger(travelers)&&Number.isInteger(rooms)&&rooms>0&&travelers>=rooms&&travelers%rooms===0) {
        const raw=await post('search_hotels',{latitude:center.latitude,longitude:center.longitude,radius_km:3,location_name:center.name,check_in_date:checkIn,check_out_date:checkOut,adults:travelers/rooms,room_count:rooms,children:0,children_ages:[]});
        rows=Array.isArray(raw.hotels)?raw.hotels:[];
      }
      return {observedAt:Date.now(),candidates:rows.slice(0,3).filter(h=>h.hotel_id&&(h.hotel_name_cn||h.hotel_name||h.name_cn||h.name)).map(h=>({id:`tourmind:${h.hotel_id}`,supplierId:String(h.hotel_id),name:h.hotel_name_cn||h.hotel_name||h.name_cn||h.name,address:h.address_cn||h.address||'',near:place.name,city:place.city,availability:'unknown',quote:null,source:'TourMind',url:''}))};
    },
    async hotelOffer({hotel,checkIn,checkOut,travelers,rooms,roomType,freeCancellationRequired=false}) {
      if(!Number.isInteger(travelers)||!Number.isInteger(rooms)||rooms<1||travelers<rooms||travelers%rooms!==0) throw new Error('每间入住人数待确认');
      const params={check_in_date:checkIn,check_out_date:checkOut,adults:travelers/rooms,room_count:rooms,children:0,children_ages:[]};
      let id=hotel.supplierId;
      if(!id){const found=await post('search_location',{keyword:hotel.name});const matched=(found.hotels||[]).filter(h=>canonical(h.hotel_name_cn||h.hotel_name||h.name_cn||h.name)===canonical(hotel.name));if(matched.length!==1)throw new Error('酒店身份尚未匹配');id=String(matched[0].hotel_id);}
      const [raw,detail]=await Promise.all([post('query_room_rates',{...params,hotel_id:id}),post('get_hotel_detail',{hotel_id:id}).catch(()=>null)]);
      const luggage=readLuggagePolicy(detail);
      const scope={checkIn,checkOut,travelers,rooms,roomType};
      if(raw.reason==='no_matching_live_room')return {luggage,terms:readHotelTerms(detail),scope,availability:'unavailable',quote:null,source:'TourMind',verified:true,checkedAt:new Date().toISOString()};
      // A quote alone is not inventory. Recheck the exact rate, requested dates and per-room occupancy.
      const products=(raw.room_types||[]).flatMap(room=> (room.products||[]).filter(p=>p.max_occupancy>=params.adults&&p.rate?.currency==='CNY'&&p.rate?.is_on_request===false&&typeof p.rate?.rate_code==='string'&&finite(p.rate?.total_price)&& (roomType==='twin'? /双床|twin|2\s*single/i:/大床|double|king|queen/i).test(String(room.bed_description||room.bed_type_desc||room.name_cn||room.name||''))).map(p=>({room,p})));
      if(freeCancellationRequired)for(let i=products.length-1;i>=0;i--){const c=readHotelTerms(detail,products[i].p).cancellation;if(c.kind!=='free_before'||Date.parse(c.deadline)<=Date.now())products.splice(i,1);}
      if(!products.length)return {luggage,terms:readHotelTerms(detail),scope,availability:'unknown',quote:null,source:'TourMind',verified:false};
      products.sort((a,b)=>a.p.rate.total_price-b.p.rate.total_price);
      const rate=products[0].p.rate;
      const checked=await post('check_room_availability',{...params,hotel_id:id,rate_code:rate.rate_code});
      const verified=validateHotelRecheck(checked,{...params,rate_code:rate.rate_code});
      return {luggage,terms:readHotelTerms(detail,products[0].p),scope,availability:verified?'available':'unknown',quote:verified&&finite(verified.amount)?{amount:verified.amount,currency:'CNY'}:null,source:'TourMind 实时房型复核',verified:!!verified,checkedAt:new Date().toISOString()};
    },
    findTrains: query=>findTrains(query,{fetchImpl}),
  };
}
/** Facility listings are evidence of a service, never proof of free 24-hour storage. */
export function readLuggagePolicy(detail) {
  const snippets=[];
  const walk=(v,depth=0)=>{if(depth>5||snippets.length>80)return;if(typeof v==='string'&&v.length<2000&&/行李|寄存|luggage|baggage/i.test(v))snippets.push(v);else if(Array.isArray(v))v.slice(0,80).forEach(x=>walk(x,depth+1));else if(v&&typeof v==='object')Object.values(v).slice(0,80).forEach(x=>walk(x,depth+1));};
  walk(detail?.hotel?.amenities);walk(detail?.hotel?.amenities_hotel);walk(detail?.hotel?.policies);walk(detail?.hotel?.description);walk(detail?.hotel?.descriptions);
  const text=[...new Set(snippets)].slice(0,3).join('；');
  return {status:text?(/不提供.{0,8}(行李|寄存)|不支持.{0,8}(行李|寄存)|no (luggage|baggage) storage/i.test(text)?'unsupported':'listed'):'unknown',text:text.slice(0,1000),fee:null,hours:null,source:'TourMind 酒店设施与政策',checkedAt:new Date().toISOString()};
}
/** Return only explicitly supplied policy fields; deposits are not a room-price discount. */
export function readHotelTerms(detail,product){
  const clean=v=>typeof v==='string'?v.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,350):null;
  const clock=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);if(!m)return null;let h=Number(m[1]);const min=Number(m[2]);if(m[3]){if(h<1||h>12)return null;h=h%12+(/pm/i.test(m[3])?12:0);}return h<=23&&min<=59?`${String(h).padStart(2,'0')}:${m[2]}`:null;};
  const policy=product?.cancellation_policy;
  const cancellation=policy?.effective_non_refundable===true||policy?.type==='non_refundable'?{kind:'non_refundable'}:policy?.type==='free_cancel_before_deadline'&&policy.effective_non_refundable===false&&typeof policy.free_cancel_deadline==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(policy.free_cancel_deadline)&&Number.isFinite(Date.parse(policy.free_cancel_deadline))?{kind:'free_before',deadline:policy.free_cancel_deadline}:{kind:'unknown'};
  return {cancellation,meals:Number.isInteger(product?.meal_count)&&product.meal_count>=0?product.meal_count:null,checkIn:clock(detail?.hotel?.checkin?.begin_time),checkOut:clock(detail?.hotel?.checkout?.time),arrivalNotice:clean(detail?.hotel?.checkin?.special_instructions),propertyFeeNotice:clean(detail?.hotel?.fees?.mandatory),paymentFeeNotice:clean(product?.rate?.stripe_payment_fee?.notice)};
}
export function validateHotelRecheck(raw,query){
  const days=[];for(let t=Date.parse(query.check_in_date);t<Date.parse(query.check_out_date);t+=86400000)days.push(new Date(t).toISOString().slice(0,10));
  for(const room of raw?.room_types||[])for(const rate of room.rateInfos||[]) {
    if(rate.rateCode!==query.rate_code||rate.currencyCode!=='CNY'||rate.isOnRequest!==false||!finite(rate.totalPrice)||!Number.isInteger(rate.allotment)||rate.allotment<query.room_count||rate.maxOccupancy<query.adults)continue;
    const actual=(rate.dailyPrices||[]).map(p=>p.stayDate).sort();
    if(JSON.stringify(actual)!==JSON.stringify(days))continue;
    // Legacy response does not establish the multi-room charging basis.
    return {amount:query.room_count===1?rate.totalPrice:null};
  }
  return null;
}
/** Pinned community wrapper, exact stations first. A timetable never implies a purchased seat. */
export async function findTrains(query,{fetchImpl=fetch}={}) {
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
  const delta=(Date.parse(query.date)-Date.parse(today))/86400000;
  if(!Number.isInteger(delta)||delta<0||delta>=15)throw new Error('车票不在当前预售期内');
  const require=createRequire(new URL('./provider-runtime/package.json',import.meta.url));
  let client,transport,stationCodes,stage='runtime';
  try {
    const [{Client},{StdioClientTransport}]=await Promise.all([import(require.resolve('@modelcontextprotocol/sdk/client/index.js')),import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'))]);
    const entry=require.resolve('12306-mcp');
    client=new Client({name:'whereto-readonly',version:'1.0.0'});
    transport=new StdioClientTransport({command:process.execPath,args:[entry],stderr:'ignore',env:Object.fromEntries(['PATH','HOME','TMPDIR','NODE_EXTRA_CA_CERTS','HTTPS_PROXY','HTTP_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))});
    stage='connect';
    await client.connect(transport,{timeout:18000});
    const call=async(name,args)=>{const result=await client.callTool({name,arguments:args},undefined,{timeout:15000});if(result.isError)throw new Error();const blocks=result.content?.filter(b=>b.type==='text')||[];const text=blocks.map(b=>b.text).join('\n');if(text.length>1000000)throw new Error();return JSON.parse(text);};
    const names=[canonical(query.origin),canonical(query.destination)];
    stage='stations';
    const stations=await call('get-station-code-by-names',{stationNames:names.join('|')});
    if(names.some(n=>stations[n]?.station_name!==n||!stations[n]?.station_code))throw new Error();
    stationCodes=names.map(n=>stations[n].station_code);
    stage='tickets';
    const rows=await call('get-tickets',{date:query.date,fromStation:stations[names[0]].station_code,toStation:stations[names[1]].station_code,format:'json',limitedNum:30,sortFlag:'startTime',...(query.earliestDeparture?{earliestStartTime:Number(query.earliestDeparture.slice(11,13))}:{})});
    return readTrainOffers(rows,query);
  } catch (cause) {if(stationCodes && stage==='tickets'){try{return await queryOfficialRail(query,stationCodes,{fetchImpl});}catch{/* Keep the original rejected scope explicit. */}}if(cause?.code==='scope_mismatch')throw cause;const error=new Error('车次查询暂不可用');error.code=stage;throw error;} finally {try{await client?.close();await transport?.close();}catch{}}
}

export function readTrainOffers(rows, query) {
  const names=[canonical(query.origin),canonical(query.destination)];
  if(!Array.isArray(rows)||rows.some(r=>r.from_station!==names[0]||r.to_station!==names[1]||r.start_date!==query.date)) {
    const error=new Error('车次返回的日期或车站与请求不符，已排除');error.code='scope_mismatch';throw error;
  }
  return {candidates:rows.filter(r=>/^[GDCZTKYLS]\d{1,5}$/.test(r.start_train_code)&&/^\d\d:\d\d$/.test(r.start_time)&&/^\d\d:\d\d$/.test(r.arrive_time)&&/^\d{4}-\d\d-\d\d$/.test(r.arrive_date)).map(r=>({number:r.start_train_code,origin:query.origin,destination:query.destination,departure:`${r.start_date}T${r.start_time}:00+08:00`,arrival:`${r.arrive_date}T${r.arrive_time}:00+08:00`,seatOptions:readTrainSeatOptions(r),availability:'unknown',price:null,verified:false,source:'12306 社区查询（余票待官方复核）',checkedAt:new Date().toISOString()}))};
}
