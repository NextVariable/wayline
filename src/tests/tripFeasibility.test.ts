import { expect, it } from "vitest";
import { buildTravelWorkspace } from "../lib/tripIntelligence";
import { assessCommute, assessTrip, calendarRisks } from "../lib/tripFeasibility";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { RailOrder } from "../lib/businessOrders";
import { tripTransfers } from "../lib/tripTransfers";
import { bookingPlaceKey } from "../lib/useBookingPlaces";
import type { RouteEvidence } from "../lib/tripDomain";
import { legPairs, localDateKey } from "../lib/todayMap";
import { initialUserPlaces } from "./fixtures/userPlaces";

const today = new Date("2026-11-20T01:00:00Z");
const freshness={now:+today,calendarCurrent:true,mailboxCurrent:true};
const cityPlace=(city:string,id:string,n:number)=>({...initialUserPlaces[0],city,id,name:id,lat:31.25+n/100,lng:121.41+n/100});
const event=(id:string,start:string,end:string,city?:string):CalendarEntry=>({
  id, uid:id, title:id, location:city ? id : "",description:"",start,end,allDay:false,timezone:"Asia/Shanghai",calendar:"合成样本",
  ...(city && {place:cityPlace(city,id,id.charCodeAt(0)%10)}),
});
const at=(day:number,time:string)=>`2026-11-${day}T${time}:00+08:00`;
const testModel=(events:CalendarEntry[], mailbox?:Parameters<typeof buildTravelWorkspace>[0]["mailbox"]) =>
  buildTravelWorkspace({events,mailbox,day:today,settings:{home:"苏州",boundaries:{}},cities:["上海","苏州","杭州"]});

it("includes overlapping events without locations, including a long event spanning two shorter ones",()=>{
  const risks=calendarRisks([
    event("客户会",at(20,"09:00"),at(20,"11:00"),"上海"),
    event("远程",at(20,"09:15"),at(20,"09:30")),
    event("例会",at(20,"10:30"),at(20,"11:10"),"上海"),
  ],freshness);
  expect(risks.filter(r=>r.type==="overlap").map(r=>r.eventIds)).toEqual([["客户会","远程"],["客户会","例会"]]);
  expect(risks.find(r=>r.type==="missing-location")).toMatchObject({eventIds:["远程"],status:"uncertain",action:{kind:"confirm-place"}});
});

it("uses current route evidence and accounts for an intervening online meeting",()=>{
  const a=event("A",at(20,"09:00"),at(20,"09:30"),"上海");
  const b=event("B",at(20,"10:00"),at(20,"11:00"),"上海");
  const online={...event("远程",at(20,"09:35"),at(20,"09:50")),location:"线上",placeResolution:{status:"online" as const,text:"线上"}};
  const [pair]=legPairs([a,online,b],localDateKey(a.start));
  expect(pair.gapMinutes).toBe(10);
  expect(pair.departure).toBe("2026-11-20T01:50:00.000Z");
  const route:RouteEvidence={mode:"transit",source:"amap",minutes:25,points:[],observedAt:freshness.now};
  expect(assessCommute(pair,[route],"transit",freshness)).toMatchObject({
    verdict:{status:"insufficient",shortBy:25},risk:{severity:"high",status:"confirmed",eventIds:["A","B"]},
  });
  expect(assessCommute(pair,[{...route,observedAt:freshness.now-31*60_000}],"transit",freshness)).toMatchObject({
    verdict:{status:"stale"},risk:{status:"uncertain",stale:true},
  });
  expect(assessCommute(pair,[],"transit",freshness).risk).toMatchObject({status:"uncertain",type:"commute-time"});
});

