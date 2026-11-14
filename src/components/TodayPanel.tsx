import { Navigation } from "lucide-react";
import { routeMapLink } from "../lib/navigationLinks";
import { modeName, type LegVerdict, type TodayLegPair, type TodayStop, type TravelMode } from "../lib/todayMap";
import type { LegResult } from "../lib/useTodayLegs";

export const todayModes: TravelMode[] = ["walking", "transit", "driving", "selfDrive"];

export interface TodaySegment {
  pair: TodayLegPair;
  mode: TravelMode;
  result?: LegResult;
  verdict: LegVerdict;
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
}

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function TodayPanel({ heading, stops, segments, loading, focused, onSelectStop, onChooseMode, onFocus, onRetry, onOpenSchedule }: Props) {
  if (!stops.length) return null;
  const fromEvent = new Map(segments.map(segment => [segment.pair.from.event.id, segment]));
  return (
    <section className="today-panel" aria-labelledby="today-map-heading">
      <div className="today-panel-heading">
        <h2 id="today-map-heading">{heading}</h2>
        {onOpenSchedule && <button type="button" className="text-action" onClick={onOpenSchedule}>查看日程</button>}
      </div>
      <ol className="today-stops">
        {stops.map(stop => {
          const { event, place } = stop;
          const segment = fromEvent.get(event.id);
          const subtitle = [place.name !== event.title ? place.name : "", event.google?.stale ? "待同步" : ""].filter(Boolean).join(" · ");
          return (
            <li className="today-stop" key={event.id}>
              <button className="today-stop-button" onClick={() => onSelectStop(stop)}>
                <span className="today-stop-time" title="日历时间">
                  <time dateTime={event.start}>{clock.format(new Date(event.start))}</time>
                  <time dateTime={event.end}>{clock.format(new Date(event.end))}</time>
                </span>
                <span className="today-stop-copy">
                  <strong>{event.title}</strong>
                  {subtitle && <small>{subtitle}</small>}
                </span>
              </button>
              {segment && (
                <TodayLeg segment={segment} loading={loading} focused={focused === segment.pair.id} onChooseMode={onChooseMode} onFocus={onFocus} onRetry={onRetry} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TodayLeg({ segment, loading, focused, onChooseMode, onFocus, onRetry }: {
  segment: TodaySegment;
  loading: boolean;
  focused: boolean;
  onChooseMode: Props["onChooseMode"];
  onFocus: Props["onFocus"];
  onRetry: Props["onRetry"];
}) {
  const { pair, mode, result, verdict } = segment;
  const late = verdict.status === "late" || verdict.status === "overlap";
  const navigation = !pair.sameSpot ? routeMapLink(pair.from.place, pair.to.place, mode) : null;
  const timing = result ? `${modeName(mode)} ${result.minutes} 分钟` : loading ? "正在查路线…" : "暂未查到路线";
  const status = verdict.status === "overlap" ? "两个日程时间重叠"
    : verdict.status === "late" ? `差 ${verdict.shortBy} 分钟` : "";
  return (
    <div className={`today-leg${late ? " is-late" : ""}`} data-status={verdict.status}>
      <div className="today-leg-summary" aria-live="polite">
        {pair.sameSpot ? <span>同一地点</span> : result ? (
          <button type="button" aria-pressed={focused} onClick={() => onFocus(pair.id)} title="在地图上查看这段路线">
            {timing} <small>{result.source === "amap" ? mode === "driving" ? "高德 · 不含等车" : mode === "selfDrive" ? "高德 · 不含停车" : "高德" : "估算"}</small>
          </button>
        ) : <span>{timing}</span>}
        {!pair.sameSpot && !result && !loading && <button type="button" onClick={onRetry}>重试</button>}
        {status && <strong>{status}</strong>}
      </div>
      {verdict.advice && <p className="today-leg-advice">{verdict.advice}</p>}
      {!pair.sameSpot && (
        <div className="today-leg-actions">
          <div className="today-mode-group" role="group" aria-label={`${pair.from.event.title}至${pair.to.event.title}的交通方式`}>
            {todayModes.map(value => (
              <button type="button" key={value} aria-pressed={mode === value} onClick={() => onChooseMode(pair, value)}>{modeName(value)}</button>
            ))}
          </div>
          {navigation && <a className="today-navigation" aria-label={`用${navigation.label}导航`} title={`用${navigation.label}导航`}
            href={navigation.href} target={navigation.target} rel="noopener noreferrer"><Navigation size={14} aria-hidden="true" /></a>}
        </div>
      )}
    </div>
  );
}
