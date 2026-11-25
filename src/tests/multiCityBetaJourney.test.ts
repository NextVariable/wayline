import { expect, it } from "vitest";
import { buildTravelWorkspace } from "../lib/tripIntelligence";
import { assessCommute, assessTrip } from "../lib/tripFeasibility";
import { tripTransfers } from "../lib/tripTransfers";
import { bookingPlaceKey } from "../lib/useBookingPlaces";
import type { CalendarEntry } from "../lib/calendarEvents";
import type { Place } from "../types/place";
import type { RouteEvidence } from "../lib/tripDomain";
import { initialUserPlaces } from "./fixtures/userPlaces";

const venue = (id: string, name: string, city: string, lat: number, lng: number): Place => ({
  ...initialUserPlaces[0], id, name, city, lat, lng, address: `${city}${name}`, source: "manual", type: "user",
});
const venueA = venue("venue-a", "国家会展中心", "上海", 31.191, 121.305);
const venueB = venue("venue-b", "虹桥商务区会议室", "上海", 31.197, 121.326);
const station = venue("station", "上海虹桥站", "上海", 31.194, 121.32);

const NOW = Date.parse("2026-11-23T02:00:00Z");
const D1 = "2026-11-24", D2 = "2026-11-25";
const event = (id: string, title: string, start: string, end: string, place?: Place): CalendarEntry => ({
  id, uid: id, title, location: place?.name ?? "", description: "", calendar: "工作",
  start, end, allDay: false, timezone: "Asia/Shanghai", ...(place && { place }),
  google: { connectionId: "google-1", calendarId: "primary", eventId: id, updated: "2026-11-21T00:00:00Z", originalStart: null },
});

const meetings = [
  event("meet-1", "客户方案评审", `${D1}T10:00:00+08:00`, `${D1}T11:30:00+08:00`, venueA),
  event("meet-2", "渠道沟通", `${D2}T09:30:00+08:00`, `${D2}T11:00:00+08:00`, venueA),
  event("meet-3", "交付对齐", `${D2}T11:20:00+08:00`, `${D2}T12:50:00+08:00`, venueB),
];
const railEvents = [
  event("rail-out", "高铁 G102｜苏州站 → 上海虹桥站", `${D1}T07:00:00+08:00`, `${D1}T07:45:00+08:00`),
  event("rail-back", "高铁 G7224｜上海虹桥站 → 苏州站", `${D2}T19:00:00+08:00`, `${D2}T19:45:00+08:00`),
];
const hotelEvent = event("stay-1", "入住 上海虹桥酒店", `${D1}T20:00:00+08:00`, `${D2}T12:00:00+08:00`, venue("hotel-a", "上海虹桥酒店", "上海", 31.2, 121.33));

const workspace = (mailbox?: Parameters<typeof buildTravelWorkspace>[0]["mailbox"]) => buildTravelWorkspace({
  events: [...meetings, ...railEvents, hotelEvent],
  settings: { home: "苏州", boundaries: {} },
  day: new Date(NOW),
  cities: ["苏州", "上海"],
  mailbox,
});

const baseMailbox = {
  orders: [
    { id: "g102", train: "G102", origin: "苏州", destination: "上海虹桥", departAt: `${D1}T07:00:00+08:00`, arriveAt: `${D1}T07:45:00+08:00` },
    { id: "g7224", train: "G7224", origin: "上海虹桥", destination: "苏州", departAt: `${D2}T19:00:00+08:00`, arriveAt: `${D2}T19:45:00+08:00` },
  ],
  bookings: [{ id: "hotel-order", kind: "stay" as const, start: D1, end: D2, to: "上海虹桥酒店", city: "上海" }],
  lastSync: NOW - 60_000,
};

it("carries a two-day cross-city trip from calendar through timeline, bookings and stay", () => {
  const { home, tripModels } = workspace(baseMailbox);
  const trip = [...tripModels.values()][0];
  expect(home).toBe("苏州");
  expect(trip.days.map(day => day.date)).toEqual([D1, D2]);
  expect(trip.cities).toEqual(["上海"]);

  const outbound = trip.segments.find(segment => segment.kind === "intercity")!;
  const returnLeg = trip.segments.filter(segment => segment.kind === "intercity").at(-1)!;
  expect(outbound.kind === "intercity" && outbound.leg.orders.map(order => order.number)).toEqual(["G102"]);
  // The Calendar rail event and the Gmail order are one booking, with both sources kept.
  const outboundOrder = outbound.kind === "intercity" ? outbound.leg.orders[0] : undefined!;
  expect(outboundOrder.provenance?.map(item => item.source).sort()).toEqual(["gmail", "google-calendar"]);
  expect(returnLeg.kind === "intercity" && returnLeg.leg.orders.map(order => order.number)).toEqual(["G7224"]);

  const stay = trip.segments.find(segment => segment.kind === "stay");
  expect(stay?.kind === "stay" && stay.night.date).toBe(D1);
  expect(stay?.kind === "stay" && stay.night.orders).toHaveLength(1);
  expect(trip.timeline.filter(row => row.kind === "booking")).toHaveLength(3);
});

