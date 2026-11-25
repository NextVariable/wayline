import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { usePanelFocus } from "../lib/usePanelFocus";
import type { Trip } from "../lib/tripDomain";
import type { BusinessTrip } from "../lib/businessTrips";
import { localDateKey } from "../lib/todayMap";
import { TripBookingRow } from "./TripBookingRow";

interface Props {
  trips: BusinessTrip[];
  selected?: BusinessTrip;
  selectedEventIds?: string[];
  mapIndices: Record<string, number>;
  timeline?: Trip["timeline"];
  now?: number;
  onTrip: (id: string | null) => void;
  onBack: () => void;
  onEvent: (id: string) => void;
  onOverview: () => void;
  onSchedule: () => void;
}

const dates = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const months = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" });
const timeLabel = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const dateLabel = (date: string) => dates.format(new Date(date + "T12:00:00"));
const rangeLabel = (trip: BusinessTrip) => {
  const first = trip.days[0].date;
  const last = trip.days.at(-1)!.date;
  return first === last ? dateLabel(first) : `${dateLabel(first)}–${dateLabel(last)}`;
};
const dayOf = (start: string) => start.length === 10 ? start : localDateKey(start);

/** 有限深度的历史工作台：只回看已经过去的计划安排，不表示实际到访。 */
export function HistoryPanel({ trips, selected, selectedEventIds, mapIndices, timeline, now = Date.now(), onTrip, onBack, onEvent, onOverview, onSchedule }: Props) {
  const panel = usePanelFocus(true);
  const [cityFilter, setCityFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const cities = useMemo(() => [...new Set(trips.flatMap(trip => trip.cities))].sort(), [trips]);
  const monthsList = useMemo(() => [...new Set(trips.map(trip => trip.days[0].date.slice(0, 7)))].sort((a, b) => b.localeCompare(a)), [trips]);
  const visible = useMemo(() => trips.filter(trip => (cityFilter === "all" || trip.cities.includes(cityFilter)) &&
    (monthFilter === "all" || trip.days.some(day => day.date.startsWith(monthFilter)))), [trips, cityFilter, monthFilter]);
  const rowsByDay = new Map<string, Trip["timeline"]>();
  if (selected) for (const row of timeline ?? selected.days.flatMap(day => day.events.map(event => ({ kind: "event" as const, event })))) {
    const date = dayOf(row.kind === "event" ? row.event.start : row.booking.start);
    const rows = rowsByDay.get(date) ?? [];
    rows.push(row);
    rowsByDay.set(date, rows);
  }
  return (
    <section className="workspace-panel business-trips-panel history-panel" ref={panel} aria-label="历史">
      <header className="panel-heading">
        <button className="text-action" type="button" onClick={selected ? () => onTrip(null) : onBack}>
          <ChevronLeft size={15} aria-hidden="true" />{selected ? "历史" : "今天"}
        </button>
        <h1>{selected ? selected.cities.join(" → ") : "历史"}</h1>
        {selected
          ? <button type="button" className="text-action" onClick={onOverview}>全程地图</button>
          : <button type="button" className="text-action" onClick={onSchedule}>日程</button>}
      </header>
      <p className="history-note">
        {selected ? `${rangeLabel(selected)} · 计划行程，未记录实际到访` : "过去的计划安排，可回看日期、地点与订单；不代表实际足迹。"}
      </p>
      {selected ? (
        <>
          {[...rowsByDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => (
            <section className="business-trip-day" aria-label={dateLabel(date)} key={date}>
              <header><h2>{dateLabel(date)}</h2></header>
              <ol className="wayline-timeline trip-timeline">
                {rows.map(row => {
                  if (row.kind === "booking") return <TripBookingRow key={`booking:${row.booking.id}`} order={row.booking} now={now} />;
                  const event = row.event;
                  return (
                    <li key={`event:${event.id}`} className="timeline-item is-stop">
                      <span className="tl-time"><time dateTime={event.start}>{timeLabel.format(new Date(event.start))}</time></span>
                      <span className="tl-rail" aria-hidden="true" />
                      <button type="button" className="tl-body business-trip-event" aria-pressed={selectedEventIds?.includes(event.id) ?? false}
                        onClick={() => onEvent(event.id)}>
                        <span>
                          <strong>{event.title}</strong>
                          {event.place?.name !== event.title && <small>{event.place?.name}</small>}
                          {event.google?.deletedAt && <small className="trip-order-state" data-state="cancelled">来源已删除 · 仅保留历史</small>}
                        </span>
                        <span className="business-trip-index" aria-label={`地图点位 ${mapIndices[event.id]}`}>{mapIndices[event.id]}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </>
      ) : (
        <>
          {!!trips.length && <div className="history-filters" role="group" aria-label="历史筛选">
            <label>城市<select value={cityFilter} onChange={event => setCityFilter(event.target.value)}>
              <option value="all">全部城市</option>
              {cities.map(city => <option key={city} value={city}>{city}</option>)}
            </select></label>
            <label>月份<select value={monthFilter} onChange={event => setMonthFilter(event.target.value)}>
              <option value="all">全部月份</option>
              {monthsList.map(month => <option key={month} value={month}>{month.replace("-", " 年 ")} 月</option>)}
            </select></label>
          </div>}
          {!trips.length && <p className="field-help">还没有已经过去的行程。历史只保留过去的计划安排。</p>}
          {!!trips.length && !visible.length && <p className="field-help">没有符合筛选条件的历史行程。</p>}
          <ul className="business-trip-list">{groupByMonth(visible).map(([month, group]) => (
            <li key={month} className="history-month">
              <h2>{months.format(new Date(group[0].days[0].date + "T12:00:00"))}</h2>
              <ul>{group.map(trip => (
                <li key={trip.id}>
                  <button type="button" className="business-trip-row" onClick={() => onTrip(trip.id)}>
                    <span>
                      <strong>{trip.cities.join(" → ")}</strong>
                      <small>{rangeLabel(trip)} · {trip.days.reduce((total, day) => total + day.events.length, 0)} 项安排</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}</ul>
            </li>
          ))}</ul>
        </>
      )}
    </section>
  );
}

function groupByMonth(trips: BusinessTrip[]): [string, BusinessTrip[]][] {
  const groups = new Map<string, BusinessTrip[]>();
  for (const trip of trips) {
    const month = trip.days[0].date.slice(0, 7);
    groups.set(month, [...(groups.get(month) ?? []), trip]);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}
