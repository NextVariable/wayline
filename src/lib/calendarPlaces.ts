import type { CalendarEntry, PlaceResolution } from "./calendarEvents";
import type { Place } from "../types/place";
import { normalizeLocationText, type PlaceAliases } from "./placeAliases";
import { calendarSearchCity } from "./geoSearch";
import { findCityPreset } from "../data/cities";

/** What the server resolver returns for one place. */
export interface FoundPlace { name: string; city: string; address: string; lat: number; lng: number }
export type ResolveResult =
  | { text: string; status: "found"; place: FoundPlace }
  | { text: string; status: "ambiguous"; candidates: FoundPlace[] }
  | { text: string; status: "none" }
  | { text: string; status: "unavailable" };

const DAY = 86_400_000;
/** Statuses that need the user, shown in the quiet corner hint. */
const PENDING = new Set(["ask", "ambiguous", "none", "missing"]);

function shortHash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** One stable map place per name and position, so the same result never duplicates a marker. */
export function toCalendarPlace(found: FoundPlace): Place {
  return {
    id: "calendar:" + shortHash(`${found.name}|${found.lat.toFixed(6)}|${found.lng.toFixed(6)}`),
    name: found.name, city: found.city, category: "custom", type: "user", source: "imported",
    lat: found.lat, lng: found.lng, address: found.address, openingHours: "", description: "",
    tags: ["日程"], reason: "", status: "saved", isSaved: false, distanceText: "", externalLinks: Object.fromEntries([]),
  };
}

const ONLINE_LINK = /https?:\/\/|meeting\.tencent\.com|zoom\.us|teams\.microsoft|feishu\.cn|larksuite/i;
const ONLINE_WORDS = new Set(["线上", "视频会议", "电话", "腾讯会议", "zoom"]);

export function classifyLocation(text: string): "empty" | "online" | "text" {
  const value = String(text ?? "").trim();
  if (!value) return "empty";
  if (ONLINE_LINK.test(value) || ONLINE_WORDS.has(value.toLowerCase())) return "online";
  return "text";
}

function windowOf(now: Date, days: number) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  return [start.getTime(), start.getTime() + days * DAY] as const;
}
const inWindow = (e: CalendarEntry, [from, to]: readonly [number, number]) => {
  const t = Date.parse(e.start);
  return t >= from && t < to;
};
const resolved = (e: CalendarEntry, resolution: PlaceResolution, place?: Place): CalendarEntry => {
  const next = { ...e, placeResolution: resolution };
  if (place) next.place = place; else delete next.place;
  return next;
};

/**
 * Decide, for events in the coming window, which places to look up, which to ask about and which to leave alone.
 * Events already placed, already decided, or carrying a resolution for their current text are untouched.
 */
export function planResolution(events: CalendarEntry[], aliases: PlaceAliases, { now, windowDays = 30, max = 40, city }: { now: Date; windowDays?: number; max?: number; city: string }) {
  const window = windowOf(now, windowDays);
  const fallback = findCityPreset(city);
  const lookups: { text: string; city: string }[] = [];
  const planned = new Set<string>();
  const updated = events.map(e => {
    if (!inWindow(e, window) || e.place) return e;
    if (e.placeResolution && e.placeResolution.text === e.location) return e;
    const kind = classifyLocation(e.location);
    if (kind === "empty") return resolved(e, { status: "missing", text: "" });
    if (kind === "online") return resolved(e, { status: "online", text: e.location });
    const key = normalizeLocationText(e.location);
    const remembered = aliases[key];
    if (remembered) return resolved(e, { status: "ask", text: e.location, suggestion: remembered });
    const text = e.location.trim(), searchCity = String(calendarSearchCity(text, fallback).name);
    const dedupe = key + "\u0000" + searchCity;
    if (!planned.has(dedupe) && planned.size < max) { planned.add(dedupe); lookups.push({ text, city: searchCity }); }
    return e;
  });
  return { lookups, updated };
}

/** Write server results onto unresolved events with the same text. Unavailable results leave events to be retried. */
export function applyResults(events: CalendarEntry[], results: ResolveResult[]) {
  const byText = new Map(results.map(r => [normalizeLocationText(r.text), r]));
  return events.map(e => {
    if (e.place || e.placeResolution) return e;
    const r = byText.get(normalizeLocationText(e.location));
    if (!r || r.status === "unavailable") return e;
    if (r.status === "found") return resolved(e, { status: "auto", text: e.location }, toCalendarPlace(r.place));
    if (r.status === "ambiguous") return resolved(e, { status: "ambiguous", text: e.location, candidates: r.candidates.slice(0, 5).map(toCalendarPlace) });
    return resolved(e, { status: "none", text: e.location });
  });
}

/** The user picked a place: use it, remember the phrase, and offer it (as a question) to other events with the same text. */
export function confirmPlace(events: CalendarEntry[], aliases: PlaceAliases, eventId: string, place: Place) {
  const target = events.find(e => e.id === eventId);
  if (!target) return { events, aliases };
  const key = normalizeLocationText(target.location);
  const nextAliases: PlaceAliases = { ...aliases, [key]: place };
  const next = events.map(e => {
    if (e.id === eventId) return resolved(e, { status: "confirmed", text: e.location }, place);
    const status = e.placeResolution?.status;
    if (!e.place && (status === "ambiguous" || status === "none") && normalizeLocationText(e.location) === key)
      return resolved(e, { status: "ask", text: e.location, suggestion: place });
    return e;
  });
  return { events: next, aliases: nextAliases };
}

export function acceptSuggestion(events: CalendarEntry[], eventId: string) {
  return events.map(e => e.id === eventId && e.placeResolution?.status === "ask" && e.placeResolution.suggestion
    ? resolved(e, { status: "confirmed", text: e.location }, e.placeResolution.suggestion) : e);
}

/** "不是": back to unrecognized, and this event is not asked about the same phrase again. */
export function rejectSuggestion(events: CalendarEntry[], eventId: string) {
  return events.map(e => e.id === eventId ? resolved(e, { status: "none", text: e.location }) : e);
}

export function ignorePlace(events: CalendarEntry[], eventId: string) {
  return events.map(e => e.id === eventId ? resolved(e, { status: "ignored", text: e.location }) : e);
}

export function pendingPlaces(events: CalendarEntry[], { now, windowDays = 30 }: { now: Date; windowDays?: number }) {
  const window = windowOf(now, windowDays);
  return events
    .filter(e => !e.place && inWindow(e, window) && PENDING.has(e.placeResolution?.status ?? ""))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** This week's placed events as map markers: one per place, listing every event held there. Ignored and online events stay off the map. */
export function calendarMapPlaces(events: CalendarEntry[], { now, days = 7 }: { now: Date; days?: number }): Place[] {
  const window = windowOf(now, days);
  const byId = new Map<string, Place>();
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    const status = e.placeResolution?.status;
    if (!e.place || e.google?.stale || !inWindow(e, window) || status === "ignored" || status === "online") continue;
    const seen = byId.get(e.place.id);
    if (seen) { seen.calendarEventIds = [...(seen.calendarEventIds ?? []), e.id]; continue; }
    const tags = e.place.tags.includes("日程") ? e.place.tags : [...e.place.tags, "日程"];
    byId.set(e.place.id, { ...e.place, tags, calendarEventIds: [e.id] });
  }
  return [...byId.values()];
}