it("flags the cancelled leg, keeps the replacement and never reports missing transport", () => {
  const { tripModels } = workspace({
    ...baseMailbox,
    orders: [...baseMailbox.orders,
      { id: "g7226", train: "G7226", origin: "上海虹桥", destination: "苏州", departAt: `${D2}T20:00:00+08:00`, arriveAt: `${D2}T20:45:00+08:00` }],
    changes: [{ id: "cancel-g7224", kind: "rail", state: "cancelled", observedAt: NOW - 30_000, number: "G7224",
      from: "上海虹桥", to: "苏州", start: `${D2}T19:00:00+08:00`, end: `${D2}T19:45:00+08:00` }],
  });
  const trip = [...tripModels.values()][0];
  const returns = trip.segments.filter(segment => segment.kind === "intercity");
  const returnOrders = returns.at(-1)!.kind === "intercity" ? returns.at(-1)!.leg.orders : [];
  expect(returnOrders.map(order => [order.number, order.state])).toEqual([["G7224", "cancelled"], ["G7226", undefined]]);

  const risks = assessTrip(trip, { calendarCurrent: true, mailboxCurrent: true, now: NOW });
  expect(risks.some(risk => risk.type === "booking-change" && risk.title.includes("取消"))).toBe(true);
  expect(risks.some(risk => risk.type === "missing-transport")).toBe(false);
  expect(risks.some(risk => risk.type === "missing-stay")).toBe(false);
});

it("keeps an unverified arrival transfer uncertain until route evidence exists", () => {
  const { tripModels } = workspace(baseMailbox);
  const trip = [...tripModels.values()][0];
  const transfers = tripTransfers(trip, { [bookingPlaceKey({ city: "上海", name: "上海虹桥站" })]: station });
  expect(transfers.length).toBeGreaterThan(0);
  const risks = assessTrip(trip, { calendarCurrent: true, mailboxCurrent: true, now: NOW }, transfers, {});
  const inbound = risks.find(risk => risk.type === "intercity");
  expect(inbound).toMatchObject({ status: "uncertain", severity: "info" });
});

it("shows a future last-mile shortage as a reference only when a route is available", () => {
  const { tripModels } = workspace(baseMailbox);
  const trip = [...tripModels.values()][0];
  const transfers = tripTransfers(trip, { [bookingPlaceKey({ city: "上海", name: "上海虹桥站" })]: station });
  const route = (minutes: number): RouteEvidence => ({ mode: "driving", minutes, source: "amap", observedAt: NOW - 60_000, points: [] });
  const tight = assessTrip(trip, { calendarCurrent: true, mailboxCurrent: true, now: NOW }, transfers,
    Object.fromEntries(transfers.map(transfer => [transfer.key, route(140)])));
  const short = tight.find(risk => risk.type === "intercity" && risk.title.includes("可能不足"));
  expect(short).toMatchObject({ severity: "medium", status: "uncertain" });
  expect(short?.basis).toContain("差 5 分钟");

  const comfortable = assessTrip(trip, { calendarCurrent: true, mailboxCurrent: true, now: NOW }, transfers,
    Object.fromEntries(transfers.map(transfer => [transfer.key, route(40)])));
  expect(comfortable.some(risk => risk.type === "intercity" && risk.status === "confirmed")).toBe(false);
});

it("downgrades a tight commute and treats a stale mailbox as unconfirmed", () => {
  const { tripModels } = workspace(baseMailbox);
  const trip = [...tripModels.values()][0];
  const pair = trip.segments.find(segment => segment.kind === "commute")!;
  expect(pair.kind).toBe("commute");
  const route: RouteEvidence = { mode: "driving", minutes: 45, source: "amap", observedAt: NOW - 60_000, points: [] };
  const verdict = assessCommute((pair as Extract<typeof pair, { kind: "commute" }>).pair, [route], "driving",
    { calendarCurrent: true, mailboxCurrent: true, now: NOW });
  expect(verdict.verdict.status).toBe("reference");
  expect(verdict.verdict.advice).toContain("参考");

  const stale = assessTrip(trip, { calendarCurrent: true, mailboxCurrent: false, now: NOW });
  expect(stale.every(risk => risk.type === "overlap" || risk.status === "uncertain" || risk.severity === "info")).toBe(true);
});
