import { useState } from "react";
import { Check, MapPin, Pencil, Trash2 } from "lucide-react";
import { ActionMenu } from "./ActionMenu";
import { classifyLocation } from "../lib/calendarPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
import { localDay } from "../lib/quickIntent";
import { acknowledgeSourceChange, adoptSourceField } from "../lib/googleCalendarSync";
import type { Place } from "../types/place";

type AgendaItem = { key: string; date: string; order: string } & ({ event: CalendarEntry } | { place: Place });
const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" });

export function calendarEventIsPast(event: CalendarEntry, today: string) {
  if (event.allDay) return event.end === event.start ? event.end < today : event.end <= today;
  return localDay(new Date(event.end)) < today;
}

export function ScheduleAgenda({ events, schedules, past, onPeriodChange, connected, onRemove, onChange, onSearch, onSelectPlace, onEdit, onDelete, onToggleCompleted }: {
  events: CalendarEntry[];
  schedules: Place[];
  past: boolean;
  onPeriodChange: (past: boolean) => void;
  connected: boolean;
  onRemove?: (id: string) => void;
  onChange?: (events: CalendarEntry[]) => void;
  onSearch: (query: string) => Promise<Place[]>;
  onSelectPlace: (place: Place) => void;
  onEdit: (place: Place) => void;
  onDelete: (id: string) => void;
  onToggleCompleted: (place: Place) => void;
}) {
  const [limit, setLimit] = useState(20);
  const [matching, setMatching] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ id: string; places: Place[] } | null>(null);
  const [error, setError] = useState("");
  const today = localDay();
  const items: AgendaItem[] = [];
  for (const event of events) {
    const start = event.allDay ? event.start : localDay(new Date(event.start));
    if (calendarEventIsPast(event, today) !== past) continue;
    const date = !past && start < today ? today : start;
    items.push({ key: `calendar-${event.id}`, date, order: event.allDay ? "" : clock.format(new Date(event.start)), event });
  }
  for (const place of schedules) {
    const [storedDate, time = ""] = place.distanceText.split(" ");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(storedDate) && Number.isFinite(Date.parse(storedDate)) ? storedDate : "";
    if ((!!date && date < today) === past) items.push({ key: `local-${place.id}`, date, order: time, place });
  }
  items.sort((a, b) => (past ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.order.localeCompare(b.order));
  const groups = new Map<string, AgendaItem[]>();
  for (const item of items.slice(0, limit)) {
    const group = groups.get(item.date) ?? [];
    group.push(item);
    groups.set(item.date, group);
  }

  async function showEventPlace(event: CalendarEntry, place?: Place) {
    const show = (selected: Place) => onSelectPlace({ ...selected, calendarEventIds: [...new Set([...(selected.calendarEventIds ?? []), event.id])] });
    setError("");
    if (place || event.place) {
      try {
        if (place) onChange?.([{ ...event, place }]);
        setMatches(null);
        show(place ?? event.place!);
      } catch { setError("保存地点失败，请重试"); }
      return;
    }
    setMatching(event.id);
    setMatches(null);
    try {
      const places = await onSearch(event.location);
      if (places.length) setMatches({ id: event.id, places: places.slice(0, 4) });
      else setError("没有找到对应地点，原日历地址已保留。");
    } catch { setError("暂时无法查找地点，请稍后重试。"); }
    finally { setMatching(null); }
  }

  return <section className="schedule-agenda" aria-label="日程列表">
    <div className="schedule-period" role="group" aria-label="日程范围">
      {(["近期", "过去"] as const).map((label, index) => <button type="button" className="text-action" key={label}
        aria-pressed={past === (index === 1)} onClick={() => { onPeriodChange(index === 1); setLimit(20); setMatches(null); setError(""); }}>{label}</button>)}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!items.length && <p className="schedule-empty">{past ? "暂无过去日程" : "近期没有日程"}</p>}
    {[...groups].map(([date, group]) => <section className="schedule-day" key={date}>
      <h2>{!date ? "日期待确认" : date === today ? "今天" : day.format(new Date(date + "T12:00:00"))}</h2>
      {group.map(item => {
        if ("place" in item) {
          const { place } = item;
          const title = place.reason.split(" · ").slice(2).join(" · ").trim() || place.name;
          const completed = place.status === "visited";
          return <article className="schedule-agenda-row" key={item.key}>
            <time>{item.order || "时间不限"}</time>
            <button type="button" className="schedule-agenda-main" onClick={() => onSelectPlace(place)}>
              <strong>{title}</strong>
              <small>{[place.name !== title ? place.name : "", completed ? "已完成" : ""].filter(Boolean).join(" · ")}</small>
            </button>
            <ActionMenu label={`${title}操作`} actions={[
              { label: "编辑日程", icon: <Pencil size={15} />, onSelect: () => onEdit(place) },
              ...(place.tags.includes("待办事项") ? [{ label: completed ? "标记未完成" : "标记完成", icon: <Check size={15} />, onSelect: () => onToggleCompleted(place) }] : []),
              { label: "删除日程", icon: <Trash2 size={15} />, danger: true, onSelect: () => onDelete(place.id) },
            ]} />
          </article>;
        }
        const { event } = item;
        const online = event.placeResolution?.status === "online" || classifyLocation(event.location) === "online" || /^online$/i.test(event.location.trim());
        const location = online ? "线上" : event.place?.name || event.location.trim();
        const repeatsTitle = location === event.title.trim();
        const canRemove = !!onRemove && (!event.google || !connected);
        const crossedDay = !event.allDay && localDay(new Date(event.end)) !== localDay(new Date(event.start));
        return <article className="schedule-agenda-row" key={item.key}>
          <div className="schedule-agenda-time"><time dateTime={event.start}>{event.allDay ? "全天" : item.order}</time>
            {!event.allDay && <time dateTime={event.end}>{crossedDay ? new Date(event.end).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " : ""}{clock.format(new Date(event.end))}</time>}
          </div>
          <div className="schedule-agenda-main">
            <strong>{event.title}</strong>
            {!!location && (online || event.placeResolution?.status === "ignored" ? !repeatsTitle && <small>{location}</small> :
              <button type="button" className="text-action schedule-location" disabled={matching !== null} onClick={() => void showEventPlace(event)}>
                <MapPin size={13} aria-hidden="true" />{matching === event.id ? "正在查找…" : repeatsTitle ? "在地图查看" : location}
              </button>)}
            {event.google?.stale && <small>待同步</small>}
            {!!event.sourceChange?.length && <div className="calendar-source-change" role="status">
              {event.sourceChange.map(change => <small key={change.field}>
                来源已更新{change.field === "location" ? "地点" : change.field === "title" ? "名称" : "时间"}：{change.from} → {change.to}，保留本地修改
              </small>)}
              <span>
                <button type="button" className="text-action" onClick={() => onChange?.(events.map(item =>
                  item.id === event.id ? acknowledgeSourceChange(item, "location") : item))}>保留本地</button>
                <button type="button" className="text-action" onClick={() => onChange?.(events.map(item =>
                  item.id === event.id ? adoptSourceField(item, "location") : item))}>使用来源</button>
              </span>
            </div>}
          </div>
          {canRemove && <ActionMenu label={`${event.title}操作`} actions={[{ label: "从 Wayline 移除", danger: true, icon: <Trash2 size={15} />, onSelect: () => {
            try { onRemove?.(event.id); } catch { setError("移除失败，请重试"); }
          } }]} />}
          {matches?.id === event.id && <div className="calendar-place-matches">{matches.places.map(place =>
            <button type="button" key={place.id} onClick={() => void showEventPlace(event, place)}><strong>{place.name}</strong><small>{place.address}</small></button>)}</div>}
        </article>;
      })}
    </section>)}
    {items.length > limit && <button type="button" className="text-action" onClick={() => setLimit(count => count + 20)}>显示更多日程</button>}
  </section>;
}
