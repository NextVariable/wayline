import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePanelFocus } from "../lib/usePanelFocus";
import type { Trip } from "../lib/tripDomain";
import type { TripAction } from "../lib/actionItems";
import { localDateKey } from "../lib/todayMap";
import type { BusinessTrip } from "../lib/businessTrips";
import { useRef, type ReactNode } from "react";
import type { City } from "../types/place";
import { CityPicker } from "./CityPicker";
import { TripActions } from "./TripActions";

interface Props {
  home: string;
  connections?: ReactNode;
  timeline?: Trip["timeline"];
  actions?: TripAction[];
  onAction?: (action: TripAction) => void;
  openConnections?: boolean;
  now?: number;
  onSchedule: () => void;
  cities: City[];
  trips: BusinessTrip[];
  selected?: BusinessTrip;
  selectedEventIds?: string[];
  mapIndices: Record<string, number>;
  onHome: (city: string) => void;
  onTrip: (id: string | null) => void;
  onBack: () => void;
  onEvent: (id: string) => void;
  onOverview: () => void;
  onBoundary: (id: string, value: "join" | "split") => void;
}

const dates = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric", day: "numeric",
});
const dateLabel = (date: string) => dates.format(new Date(date + "T12:00:00"));
const timeLabel = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function BusinessTripsPanel({ home, cities, trips, selected, selectedEventIds, mapIndices, onHome, onTrip, onBack, onEvent, onOverview, onBoundary, connections, onSchedule, timeline, actions = [], onAction, openConnections, now = Date.now() }: Props) {
  const panel = usePanelFocus(true);
  const details = useRef<HTMLDetailsElement>(null);
  const showConnections = (segmentId?: string) => {
    if (!details.current) return;
    details.current.open = true;
    const section=Array.from(details.current.querySelectorAll<HTMLElement>("[data-trip-segment]"))
      .find(item=>item.dataset.tripSegment === segmentId);
    const target=section?.querySelector<HTMLElement>("button, summary") ?? details.current.querySelector("summary");
    target?.focus();
  };
  const rowsByDay = new Map<string, Trip["timeline"]>();
  if (selected) for (const row of timeline ?? selected.days.flatMap(day => day.events.map(event => ({kind:"event" as const,event})))) {
    const start = row.kind === "event" ? row.event.start : row.booking.start;
    const date = start.length === 10 ? start : localDateKey(start);
    const rows=rowsByDay.get(date) ?? [];
    rows.push(row);
    rowsByDay.set(date,rows);
  }
  return (
    <section className="workspace-panel business-trips-panel" ref={panel} aria-label="行程">
      <header className="panel-heading">
        <button className="text-action" type="button" onClick={selected ? () => onTrip(null) : onBack}>
          <ChevronLeft size={15} aria-hidden="true" />{selected ? "行程" : "地点"}
        </button>
        <h1>{selected ? selected.cities.join(" → ") : "行程"}</h1>
        {selected
          ? <button type="button" className="text-action" onClick={onOverview}>全程地图</button>
          : <button type="button" className="text-action" onClick={onSchedule}>日程</button>}
      </header>
      {selected ? <>
        <TripActions actions={actions} onAction={action => {
          if (onAction) { onAction(action); return; }
          if (action.nextStep.kind === "review-calendar" || action.nextStep.kind === "confirm-place") onSchedule();
          else showConnections(action.segmentId);
        }} />
        {[...rowsByDay].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows]) => {
          const index=selected.days.findIndex(day=>day.date === date);
          return <section className="business-trip-day" aria-label={dateLabel(date)} key={date}>
            <header>
              <h2>{dateLabel(date)}</h2>
              {index > 0 && <button type="button" className="text-action" onClick={() => onBoundary(selected.days[index].events[0].id, "split")}>从这天拆开</button>}
            </header>
            <ul>{rows.map(row => {
              if (row.kind === "booking") {
                const order=row.booking;
                const state=order.state === "cancelled" ? "收到取消通知" : order.state === "changed" ? "收到改签通知" :
                  order.state === "review" ? "待核对" : !!order.end && Date.parse(order.end)<now ? "时段已过" : order.source === "日历" ? "日历安排" : "订单记录";
                return <li key={`booking:${order.id}`} className="business-trip-event trip-order-row" data-state={order.state ?? "confirmed"}>
                  <span>{order.start.length === 10 ? "住宿" : timeLabel.format(new Date(order.start))}</span>
                  <span><strong>{[order.number,order.from?.name,order.to.name].filter(Boolean).join(" · ")}</strong>
                    <small className="trip-order-state" data-state={order.state ?? "confirmed"}>{state} · {order.provenance?.some(item=>item.source === "gmail") && order.provenance.some(item=>item.source !== "gmail") ? "日历 / Gmail" : order.source}</small></span>
                </li>;
              }
              const event=row.event;
              return <li key={`event:${event.id}`}>
                <button type="button" className="business-trip-event" aria-pressed={selectedEventIds?.includes(event.id) ?? false}
                  onClick={() => onEvent(event.id)}>
                  <span><time dateTime={event.start}>{timeLabel.format(new Date(event.start))}</time><small>{Date.parse(event.end)<now ? "已过日程" : "日历"}</small></span>
                  <span><strong>{event.title}</strong>{event.place?.name !== event.title && <small>{event.place?.name}</small>}</span>
                  <span className="business-trip-index" aria-label={`地图点位 ${mapIndices[event.id]}`}>{mapIndices[event.id]}</span>
                </button>
              </li>;
            })}</ul>
          </section>;
        })}
        {connections && <details className="trip-connections" ref={details} open={openConnections || undefined}><summary>通勤与预订详情</summary>{connections}</details>}
        {trips.indexOf(selected) > 0 && <button type="button" className="text-action" onClick={() => onBoundary(selected.id, "join")}>与上一趟合并</button>}
      </> : <>
        <CityPicker
          activeCity={home}
          cities={cities}
          onChange={city => onHome(city.name)}
          onClearHome={() => onHome("")}
        />
        {home && !trips.length && <p className="field-help">暂无有明确地点的外地日程。</p>}
        <ul className="business-trip-list">{trips.map(trip => (
          <li key={trip.id}>
            <button type="button" className="business-trip-row" onClick={() => onTrip(trip.id)}>
              <span><strong>{trip.cities.join(" → ")}</strong><small>
                {dateLabel(trip.days[0].date)}{trip.days.length > 1 ? `–${dateLabel(trip.days.at(-1)!.date)}` : ""}
              </small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}</ul>
      </>}
    </section>
  );
}
