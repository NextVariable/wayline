import type { CalendarEvent, RouteEvidence, SourceProvenance, TravelRisk, Trip } from "./tripDomain";
import { localDateKey, routeProviderMode, type TodayLegPair, type TravelMode } from "./todayMap";
import { assessLeg, legClock, type LegAssessment } from "./smartRoutes";
import type { TripTransfer } from "./tripTransfers";
import { classifyLocation } from "./calendarPlaces";
import { eventDay } from "./tripDay";

export interface Freshness { calendarCurrent: boolean; mailboxCurrent: boolean; now:number }
export const ROUTE_MAX_AGE = 30 * 60_000;
export const isCurrentRoute = (route:RouteEvidence, now:number) =>
  (route.source === "amap" || route.source === "synthetic") && Number.isFinite(route.minutes) && route.minutes >= 0 &&
  !!route.observedAt && route.observedAt <= now+60_000 && now-route.observedAt <= ROUTE_MAX_AGE;


const eventStale = (event:CalendarEvent, status:Freshness) => !!event.google && (!status.calendarCurrent || !!event.google.stale);
const eventSource = (event:CalendarEvent, status:Freshness):SourceProvenance => event.local ? {
  source:"wayline",
  recordId:event.local.sourcePlaceId,
  confidence:"recorded",
  stale:false,
} : {
  source:event.google ? "google-calendar" : "calendar-file",
  recordId:event.id,
  observedAt:event.google?.updated ? Date.parse(event.google.updated) || undefined : undefined,
  confidence:"recorded",
  stale:eventStale(event,status),
};
const timed = (events:CalendarEvent[]) => events.filter(event => !event.allDay &&
  Number.isFinite(Date.parse(event.start)) && Date.parse(event.end)>=Date.parse(event.start))
  .sort((left,right) => Date.parse(left.start)-Date.parse(right.start));

export function calendarRisks(events:CalendarEvent[], status:Freshness, day?:string):TravelRisk[] {
  const relevant = timed(events).filter(event => !day || (localDateKey(event.start) <= day && localDateKey(Date.parse(event.end)-1) >= day));
  const risks:TravelRisk[] = [];
  let furthest:CalendarEvent | undefined;
  for (const event of relevant) {
    if (furthest && Date.parse(event.end) > Date.parse(event.start) && Date.parse(furthest.end) > Date.parse(event.start)) {
      const evidence = [eventSource(furthest,status),eventSource(event,status)];
      const stale = evidence.some(source => source.stale);
      risks.push({id:JSON.stringify(["overlap",furthest.id,event.id]),type:"overlap",severity:stale?"medium":"high",
        status:stale?"uncertain":"confirmed",eventIds:[furthest.id,event.id],evidence,stale,
        title:stale ? "日程可能重叠" : "日程时间重叠",basis:`「${furthest.title}」结束晚于「${event.title}」开始`,
        action:{kind:"review-calendar",label:"核对两场日程"}});
    }
    if (!furthest || Date.parse(event.end) > Date.parse(furthest.end)) furthest=event;
    const placeUnconfirmed = event.placeResolution?.status === "ask" || event.placeResolution?.status === "ambiguous";
    if ((!event.place || placeUnconfirmed) && event.placeResolution?.status !== "ignored" && event.placeResolution?.status !== "online" &&
        classifyLocation(event.location) !== "online") {
      risks.push({id:JSON.stringify(["place",event.id]),type:"missing-location",severity:"info",status:"uncertain",
        eventIds:[event.id],evidence:[eventSource(event,status)],stale:eventStale(event,status),
        title:"日程地点待确认",basis:`「${event.title}」缺少可用于路线的坐标`,action:{kind:"confirm-place",label:"确认地点"}});
    }
  }
  return risks;
}

export interface CommuteAssessment { verdict: LegAssessment; plan: LegAssessment; risk?: TravelRisk }

/**
 * Today 与 Trips 共用这一处：先统一算 available/remaining/latestDeparture，再决定是否值得提醒。
 * 只有真实或明确标注的合成路线能给出确定性结论；估算与未来路线保持参考语义。
 */
