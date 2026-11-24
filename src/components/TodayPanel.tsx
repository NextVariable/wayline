import type { TravelRisk } from "../lib/tripDomain";
import type { TripAction } from "../lib/actionItems";
import { Navigation } from "lucide-react";
import { routeMapLink } from "../lib/navigationLinks";
import { modeName, type LegVerdict, type TodayLegPair, type TodayStop, type TravelMode } from "../lib/todayMap";
import type { LegResult } from "../lib/useTodayLegs";
import { TripActions } from "./TripActions";

export const todayModes: TravelMode[] = ["walking", "transit", "driving", "selfDrive"];

export interface TodaySegment {
  pair: TodayLegPair;
  mode: TravelMode;
  result?: LegResult;
  verdict: LegVerdict;
  risk?:TravelRisk;
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
  syncWarning?: boolean;
  conflicts?: TravelRisk[];
  actions?: TripAction[];
  onAction?: (action: TripAction) => void;
  nextStopId?: string;
}

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function TodayPanel({ heading, stops, segments, loading, focused, onSelectStop, onChooseMode, onFocus, onRetry, onOpenSchedule, onNavigate, syncWarning, conflicts = [], actions = [], onAction, nextStopId }: Props) {
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
                <TodayLeg segment={segment} loading={loading} focused={focused === segment.pair.id} onChooseMode={onChooseMode} onFocus={onFocus} onRetry={onRetry} onNavigate={onNavigate} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TodayLeg({ segment, loading, focused, onChooseMode, onFocus, onRetry, onNavigate }: {
  segment: TodaySegment;
  loading: boolean;
  focused: boolean;
  onChooseMode: Props["onChooseMode"];
  onFocus: Props["onFocus"];
  onRetry: Props["onRetry"];
  onNavigate: Props["onNavigate"];
}) {
  const { pair, mode, result, verdict, risk } = segment;
  const late = verdict.status === "late" || verdict.status === "overlap";
  const navigation = !pair.sameSpot ? routeMapLink(pair.from.place, pair.to.place, mode) : null;
  const failed = !pair.sameSpot && !result && !loading;
  const timing = result ? `${modeName(mode)} ${result.minutes} 分钟` : loading ? "正在查路线…" : failed ? "路线暂不可用" : "暂未查到路线";
  const status = verdict.status === "overlap" ? "两个日程时间重叠"
    : verdict.status === "late" ? `差 ${verdict.shortBy} 分钟` : "";
  return (
    <div className={`today-leg${late ? " is-late" : ""}`} data-status={verdict.status} aria-busy={loading}>
      <div className="today-leg-summary" aria-live="polite">
        {pair.sameSpot ? <span>同一地点</span> : result ? (
          <button type="button" aria-pressed={focused} onClick={() => onFocus(pair.id)} title="在地图上查看这段路线">
            {timing} <small>{result.source === "amap" ? mode === "driving" ? "高德 · 不含等车" : mode === "selfDrive" ? "高德 · 不含停车" : "高德" : "估算"}{result.observedAt && result.observedAt > 0 ? ` · ${new Date(result.observedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 查询` : ""}</small>
          </button>
        ) : <span>{timing}</span>}
        {failed && <button type="button" onClick={onRetry} title="重新查询这段路线">重试路线</button>}
        {status && <strong>{status}</strong>}
      </div>
      {risk?.stale && result && <button type="button" className="text-action" onClick={onRetry}>更新路线参考</button>}
      {verdict.advice && <p className="today-leg-advice">{verdict.advice}</p>}
      {!pair.sameSpot && (
        <div className="today-leg-actions">
          <div className="today-mode-group" role="group" aria-label={`${pair.from.event.title}至${pair.to.event.title}的交通方式`}>
            {todayModes.map(value => (
              <button type="button" key={value} aria-pressed={mode === value} onClick={() => onChooseMode(pair, value)}>{modeName(value)}</button>
            ))}
          </div>
          {navigation && <a className="today-navigation" aria-label={`用${navigation.label}导航`} title={`用${navigation.label}导航`}
            href={navigation.href} target={navigation.target} onClick={() => onNavigate?.(pair.id)} rel="noopener noreferrer"><Navigation size={14} aria-hidden="true" /></a>}
        </div>
      )}
    </div>
  );
}
