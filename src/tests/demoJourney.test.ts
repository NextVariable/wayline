import { afterEach, beforeEach, expect, it } from "vitest";
import { buildTravelWorkspace } from "../lib/tripIntelligence";
import { assessTrip, calendarRisks } from "../lib/tripFeasibility";
import { createDemoMailbox, demoBusinessSettings, demoCalendarEntries, demoDay } from "../lib/demoWorkspace";
import { localDateKey } from "../lib/todayMap";

const NOW = Date.parse("2026-11-23T02:00:00Z");
const freshness = { calendarCurrent: true, mailboxCurrent: true, now: NOW };

beforeEach(() => {
  (globalThis as any).localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
});
afterEach(() => { delete (globalThis as any).localStorage; });

function demoWorkspace() {
  const events = demoCalendarEntries(NOW);
  const mailbox = createDemoMailbox(NOW);
  return {
    events,
    mailbox,
    model: buildTravelWorkspace({
      events,
      settings: demoBusinessSettings,
      day: new Date(NOW),
      mailbox,
      cities: ["上海", "苏州"],
    }),
  };
}

it("groups the synthetic cross-city schedule into one two-day Suzhou trip", () => {
  const { model } = demoWorkspace();
  expect(model.home).toBe("上海");
  expect(model.tripModels.size).toBe(1);
  const trip = [...model.tripModels.values()][0];
  expect(trip.cities).toEqual(["苏州"]);
  expect(trip.days.map(day => day.date)).toEqual([demoDay(1, NOW), demoDay(2, NOW)]);
  expect(trip.segments.some(segment => segment.kind === "intercity")).toBe(true);
});

it("carries the demo rail orders with duplicate calendar/Gmail provenance and the cancellation", () => {
  const { model } = demoWorkspace();
  const trip = [...model.tripModels.values()][0];
  const legs = trip.segments.flatMap(segment => segment.kind === "intercity" ? [segment.leg] : []);
  const orders = legs.flatMap(leg => leg.orders);
  const outbound = orders.find(order => order.number === "G7002");
  expect(outbound?.provenance?.map(item => item.source).sort()).toEqual(["calendar-file", "gmail"]);
  expect(orders.some(order => order.number === "G7010" && order.state === "cancelled")).toBe(true);
  expect(orders.some(order => order.number === "G7026")).toBe(true);
});

it("surfaces the demo action risks without inventing missing transport", () => {
  const { model } = demoWorkspace();
  const trip = [...model.tripModels.values()][0];
  const risks = assessTrip(trip, freshness);
  const types = new Set(risks.map(risk => risk.type));
  expect(types.has("booking-change")).toBe(true);
  expect(types.has("booking-conflict")).toBe(true);
  expect(types.has("missing-location")).toBe(true);
  expect(types.has("missing-stay")).toBe(true);
  expect(types.has("missing-transport")).toBe(false);
  for (const risk of risks) {
    expect(risk.evidence.length).toBeGreaterThan(0);
    expect(risk.action.label.length).toBeGreaterThan(0);
  }
});

it("flags the same-city overlap on the demo today", () => {
  const { events } = demoWorkspace();
  const risks = calendarRisks(events, freshness, demoDay(0, NOW));
  expect(risks.some(risk => risk.type === "overlap")).toBe(true);
  expect(risks.every(risk => risk.status === "confirmed" || risk.status === "uncertain")).toBe(true);
});

it("keeps the demo confined to today/tomorrow relative dates", () => {
  const { events } = demoWorkspace();
  const days = [...new Set(events.map(event => localDateKey(event.start)))].sort();
  expect(days).toEqual([demoDay(0, NOW), demoDay(1, NOW), demoDay(2, NOW)]);
});
