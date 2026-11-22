import { expect, it } from "vitest";
import { eventDay } from "../lib/tripDay";
import { groupBusinessTrips, tripPlaces } from "../lib/businessTrips";
import { tripNeeds } from "../lib/businessOrders";
import type { CalendarEntry } from "../lib/calendarEvents";
import { initialUserPlaces } from "./fixtures/userPlaces";

const place = (city: string, id: string) => ({ ...initialUserPlaces[0], id, name: id, city });

const event = (id: string, start: string, end: string, timezone: string, city = "上海"): CalendarEntry => ({
  id, uid: id, title: id, location: id, description: "", calendar: "合成样本",
  start, end, allDay: false, timezone, place: place(city, id),
});

it("uses the calendar event's own zone for its trip day", () => {
  const la = event("洛杉矶客户会", "2026-11-12T22:00:00-08:00", "2026-11-12T23:30:00-08:00", "America/Los_Angeles");
  expect(eventDay(la)).toBe("2026-11-12");
  // 2026-11-12 22:00 in Los Angeles is already 2026-11-13 in Shanghai, where the device is.
  expect(new Date(la.start).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })).toBe("2026-11-13");
  const [trip] = groupBusinessTrips([la], { home: "苏州", boundaries: {} }, "2026-11-12");
  expect(trip.days.map(day => day.date)).toEqual(["2026-11-12"]);
  expect(tripPlaces(trip).map(item => item.city)).toEqual(["上海"]);
});

it("keeps the overnight stay on the same local day as the last meeting", () => {
  const first = event("客户会", "2026-11-12T22:00:00-08:00", "2026-11-12T23:00:00-08:00", "America/Los_Angeles");
  const next = event("次日会", "2026-11-13T21:00:00-08:00", "2026-11-13T22:00:00-08:00", "America/Los_Angeles");
  const [trip] = groupBusinessTrips([first, next], { home: "苏州", boundaries: {} }, "2026-11-12");
  expect(trip.days.map(day => day.date)).toEqual(["2026-11-12", "2026-11-13"]);
  expect(tripNeeds(trip, "苏州").nights.map(night => night.date)).toEqual(["2026-11-12"]);
});

it("falls back to the device day when the calendar zone is unknown or absent", () => {
  const unknown = event("未知时区", "2026-11-13T09:00:00+08:00", "2026-11-13T10:00:00+08:00", "Not/AZone");
  expect(eventDay(unknown)).toBe("2026-11-13");
  expect(eventDay({ ...unknown, timezone: "" })).toBe("2026-11-13");
});
