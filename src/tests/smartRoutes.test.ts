process.env.TZ = "Asia/Shanghai";
import { describe, expect, it } from "vitest";
import { initialUserPlaces } from "./fixtures/userPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { RouteEvidence } from "../lib/tripDomain";
import type { TodayLegPair } from "../lib/todayMap";
import {
  DEFAULT_COMMUTE_BUFFER, bufferPlan, assessLeg, departureReminder, isFutureLeg,
} from "../lib/smartRoutes";

const place = (id: string, name = id, patch: Partial<typeof initialUserPlaces[0]> = {}) =>
  ({ ...initialUserPlaces[0], id, name, city: "上海", lat: 31.23, lng: 121.47, ...patch });

const event = (id: string, start: string, end: string, venue = place("a")): CalendarEntry => ({
  id, uid: id, title: id, location: venue.name, description: "",
  start, end, allDay: false, timezone: "Asia/Shanghai", calendar: "测试", place: venue,
});

const makePair = (patch: Partial<TodayLegPair> & { gapMinutes?: number; start?: string; end?: string; fromPlace?: ReturnType<typeof place>; toPlace?: ReturnType<typeof place>; sameSpot?: boolean } = {}): TodayLegPair => {
  const fromPlace = patch.fromPlace ?? place("a", "A");
  const toPlace = patch.toPlace ?? place("b", "B");
  const start = patch.start ?? "2026-11-24T11:45:00+08:00";
  const end = patch.end ?? "2026-11-24T12:45:00+08:00";
  const from = event("a", "2026-11-24T10:00:00+08:00", "2026-11-24T11:00:00+08:00", fromPlace);
  const to = event("b", start, end, toPlace);
  return {
    id: "a>b", from: { event: from, place: fromPlace }, to: { event: to, place: toPlace },
    sameSpot: patch.sameSpot ?? false, crossCity: false, directKm: 3,
    gapMinutes: patch.gapMinutes ?? 45, departure: from.end, defaultMode: "transit", ...patch,
  };
};

const NOW = Date.parse("2026-11-24T11:00:00+08:00");
const route = (minutes: number, patch: Partial<RouteEvidence> = {}): RouteEvidence =>
  ({ mode: "transit", minutes, source: "amap", points: [], observedAt: NOW, ...patch });

