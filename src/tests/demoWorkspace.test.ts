import { afterEach, beforeEach, expect, it } from "vitest";
import {
  DEMO_OWNER, DEMO_USER, createDemoMailbox, demoCalendarEntries, demoDay, demoLegResults,
  enterDemo, exitDemo, readDemoMode, resetDemo, seedDemoWorkspace,
} from "../lib/demoWorkspace";
import { calendarKey } from "../lib/calendarEvents";
import { localDateKey, type TodayLegPair } from "../lib/todayMap";
import type { Place } from "../types/place";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.values.set(key, value);
    Object.defineProperty(this, key, { value, enumerable: true, configurable: true, writable: true });
  }
  removeItem(key: string) {
    this.values.delete(key);
    delete (this as unknown as Record<string, unknown>)[key];
  }
  clear() { for (const key of [...this.values.keys()]) this.removeItem(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  (globalThis as any).sessionStorage = new MemoryStorage();
});
afterEach(() => {
  delete (globalThis as any).localStorage;
  delete (globalThis as any).sessionStorage;
});

const NOW = Date.parse("2026-11-23T02:00:00Z");

it("keeps demo data in a dedicated owner and never touches another space", () => {
  localStorage.setItem("whatto.userPlaces.guest", JSON.stringify([{ id: "real-place" }]));
  localStorage.setItem(calendarKey("guest"), JSON.stringify([{ id: "real-event" }]));
  enterDemo(NOW);
  expect(readDemoMode()).toBe(true);
  expect(localStorage.getItem("whatto.userPlaces.guest")).toContain("real-place");
  expect(localStorage.getItem(calendarKey("guest"))).toContain("real-event");
  expect(localStorage.getItem(`whatto.userPlaces.${DEMO_OWNER}`)).toBeNull();
  expect(JSON.parse(localStorage.getItem(calendarKey(DEMO_OWNER)) ?? "[]")).toHaveLength(10);
  expect(localStorage.getItem(`wayline.businessTrips.${DEMO_OWNER}`)).toContain("上海");
  exitDemo();
  expect(readDemoMode()).toBe(false);
  expect(localStorage.getItem(calendarKey(DEMO_OWNER))).toBeNull();
  expect(localStorage.getItem("whatto.userPlaces.guest")).toContain("real-place");
});

it("reseeds the same synthetic scenario on reset", () => {
  seedDemoWorkspace(NOW);
  const before = localStorage.getItem(calendarKey(DEMO_OWNER));
  localStorage.setItem(calendarKey(DEMO_OWNER), "[]");
  resetDemo(NOW);
  expect(localStorage.getItem(calendarKey(DEMO_OWNER))).toBe(before);
});

it("covers the requested demo scenario: same-city day, cross-city two days, conflict, ambiguity and missing stay", () => {
  const events = demoCalendarEntries(NOW);
  const today = demoDay(0, NOW);
  const sameCity = events.filter(event => localDateKey(event.start) === today);
  expect(sameCity).toHaveLength(3);
  expect(new Set(sameCity.map(event => event.place?.city))).toEqual(new Set(["上海"]));
  const days = new Set(events.map(event => localDateKey(event.start)));
  expect(days.size).toBe(3);
  expect(events.some(event => event.placeResolution?.status === "ambiguous")).toBe(true);

  const mailbox = createDemoMailbox(NOW);
  expect(mailbox.orders.map(order => order.train)).toEqual(["G7002", "G7010", "G7026"]);
  expect(mailbox.changes?.map(change => [change.number, change.state])).toEqual([["G7010", "cancelled"]]);
  expect(mailbox.bookings ?? []).toHaveLength(0);
  expect(mailbox.lastSync).toBe(NOW - 60_000);
});

it("labels demo legs as estimates, never as provider routes", () => {
  const place = (lat: number, lng: number, id: string): Place => ({
    id, name: id, city: "上海", category: "business", type: "system", source: "system",
    lat, lng, address: "", openingHours: "", description: "", tags: [], reason: "",
    status: "saved", isSaved: false, distanceText: "", externalLinks: {},
  });
  const pair: TodayLegPair = {
    id: "a-b", sameSpot: false, crossCity: false, directKm: 5, gapMinutes: 60, defaultMode: "driving",
    from: { event: { id: "a" } as any, place: place(31.23, 121.47, "a") },
    to: { event: { id: "b" } as any, place: place(31.25, 121.5, "b") },
  };
  const legs = demoLegResults([pair], NOW)["a-b"];
  for (const mode of ["walking", "transit", "driving"] as const) {
    expect(legs?.[mode]?.source).toBe("estimate");
    expect(legs?.[mode]?.observedAt).toBe(NOW);
    expect(legs?.[mode]?.minutes).toBeGreaterThan(0);
    expect(legs?.[mode]?.points).toHaveLength(2);
  }
});

it("uses a local-only demo user", () => {
  expect(DEMO_USER.method).toBe("local");
  expect(DEMO_OWNER.startsWith("demo:")).toBe(true);
});
