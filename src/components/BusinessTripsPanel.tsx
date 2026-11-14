import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePanelFocus } from "../lib/usePanelFocus";
import type { BusinessTrip } from "../lib/businessTrips";
import type { ReactNode } from "react";
import type { City } from "../types/place";
import { CityPicker } from "./CityPicker";

interface Props {
  home: string;
  connections?: ReactNode;
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

export function BusinessTripsPanel({ home, cities, trips, selected, selectedEventIds, mapIndices, onHome, onTrip, onBack, onEvent, onOverview, onBoundary, connections, onSchedule }: Props) {
  const panel = usePanelFocus(true);
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
        {selected.days.map((day, index) => (
          <section className="business-trip-day" aria-label={dateLabel(day.date)} key={day.date}>
            <header>
              <h2>{dateLabel(day.date)}</h2>
              {index > 0 && <button type="button" className="text-action" onClick={() => onBoundary(day.events[0].id, "split")}>从这天拆开</button>}
            </header>
            <ul>{day.events.map(event => (
              <li key={event.id}>
                <button type="button" className="business-trip-event" aria-pressed={selectedEventIds?.includes(event.id) ?? false}
                  onClick={() => onEvent(event.id)}>
                  <span><time dateTime={event.start}>{timeLabel.format(new Date(event.start))}</time><small>日历</small></span>
                  <span><strong>{event.title}</strong>{event.place.name !== event.title && <small>{event.place.name}</small>}</span>
                  <span className="business-trip-index" aria-label={`地图点位 ${mapIndices[event.id]}`}>{mapIndices[event.id]}</span>
                </button>
              </li>
            ))}</ul>
          </section>
        ))}
        {connections}
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