describe("统一可行性计算", () => {
  it("可用 45、路线 38、缓冲 10 时，差 3 分钟", () => {
    const plan = assessLeg({ pair: makePair({ gapMinutes: 45 }), route: route(38), mode: "transit", now: NOW });
    expect(plan).toMatchObject({ status: "insufficient", availableMinutes: 45, routeMinutes: 38, bufferMinutes: 10, remainingMinutes: -3, shortBy: 3 });
    expect(plan.latestDeparture).toBe("2026-11-24T02:57:00.000Z");
  });

  it("调整缓冲后立即重算，且路线耗时不变", () => {
    const pair = makePair({ gapMinutes: 45 });
    expect(assessLeg({ pair, route: route(38), mode: "transit", now: NOW, bufferOverride: 5 })).toMatchObject({ status: "tight", remainingMinutes: 2 });
    expect(assessLeg({ pair, route: route(38), mode: "transit", now: NOW, bufferOverride: 0 })).toMatchObject({ status: "tight", remainingMinutes: 7 });
    expect(assessLeg({ pair, route: route(30), mode: "transit", now: NOW, bufferOverride: 0 })).toMatchObject({ status: "sufficient", remainingMinutes: 15 });
    expect(bufferPlan(pair).minutes).toBe(DEFAULT_COMMUTE_BUFFER);
    expect(bufferPlan(pair, 5)).toMatchObject({ minutes: 5, overridden: true, parts: [{ label: "本段单独设置", minutes: 5 }] });
  });

  it("时间重叠优先于其他判断，不会被当作零分钟会议", () => {
    expect(assessLeg({ pair: makePair({ gapMinutes: -5 }), route: route(10), mode: "transit", now: NOW }))
      .toMatchObject({ status: "overlap", shortBy: 5 });
  });

  it("上一场结束时间未知时保持待确认，即使已有路线", () => {
    expect(assessLeg({ pair: makePair({ gapMinutes: 20, endPending: true } as Partial<TodayLegPair>), route: route(10), mode: "transit", now: NOW }))
      .toMatchObject({ status: "pending", remainingMinutes: null });
  });

  it("无效结束时间不被解释成次日，也不给出结论", () => {
    const pair = makePair();
    const broken = { ...pair, from: { ...pair.from, event: { ...pair.from.event, end: "not-a-time" } }, gapMinutes: Number.NaN };
    expect(assessLeg({ pair: broken, route: route(10), mode: "transit", now: NOW })).toMatchObject({ status: "pending" });
  });

  it("同地点仍需处理重叠与缓冲", () => {
    const same = (gapMinutes: number) => assessLeg({ pair: makePair({ gapMinutes, sameSpot: true }), mode: "walking", now: NOW });
    expect(same(-5).status).toBe("overlap");
    expect(same(5)).toMatchObject({ status: "insufficient", routeMinutes: 0, bufferMinutes: 10 });
    expect(same(30)).toMatchObject({ status: "sufficient", remainingMinutes: 20 });
  });

  it("未来路线只给参考结论", () => {
    const pair = makePair({ start: "2026-11-25T11:45:00+08:00", end: "2026-11-25T12:45:00+08:00", departure: "2026-11-25T11:00:00+08:00" });
    expect(isFutureLeg(pair, NOW)).toBe(true);
    expect(assessLeg({ pair, route: route(20), mode: "transit", now: NOW })).toMatchObject({ status: "reference", reference: true });
  });

  it("估算路线不冒充确定性结论", () => {
    const plan = assessLeg({ pair: makePair({ gapMinutes: 10 }), route: route(90, { source: "estimate" }), mode: "transit", now: NOW });
    expect(plan.status).toBe("reference");
    expect(plan.shortBy).toBe(90);
    expect(plan.advice).toContain("需查询实时路线复核");
  });

  it("未来参考路线即使算不过来也不输出确定的时间不足", () => {
    const pair = makePair({ start: "2026-11-25T11:45:00+08:00", end: "2026-11-25T12:45:00+08:00", departure: "2026-11-25T11:00:00+08:00" });
    const plan = assessLeg({ pair, route: route(90), mode: "transit", now: NOW });
    expect(plan.status).toBe("reference");
    expect(plan.shortBy).toBe(55);
    expect(plan.advice).toContain("参考路线可能不足 55 分钟");
    expect(plan.advice).not.toContain("仍差 55 分钟");
  });

  it("车站与机场预留未确认时保持待确认，不直接判定不足", () => {
    const pair = makePair({ gapMinutes: 45, toPlace: place("airport", "虹桥机场T2") });
    const plan = assessLeg({ pair, route: route(20), mode: "transit", now: NOW });
    expect(plan).toMatchObject({ status: "pending", bufferPending: true });
    expect(plan.advice).toContain("确认后再判断");
  });

  it("结束时间早于开始时间视为无效输入，不擅自跨到次日", () => {
    const pair = makePair();
    const broken = { ...pair, from: { ...pair.from, event: { ...pair.from.event, start: "2026-11-24T11:00:00+08:00", end: "2026-11-24T10:00:00+08:00" } } };
    expect(assessLeg({ pair: broken, route: route(10), mode: "transit", now: NOW }))
      .toMatchObject({ status: "pending", remainingMinutes: null });
  });

  it("跨午夜的相邻安排按真实时间差计算", () => {
    const from = event("night", "2026-11-23T23:50:00+08:00", "2026-11-24T00:00:00+08:00");
    const to = event("dawn", "2026-11-24T00:30:00+08:00", "2026-11-24T01:30:00+08:00");
    const pair: TodayLegPair = {
      id: "night>dawn", from: { event: from, place: place("a", "A") }, to: { event: to, place: place("b", "B") },
      sameSpot: false, crossCity: false, directKm: 3, gapMinutes: 30, departure: from.end,
      defaultMode: "driving",
    };
    const plan = assessLeg({ pair, route: route(10, { mode: "driving" }), mode: "driving", now: NOW, accessOverride: 0 });
    expect(plan).toMatchObject({ status: "sufficient", availableMinutes: 30, remainingMinutes: 10 });
  });
});

