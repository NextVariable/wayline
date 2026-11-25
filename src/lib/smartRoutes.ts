import type { RouteEvidence } from "./tripDomain";
import { localDateKey, routeProviderMode, type TodayLegPair, type TravelMode } from "./todayMap";

/** 本轮可行性结论。每种状态都对应 PRD RT11 的一行，不再用 ok/late 两值含糊表达。 */
export type LegStatus = "overlap" | "pending" | "stale" | "insufficient" | "tight" | "sufficient" | "reference";
export type RouteState = "missing" | "fresh" | "reference" | "stale";

export interface BufferPart { label: string; minutes: number; pending?: boolean }
export interface BufferPlan { minutes: number; parts: BufferPart[]; pending: boolean; overridden: boolean }

export interface LegAssessment {
  status: LegStatus;
  mode: TravelMode;
  availableMinutes: number | null;
  routeMinutes: number | null;
  bufferMinutes: number;
  accessMinutes: number;
  accessEstimated: boolean;
  doorToDoorMinutes: number | null;
  bufferParts: BufferPart[];
  bufferPending: boolean;
  bufferOverridden: boolean;
  remainingMinutes: number | null;
  /** 最迟建议出发时间（ISO）。留出路线耗时与额外缓冲。 */
  latestDeparture: string | null;
  shortBy: number;
  reference: boolean;
  routeState: RouteState;
  advice: string;
}

export const DEFAULT_COMMUTE_BUFFER = 10;
export const TIGHT_REMAINING_MINUTES = 10;
export const DEPARTURE_REMINDER_LEAD_MINUTES = 10;
const MINUTE = 60_000;
const MAX_FUTURE_AGE = 24 * 60 * MINUTE;

/** 分模式时效：步行结构稳定，打车/自驾受路况影响最大。未来日一律按参考处理。 */
export const ROUTE_TTLS: Record<TravelMode, number> = {
  walking: 24 * 60 * MINUTE,
  transit: 15 * MINUTE,
  driving: 5 * MINUTE,
  selfDrive: 5 * MINUTE,
};

/** 铁路/机场缓冲采用 PRD 建议值，不是供应商官方规则，界面上标注待确认。 */
const HUB_BUFFERS = {
  railDeparture: 30,
  airportDeparture: 120,
  railArrival: 15,
  airportArrival: 45,
} as const;

type Hub = "rail" | "airport" | null;

function hubOf(place: { name: string; category?: string; address?: string }): Hub {
  if (/地铁|公交|轻轨|有轨电车|BRT|汽车站/i.test(place.name)) return null;
  if (/机场|航站楼/.test(place.name)) return "airport";
  if (/火车站|高铁站|铁路客站|动车站/.test(place.name) ||
      (place.category === "transport" && /站(?:[（(].*[）)])?$/.test(place.name))) return "rail";
  return null;
}

/**
 * 额外缓冲。普通通勤默认 10 分钟；车站/机场用 PRD 建议值，且不叠加普通缓冲，
 * 避免把路线服务已经包含的步行、候车再扣一次。用户单段覆盖时整段替换。
 */
export function bufferPlan(pair: TodayLegPair, override?: number): BufferPlan {
  if (Number.isFinite(override)) {
    const minutes = Math.max(0, Math.round(override as number));
    return { minutes, parts: [{ label: "本段单独设置", minutes }], pending: false, overridden: true };
  }
  const toHub = hubOf(pair.to.place);
  const fromHub = hubOf(pair.from.place);
  if (toHub) {
    const minutes = toHub === "airport" ? HUB_BUFFERS.airportDeparture : HUB_BUFFERS.railDeparture;
    return {
      minutes,
      parts: [{ label: toHub === "airport" ? "前往机场预留" : "前往车站预留", minutes, pending: true }],
      pending: true,
      overridden: false,
    };
  }
  if (fromHub) {
    const minutes = fromHub === "airport" ? HUB_BUFFERS.airportArrival : HUB_BUFFERS.railArrival;
    return {
      minutes,
      parts: [{ label: fromHub === "airport" ? "机场到达预留" : "车站到达预留", minutes, pending: true }],
      pending: true,
      overridden: false,
    };
  }
  return {
    minutes: DEFAULT_COMMUTE_BUFFER,
    parts: [{ label: "普通通勤缓冲", minutes: DEFAULT_COMMUTE_BUFFER }],
    pending: false,
    overridden: false,
  };
}

