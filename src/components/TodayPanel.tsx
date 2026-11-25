import { Fragment } from "react";
import type { TravelRisk } from "../lib/tripDomain";
import type { TripAction } from "../lib/actionItems";
import { routeMapLink } from "../lib/navigationLinks";
import { type TodayLegPair, type TodayStop, type TravelMode } from "../lib/todayMap";
import { pairDeparture, type LegResult } from "../lib/useTodayLegs";
import { departureReminder, sourceLabel, type LegAssessment } from "../lib/smartRoutes";
import type { RoadAccessMode } from "../lib/smartRoutes";
import { RouteLeg } from "./RouteLeg";

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
  accessOverride?: number;
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
  onAccessChange?: (mode:RoadAccessMode, minutes:number | undefined) => void;
  onBufferChange?: (pair: TodayLegPair, minutes: number | undefined) => void;
  now?: number;
  syncWarning?: boolean;
  conflicts?: TravelRisk[];
  actions?: TripAction[];
  onAction?: (action: TripAction) => void;
  /** Opens Copilot with this reminder as context; only passed when the model is configured. */
  onExplainAction?: (action: TripAction) => void;
  nextStopId?: string;
}

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function TodayPanel({ heading, stops, segments, loading, focused, onSelectStop, onChooseMode, onFocus, onRetry, onOpenSchedule, onNavigate, onCompare, onBufferChange, onAccessChange, now = Date.now(), syncWarning, conflicts = [], actions = [], onAction, onExplainAction, nextStopId }: Props) {
  if (!stops.length && !conflicts.length) return null;
  const fromEvent = new Map(segments.map(segment => [segment.pair.from.event.id, segment]));
  return (
    <section className="today-panel" aria-labelledby="today-map-heading">
      <div className="today-panel-heading">
        <div>
          <p className="today-eyebrow">Today</p>
          <h2 id="today-map-heading">{heading}</h2>
        </div>
        {onOpenSchedule && <button type="button" className="text-action" onClick={onOpenSchedule}>查看日程</button>}
      </div>
      {syncWarning && <p className="field-help" role="status">日历待同步，暂不判断能否准时</p>}
      {/* 有统一行动项时不再重复展示同一条冲突摘要，避免同一风险出现两次。 */}
      {conflicts.length > 0 && !actions.length && <p className="field-help" role="status">
        {conflicts.some(conflict => conflict.status === "uncertain") && "待确认 · "}
        {conflicts[0].title} · {conflicts[0].basis}{conflicts.length>1 && ` 等 ${conflicts.length} 项`}
      </p>}
      {onAction && actions.length > 0 && <div className="today-attention" data-severity={actions[0].severity}>
        <button type="button" onClick={() => onAction(actions[0])}>
          <span>{actions[0].title}</span>
          <small>{actions[0].nextStep.label}</small>
        </button>
        {actions.length > 1 && <span className="today-attention-count">{actions.length - 1} 项见行程</span>}
        {onExplainAction && <button type="button" className="text-action today-attention-explain" onClick={() => onExplainAction(actions[0])}>解释</button>}
      </div>}
      <ol className="wayline-timeline today-timeline">
        {stops.map(stop => {
          const { event, place } = stop;
          const segment = fromEvent.get(event.id);
          const next = event.id === nextStopId;
          const subtitle = [
            place.name !== event.title ? place.name : "",
            event.local ? (event.local.origin === "intake" ? "智能录入" : "手动录入") : "",
            event.google?.stale ? "待同步" : "",
          ].filter(Boolean).join(" · ");
          return (
            <Fragment key={event.id}>
              <li className={`timeline-item is-stop${next ? " is-next" : ""}`} aria-current={next ? "step" : undefined}>
                <span className="tl-time">
                  <time dateTime={event.start}>{clock.format(new Date(event.start))}</time>
                  {event.local?.endPending
                    ? <span className="today-end-pending">结束待确认</span>
                    : <time dateTime={event.end}>{clock.format(new Date(event.end))}</time>}
                </span>
                <span className="tl-rail" aria-hidden="true" />
                <button type="button" className="tl-body stop-row" data-calendar-stop={event.id} onClick={() => onSelectStop(stop)}>
                  <span className="stop-title">
                    <strong>{event.title}</strong>
                    {next && <span className="stop-next">下一站</span>}
                  </span>
                  {subtitle && <small>{subtitle}</small>}
                </button>
              </li>
              {segment && (
                <li className="timeline-item is-leg">
                  <span className="tl-time" aria-hidden="true" />
                  <span className="tl-rail" aria-hidden="true" />
                  <div className="tl-body">
                    <TodayLeg segment={segment} loading={loading} now={now} focused={focused === segment.pair.id}
                      onChooseMode={onChooseMode} onFocus={onFocus} onRetry={onRetry} onNavigate={onNavigate}
                      onCompare={onCompare} onBufferChange={onBufferChange} onAccessChange={onAccessChange} />
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}

function TodayLeg({ segment, loading, focused, now, onChooseMode, onFocus, onRetry, onNavigate, onCompare, onBufferChange, onAccessChange }: {
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
  onAccessChange: Props["onAccessChange"];
}) {
  const { pair, mode, result, plan, risk, options = {}, bufferOverride } = segment;
  const navigation = !pair.sameSpot ? routeMapLink(pair.from.place, pair.to.place, mode) : null;
  const failed = !pair.sameSpot && !result && !loading;
  return (
    <RouteLeg
      mode={mode}
      minutes={result?.minutes}
      plan={plan}
      sameSpot={pair.sameSpot}
      loading={loading && !result}
      failed={failed}
      focused={focused}
      risk={risk}
      bufferOverride={bufferOverride}
      accessOverride={segment.accessOverride}
      onAccessChange={onAccessChange}
      reminder={departureReminder(plan, pair, now)}
      source={result ? sourceLabel(result, mode) : undefined}
      observedAt={result?.observedAt}
      plannedAt={pairDeparture(pair)}
      options={todayModes.map(value => ({
        mode: value,
        minutes: (options[value] ?? (value === "selfDrive" ? options.driving : undefined))?.minutes,
      }))}
      onChooseMode={nextMode => onChooseMode(pair, nextMode)}
      onRetry={onRetry}
      onNavigate={() => onNavigate?.(pair.id)}
      onBufferChange={minutes => onBufferChange?.(pair, minutes)}
      navigation={navigation}
      onToggle={open => {
        if (open && !focused) onFocus(pair.id);
        if (!open && focused) onFocus(pair.id);
        onCompare?.(open ? pair.id : null);
      }}
      note={result?.source === "synthetic"
        ? <p className="leg-note">合成演示路线，仅用于功能验收，不代表真实高德结果。</p>
        : null}
    />
  );
}