it("joins meeting, rail and hotel records, detects late arrival and leaves missing return transport open",()=>{
  const meeting=event("A",at(20,"10:00"),at(20,"11:00"),"上海");
  const next=event("B",at(21,"09:00"),at(21,"10:00"),"上海");
  const model=testModel([meeting,next],{
    lastSync:+today,
    orders:[{id:"rail",train:"G102",origin:"苏州",destination:"上海虹桥",departAt:at(20,"09:30"),arriveAt:at(20,"10:10")}],
    bookings:[{id:"stay",kind:"stay",start:"2026-11-20",end:"2026-11-21",to:"示例酒店",city:"上海"}],
  });
  const trip=model.tripModels.get("A")!;
  expect(trip.timeline.map(row=>row.kind)).toEqual(["booking","booking","event","event"]);
  const risks=assessTrip(trip,freshness);
  expect(risks.find(r=>r.type==="booking-conflict")).toMatchObject({status:"confirmed",eventIds:["A"],severity:"high",basis:expect.stringContaining("10 分钟")});
  expect(risks.some(r=>r.type==="missing-transport")).toBe(true);
  expect(risks.some(r=>r.type==="missing-stay")).toBe(false);
  expect(assessTrip(trip,{...freshness,mailboxCurrent:false})[0]).toMatchObject({status:"uncertain",stale:true});
});

it("suppresses a deduplicated cancelled order before assessing a meeting conflict",()=>{
  const meeting=event("A",at(20,"10:00"),at(20,"11:00"),"上海");
  const calendar={...event("ticket",at(20,"09:30"),at(20,"10:10")),title:"高铁 G102｜苏州站 → 上海虹桥站"};
  const model=testModel([meeting,calendar],{lastSync:+today,orders:[],changes:[
    {id:"cancelled",kind:"rail",number:"G102",start:calendar.start,end:calendar.end,from:"苏州站",to:"上海虹桥站",
      state:"cancelled",observedAt:+today},
  ]});
  const trip=model.tripModels.get("A")!;
  const bookings=trip.timeline.flatMap(row=>row.kind==="booking"?[row.booking]:[]);
  expect(bookings).toHaveLength(1);
  expect(bookings[0]).toMatchObject({state:"cancelled",provenance:[{source:"calendar-file"},{source:"gmail"}]});
  expect(assessTrip(trip,freshness)).toContainEqual(expect.objectContaining({type:"booking-change",status:"confirmed"}));
  expect(assessTrip(trip,freshness).some(r=>r.type==="booking-conflict")).toBe(false);
});

it("finds a departure before the earlier city's meeting ends and keeps unknown airport travel uncertain",()=>{
  const a=event("A",at(20,"09:00"),at(20,"11:00"),"上海");
  const b=event("B",at(20,"13:00"),at(20,"14:00"),"杭州");
  const model=testModel([a,b],{lastSync:+today,orders:[
    {id:"intercity",train:"G103",origin:"上海虹桥站",destination:"杭州东站",departAt:at(20,"10:45"),arriveAt:at(20,"12:00")},
    {id:"inbound",train:"G104",origin:"苏州站",destination:"上海虹桥站",departAt:at(20,"07:30")},
  ]});
  const risks=assessTrip(model.tripModels.get("A")!,freshness);
  expect(risks).toContainEqual(expect.objectContaining({type:"booking-conflict",eventIds:["A","B"],basis:expect.stringContaining("15 分钟")}));
  expect(risks).toContainEqual(expect.objectContaining({type:"intercity",status:"uncertain",basis:expect.stringContaining("缺少到达时间")}));
});

it("recomputes timing and matching when a committed calendar event moves",()=>{
  const meeting=event("A",at(20,"10:00"),at(20,"11:00"),"上海");
  const mailbox={lastSync:+today,orders:[{id:"train",train:"G300",origin:"苏州站",
    destination:"上海虹桥站",departAt:at(20,"09:00"),arriveAt:at(20,"10:15")}]};
  const initial=assessTrip(testModel([meeting],mailbox).tripModels.get("A")!,freshness);
  expect(initial.some(r=>r.type==="booking-conflict")).toBe(true);
  const delayed={...meeting,start:at(20,"11:00"),end:at(20,"12:00")};
  const recalculated=assessTrip(testModel([delayed],mailbox).tripModels.get("A")!,freshness);
  expect(recalculated.some(r=>r.type==="booking-conflict")).toBe(false);
  expect(recalculated.some(r=>r.type==="intercity" && r.status==="uncertain")).toBe(true);
  const relocated={...delayed,place:cityPlace("杭州","新场地",2)};
  const next=testModel([relocated],mailbox).tripModels.get("A")!;
  expect(next.timeline.map(row=>row.kind)).toEqual(["event"]);
  expect(assessTrip(next,freshness).some(r=>r.type==="missing-transport")).toBe(true);
});

