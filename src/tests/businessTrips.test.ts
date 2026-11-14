import { expect, it } from "vitest";
import { groupBusinessTrips, tripPlaces } from "../lib/businessTrips";
import type { CalendarEntry } from "../lib/calendarEvents";
import { initialUserPlaces } from "../data/userPlaces";

const date = "2026-11-13";
const event = (id: string, day: string, city: string, hour = "10"): CalendarEntry => ({
  id, uid: id, title: id, location: city, description: "", calendar: "验收",
  start: `2026-11-${day}T${hour}:00:00+08:00`, end: `2026-11-${day}T${hour}:30:00+08:00`,
  allDay: false, timezone: "Asia/Shanghai", place: { ...initialUserPlaces[0], id: city, city },
});
const sample = [
  event("苏州会议", "13", "苏州"), event("上海一", "14", "上海"),
  event("杭州会议", "16", "杭州"), event("上海二", "16", "上海", "15"),
  event("回苏州", "17", "苏州市"), event("下一趟", "18", "上海"),
];
const home = { home: "苏州", boundaries: {} };

it("retains both days and the original trip ID after midnight on a trip", () => {
  const events = [event("去程活动", "13", "上海"), event("返程活动", "14", "上海")];
  const [trip] = groupBusinessTrips(events, home, "2026-11-14");
  expect(trip.id).toBe("去程活动");
  expect(trip.days.map(day => day.date)).toEqual(["2026-11-13", "2026-11-14"]);
  expect(groupBusinessTrips(events, home, "2026-11-15")).toEqual([]);
});

it("groups an away itinerary across one free day and splits when a home event intervenes", () => {
  const trips = groupBusinessTrips(sample, home, date);
  expect(trips.map(trip => trip.id)).toEqual(["上海一", "下一趟"]);
  expect(trips[0].days.map(day => day.date)).toEqual(["2026-11-14", "2026-11-16"]);
  expect(trips[0].cities).toEqual(["上海", "杭州", "上海"]);
  expect(tripPlaces(trips[0]).find(place => place.city === "上海")?.calendarEventIds).toEqual(["上海一", "上海二"]);
});

it("uses saved split and join overrides without changing event objects", () => {
  const before = JSON.stringify(sample);
  const split = groupBusinessTrips(sample, { ...home, boundaries: { 杭州会议: "split" } }, date);
  expect(split.map(trip => trip.id)).toEqual(["上海一", "杭州会议", "下一趟"]);
  const joined = groupBusinessTrips(sample, { ...home, boundaries: { 下一趟: "join" } }, date);
  expect(joined).toHaveLength(1);
  expect(joined[0].days.at(-1)?.date).toBe("2026-11-18");
  expect(JSON.stringify(sample)).toBe(before);
});

it("does not infer a home city, or count past, all-day, online, unresolved or stale meetings", () => {
  const [item] = sample.slice(1);
  const dated = { ...item, allDay: true };
  const stale = { ...item, google: { connectionId: "a", calendarId: "b", eventId: "c", updated: "", originalStart: null, stale: true } };
  const online = { ...item, placeResolution: { status: "online" as const, text: "" } };
  expect(groupBusinessTrips(sample, { ...home, home: "" }, date)).toEqual([]);
  expect(groupBusinessTrips([dated, stale, online, { ...item, place: undefined }, event("旧会议", "12", "上海")], home, date)).toEqual([]);
});

import { assignTripBookings, collectTripBookings } from "../lib/businessOrders";

it("joins a dated trip's rail, flight and overnight stay without making booked stops meetings", () => {
  const events = [
    event("开会", "14", "上海", "12"), event("回访", "15", "上海", "12"),
    { ...event("rail", "14", "苏州", "08"), title:"高铁 G101｜苏州站 → 上海虹桥站" },
    { ...event("flight", "15", "上海", "18"), title:"航班 MU2222｜SHA → SZX" },
  ];
  const trips = groupBusinessTrips(events, home, date);
  expect(trips[0].days.flatMap(day => day.events).map(row=>row.id)).toEqual(["开会","回访"]);
  const bookings = collectTripBookings(events, [
    { id:"dup", train:"G101", origin:"苏州", destination:"上海虹桥", departAt:events[2].start },
    { id:"return", train:"G202", origin:"上海虹桥", destination:"苏州", departAt:"2026-11-15T18:00:00+08:00" },
  ], [{id:"stay",kind:"stay",start:"2026-11-14",end:"2026-11-15",to:"上海虹桥酒店"}], ["上海","苏州","深圳"]);
  const plan = assignTripBookings(trips,"苏州",bookings).get(trips[0].id)!;
  expect(plan.legs.map(leg=>leg.orders.map(row=>row.number))).toEqual([["G101"],["G202"]]);
  expect(plan.nights[0].orders[0]).toMatchObject({source:"Gmail",kind:"stay"});
});

it("does not attach one booking to two possible trips", () => {
  const events = [event("上午", "14","上海","10"), event("下午","14","上海","15")];
  const trips = groupBusinessTrips(events,{...home,boundaries:{下午:"split"}},date);
  const bookings = collectTripBookings([], [{id:"early",train:"G1",origin:"苏州",destination:"上海虹桥",departAt:"2026-11-14T07:00:00+08:00"}], [],["上海","苏州"]);
  const plans = assignTripBookings(trips,"苏州",bookings);
  expect([...plans.values()].flatMap(plan=>plan.legs.flatMap(leg=>leg.orders))).toEqual([]);
});