/** Compare actual instants, including a departure later on the same day. */
export function isFutureLeg(pair: TodayLegPair, now: number) {
  const departure = pair.departure ?? pair.from.event.end;
  return Date.parse(departure) > now;
}

/** 路线的时效语义。缺失与过期分开，未来路线单独标记参考。 */
export function legRouteState(pair: TodayLegPair, route: RouteEvidence | undefined, mode: TravelMode, now: number): RouteState {
  if (pair.sameSpot && !route) return "fresh";
  if (!route || !Number.isFinite(route.minutes) || route.minutes < 0) return "missing";
  if (!route.observedAt || route.observedAt > now + MINUTE) return "stale";
  const future = isFutureLeg(pair, now);
  const queriedBeforeDeparture = isFutureLeg(pair, route.observedAt);
  const maxAge = future ? MAX_FUTURE_AGE : ROUTE_TTLS[mode] ?? ROUTE_TTLS[routeProviderMode(mode) as TravelMode] ?? ROUTE_TTLS.transit;
  if (now - route.observedAt > maxAge) return "stale";
  if ((route.source === "estimate" || route.source === "synthetic")) return "reference";
  return future || queriedBeforeDeparture ? "reference" : "fresh";
}

export function sourceLabel(route: RouteEvidence | undefined, mode: TravelMode) {
  if (!route || route.source === "estimate") return "估算";
  if (route.source === "synthetic") return "合成演示路线";
  if (routeProviderMode(mode) === "driving") return "高德驾车 · 查询时参考";
  return "高德";
}

export type RoadAccessMode = Extract<TravelMode, "driving" | "selfDrive">;
export const ROAD_ACCESS_DEFAULTS: Record<RoadAccessMode, number> = { driving: 8, selfDrive: 10 };
export const roadAccessLabel = (mode: RoadAccessMode) => mode === "driving" ? "等车预留" : "取车与停车预留";
export function roadAccessMode(mode: TravelMode): mode is RoadAccessMode {
  return mode === "driving" || mode === "selfDrive";
}
const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai" });

export function legClock(iso: string | null | undefined) {
  if (!iso) return "";
  const value = Date.parse(iso);
  return Number.isFinite(value) ? clock.format(new Date(value)) : "";
}

/**
 * 统一可行性计算：
 *   available = 下一安排开始 − 上一安排可离开
 *   remaining = available − routeDuration − extraBuffer
 *   latestDeparture = 下一安排开始 − routeDuration − extraBuffer
 * 缺失结束时间不会被当成 0 分钟会议；同地点也必须走完重叠与缓冲判断。
 */
