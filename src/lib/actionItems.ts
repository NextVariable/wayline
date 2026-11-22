import type { ActionItem, CalendarEvent, RiskType, SourceProvenance, TravelRisk } from "./tripDomain";

export interface ActionEventRef {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
}

export interface TripAction {
  id: string;
  riskIds: string[];
  type: RiskType;
  severity: TravelRisk["severity"];
  status: TravelRisk["status"];
  title: string;
  problem: string;
  evidence: SourceProvenance[];
  eventIds: string[];
  events: ActionEventRef[];
  segmentId?: string;
  nextStep: ActionItem;
  uncertain: boolean;
  uncertainty?: string;
  dueAt?: number;
  stale: boolean;
}

const SEVERITY_WEIGHT: Record<TravelRisk["severity"], number> = { high: 0, medium: 1, info: 2 };

function eventRef(event: CalendarEvent): ActionEventRef {
  return { id: event.id, title: event.title, start: event.start, end: event.end, location: event.location };
}

function earliest(events: ActionEventRef[]): number | undefined {
  const times = events.map(event => Date.parse(event.start)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : undefined;
}

function uncertaintyOf(risk: TravelRisk): string | undefined {
  if (risk.stale) return "来源数据可能已过期，请重新刷新后再确认";
  if (risk.status === "uncertain") return "判断基于估算或未确认数据，实际出行前需复核";
  if (!risk.evidence.length) return "暂无来源证据，需人工确认";
  return undefined;
}

/**
 * 把来自 Today 与 Trips 的 TravelRisk 统一成可执行行动项。
 * 只做派生与排序，不触发订票、不修改日历、不调用外部供应商。
 */
export function buildTripActions({ risks, events, now }: {
  risks: TravelRisk[];
  events: CalendarEvent[];
  now?: number;
}): TripAction[] {
  const byId = new Map(events.map(event => [event.id, event]));
  const seen = new Map<string, TripAction>();
  for (const risk of risks) {
    // 证据记录也参与去重：同一会议下不同订单的同类风险不能被合并。
    const evidenceKey = [...new Set(risk.evidence.map(item => `${item.source}:${item.recordId}`))].sort().join(",");
    const key = `${risk.type}|${risk.segmentId ?? ""}|${[...risk.eventIds].sort().join(",")}|${risk.title}|${evidenceKey}`;
    const existing = seen.get(key);
    if (existing) {
      if (!existing.riskIds.includes(risk.id)) existing.riskIds.push(risk.id);
      continue;
    }
    const refs = risk.eventIds.map(id => byId.get(id)).filter((event): event is CalendarEvent => !!event).map(eventRef);
    const uncertainty = uncertaintyOf(risk);
    const dueAt = earliest(refs);
    seen.set(key, {
      id: risk.id,
      riskIds: [risk.id],
      type: risk.type,
      severity: risk.severity,
      status: risk.status,
      title: risk.title,
      problem: risk.basis,
      evidence: risk.evidence,
      eventIds: risk.eventIds,
      events: refs,
      segmentId: risk.segmentId,
      nextStep: risk.action,
      uncertain: !!uncertainty,
      uncertainty,
      dueAt,
      stale: risk.stale,
    });
  }
  return [...seen.values()].sort((a, b) => {
    const severity = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (severity) return severity;
    const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    // 同等严重度和时间下，先给出已确认事实，再给出待核实推断。
    if (a.uncertain !== b.uncertain) return a.uncertain ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 仅用于展示的近期相关性判断，不影响排序。 */
export function isImminent(action: TripAction, now: number, windowMs = 6 * 60 * 60_000): boolean {
  return action.dueAt !== undefined && action.dueAt >= now && action.dueAt - now <= windowMs;
}
