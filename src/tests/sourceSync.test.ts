import { expect, it } from "vitest";
import type { CalendarEntry } from "../lib/calendarEvents";
import { acknowledgeSourceChange, adoptSourceField, mergeGoogleSnapshot, overrideCalendarField, suppressCalendarEntry } from "../lib/googleCalendarSync";
import { initialUserPlaces } from "./fixtures/userPlaces";

const place = { ...initialUserPlaces[0], id: "place", name: "上海虹桥站", city: "上海" };
const event = (patch: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: "google:connection:work:meeting", uid: "meeting", title: "客户会议", location: "上海虹桥站",
  description: "", start: "2026-10-30T01:00:00.000Z", end: "2026-10-30T02:00:00.000Z",
  allDay: false, timezone: "Asia/Shanghai", calendar: "工作",
  google: { connectionId: "connection", calendarId: "work", eventId: "meeting", updated: "2026-10-29T01:00:00.000Z", originalStart: null },
  ...patch,
});

it("keeps a source-deleted event as a tombstone for History and ignores a stale cached copy", () => {
  const previous = [event({ place })];
  const deleted = [{ id: event().id, updated: "2026-10-29T02:00:00.000Z", at: Date.parse("2026-10-29T02:00:00.000Z") }];
  const next = mergeGoogleSnapshot(previous, [], "connection", deleted);
  expect(next).toHaveLength(1);
  expect(next[0].google?.deletedAt).toBeTruthy();
  expect(next[0].google?.deletedBy).toBe("source");
  expect(mergeGoogleSnapshot(next, [], "connection", deleted)).toEqual(next);
});

it("revives a source-deleted event only when the source revision is newer", () => {
  const previous = [event({ google: { ...event().google!, deletedAt: "2026-10-29T02:00:00.000Z", deletedBy: "source" } })];
  const stale = mergeGoogleSnapshot(previous, [event()], "connection");
  expect(stale[0].google?.deletedAt).toBeTruthy();
  const fresh = mergeGoogleSnapshot(previous, [event({ google: { ...event().google!, updated: "2026-10-29T03:00:00.000Z" } })], "connection");
  expect(fresh[0].google?.deletedAt).toBeUndefined();
});

it("does not let an older snapshot overwrite newer cached values", () => {
  const previous = [event({ title: "新名称", google: { ...event().google!, updated: "2026-10-29T05:00:00.000Z" } })];
  const next = mergeGoogleSnapshot(previous, [event({ title: "旧名称" })], "connection");
  expect(next[0].title).toBe("新名称");
  expect(next).toEqual(previous);
});

it("suppresses a user-deleted source key across a reconnect with a new connection id", () => {
  const removed = suppressCalendarEntry(event({ place }), "user", "2026-10-29T04:00:00.000Z");
  const reconnected = event({ id: "google:new:work:meeting", google: { ...event().google!, connectionId: "new" } });
  const next = mergeGoogleSnapshot([removed], [reconnected], "new");
  expect(next).toHaveLength(1);
  expect(next[0].id).toBe(removed.id);
  expect(next[0].google?.deletedBy).toBe("user");
});

it("keeps a confirmed local place when the source address changes and offers the source value", () => {
  const previous = [event({ place, placeResolution: { status: "confirmed", text: "上海虹桥站" } })];
  const next = mergeGoogleSnapshot(previous, [event({ location: "上海国家会展中心", google: { ...event().google!, updated: "2026-10-29T06:00:00.000Z" } })], "connection");
  expect(next[0].location).toBe("上海虹桥站");
  expect(next[0].place).toEqual(place);
  expect(next[0].sourceChange).toEqual([expect.objectContaining({ field: "location", from: "上海虹桥站", to: "上海国家会展中心" })]);
  expect(acknowledgeSourceChange(next[0], "location").sourceChange).toEqual([]);
  const adopted = adoptSourceField(next[0], "location");
  expect(adopted.location).toBe("上海国家会展中心");
  expect(adopted.overrides?.location).toBeUndefined();
  expect(adopted.sourceChange).toBeUndefined();
});

it("applies an explicit field override and keeps it stable on repeated sync", () => {
  const edited = overrideCalendarField(event(), "title", "本地标题", 1);
  const synced = mergeGoogleSnapshot([edited], [event({ google: { ...event().google!, updated: "2026-10-29T07:00:00.000Z" } })], "connection");
  expect(synced[0].title).toBe("本地标题");
  expect(mergeGoogleSnapshot(synced, [event({ google: { ...event().google!, updated: "2026-10-29T07:00:00.000Z" } })], "connection")).toEqual(synced);
});
