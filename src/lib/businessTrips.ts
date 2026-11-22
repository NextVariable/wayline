import type { CalendarEntry } from "./calendarEvents";
import { orderKind } from "../../shared/travel-order.mjs";
import { cityKey } from "./citySelection";
import { eventDay } from "./tripDay";
import { samePlace } from "./placeIdentity";
import type { Place } from "../types/place";

type PlacedEvent = CalendarEntry & { place: Place };
export interface BusinessTrip {
  id: string;
  days: { date: string; events: PlacedEvent[] }[];
  cities: string[];
}
export interface BusinessTripSettings {
  home: string;
  boundaries: Record<string, "split" | "join">;
  inferHome?: boolean;
}
export const emptyTripSettings: BusinessTripSettings = { home: "", boundaries: {} };

export function groupBusinessTrips(events: CalendarEntry[], settings: BusinessTripSettings, today: string): BusinessTrip[] {
  const home = cityKey(settings.home);
  if (!home) return [];
  const trips: BusinessTrip[] = [];
  let current: BusinessTrip | undefined;
  let homeBetween = false;
  const placed = events.filter((e): e is PlacedEvent => Boolean(e.place?.city?.trim()) &&
    !orderKind(e.title) && !e.allDay && !e.google?.stale && e.placeResolution?.status !== "ignored" &&
    e.placeResolution?.status !== "online" && Number.isFinite(Date.parse(e.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  for (const event of placed) {
    const city = cityKey(event.place.city);
    if (city === home) { homeBetween = true; continue; }
    if (!city || /^(未知|未识别|其他|全部)/.test(city)) continue;
    const date = eventDay(event);
    const previous = current?.days.at(-1);
    const gap = previous ? (Date.parse(date) - Date.parse(previous.date)) / 86_400_000 : 0;
    const boundary = settings.boundaries[event.id];
    if (!current || boundary === "split" || (boundary !== "join" && (gap > 2 || homeBetween))) {
      current = { id: event.id, days: [], cities: [] };
      trips.push(current);
    }
    const last = current.days.at(-1);
    if (last?.date === date) last.events.push(event);
    else current.days.push({ date, events: [event] });
    if (!current.cities.length || cityKey(current.cities.at(-1)!) !== city) current.cities.push(String(event.place.city));
    homeBetween = false;
  }
  return trips.filter(trip => trip.days.at(-1)!.date >= today);
}

export function tripPlaces(trip: BusinessTrip | undefined): Place[] {
  const places: Place[] = [];
  for (const event of trip?.days.flatMap(day => day.events) ?? []) {
    const known = places.find(place => samePlace(place, event.place));
    if (known) known.calendarEventIds!.push(event.id);
    else places.push({ ...event.place, calendarEventIds: [event.id] });
  }
  return places;
}

export function readBusinessTripSettings(owner: string): BusinessTripSettings {
  try {
    const value = JSON.parse(localStorage.getItem(`wayline.businessTrips.${owner}`) ?? "null");
    if (typeof value?.home !== "string") return emptyTripSettings;
    return {
      home: value.home,
      ...(value.inferHome === false && { inferHome: false }),
      boundaries: Object.fromEntries(Object.entries(value.boundaries ?? {}).filter(
        (entry): entry is [string, "split" | "join"] => entry[1] === "split" || entry[1] === "join")),
    };
  } catch { return emptyTripSettings; }
}

export function writeBusinessTripSettings(owner: string, settings: BusinessTripSettings) {
  localStorage.setItem(`wayline.businessTrips.${owner}`, JSON.stringify(settings));
}
