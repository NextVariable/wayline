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
const past = event("d", "2026-11-23T09:00:00+08:00", "2026-11-23T10:00:00+08:00");
const far = event("e", "2026-11-27T09:00:00+08:00", "2026-11-27T10:00:00+08:00");
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

it("does not merge different orders that share a meeting and title", () => {
  const shared = risk({ id: "order-a", type: "booking-conflict", severity: "high", eventIds: ["a"],
    evidence: [{ source: "gmail", recordId: "order-a", confidence: "recorded" }] });
  const other = risk({ id: "order-b", type: "booking-conflict", severity: "high", eventIds: ["a"],
    evidence: [{ source: "gmail", recordId: "order-b", confidence: "recorded" }] });
  const actions = buildTripActions({ risks: [shared, other], events, now });
  expect(actions.map(action => action.id).sort()).toEqual(["order-a", "order-b"]);
});

it("keeps confirmed facts ahead of equally severe, equally timed uncertainty", () => {
  const actions = buildTripActions({ risks: [
    risk({ id: "uncertain", type: "commute-time", severity: "medium", eventIds: ["a"], status: "uncertain" }),
    risk({ id: "confirmed", type: "missing-stay", severity: "medium", eventIds: ["a"] }),
  ], events, now });
  expect(actions.map(action => action.id)).toEqual(["confirmed", "uncertain"]);
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

it("ranks expired risks behind actionable work instead of pinning them first", () => {
  const actions = buildTripActions({ risks: [
    risk({ id: "old-high", type: "overlap", severity: "high", eventIds: ["d"] }),
    risk({ id: "next-medium", type: "missing-stay", severity: "medium", eventIds: ["c"] }),
  ], events: [...events, past], now });
  expect(actions.map(action => action.id)).toEqual(["next-medium", "old-high"]);
  expect(actions[1].lifecycle).toBe("expired");
});

it("orders imminent work ahead of future work and undated work ahead of expired", () => {
  const actions = buildTripActions({ risks: [
    risk({ id: "far", type: "overlap", severity: "medium", eventIds: ["e"] }),
    risk({ id: "soon", type: "overlap", severity: "medium", eventIds: ["a"] }),
    risk({ id: "undated", type: "missing-transport", severity: "medium", eventIds: [] }),
  ], events: [...events, past, far], now });
  expect(actions.map(action => action.id)).toEqual(["soon", "far", "undated"]);
  expect(actions.map(action => action.lifecycle)).toEqual(["imminent", "upcoming", "undated"]);

  const withExpired = buildTripActions({ risks: [
    risk({ id: "expired", type: "overlap", severity: "high", eventIds: ["d"] }),
    risk({ id: "undated", type: "missing-transport", severity: "medium", eventIds: [] }),
  ], events: [...events, past], now });
  expect(withExpired.map(action => action.id)).toEqual(["undated", "expired"]);
});

it("keeps ongoing and cross-day meetings actionable instead of expiring them at start", () => {
  const ongoing = event("ongoing", "2026-11-24T07:30:00+08:00", "2026-11-24T09:30:00+08:00");
  const overnight = event("overnight", "2026-11-23T22:00:00+08:00", "2026-11-24T08:30:00+08:00");
  const actions = buildTripActions({ risks: [
    risk({ id: "ongoing-risk", type: "overlap", severity: "high", eventIds: ["ongoing"] }),
    risk({ id: "overnight-risk", type: "commute-time", severity: "medium", eventIds: ["overnight"] }),
  ], events: [...events, ongoing, overnight], now });
  expect(actions.map(action => [action.id, action.lifecycle])).toEqual([
    ["ongoing-risk", "imminent"],
    ["overnight-risk", "imminent"],
  ]);
});

it("keeps unresolved booking problems actionable after departure as overdue", () => {
  const actions = buildTripActions({ risks: [
    risk({ id: "past-booking", type: "booking-conflict", severity: "high", eventIds: ["d"] }),
    risk({ id: "past-overlap", type: "overlap", severity: "high", eventIds: ["d"] }),
  ], events: [...events, past], now });
  expect(actions.map(action => [action.id, action.lifecycle])).toEqual([
    ["past-booking", "overdue"],
    ["past-overlap", "expired"],
  ]);
});

it("compares event end times across time zones without shifting the day", () => {
  const utcOngoing = event("utc-ongoing", "2026-11-24T01:00:00Z", "2026-11-24T03:00:00Z");
  const utcNow = Date.parse("2026-11-24T02:00:00Z");
  const [action] = buildTripActions({ risks: [
    risk({ id: "utc-risk", type: "intercity", severity: "medium", eventIds: ["utc-ongoing"] }),
  ], events: [utcOngoing], now: utcNow });
  expect(action.lifecycle).toBe("imminent");
  expect(action.dueAt).toBe(Date.parse("2026-11-24T01:00:00Z"));
});

it("keeps stale and uncertainty markers on expired risks", () => {
  const [expired] = buildTripActions({ risks: [
    risk({ id: "stale-old", type: "missing-location", severity: "high", eventIds: ["d"], stale: true }),
  ], events: [...events, past], now });
  expect(expired.lifecycle).toBe("expired");
  expect(expired.uncertain).toBe(true);
  expect(expired.uncertainty).toContain("过期");
});