it("flags missing transport when the only order is cancelled and clears the gap on replacement",()=>{
  const meeting=event("A",at(20,"10:00"),at(20,"11:00"),"上海");
  const changes=[{id:"old",kind:"rail" as const,number:"G102",state:"cancelled" as const,from:"苏州站",to:"上海虹桥站",
    start:at(20,"09:00"),end:at(20,"09:25"),observedAt:+today}];
  const assess=(orders:RailOrder[])=>
    assessTrip(testModel([meeting],{changes,lastSync:+today,orders}).tripModels.get("A")!,freshness);
  const missing=({type,basis}:{type:string;basis:string})=>type==="missing-transport"&&basis.includes("苏州 → 上海");
  expect(assess([]).some(missing)).toBe(true);
  const replacement=assess([{id:"new",train:"G103",origin:"苏州站",destination:"上海虹桥站",
    departAt:at(20,"09:15"),arriveAt:at(20,"09:50")}]);
  expect(replacement.some(missing)).toBe(false);
  expect(replacement.filter(r=>r.type==="booking-change")).toHaveLength(1);
});

it("reports a cancelled stay once but marks every uncovered night",()=>{
  const first=event("A",at(20,"10:00"),at(20,"11:00"),"上海");
  const last=event("B",at(22,"09:00"),at(22,"10:00"),"上海");
  const trip=testModel([first,last],{orders:[],lastSync:+today,changes:[
    {id:"cancelled-hotel",kind:"stay",state:"cancelled",observedAt:+today,to:"示例酒店",city:"上海",
      start:"2026-11-20",end:"2026-11-22"},
  ]}).tripModels.get("A")!;
  const risks=assessTrip(trip,freshness);
  expect(risks.filter(r=>r.type==="booking-change")).toHaveLength(1);
  expect(risks.filter(r=>r.type==="missing-stay")).toHaveLength(2);
});

it("uses a dated route for station-to-meeting timing, degrades stale data and invalidates moved coordinates",()=>{
  const meeting=event("A",at(20,"10:00"),at(20,"11:00"),"上海");
  const mailbox={lastSync:+today,orders:[{id:"new",train:"G105",origin:"苏州站",destination:"上海虹桥站",
    departAt:at(20,"09:00"),arriveAt:at(20,"09:50")}]};
  const trip=testModel([meeting],mailbox).tripModels.get("A")!;
  const terminal=cityPlace("上海","虹桥",1);
  const locations={[bookingPlaceKey({name:"上海虹桥站",city:"上海"})]:terminal};
  const transfers=tripTransfers(trip,locations);
  expect(transfers).toHaveLength(1);
  expect(transfers[0]).toMatchObject({availableMinutes:10});
  const route:RouteEvidence={mode:"driving",source:"amap",minutes:15,points:[],observedAt:freshness.now};
  const routes={[transfers[0].key]:route};
  const get=(status=freshness)=>assessTrip(trip,status,transfers,routes).find(r=>r.type==="intercity");
  expect(get()).toMatchObject({severity:"high",status:"confirmed",basis:expect.stringContaining("差 5 分钟")});
  expect(get({...freshness,mailboxCurrent:false})).toMatchObject({severity:"info",status:"uncertain",stale:true});
  expect(get({...freshness,now:freshness.now+31*60_000})).toMatchObject({severity:"info",status:"uncertain",stale:true});
  const moved={...meeting,place:cityPlace("上海","新会场",5)};
  const newTrip=testModel([moved],mailbox).tripModels.get("A")!;
  expect(assessTrip(newTrip,freshness,tripTransfers(newTrip,locations),routes).find(r=>r.type==="intercity"))
    .toMatchObject({status:"uncertain",severity:"info"});
});
