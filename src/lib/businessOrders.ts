import rail from "../../server/main-passenger-rail.json";
import { namedRoute, orderKind, orderText, serviceNumber } from "../../shared/travel-order.mjs";
import type { Place } from "../types/place";
import type { BusinessTrip } from "./businessTrips";
import type { CalendarEntry } from "./calendarEvents";
import type { SourceProvenance } from "./tripDomain";
import { cityKey } from "./citySelection";
import { eventDay } from "./tripDay";

export type BookingKind = "rail" | "flight" | "stay";
export interface OrderPoint { name: string; city?: string; place?: Place }
export interface TripBooking {
  id: string; kind: BookingKind; source: "日历" | "Gmail"; number?: string;
  start: string; end?: string; from?: OrderPoint; to: OrderPoint;
  state?: "confirmed" | "cancelled" | "changed" | "review";
  provenance?: SourceProvenance[];
}
export interface GmailBooking {
  city?: string; id: string; kind: "flight" | "stay"; number?: string; start: string; end: string; from?: string; to: string;
}
export interface BookingChange {
  id:string; kind:BookingKind; state:"cancelled"|"changed"|"review"; observedAt:number;
  from?:string; to:string; city?:string; number?:string; start:string; end?:string;
}
export interface RailOrder { id: string; train: string; origin: string; destination: string; departAt: string; arriveAt?: string }
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
export const chinaDate = (value: string | number) => dateFormat.format(new Date(value));
export const nextDate = (day: string) => new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);

const aliases: Record<string,string> = { SZX: "深圳宝安国际机场", SHA: "上海虹桥国际机场", PVG: "上海浦东国际机场", PEK: "北京首都国际机场", PKX: "北京大兴国际机场", CAN: "广州白云国际机场", HGH: "杭州萧山国际机场", CTU: "成都双流国际机场", TFU: "成都天府国际机场", HKG: "香港国际机场", MFM: "澳门国际机场", "大兴机场站": "大兴机场站", "新塘站": "广州新塘站" };
const stationCities = new Map<string,string[]>();
for (const [city, names] of Object.entries(rail.cities)) for (const name of names) {
  const key = name.replace(/站$/, "");
  stationCities.set(key, [...(stationCities.get(key) ?? []), city]);
}
stationCities.set("大兴机场", ["北京"]);
stationCities.set("香港西九龙", ["香港"]);

export function bookingPoint(value: string, kind: BookingKind, cities: string[]): OrderPoint {
  const raw = orderText(value);
  let name = Object.hasOwn(aliases,raw.toUpperCase()) ? aliases[raw.toUpperCase()] : Object.hasOwn(aliases,raw) ? aliases[raw] : raw;
  const terminal = kind === "flight" ? /^([A-Z]{3})\s*[-（(]?\s*(T[1-9])(?:号?航站楼)?[）)]?$/i.exec(raw) : null;
  if (terminal && Object.hasOwn(aliases,terminal[1].toUpperCase()))
    name=aliases[terminal[1].toUpperCase()] + terminal[2].toUpperCase();
  if (kind === "rail" && name && !name.endsWith("站")) name += "站";
  const known = kind === "rail" ? stationCities.get(name.replace(/站$/, "")) : undefined;
  const city = known?.length === 1 ? known[0] : [...new Set(cities)].sort((a,b) => b.length-a.length)
    .find(candidate => candidate && (name.startsWith(candidate) || name.includes(candidate + "市")));
  return { name, city };
}

