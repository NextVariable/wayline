import type { CalendarEntry } from "./calendarEvents";
import type { Place } from "../types/place";
import { cityKey } from "./citySelection";
import { classifyLocation } from "./calendarPlaces";
import { samePlace } from "./placeIdentity";

export type TravelMode = "walking" | "transit" | "driving" | "selfDrive";
export const routeProviderMode = (mode: TravelMode) => mode === "selfDrive" ? "driving" : mode;
export interface TodayStop { event: CalendarEntry; place: Place }
export interface TodayLegPair {
  id: string;
  from: TodayStop;
  to: TodayStop;
  sameSpot: boolean;
  crossCity: boolean;
  directKm: number;
  gapMinutes: number;
  departure?: string;
  /** The previous arrangement has no confirmed end time, so feasibility stays unknown. */
  endPending?: boolean;
  defaultMode: TravelMode;
}

const WALK_LIMIT_KM = 1.2;

/** Great-circle distance in kilometres. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const defaultMode = (directKm: number, crossCity: boolean): TravelMode =>
  crossCity ? "driving" : directKm < WALK_LIMIT_KM ? "walking" : "transit";

/** Local calendar day of an instant on this device, as YYYY-MM-DD. */
export function localDateKey(value: string | number | Date) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Not all-day, not an online meeting, not ignored: the events that can sit on a timeline. */
const onTimeline = (e: CalendarEntry) => !e.allDay && Number.isFinite(Date.parse(e.start)) && e.placeResolution?.status !== "ignored" && e.placeResolution?.status !== "online" && classifyLocation(e.location) !== "online";
const hasPlace = (e: CalendarEntry): e is CalendarEntry & { place: Place } => !!e.place && !e.google?.stale;

export function pickDay(events: CalendarEntry[], now: Date, options: { todayKey?: string; dayOf?: (event: CalendarEntry) => string } = {}): { dateKey: string; isToday: boolean; nextLabel?: string } | null {
  const dayOf = options.dayOf ?? ((event: CalendarEntry) => localDateKey(event.start));
  const today = options.todayKey ?? localDateKey(now);
  const days = [...new Set(events.filter(e => onTimeline(e) && hasPlace(e)).map(dayOf))].filter(k => k >= today).sort();
  if (!days.length) return null;
  const dateKey = days[0];
  if (dateKey === today) return { dateKey, isToday: true };
  const [, month, day] = dateKey.split("-");
  return { dateKey, isToday: false, nextLabel: `${Number(month)} 月 ${Number(day)} 日` };
}

/** Placed events of one local day, in start order. */
export function stopsOfDay(events: CalendarEntry[], dateKey: string, dayOf: (event: CalendarEntry) => string = e => localDateKey(e.start)): TodayStop[] {
  return events
    .filter(e => onTimeline(e) && dayOf(e) === dateKey && hasPlace(e))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map(e => ({ event: e, place: e.place! }));
}

/**
 * Neighbouring placed events. An event on that day that is on the timeline but has no place yet sits between
 * its neighbours in time, so they are not joined across it: where the person goes in between is unknown.
 */
export function legPairs(events: CalendarEntry[], dateKey: string, dayOf: (event: CalendarEntry) => string = e => localDateKey(e.start)): TodayLegPair[] {
  const sameDay = events
    .filter(e => onTimeline(e) && dayOf(e) === dateKey)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const online = events.filter(event => !event.allDay && dayOf(event) === dateKey &&
    (event.placeResolution?.status === "online" || classifyLocation(event.location) === "online") && !event.google?.stale)
    .sort((a,b) => Date.parse(a.start)-Date.parse(b.start));
  let onlineIndex = 0;
  let onlineEnd = Number.NEGATIVE_INFINITY;
  const pairs: TodayLegPair[] = [];
  for (let i = 1; i < sameDay.length; i += 1) {
    const prev = sameDay[i - 1], next = sameDay[i];
    if (!hasPlace(prev) || !hasPlace(next)) continue;
    const from: TodayStop = { event: prev, place: prev.place }, to: TodayStop = { event: next, place: next.place };
    const nextStart=Date.parse(next.start);
    while (onlineIndex<online.length && Date.parse(online[onlineIndex].start)<nextStart) {
      onlineEnd=Math.max(onlineEnd,Date.parse(online[onlineIndex].end));
      onlineIndex++;
    }
    const prevEnd=Date.parse(prev.end);
    const departure=Math.max(prevEnd,onlineEnd);
    const directKm = haversineKm(from.place, to.place);
    const crossCity = cityKey(from.place.city) !== cityKey(to.place.city);
    pairs.push({
      id: `${prev.id}>${next.id}`, from, to,
      sameSpot: samePlace(from.place, to.place),
      crossCity, directKm,
      gapMinutes: Math.floor((nextStart-departure) / 60000),
      ...(departure > prevEnd && {departure:new Date(departure).toISOString()}),
      ...(prev.local?.endPending && {endPending:true}),
      defaultMode: defaultMode(directKm, crossCity),
    });
  }
  return pairs;
}

export interface LegOption { mode: TravelMode; minutes: number; source: "amap" | "estimate" }
export interface LegVerdict { status: "ok" | "late" | "overlap" | "unknown"; shortBy?: number; advice?: string }

export const modeName = (mode: TravelMode) => ({ walking: "步行", transit: "地铁公交", driving: "打车", selfDrive: "自驾" })[mode];

/**
 * Can this leg be made? Only a time the map service actually returned can be late: an estimate is shown but never raises
 * an alarm. When it cannot be made, exactly one fix is offered: another looked-up mode that fits (the fastest), else leaving earlier.
 */
export function judgeLeg(pair: TodayLegPair, options: LegOption[], chosen: TravelMode): LegVerdict {
  if (pair.gapMinutes < 0) return { status: "overlap" };
  if (pair.sameSpot) return { status: "ok" };
  if (!Number.isFinite(pair.gapMinutes)) return { status: "unknown" };
  if (pair.endPending) return { status: "unknown", advice: "上一场结束时间待确认，补齐后再判断能否赶上" };
  const current = options.find(o => o.mode === chosen);
  if (!current || current.source !== "amap") return { status: "unknown" };
  const shortBy = Math.ceil(current.minutes) - pair.gapMinutes;
  if (shortBy <= 0) return { status: "ok" };
  const faster = options
    .filter(o => routeProviderMode(o.mode) !== routeProviderMode(chosen) && o.source === "amap" && Math.ceil(o.minutes) <= pair.gapMinutes)
    .sort((a, b) => a.minutes - b.minutes)[0];
  const advice = faster
    ? `改用${modeName(faster.mode)}约 ${Math.ceil(faster.minutes)} 分钟`
    : `如需准时，上一场需提前 ${Math.ceil(shortBy / 5) * 5} 分钟离开`;
  return { status: "late", shortBy, advice };
}
