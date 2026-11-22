import { expect, it } from "vitest";
import { buildTripActions, isImminent, type TripAction } from "../lib/actionItems";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { TravelRisk } from "../lib/tripDomain";
import type { Place } from "../types/place";

const place: Place = {
  id: "p", name: "会议室", city: "上海", category: "business", type: "system", source: "system",
  lat: 31.2, lng: 121.4, address: "", openingHours: "", description: "", tags: [], reason: "",
  status: "saved", isSaved: false, distanceText: "", externalLinks: {},
};
const event = (id: string, start: string, end: string): CalendarEntry => ({
  id, uid: id, title: `日程 ${id}`, location: "会议室", description: "", calendar: "工作",
  start, end, allDay: false, timezone: "Asia/Shanghai", place,
});

const risk = (over: Partial<TravelRisk> & Pick<TravelRisk, "id" | "type" | "severity" | "eventIds">): TravelRisk => ({
  status: "confirmed", title: over.type, basis: "证据说明", evidence: [
    { source: "google-calendar", recordId: over.eventIds[0], confidence: "recorded" },
  ], stale: false, action: { kind: "review-calendar", label: "检查日程" }, ...over,
});

const events = [
  event("a", "2026-11-24T09:00:00+08:00", "2026-11-24T10:00:00+08:00"),
  event("b", "2026-11-24T10:30:00+08:00", "2026-11-24T11:00:00+08:00"),
  event("c", "2026-11-24T15:00:00+08:00", "2026-11-24T16:00:00+08:00"),
];
const now = Date.parse("2026-11-24T08:00:00+08:00");

it("sorts by severity first, then by the earliest related schedule", () => {
  const actions = buildTripActions({ risks: [
    risk({ id: "info", type: "commute-time", severity: "info", eventIds: ["a"] }),
    risk({ id: "medium-late", type: "missing-stay", severity: "medium", eventIds: ["c"] }),
    risk({ id: "medium-early", type: "booking-change", severity: "medium", eventIds: ["b"] }),
    risk({ id: "high", type: "overlap", severity: "high", eventIds: ["c"] }),
  ], events, now });
  expect(actions.map(action => action.id)).toEqual(["high", "medium-early", "medium-late", "info"]);
});

it("keeps the related schedule, evidence, problem and next step on every action", () => {
  const [action] = buildTripActions({ risks: [
    risk({ id: "conflict", type: "booking-conflict", severity: "high", eventIds: ["a"],
      basis: "17:30 的返程车与 17:00 的会议重叠", action: { kind: "review-booking", label: "核对返程订单" } }),
  ], events, now });
  expect(action.events).toEqual([{ id: "a", title: "日程 a", start: events[0].start, end: events[0].end, location: "会议室" }]);
  expect(action.problem).toContain("17:30");
  expect(action.evidence[0]).toMatchObject({ source: "google-calendar", recordId: "a" });
  expect(action.nextStep).toEqual({ kind: "review-booking", label: "核对返程订单" });
  expect(action.uncertain).toBe(false);
  expect(action.dueAt).toBe(Date.parse(events[0].start));
});

it("marks uncertain and stale risks instead of presenting them as facts", () => {
  const [action] = buildTripActions({ risks: [
    risk({ id: "pending", type: "commute-time", severity: "medium", eventIds: ["a"], status: "uncertain" }),
    risk({ id: "stale", type: "missing-location", severity: "medium", eventIds: ["b"], stale: true }),
  ], events, now });
  expect(action.id).toBe("pending");
  expect(action.uncertain).toBe(true);
  expect(action.uncertainty).toContain("复核");
  const stale = buildTripActions({ risks: [
    risk({ id: "stale", type: "missing-location", severity: "medium", eventIds: ["b"], stale: true }),
  ], events, now })[0];
  expect(stale.uncertain).toBe(true);
  expect(stale.uncertainty).toContain("过期");
});

it("does not duplicate the same risk arriving from Today and Trips", () => {
  const shared = risk({ id: "same", type: "overlap", severity: "high", eventIds: ["a", "b"] });
  const actions = buildTripActions({ risks: [shared, { ...shared }], events, now });
  expect(actions).toHaveLength(1);
});

it("only calls an action imminent when it falls inside the window", () => {
  const [soon, later] = buildTripActions({ risks: [
    risk({ id: "soon", type: "overlap", severity: "high", eventIds: ["a"] }),
    risk({ id: "later", type: "overlap", severity: "high", eventIds: ["c"] }),
  ], events, now });
  expect(isImminent(soon, now)).toBe(true);
  expect(isImminent(later, now)).toBe(false);
});

it("keeps actions without a related schedule at the end of their severity group", () => {
  const actions: TripAction[] = buildTripActions({ risks: [
    risk({ id: "no-event", type: "missing-transport", severity: "medium", eventIds: [] }),
    risk({ id: "with-event", type: "missing-stay", severity: "medium", eventIds: ["c"] }),
  ], events, now });
  expect(actions.map(action => action.id)).toEqual(["with-event", "no-event"]);
});