export function calendarBooking(event: CalendarEntry, cities: string[]): TripBooking | null {
  if (event.google?.stale || event.placeResolution?.status === "ignored" || /已取消|已退票/.test(event.description)) return null;
  const kind = orderKind(event.title);
  if (!kind) return null;
  if (kind === "stay") {
    const name = event.place?.name ?? (event.location || event.title.replace(/^(?:入住|退房|住宿|酒店订单|客房预订)\s*[：:｜|·-]?\s*/, ""));
    if (!name || /^(酒店|住宿)$/.test(name) || /退房/.test(event.title) && !/入住/.test(event.title)) return null;
    // A timed check-in alone does not establish how many nights were booked.
    const end = chinaDate(event.end) > chinaDate(event.start) ? event.end : undefined;
    return { id: event.id, kind, source: "日历", start: event.start, end, to: { ...bookingPoint(name, kind, cities), ...(event.place && { city: event.place.city, place: event.place }) } };
  }
  if (event.allDay) return null;
  const [origin, destination] = namedRoute(event.title);
  const number = serviceNumber(event.title, kind);
  if (!number || !origin || !destination) return null;
  return { id: event.id, kind, source: "日历", number, start: event.start, end: Date.parse(event.end) > Date.parse(event.start) ? event.end : undefined,
    from: bookingPoint(origin, kind, cities), to: bookingPoint(destination, kind, cities) };
}

function sameOrderPoint(a?:OrderPoint,b?:OrderPoint) {
  return !a || !b || (a.name.replace(/\s/g,"") === b.name.replace(/\s/g,"") &&
    (!a.city || !b.city || cityKey(a.city) === cityKey(b.city)));
}

function sameTransportBooking(a:TripBooking,b:TripBooking) {
  return a.kind === b.kind && a.number === b.number && sameOrderPoint(a.from,b.from) &&
    sameOrderPoint(a.to,b.to) && Math.abs(Date.parse(a.start)-Date.parse(b.start)) < 60_000;
}

export function hasCalendarRailOrder(order:RailOrder, events:CalendarEntry[]) {
  const arrival=bookingPoint(order.destination,"rail",[]);
  const reference:TripBooking={id:order.id,kind:"rail",source:"Gmail",number:order.train,
    start:order.departAt,from:bookingPoint(order.origin,"rail",[]),to:arrival};
  return events.some(event => {
    const booking=calendarBooking(event,[]);
    return !!booking && sameTransportBooking(booking,reference);
  });
}

