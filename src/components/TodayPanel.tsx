import type { TravelRisk } from "../lib/tripDomain";
import type { TripAction } from "../lib/actionItems";
import { useState } from "react";
import { Navigation } from "lucide-react";
import { routeMapLink } from "../lib/navigationLinks";
import { modeName, routeProviderMode, type TodayLegPair, type TodayStop, type TravelMode } from "../lib/todayMap";
import type { LegResult } from "../lib/useTodayLegs";
import {
  LEG_STATUS_LABEL, departureReminder, legClock, sourceLabel, type LegAssessment,
} from "../lib/smartRoutes";
import { TripActions } from "./TripActions";

export const todayModes: TravelMode[] = ["walking", "transit", "driving", "selfDrive"];

export interface TodaySegment {
  pair: TodayLegPair;
  mode: TravelMode;
  result?: LegResult;
  plan: LegAssessment;
  risk?:TravelRisk;
  /** 用户展开比较时，同一路段其他交通方式的结果。 */
  options?: Partial<Record<TravelMode, LegResult>>;
  /** 用户为这一段单独设置的缓冲分钟数。 */
  bufferOverride?: number;
}

interface Props {
  heading: string;
  stops: TodayStop[];
  segments: TodaySegment[];
  loading: boolean;
  focused: string | null;
  onSelectStop: (stop: TodayStop) => void;
  onChooseMode: (pair: TodayLegPair, mode: TravelMode) => void;
  onFocus: (id: string) => void;
  onRetry: () => void;
  onOpenSchedule?: () => void;
  onNavigate?: (id: string) => void;
  onCompare?: (id: string | null) => void;
  onBufferChange?: (pair: TodayLegPair, minutes: number | undefined) => void;
  now?: number;
  syncWarning?: boolean;
  conflicts?: TravelRisk[];
  actions?: TripAction[];
  onAction?: (action: TripAction) => void;
  nextStopId?: string;
}

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function TodayPanel({ heading, stops, segments, loading, focused, onSelectStop, onChooseMode, onFocus, onRetry, onOpenSchedule, onNavigate, onCompare, onBufferChange, now = Date.now(), syncWarning, conflicts = [], actions = [], onAction, nextStopId }: Props) {
  if (!stops.length && !conflicts.length) return null;
  const fromEvent = new Map(segments.map(segment => [segment.pair.from.event.id, segment]));
  return (
    <section className="today-panel" aria-labelledby="today-map-heading">
      <div className="today-panel-heading">
        <h2 id="today-map-heading">{heading}</h2>
        {onOpenSchedule && <button type="button" className="text-action" onClick={onOpenSchedule}>查看日程</button>}
      </div>
      {syncWarning && <p className="field-help" role="status">日历待同步，暂不判断能否准时</p>}
      {/* 有统一行动项时不再重复展示同一条冲突摘要，避免同一风险出现两次。 */}
      {conflicts.length > 0 && !actions.length && <p className="field-help" role="status">
        {conflicts.some(conflict => conflict.status === "uncertain") && "待确认 · "}
        {conflicts[0].title} · {conflicts[0].basis}{conflicts.length>1 && ` 等 ${conflicts.length} 项`}
      </p>}
      {onAction && <TripActions compact actions={actions} limit={2} onAction={onAction} />}
      <ol className="today-stops">
        {stops.map(stop => {
          const { event, place } = stop;
          const segment = fromEvent.get(event.id);
          const subtitle = [
            place.name !== event.title ? place.name : "",
            event.local ? (event.local.origin === "intake" ? "智能录入" : "手动录入") : "",
            event.google?.stale ? "待同步" : "",
          ].filter(Boolean).join(" · ");
          return (
            <li className="today-stop" key={event.id} aria-current={event.id === nextStopId ? "step" : undefined}>
              <button className="today-stop-button" data-calendar-stop={event.id} onClick={() => onSelectStop(stop)}>
                <span className="today-stop-time" title="日历时间">
                  <time dateTime={event.start}>{clock.format(new Date(event.start))}</time>
                  {event.local?.endPending
                    ? <span className="today-end-pending">结束待确认</span>
                    : <time dateTime={event.end}>{clock.format(new Date(event.end))}</time>}
                </span>
                <span className="today-stop-copy">
                  <strong>{event.title}</strong>
                  {event.id === nextStopId && <small className="today-next">下一站</small>}
                  {subtitle && <small>{subtitle}</small>}
                </span>
              </button>
              {segment && (
                <TodayLeg segment={segment} loading={loading} now={now} focused={focused === segment.pair.id}
                  onChooseMode={onChooseMode} onFocus={onFocus} onRetry={onRetry} onNavigate={onNavigate}
                  onCompare={onCompare} onBufferChange={onBufferChange} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TodayLeg({ segment, loading, focused, now, onChooseMode, onFocus, onRetry, onNavigate, onCompare, onBufferChange }: {
  segment: TodaySegment;
  loading: boolean;
  focused: boolean;
  now: number;
  onChooseMode: Props["onChooseMode"];
  onFocus: Props["onFocus"];
  onRetry: Props["onRetry"];
  onNavigate: Props["onNavigate"];
  onCompare: Props["onCompare"];
  onBufferChange: Props["onBufferChange"];
}) {
  const { pair, mode, result, plan, risk, options = {}, bufferOverride } = segment;
  const [open, setOpen] = useState(false);
  const bad = plan.status === "insufficient" || plan.status === "overlap";
  const navigation = !pair.sameSpot ? routeMapLink(pair.from.place, pair.to.place, mode) : null;
  const failed = !pair.sameSpot && !result && !loading;
  const timing = pair.sameSpot ? "同一地点" : result ? `${modeName(mode)} ${result.minutes} 分钟` : loading ? "正在查路线…" : failed ? "路线暂不可用" : "暂未查到路线";
  const statusText = plan.status === "insufficient" ? `时间不足 ${plan.shortBy} 分钟`
    : plan.status === "overlap" ? `日程重叠 ${plan.shortBy} 分钟`
    : plan.status === "tight" ? `时间紧张 · 余 ${plan.remainingMinutes} 分钟`
    : plan.status === "stale" ? "路线已过期"
    : plan.status === "pending" ? "待确认"
    : plan.status === "reference" ? "参考结果 · 出发前复核"
    : plan.remainingMinutes !== null ? `时间充足 · 余 ${plan.remainingMinutes} 分钟` : LEG_STATUS_LABEL[plan.status];
  const reminder = departureReminder(plan, pair, now);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !focused) onFocus(pair.id);
    if (!next && focused) onFocus(pair.id);
    onCompare?.(next ? pair.id : null);
  };
  return (
    <div className={`today-leg${bad ? " is-late" : ""}${plan.status === "tight" ? " is-tight" : ""}`} data-status={plan.status} aria-busy={loading && !result}>
      <div className="today-leg-summary" aria-live="polite">
        {pair.sameSpot ? <span>{timing}</span> : result ? (
          <button type="button" aria-pressed={focused} onClick={toggle} title="展开这段路线的详情">
            {timing} <small>{sourceLabel(result, mode)}{result.observedAt && result.observedAt > 0 ? ` · ${new Date(result.observedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 查询` : ""}</small>
          </button>
        ) : <span>{timing}</span>}
        {failed && <button type="button" onClick={onRetry} title="重新查询这段路线">重试路线</button>}
        <button type="button" className="today-leg-toggle" aria-expanded={open} onClick={toggle}>
          {statusText}
        </button>
      </div>
      {plan.status === "stale" && <button type="button" className="text-action" onClick={onRetry}>刷新路线</button>}
      {reminder && <p className="today-leg-reminder" role="status">{reminder}</p>}
      {plan.advice && <p className={`today-leg-advice${bad ? " is-bad" : ""}`}>{plan.advice}</p>}
      {!pair.sameSpot && <div className="today-mode-group" role="group" aria-label={`${pair.from.event.title}至${pair.to.event.title}的交通方式`}>
        {todayModes.map(value => {
          const option = options[value] ?? (value === "selfDrive" ? options.driving : undefined);
          return <button type="button" key={value} aria-pressed={mode === value} onClick={() => onChooseMode(pair, value)}>
            {modeName(value)}{option ? ` ${option.minutes} 分` : loading ? "" : " 未查询"}
          </button>;
        })}
      </div>}
      {open && <div className="today-leg-detail">
        <dl className="today-leg-metrics">
          <div><dt>可用时间</dt><dd>{plan.availableMinutes === null ? "待确认" : `${plan.availableMinutes} 分钟`}</dd></div>
          <div><dt>路线耗时</dt><dd>{plan.routeMinutes === null ? "未查询" : `${plan.routeMinutes} 分钟`}</dd></div>
          <div><dt>额外缓冲</dt><dd>{plan.bufferMinutes} 分钟{plan.bufferOverridden ? "（本段）" : ""}</dd></div>
          <div><dt>剩余时间</dt><dd data-negative={plan.remainingMinutes !== null && plan.remainingMinutes < 0}>{plan.remainingMinutes === null ? "待确认" : `${plan.remainingMinutes} 分钟`}</dd></div>
          <div><dt>最迟出发</dt><dd>{plan.latestDeparture ? legClock(plan.latestDeparture) : "待确认"}</dd></div>
        </dl>
        <div className="today-buffer">
          <strong>缓冲组成</strong>
          <ul>{plan.bufferParts.map(part => <li key={part.label}>{part.label} {part.minutes} 分钟{part.pending ? " · PRD 建议值，待确认" : ""}</li>)}</ul>
          <small>路线服务已包含的步行、候车不会重复扣除。</small>
        </div>
        {onBufferChange && <div className="today-buffer-change" role="group" aria-label="调整这段的额外缓冲">
          {[0, 5, 10, 15, 20].map(minutes => <button type="button" key={minutes} aria-pressed={(bufferOverride ?? -1) === minutes}
            onClick={() => onBufferChange(pair, minutes)}>{minutes} 分</button>)}
          <button type="button" onClick={() => onBufferChange(pair, undefined)}>恢复默认 10 分</button>
        </div>}
        {risk && <p className="today-leg-risk"><strong>{risk.title}</strong> · {risk.basis}</p>}
        {result?.source === "synthetic" && <p className="field-help">合成演示路线，仅用于功能验收，不代表真实高德结果。</p>}
        {result && <p className="field-help">{sourceLabel(result, mode)} · {routeProviderMode(mode) === "driving" ? "驾车数据不含等车/停车时间" : plan.routeState === "reference" ? "未来或估算路线，仅作参考" : "当前路线"}</p>}
        <div className="today-leg-actions">
          <button type="button" onClick={onRetry}>刷新路线</button>
          {navigation && <a className="today-navigation" aria-label={`用${navigation.label}导航`} title={`用${navigation.label}导航`}
            href={navigation.href} target={navigation.target} onClick={() => onNavigate?.(pair.id)} rel="noopener noreferrer"><Navigation size={14} aria-hidden="true" /></a>}
        </div>
      </div>}
    </div>
  );
}
