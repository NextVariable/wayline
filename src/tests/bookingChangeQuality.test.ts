import { expect, it } from "vitest";
import { collectTripBookings, type BookingChange, type RailOrder } from "../lib/businessOrders";

const cities = ["苏州", "上海"];
const rail = (id: string, train: string, departAt: string, arriveAt: string): RailOrder =>
  ({ id, train, origin: "苏州", destination: "上海虹桥", departAt, arriveAt });
const change = (patch: Partial<BookingChange>): BookingChange => ({
  id: "notice-1", kind: "rail", state: "cancelled", observedAt: 2_000,
  number: "G101", from: "苏州", to: "上海虹桥",
  start: "2026-11-24T08:00:00+08:00", end: "2026-11-24T08:45:00+08:00", ...patch,
});

it("downgrades the original booking instead of inventing a second one when a change moves the time", () => {
  const orders = [rail("ticket", "G101", "2026-11-24T08:00:00+08:00", "2026-11-24T08:45:00+08:00")];
  const bookings = collectTripBookings([], orders, [], cities, [change({
    state: "changed", start: "2026-11-24T09:10:00+08:00", end: "2026-11-24T09:55:00+08:00",
  })], 1_000);
  expect(bookings).toHaveLength(1);
  expect(bookings[0]).toMatchObject({ id: "ticket", number: "G101", state: "changed" });
  expect(bookings[0].provenance?.map(item => item.recordId).sort()).toEqual(["notice-1", "ticket"]);
});

it("attaches a notice that lost its number to the only matching journey", () => {
  const orders = [rail("ticket", "G101", "2026-11-24T08:00:00+08:00", "2026-11-24T08:45:00+08:00")];
  const bookings = collectTripBookings([], orders, [], cities, [change({ number: undefined })], 1_000);
  expect(bookings).toHaveLength(1);
  expect(bookings[0]).toMatchObject({ id: "ticket", state: "cancelled" });
});

it("leaves every candidate for review when a notice cannot be attributed to one journey", () => {
  const orders = [
    rail("monday", "G101", "2026-11-24T08:00:00+08:00", "2026-11-24T08:45:00+08:00"),
    rail("tuesday", "G101", "2026-11-25T08:00:00+08:00", "2026-11-25T08:45:00+08:00"),
  ];
  const bookings = collectTripBookings([], orders, [], cities, [change({ number: undefined, start: "2026-11-24T08:30:00+08:00" })], 3_000);
  expect(bookings).toHaveLength(2);
  expect(bookings.map(booking => booking.state)).toEqual(["review", "review"]);
  expect(bookings.every(booking => booking.provenance?.some(item => item.recordId === "notice-1"))).toBe(true);
});

it("ignores a cancellation that is older than the confirmation already held", () => {
  const orders = [rail("ticket", "G101", "2026-11-24T08:00:00+08:00", "2026-11-24T08:45:00+08:00")];
  // The mailbox was read at 5s, so the ticket is already confirmed; a 4s notice is stale.
  const bookings = collectTripBookings([], orders, [], cities, [change({ observedAt: 4_000 })], 5_000);
  expect(bookings).toHaveLength(1);
  expect(bookings[0].state).toBeUndefined();
});

it("applies a newer cancellation and keeps evidence unique", () => {
  const orders = [rail("ticket", "G101", "2026-11-24T08:00:00+08:00", "2026-11-24T08:45:00+08:00")];
  const notice = change({ observedAt: 9_000 });
  const bookings = collectTripBookings([], orders, [], cities, [notice, notice], 8_000);
  expect(bookings).toHaveLength(1);
  expect(bookings[0].state).toBe("cancelled");
  expect(bookings[0].provenance?.filter(item => item.recordId === "notice-1")).toHaveLength(1);
});