export function assessCommute(pair:TodayLegPair, routes:RouteEvidence[], mode:TravelMode, status:Freshness,
  options:{ bufferOverride?:number; accessOverride?:number } = {}):CommuteAssessment {
  const result = routes.find(item => item.mode === mode)
    ?? routes.find(item => routeProviderMode(item.mode) === routeProviderMode(mode));
  const plan = assessLeg({ pair, route:result, mode, now:status.now, bufferOverride:options.bufferOverride, accessOverride:options.accessOverride });
  const sources=[eventSource(pair.from.event,status), eventSource(pair.to.event,status)];
  const routeStale=plan.routeState === "stale";
  const evidenceStale=sources.some(source => source.stale) || routeStale;
  const verdict:LegAssessment = evidenceStale && !["overlap","pending","stale"].includes(plan.status)
    ? { ...plan, status:"pending", latestDeparture:null, remainingMinutes:null, advice:"日历或路线证据需要更新，暂不下确定性结论" }
    : plan;
  if (verdict.status === "sufficient" || verdict.status === "reference") return {verdict, plan};
  const overlap=verdict.status === "overlap";
  const confirmed=overlap || verdict.status === "insufficient";
  const risk:TravelRisk={id:JSON.stringify(["commute",pair.id,mode]),type:overlap?"overlap":pair.crossCity?"intercity":"commute-time",
    segmentId:pair.id, severity:confirmed?"high":verdict.status === "tight"?"medium":"info",
    status:confirmed?"confirmed":"uncertain",
    eventIds:[pair.from.event.id,pair.to.event.id],stale:evidenceStale,
    evidence:result ? [...sources,{source:result.source,recordId:pair.id,observedAt:result.observedAt,
      confidence:result.source === "estimate" ? "inferred" : "recorded",stale:routeStale}] : sources,
    title:overlap?"日程时间重叠":confirmed?"通勤时间不足":verdict.status === "tight"?"通勤时间紧张":
      verdict.status === "stale"?"路线参考已过期":"通勤时间待核实",
    basis:commuteBasis(pair,verdict,result),
    action:{kind:overlap?"review-calendar":"review-route",
      label:overlap?"核对两场日程":verdict.status === "stale"?"刷新路线":
        confirmed && verdict.latestDeparture ? `最迟 ${legClock(verdict.latestDeparture)} 出发` : "查询路线"}};
  return {verdict,plan:verdict,risk};
}

function commuteBasis(pair:TodayLegPair, plan:LegAssessment, route?:RouteEvidence) {
  const buffer=(plan.accessMinutes ? `，门到门预留 ${plan.accessMinutes} 分钟` : "") +
    (plan.bufferMinutes ? `，安全缓冲 ${plan.bufferMinutes} 分钟` : "");
  if (plan.status === "overlap") return `日程占用时间与下一场重叠 ${plan.shortBy} 分钟`;
  if (plan.status === "insufficient") return `可用 ${plan.availableMinutes} 分钟，路线约 ${plan.routeMinutes} 分钟${buffer}，差 ${plan.shortBy} 分钟`;
  if (plan.status === "tight") return `可用 ${plan.availableMinutes} 分钟，路线约 ${plan.routeMinutes} 分钟${buffer}，仅余 ${plan.remainingMinutes} 分钟`;
  if (plan.status === "stale") return route ? `路线查询于 ${new Date(route.observedAt ?? 0).toLocaleString("zh-CN")}，已超过时效` : "路线参考已过期";
  if (plan.routeState === "missing" && !pair.sameSpot) return "尚无可用于判断的路线";
  return plan.advice || "信息不完整，暂不下结论";
}