describe("路线时效", () => {
  it("公交 15 分钟过期，步行 24 小时仍可用", () => {
    const pair = makePair();
    expect(assessLeg({ pair, route: route(20, { observedAt: NOW - 16 * 60_000 }), mode: "transit", now: NOW }).status).toBe("stale");
    expect(assessLeg({ pair, route: route(20, { observedAt: NOW - 16 * 60_000 }), mode: "walking", now: NOW }).status).toBe("reference");
    expect(assessLeg({ pair, route: route(20, { observedAt: NOW - 6 * 60_000 }), mode: "driving", now: NOW }).status).toBe("stale");
  });

  it("查询时间在未来或缺失时视为过期", () => {
    const pair = makePair();
    expect(assessLeg({ pair, route: route(20, { observedAt: NOW + 2 * 60_000 }), mode: "transit", now: NOW }).status).toBe("stale");
    expect(assessLeg({ pair, route: route(20, { observedAt: 0 }), mode: "transit", now: NOW }).status).toBe("stale");
  });
});

describe("缓冲与出发提醒", () => {
  it("机场与车站使用 PRD 建议值并标注待确认", () => {
    const airport = bufferPlan(makePair({ toPlace: place("airport", "虹桥机场T2") }));
    expect(airport).toMatchObject({ minutes: 120, pending: true, parts: [{ label: "前往机场预留", minutes: 120, pending: true }] });
    const rail = bufferPlan(makePair({ fromPlace: { ...place("station", "上海虹桥站"), category: "transport" } }));
    expect(rail).toMatchObject({ minutes: 15, pending: true, parts: [{ label: "车站到达预留", minutes: 15 }] });
  });

  it("提醒锚定最迟出发时间，而不是上一场结束", () => {
    const pair = makePair({ gapMinutes: 45 });
    const plan = assessLeg({ pair, route: route(38), mode: "transit", now: NOW });
    expect(departureReminder(plan, pair, Date.parse("2026-11-24T10:50:00+08:00"))).toContain("10:57");
    expect(departureReminder(plan, pair, Date.parse("2026-11-24T10:30:00+08:00"))).toBe("");
    const sufficient = assessLeg({ pair, route: route(20), mode: "transit", now: NOW });
    expect(departureReminder(sufficient, pair, Date.parse("2026-11-24T11:10:00+08:00"))).toContain("11:15");
  });

  it("时间不足不等待提醒窗口，状态本身即可展示", () => {
    const pair = makePair({ gapMinutes: 45 });
    const plan = assessLeg({ pair, route: route(38), mode: "transit", now: NOW });
    expect(plan.status).toBe("insufficient");
    expect(plan.advice).toContain("差 3 分钟");
    expect(departureReminder(plan, pair, Date.parse("2026-11-24T10:30:00+08:00"))).toBe("");
  });
});

it("labels same-day future trips as reference and never upgrades a pre-departure observation as the clock advances", () => {
  const pair = makePair();
  const observedAt = NOW - 2 * 60_000;
  const result = route(20, { observedAt });
  expect(assessLeg({ pair, route:result, mode:"transit", now:observedAt })).toMatchObject({status:"reference"});
  expect(assessLeg({ pair, route:result, mode:"transit", now:NOW })).toMatchObject({status:"reference"});
  expect(assessLeg({ pair, route:result, mode:"transit", now:NOW+16*60_000 })).toMatchObject({status:"stale"});
});

it("adds mode-specific door-to-door time once, without adding transit waiting or changing route minutes", () => {
  const pair=makePair();
  const plan=(mode:TodayLegPair["defaultMode"], accessOverride?:number) => assessLeg({
    pair, mode, accessOverride, route:route(20), now:NOW,
  });
  expect(plan("transit",8)).toMatchObject({routeMinutes:20,accessMinutes:0,doorToDoorMinutes:20,bufferMinutes:10,remainingMinutes:15});
  expect(plan("driving")).toMatchObject({status:"reference",routeMinutes:20,accessMinutes:8,accessEstimated:true,doorToDoorMinutes:28,remainingMinutes:7});
  expect(plan("selfDrive",12)).toMatchObject({status:"tight",routeMinutes:20,accessMinutes:12,accessEstimated:false,doorToDoorMinutes:32,remainingMinutes:3});
  expect(plan("driving",0)).toMatchObject({status:"sufficient",accessMinutes:0,remainingMinutes:15});
});

it("does not add railway processing time just because a place is a subway or bus stop", () => {
  const venue = place("subway", "人民广场（地铁站）", {category:"transport",address:"机场路"});
  expect(bufferPlan(makePair({toPlace:venue}))).toMatchObject({minutes:10,pending:false});
});