export function collectTripBookings(events: CalendarEntry[], railOrders: RailOrder[], mail: GmailBooking[], cities: string[], changes: BookingChange[] = [], mailObservedAt?: number | null) {
  const bookings: TripBooking[] = [];
  const eventById = new Map(events.map(event => [event.id,event]));
  const calendar = events.flatMap(event => calendarBooking(event, cities) ?? []);
  const incoming: TripBooking[] = [
    ...railOrders.map((row): TripBooking => ({ id: row.id, source: "Gmail", kind: "rail", number: row.train, start: row.departAt, end: row.arriveAt,
      from: bookingPoint(row.origin, "rail", cities), to: bookingPoint(row.destination, "rail", cities) })),
    ...changes.map((row): TripBooking => ({ id:row.id, kind:row.kind, state:row.state, number:row.number,
      start:row.start, end:row.end, source:"Gmail", from:row.from ? bookingPoint(row.from,row.kind,cities) : undefined,
      to:{...bookingPoint(row.to,row.kind,cities), ...(row.city && {city:cityKey(row.city)})},
      provenance:[{source:"gmail",recordId:row.id,observedAt:row.observedAt, confidence:row.state === "review" ? "inferred" : "recorded"}],
    })),
    ...mail.map((row): TripBooking => ({ ...row, source: "Gmail", from: row.from ? bookingPoint(row.from, row.kind, cities) : undefined, to: { ...bookingPoint(row.to, row.kind, cities), ...(row.city && {city:cityKey(row.city)}) } })),
  ];
  const isNotice = (item: TripBooking) => !!item.state && item.state !== "confirmed";
  const observedAt = (item: TripBooking) => (item.provenance ?? []).reduce((latest, source) => Math.max(latest, source.observedAt ?? 0), 0);
  const stateRank: Record<string, number> = { review: 1, changed: 2, cancelled: 3 };
  const mergeProvenance = (target: TripBooking, item: TripBooking) => {
    target.provenance = [...new Map([...(target.provenance ?? []), ...(item.provenance ?? [])]
      .map(source => [`${source.source}|${source.recordId}|${source.observedAt ?? 0}`, source])).values()];
  };
  // Only a notice newer than the evidence already held can change the state; a delayed cancellation
  // arriving after a newer confirmation must not silently cancel the booking again. The target's
  // observation time is captured before its provenance is merged, otherwise the notice's own
  // timestamp would pollute the comparison and every notice would look stale.
  const applyState = (target: TripBooking, item: TripBooking, knownAt = observedAt(target)) => {
    if (!item.state) return;
    const incomingAt = observedAt(item);
    if (incomingAt && knownAt && incomingAt < knownAt) return;
    if (target.state && (stateRank[target.state] ?? 0) > (stateRank[item.state] ?? 0)) return;
    target.state = item.state;
  };
  const exactMatch = (item: TripBooking) => bookings.find(known => known.kind === item.kind && (item.kind === "stay"
    ? chinaDate(known.start) === chinaDate(item.start) && known.to.name.replace(/\s/g, "") === item.to.name.replace(/\s/g, "") &&
      (!known.to.city || !item.to.city || cityKey(known.to.city) === cityKey(item.to.city))
    : sameTransportBooking(known,item)));
  // A change notice can lose its journey id or shift the departure time (改签). Attach it only when one
  // existing booking is the unambiguous subject; otherwise leave every candidate for review.
  const candidatesFor = (item: TripBooking) => {
    const same = bookings.filter(known => known.kind === item.kind);
    if (item.kind === "stay") return same.filter(known =>
      known.to.name.replace(/\s/g, "") === item.to.name.replace(/\s/g, "") &&
      (!known.to.city || !item.to.city || cityKey(known.to.city) === cityKey(item.to.city)));
    // A notice that still carries a service number must match that number. Fuzzy route/date matching is
    // reserved for notices that lost their number; otherwise a cancellation for G102 would silently
    // cancel an unrelated replacement such as G103 on the same route.
    if (item.number) return same.filter(known => known.number === item.number);
    return same.filter(known => sameOrderPoint(known.from, item.from) && sameOrderPoint(known.to, item.to) &&
      Math.abs(Date.parse(known.start) - Date.parse(item.start)) <= 3 * 86_400_000);
  };
  const bases = [...calendar, ...incoming.filter(item => !isNotice(item))];
  const notices = incoming.filter(isNotice).sort((left, right) => observedAt(left) - observedAt(right));
  for (const item of bases) {
    const event = item.source === "日历" ? eventById.get(item.id) : undefined;
    item.provenance ??= [{source:event?.google ? "google-calendar" : event ? "calendar-file" : "gmail",
      recordId:item.id, observedAt:event?.google?.updated ? Date.parse(event.google.updated) || undefined : event ? undefined : mailObservedAt ?? undefined,
      confidence:item.source === "日历" ? "inferred" : "recorded"}];
    const match = exactMatch(item);
    if (match) {
      mergeProvenance(match, item);
      // A stay checkout is recorded either as a date or as a checkout time, so compare whole days;
      // transport keeps exact timestamps. Only a real difference in the day/time needs review.
      const endMismatch = !!match.end && !!item.end && (item.kind === "stay"
        ? chinaDate(match.end) !== chinaDate(item.end)
        : Date.parse(match.end) !== Date.parse(item.end));
      const gmailConfirmation = item.source === "Gmail" && !item.state;
      if ((gmailConfirmation || item.kind === "stay") &&
          (!match.state || match.state === "confirmed") && endMismatch) match.state = "review";
      match.end ??= item.end;
      if (!match.to.city && item.to.city) match.to = { ...item.to, ...match.to, city:item.to.city };
      continue;
    }
    bookings.push(item);
  }
  for (const item of notices) {
    const match = exactMatch(item);
    if (match) {
      const knownAt = observedAt(match);
      mergeProvenance(match, item);
      applyState(match, item, knownAt);
      continue;
    }
    const candidates = candidatesFor(item);
    if (candidates.length === 1) {
      const knownAt = observedAt(candidates[0]);
      mergeProvenance(candidates[0], item);
      applyState(candidates[0], item, knownAt);
      continue;
    }
    if (candidates.length > 1) {
      // Ambiguous subject: do not invent a booking, and do not let any candidate look settled.
      for (const candidate of candidates) {
        mergeProvenance(candidate, item);
        if (!candidate.state || candidate.state === "confirmed") candidate.state = "review";
      }
      continue;
    }
    bookings.push(item);
  }
  return bookings;
}