export function assessLeg(input: {
  pair: TodayLegPair;
  route?: RouteEvidence;
  mode: TravelMode;
  now: number;
  bufferOverride?: number;
  accessOverride?: number;
}): LegAssessment {
  const { pair, route, mode, now, bufferOverride } = input;
  const buffer = bufferPlan(pair, bufferOverride);
  const roadAccess = !pair.sameSpot && roadAccessMode(mode);
  const configured = input.accessOverride;
  const confirmedAccess = typeof configured === "number" && Number.isFinite(configured) && configured >= 0 && configured <= 120;
  const accessMinutes = roadAccess ? (confirmedAccess ? Math.round(configured) : ROAD_ACCESS_DEFAULTS[mode]) : 0;
  const accessEstimated = roadAccess && !confirmedAccess;
  const available = Number.isFinite(pair.gapMinutes) ? Math.floor(pair.gapMinutes) : null;
  const routeState = legRouteState(pair, route, mode, now);
  const future = isFutureLeg(pair, now);
  const reference = routeState === "reference" || (routeState === "fresh" && (future || accessEstimated));
  const routeMinutes = pair.sameSpot ? 0
    : route && routeState !== "missing" && routeState !== "stale" ? Math.ceil(route.minutes) : null;
  const base = {
    mode,
    availableMinutes: available,
    routeMinutes,
    bufferMinutes: buffer.minutes, accessMinutes, accessEstimated,
    doorToDoorMinutes: routeMinutes === null ? null : routeMinutes + accessMinutes,
    bufferParts: buffer.parts,
    bufferPending: buffer.pending,
    bufferOverridden: buffer.overridden,
    reference,
    routeState,
  };
  const unknown = (status: LegStatus, advice: string, shortBy = 0): LegAssessment => ({
    ...base, status, remainingMinutes: null, latestDeparture: null, shortBy, advice,
  });
  const fromStart = Date.parse(pair.from.event.start);
  const fromEnd = Date.parse(pair.from.event.end);
  if (available === null || !Number.isFinite(fromEnd) || !Number.isFinite(fromStart)) {
    return unknown("pending", "上一场结束时间无效或不完整，先补齐时间");
  }
  // 结束早于开始属于无效时间，不做“解释成次日”的猜测。
  if (fromEnd < fromStart) {
    return unknown("pending", "上一场结束时间早于开始时间，先核对原始日程");
  }
  if (available < 0) {
    return { ...unknown("overlap", "两场日程时间重叠，先调整会议时间", Math.abs(available)) };
  }
  if (pair.endPending) {
    return unknown("pending", "上一场结束时间待确认，补齐后再判断能否赶上");
  }
  if (routeState === "missing") {
    return unknown("pending", pair.sameSpot ? "同地点无需路线，但时间尚未核对" : "尚无可用路线，查询后再判断");
  }
  if (routeState === "stale") {
    return unknown("stale", "路线参考已过期，刷新后再判断");
  }
  const minutes = routeMinutes ?? 0;
  const remaining = available - minutes - accessMinutes - buffer.minutes;
  const latestDeparture = new Date(Date.parse(pair.to.event.start) - (minutes + accessMinutes + buffer.minutes) * MINUTE).toISOString();
  const estimateOnly = route?.source === "estimate";
  // 未来日期与估算路线只给参考语义：即使按参考值算不过来，也不输出确定的风险结论。
  if (reference) {
    return {
      ...base, status: "reference", remainingMinutes: remaining, latestDeparture,
      shortBy: remaining < 0 ? -remaining : 0,
      advice: estimateOnly
        ? `估算${remaining < 0 ? `可能不足 ${-remaining} 分钟` : `约余 ${remaining} 分钟`}，需查询实时路线复核`
        : remaining < 0
          ? `参考路线可能不足 ${-remaining} 分钟，出发前需复核`
          : `按参考路线约余 ${remaining} 分钟，出发前需复核`,
    };
  }
  // 车站/机场预留采用 PRD 建议值而非供应商规则，未确认前保持待确认。
  if (buffer.pending) {
    return {
      ...base, status: "pending", remainingMinutes: remaining, latestDeparture: null, shortBy: 0,
      advice: `车站/机场预留按建议值 ${buffer.minutes} 分钟，确认后再判断`,
    };
  }
  if (remaining < 0) {
    const shortBy = -remaining;
    const departure = legClock(latestDeparture);
    return {
      ...base, status: "insufficient",
      remainingMinutes: remaining, latestDeparture, shortBy,
      advice: `按${sourceLabel(route, mode)} ${minutes} 分钟，留出 ${buffer.minutes} 分钟缓冲后仍差 ${shortBy} 分钟；最迟 ${departure} 出发，或改用更快方式`,
    };
  }
  if (remaining < TIGHT_REMAINING_MINUTES) {
    return {
      ...base, status: "tight", remainingMinutes: remaining, latestDeparture, shortBy: 0,
      advice: `剩余 ${remaining} 分钟，最迟 ${legClock(latestDeparture)} 出发`,
    };
  }
  return {
    ...base, status: "sufficient", remainingMinutes: remaining, latestDeparture, shortBy: 0,
    advice: `预计提前 ${remaining} 分钟到达`,
  };
}

/** 只建议当天、临近最迟出发窗口的路段。时间不足的风险另由状态直接展示，不等待窗口。 */
export function departureReminder(plan: LegAssessment, pair: TodayLegPair, now: number) {
  if (!plan.latestDeparture || plan.reference) return "";
  if (["overlap", "pending", "stale"].includes(plan.status)) return "";
  if (localDateKey(pair.to.event.start) !== localDateKey(now)) return "";
  const latest = Date.parse(plan.latestDeparture);
  const start = Date.parse(pair.to.event.start);
  if (!(now >= latest - DEPARTURE_REMINDER_LEAD_MINUTES * MINUTE && now <= start)) return "";
  return `建议 ${legClock(plan.latestDeparture)} 前出发，已预留 ${DEPARTURE_REMINDER_LEAD_MINUTES} 分钟提前量`;
}

export const LEG_STATUS_LABEL: Record<LegStatus, string> = {
  overlap: "日程重叠",
  pending: "待确认",
  stale: "路线已过期",
  insufficient: "时间不足",
  tight: "时间紧张",
  sufficient: "时间充足",
  reference: "参考结果",
};

export const ROUTE_STATE_LABEL: Record<RouteState, string> = {
  missing: "未查询",
  fresh: "当前",
  reference: "参考",
  stale: "已过期",
};