export function assessTrip(trip:Trip,status:Freshness,transfers:TripTransfer[] = [],routes:Record<string,RouteEvidence> = {}):TravelRisk[] {
  const events=trip.days.flatMap(day => day.events);
  const byId=new Map(events.map(event=>[event.id,event]));
  const risks=calendarRisks(events,status);
  for (const segment of trip.segments) {
    if (segment.kind === "commute") continue;
    const orders=segment.kind === "stay" ? segment.night.orders : segment.leg.orders;
    const eventIds=segment.kind === "stay" ? events.filter(event=>eventDay(event)===segment.night.date).map(event=>event.id)
      : segment.constraints.map(constraint=>constraint.eventId);
    const evidence=eventIds.flatMap(id => byId.has(id) ? [eventSource(byId.get(id)!,status)] : []);
    const stale= evidence.some(item=>item.stale);
    const transport=segment.kind==="intercity";
    const label=transport?`${segment.leg.from} → ${segment.leg.to}`:`${segment.night.date.slice(5)} · ${segment.night.city}`;
    const active=orders.filter(order=>!order.state || order.state==="confirmed");
    for (const order of orders) {
      const orderEvidence=(order.provenance ?? [{source:order.source==="Gmail"?"gmail":"calendar-file",recordId:order.id,confidence:"inferred"} as const])
        .map(source => ({...source,stale:source.source==="gmail" ? !status.mailboxCurrent :
          source.source==="google-calendar" ? !status.calendarCurrent : false}));
      const outdated=stale || orderEvidence.some(source=>source.stale);
      const common={id:JSON.stringify([segment.id,order.id]),segmentId:segment.id,eventIds,
        evidence:[...evidence,...orderEvidence],stale:outdated};
      if (order.state && order.state !== "confirmed") {
        risks.push({...common,id:JSON.stringify(["booking-change",order.id]),type:"booking-change",severity:"medium",
          status:order.state==="review" || outdated?"uncertain":"confirmed",
          title:order.state==="cancelled"?"订单收到取消通知":order.state==="changed"?"订单收到改签通知":"订单信息待核对",
          basis:label+" · 原安排需要核对",action:{kind:"review-booking",label:"查看最新订单通知"}});
        continue;
      }
      if (!transport) continue;
      const violated=segment.constraints.find(constraint => constraint.kind==="depart-after"
        ? Date.parse(order.start)<Date.parse(constraint.at)
        : !!order.end && Date.parse(order.end)>Date.parse(constraint.at));
      if (violated) {
        const minutes=Math.ceil(Math.abs(Date.parse(violated.at)-Date.parse(violated.kind==="depart-after"?order.start:order.end!))/60_000);
        risks.push({...common,type:"booking-conflict",severity:outdated?"medium":"high",status:outdated?"uncertain":"confirmed",
          title:outdated?"订单可能与会议冲突":"订单与会议时间冲突",
          basis:label+" · "+(violated.kind==="depart-after"?`会议结束前 ${minutes} 分钟发车或起飞`:`会议开始后 ${minutes} 分钟到站或落地`),
          action:{kind:"review-booking",label:"核对会议与预订时间"}});
      } else if (segment.constraints.length) {
        for (const constraint of segment.constraints) {
          const transfer=transfers.find(item => item.segmentId===segment.id && item.orderId===order.id && item.kind===constraint.kind);
          const route=transfer && routes[transfer.key];
          const routeStale=!!route && !isCurrentRoute(route,status.now);
          const enoughEvidence=!!transfer && !!route && !routeStale && !outdated;
          const shortBy=enoughEvidence ? route.minutes-transfer.availableMinutes : 0;
          const futureReference=!!transfer && !!route && Date.parse(transfer.departure) > Math.min(status.now,route.observedAt ?? 0);
          const inbound=constraint.kind==="arrive-before";
          const routeEvidence:SourceProvenance[] = route && transfer ? [{source:"amap",recordId:transfer.key,
            observedAt:route.observedAt,confidence:"recorded",stale:routeStale}] : [];
          risks.push({...common,id:JSON.stringify([segment.id,order.id,constraint.kind]),eventIds:[constraint.eventId],
            evidence:[...common.evidence,...routeEvidence],stale:outdated || routeStale,
            type:"intercity",severity:shortBy>0?(futureReference?"medium":"high"):"info",status:shortBy>0 && !futureReference?"confirmed":"uncertain",
            title:shortBy>0?(futureReference?"参考路线显示城际接驳可能不足":"按查询耗时，城际接驳时间不足"):"城际接驳待确认",
            basis:label+" · "+(enoughEvidence
              ? `可用 ${transfer.availableMinutes} 分钟，高德驾车约 ${route.minutes} 分钟${shortBy>0?`，${futureReference?"可能":""}差 ${shortBy} 分钟`:""}${futureReference?"（查询时参考）":""}，另需核对进出站与等车时间`
              : !order.end && inbound ? "订单缺少到达时间" : routeStale || outdated ? "日历、订单或路线证据需要更新" : "尚未核实车站或机场与会场之间的耗时"),
            action:{kind:"review-route",label:inbound?"核对到站后接驳":"核对出发前接驳"}});
        }
      }
    }
    if (!active.length) risks.push({
      id:JSON.stringify(["missing",segment.id]),segmentId:segment.id,type:transport?"missing-transport":"missing-stay",
      severity:"info",status:"uncertain",eventIds,stale,evidence,
      title:transport?"未见已订交通":"未见已订住宿",basis:label+(orders.length ? " · 原订单已取消、变更或待核对，尚无可确认的替代安排" : " · 当前来源无可关联的预订"),
      action:{kind:transport?"compare-transport":"confirm-stay",label:transport?"核对交通安排":"核对住宿安排"}});
  }
  return [...new Map(risks.map(risk=>[risk.id,risk])).values()].sort((a,b) => ({high:0,medium:1,info:2}[a.severity])-({high:0,medium:1,info:2}[b.severity]));
}