export interface TravelGap { id: string; from: string; to: string; date: string; after?: string; before?: string; afterEventId?: string; beforeEventId?: string; orders: TripBooking[] }
export interface StayNight { date: string; city: string; orders: TripBooking[] }
export function tripNeeds(trip: BusinessTrip, home: string) {
  const activities = trip.days.flatMap(day => day.events);
  const first = activities[0], last = activities.at(-1)!;
  const makeLeg = (from: string, to: string, date: string, after?: CalendarEntry, before?: CalendarEntry): TravelGap =>
    ({ id: JSON.stringify([from,to,date,after?.end,before?.start]), from:cityKey(from), to:cityKey(to), date, after:after?.end, before:before?.start, afterEventId:after?.id, beforeEventId:before?.id, orders: [] });
  const legs = [makeLeg(home, first.place.city, eventDay(first), undefined, first)];
  for (let i=1; i<activities.length; i++) {
    const from = activities[i-1], to = activities[i];
    if (cityKey(from.place.city) !== cityKey(to.place.city))
      legs.push(makeLeg(from.place.city, to.place.city, eventDay(to), from, to));
  }
  legs.push(makeLeg(last.place.city, home, eventDay(last), last));
  const nights: StayNight[] = [];
  for (let date=eventDay(first); date<eventDay(last) && nights.length<60; date=nextDate(date)) {
    const city = activities.filter(event => eventDay(event) <= date).at(-1)!.place.city;
    nights.push({ date, city:cityKey(city), orders: [] });
  }
  return { legs, nights };
}

export function assignTripBookings(trips: BusinessTrip[], home: string, orders: TripBooking[]) {
  const results = new Map(trips.map(trip => [trip.id, tripNeeds(trip, home)]));
  for (const order of orders) {
    const date = chinaDate(order.start);
    if (order.kind === "stay") {
      const end = order.end ? chinaDate(order.end) : nextDate(date);
      const matches = [...results.values()].map(plan => plan.nights.filter(night => order.to.city &&
        cityKey(order.to.city) === cityKey(night.city) && night.date >= date && night.date < end)).filter(matches => matches.length);
      if (matches.length === 1) for (const night of matches[0]) night.orders.push(order);
      continue;
    }
    const candidates = [...results.values()].flatMap(plan => plan.legs).filter(leg =>
      order.from?.city && order.to.city && cityKey(order.from.city) === cityKey(leg.from) && cityKey(order.to.city) === cityKey(leg.to) &&
      (date === leg.date || !!leg.before && chinaDate(order.end ?? order.start) === leg.date ||
        !!leg.after && !!leg.before && date >= chinaDate(leg.after) && date <= leg.date));
    if (candidates.length === 1) candidates[0].orders.push(order);
    else {
      const feasible = candidates.filter(leg =>
        (!leg.after || Date.parse(order.start) >= Date.parse(leg.after)) &&
        (!leg.before || Date.parse(order.end ?? order.start) <= Date.parse(leg.before)));
      if (feasible.length === 1) feasible[0].orders.push(order);
    }
  }
  return results;
}

// Infer only when independent round trips consistently return to the same city.
export function inferBookingHome(orders: TripBooking[]) {
  const transport = orders.filter(order => (!order.state || order.state === "confirmed") && order.kind !== "stay" && order.from?.city && order.to.city)
    .sort((a,b) => Date.parse(a.start)-Date.parse(b.start));
  const candidates: string[] = [];
  for (let i=0; i<transport.length-1; i+=2) {
    const first = transport[i], second = transport[i+1];
    if (first.from?.city === second.to.city && first.to.city === second.from?.city &&
        Date.parse(second.start)-Date.parse(first.start) <= 7*86400000) candidates.push(second.to.city!);
  }
  return candidates.length >= 2 && candidates.every(city => city === candidates[0]) ? candidates[0] : undefined;
}
