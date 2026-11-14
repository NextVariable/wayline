import type { TripDecision, JointDecision, DepartureWindow, PlannerResult, HotelTerms } from "../types/place";

const record = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const text = (value: unknown): value is string => typeof value === "string" && value.length < 4000;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function normalizeDecision(value: unknown): TripDecision | undefined {
  const raw = record(value);
  if (!raw || !["conditional","conflict"].includes(raw.status) || !record(raw.schedule)) return;
  const questions = Array.isArray(raw.questions) ? raw.questions.filter((q:unknown) => record(q) && text((q as any).prompt) && text((q as any).why)).slice(0,3) : [];
  const hotels = Array.isArray(raw.hotels) ? raw.hotels.filter((h:unknown) => {
    const row = record(h);
    if (!row || ![row.id,row.name,row.address,row.near,row.url].every(text)) return false;
    try { const url = new URL(row.url); return url.protocol === "https:" && url.hostname === "uri.amap.com"; } catch { return false; }
  }).slice(0,6) : [];
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((s:unknown) => { const v = record(s); if (!v || !text(v.title) || !text(v.url) || !["retrieved","unavailable"].includes(v.status) || !finite(v.observedAt)) return false; try { const url=new URL(v.url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }).slice(0,14) : [];
  return {inputNeeds:record(raw.inputNeeds)&&typeof raw.inputNeeds.party==="boolean"?{party:raw.inputNeeds.party}:undefined,publicResearch: record(raw.publicResearch) && ["retrieved","unavailable","not_configured"].includes(raw.publicResearch.status) && typeof raw.publicResearch.searched === "boolean" ? {status:raw.publicResearch.status,searched:raw.publicResearch.searched} : undefined, joint:normalizeJoint(raw.joint),sources,status:raw.status,engine:text(raw.engine) ? raw.engine : "unavailable",questions,hotels,
    missing:Array.isArray(raw.missing) ? raw.missing.filter(text).slice(0,12) : [],
    observedAt:finite(raw.observedAt) ? raw.observedAt : 0,
    schedule:{status:text(raw.schedule.status) ? raw.schedule.status : "unknown", nodes:Array.isArray(raw.schedule.nodes) ? raw.schedule.nodes.filter((n:unknown) => {
      const node = record(n); return node && text(node.id) && text(node.name) && (node.latest_departure === null || text(node.latest_departure) && Number.isFinite(Date.parse(node.latest_departure))) && (node.slack_minutes === null || typeof node.slack_minutes === "number" && Number.isFinite(node.slack_minutes));
    }).slice(0,64) : []}};
}
export function normalizeWindows(value: unknown): DepartureWindow[] {
  return Array.isArray(value) ? value.filter((v:unknown) => {
    const row = record(v); return row && [row.from,row.to,row.latestDeparture,row.caveat].every(text) && Number.isFinite(Date.parse(row.latestDeparture)) && finite(row.bufferMinutes) && finite(row.travelSeconds);
  }).slice(0,12) : [];
}
export function normalizeRouteEvidence(value: unknown): PlannerResult["routeEvidence"] {
  const raw = record(value);
  if (raw?.source !== "amap" || !finite(raw.observedAt) || !Array.isArray(raw.legs) || raw.legs.length > (raw.scope==='joint'?64:11)) return;
  if (!raw.legs.every((v:unknown) => {
    const row = record(v); return row && text(row.from) && text(row.to) && finite(row.duration) && finite(row.distance) && Array.isArray(row.points) && row.points.length <= 100000 && row.points.every((p:unknown) => { const point = record(p); return point && typeof point.latitude === "number" && Number.isFinite(point.latitude) && Math.abs(point.latitude)<=90 && typeof point.longitude === "number" && Number.isFinite(point.longitude) && Math.abs(point.longitude)<=180; });
  })) return;
  return {...(raw.scope==='joint'?{scope:'joint' as const}:{}),...(["driving","walking","transit"].includes(raw.mode)?{mode:raw.mode}:{}),source:"amap",observedAt:raw.observedAt,legs:raw.legs};
}

export function normalizeHotelTerms(value:unknown):HotelTerms|null {
  const raw=record(value);if(!raw)return null;
  const c=record(raw.cancellation),deadline=c?.deadline;
  const cancellation:HotelTerms['cancellation']=c?.kind==='non_refundable'?{kind:'non_refundable'}:c?.kind==='free_before'&&typeof deadline==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(deadline)&&Number.isFinite(Date.parse(deadline))?{kind:'free_before',deadline}:{kind:'unknown'};
  const notice=(v:unknown)=>typeof v==='string'&&v.length<=350?v:null;
  const clock=(v:unknown)=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)?v:null;
  return {cancellation,meals:Number.isInteger(raw.meals)&&raw.meals>=0&&raw.meals<=100?raw.meals:null,checkIn:clock(raw.checkIn),checkOut:clock(raw.checkOut),arrivalNotice:notice(raw.arrivalNotice),propertyFeeNotice:notice(raw.propertyFeeNotice),paymentFeeNotice:notice(raw.paymentFeeNotice)};
}
export function normalizeJoint(value:unknown): JointDecision | undefined {
  const raw=record(value);
  if(!raw||!["conditional","unranked","conflict","unavailable","needs_input","not_applicable"].includes(raw.status))return;
  const timestamp=(v:unknown)=>v===null||text(v)&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v));
  const nullable=(v:unknown)=>v===null||finite(v);
  const plans=Array.isArray(raw.plans)?raw.plans.filter((v:unknown)=>{
    const p=record(v);return p&&[p.id,p.status,p.hotel].every(text)&&typeof p.ranked==="boolean"&&[p.outbound,p.returning].every(v=>v===null||text(v))&&[p.transportMinutes,p.totalCost].every(nullable)&&finite(p.knownCost)&&Array.isArray(p.timeline)&&p.timeline.length<=64&&p.timeline.every((v:unknown)=>{
      const n=record(v);return n&&[n.id,n.name].every(text)&&["event","rest","buffer","baggage","transfer","fixed","terminal"].includes(n.kind)&&finite(n.minutes)&&[n.start,n.deadline,n.latestDeparture,n.latestStart??null,n.conservativeLatestDeparture??null].every(timestamp);
    });
  }).slice(0,2).map((p:any)=>({...p,conservativeStatus:["feasible_under_inputs","infeasible","unknown"].includes(p.conservativeStatus)?p.conservativeStatus:"unknown",mapEvidence:normalizeRouteEvidence(p.mapEvidence),timeline:p.timeline.map((n:any)=>({...n,nextTransfer:record(n.nextTransfer)&&['driving','walking','transit'].includes(n.nextTransfer.mode)&&finite(n.nextTransfer.minutes)&&text(n.nextTransfer.to)?{mode:n.nextTransfer.mode,minutes:n.nextTransfer.minutes,to:n.nextTransfer.to}:undefined})),hotelFit:record(p.hotelFit)&&["matched","unmatched","none"].includes(p.hotelFit.group)?{group:p.hotelFit.group,nightly:finite(p.hotelFit.nightly)?p.hotelFit.nightly:null,budget:finite(p.hotelFit.budget)?p.hotelFit.budget:null}:null,hotelTerms:normalizeHotelTerms(p.hotelTerms),hotelQuote:record(p.hotelQuote)&&finite(p.hotelQuote.amount)&&[p.hotelQuote.rooms,p.hotelQuote.nights].every(n=>Number.isInteger(n)&&n>0)&&['twin','double'].includes(p.hotelQuote.roomType)?{amount:p.hotelQuote.amount,rooms:p.hotelQuote.rooms,nights:p.hotelQuote.nights,roomType:p.hotelQuote.roomType}:null,issues:Array.isArray(p.issues)?p.issues.filter(text).slice(0,20):[]})):[];
  const coverage=record(raw.coverage);
  const railOptions=Array.isArray(raw.railOptions)?raw.railOptions.filter((v:unknown)=>{
    const r=record(v);return r&&[r.number,r.origin,r.destination,r.departure,r.checkedAt].every(text)&&['outbound','return'].includes(r.direction)&&Number.isFinite(Date.parse(r.departure))&&Number.isFinite(Date.parse(r.checkedAt))&&Array.isArray(r.seatOptions);
  }).slice(0,6).map((r:any)=>({...r,seatOptions:r.seatOptions.filter((v:unknown)=>{const s=record(v);return s&&text(s.name)&&s.name.length<=40&&(s.price===null||finite(s.price))&&(s.count===null||Number.isInteger(s.count)&&s.count>=0)&&['available','unavailable','unknown'].includes(s.status);}).slice(0,16)})):[];
  const flightOffers = Array.isArray(raw.flightOffers) ? raw.flightOffers.flatMap((value:unknown) => {
    const offer = record(value);
    if (!offer || ![offer.key,offer.number,offer.from,offer.to,offer.departure,offer.arrival].every(text) ||
        !['SZX','SHA','PVG'].includes(offer.from) || !['SZX','SHA','PVG'].includes(offer.to) ||
        !timestamp(offer.departure) || !timestamp(offer.arrival) || Date.parse(offer.arrival) <= Date.parse(offer.departure) ||
        !['outbound','return'].includes(offer.direction) || typeof offer.feasible !== 'boolean' ||
        typeof offer.booked !== 'boolean' || !finite(offer.observedAt) || !nullable(offer.totalPrice) ||
        !nullable(offer.referencePrice)) return [];
    let bookingUrl = null;
    try { const url = new URL(offer.bookingUrl); if (url.protocol === 'https:' && url.host === 'router.feizhu.com' && !url.username && !url.password) bookingUrl = url.href; } catch {}
    return [{...offer,bookingUrl} as NonNullable<JointDecision['flightOffers']>[number]];
  }).slice(0,8) : [];
  return {status:raw.status, ...(raw.flightRequested===true?{flightRequested:true,flightOffers}:{}),...(typeof raw.railRequested==='boolean'?{railRequested:raw.railRequested}:{}),plans,rejected:Array.isArray(raw.rejected)?raw.rejected.filter((v:unknown)=>{const p=record(v);return p&&[p.id,p.hotel,p.reason].every(text);}).slice(0,8):[],
    ...(railOptions.length?{railOptions}:{}),
    pending:Array.isArray(raw.pending)?raw.pending.filter(text).slice(0,12):[],assumptions:Array.isArray(raw.assumptions)?raw.assumptions.filter(text).slice(0,6):[],
    ...(coverage&&['evaluated','rejected','conditional','verified'].every(k=>Number.isInteger(coverage[k])&&coverage[k]>=0&&coverage[k]<=10000)?{coverage:coverage as unknown as NonNullable<JointDecision['coverage']>}:{} )};
}
