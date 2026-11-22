import { assignTripBookings, collectTripBookings, inferBookingHome, type BookingChange, type GmailBooking, type RailOrder } from "./businessOrders";
import { groupBusinessTrips, type BusinessTripSettings } from "./businessTrips";
import type { CalendarEvent, Trip, TripSegment } from "./tripDomain";
import { legPairs, localDateKey as dayKey, pickDay, stopsOfDay } from "./todayMap";
import { eventDay } from "./tripDay";

export function buildTravelWorkspace({events, settings, day, mailbox, cities, todayKey, dayOf}: {
  events:CalendarEvent[]; settings:BusinessTripSettings; day:Date; cities:string[];
  todayKey?:string; dayOf?:(event:CalendarEvent)=>string;
  mailbox?:{ orders:RailOrder[]; bookings?:GmailBooking[]; changes?:BookingChange[]; lastSync:number|null };
}) {
  const bookings = collectTripBookings(events, mailbox?.orders ?? [], mailbox?.bookings ?? [], cities, mailbox?.changes, mailbox?.lastSync);
  const home = settings.home || (settings.inferHome !== false ? inferBookingHome(bookings) : "") || "";
  const today = todayKey ?? dayKey(day);
  const keyOf = dayOf ?? ((event: CalendarEvent) => dayKey(event.start));
  const trips = groupBusinessTrips(events, {...settings,home}, today);
  const plans = assignTripBookings(trips, home, bookings);
  const tripModels = new Map(trips.map(trip => {
    const plan = plans.get(trip.id)!;
    const events = trip.days.flatMap(day => day.events);
    const allOrders = [...new Map([...plan.legs,...plan.nights].flatMap(segment =>
      segment.orders.map(order => [order.id,order] as const))).values()];
    const timeline:Trip["timeline"] = [
      ...events.map(event => ({kind:"event" as const,event})),
      ...allOrders.map(booking => ({kind:"booking" as const,booking})),
    ];
    const at = (row:Trip["timeline"][number]) => Date.parse(row.kind === "event" ? row.event.start :
      row.booking.start.length === 10 ? row.booking.start+"T00:00:00+08:00" : row.booking.start);
    timeline.sort((left,right) => at(left)-at(right));
    const segments:TripSegment[] = [
      ...trip.days.flatMap(day => legPairs(day.events,day.date,eventDay).filter(pair => !pair.crossCity)
        .map(pair => ({kind:"commute" as const,id:pair.id,pair}))),
      ...plan.legs.map(leg => {
        const constraints:Extract<TripSegment,{kind:"intercity"}>["constraints"] = [];
        if (leg.after && leg.afterEventId) constraints.push({eventId:leg.afterEventId,kind:"depart-after",at:leg.after});
        if (leg.before && leg.beforeEventId) constraints.push({eventId:leg.beforeEventId,kind:"arrive-before",at:leg.before});
        return {kind:"intercity" as const,id:leg.id,leg,constraints};
      }),
      ...plan.nights.map(night => ({kind:"stay" as const,id:`stay:${night.date}:${night.city}`,night})),
    ];
    const model:Trip = {...trip,timeline,segments};
    return [trip.id,model] as const;
  }));
  const todayDay = pickDay(events,day,{todayKey:today,dayOf:keyOf});
  return {home,trips,plans,tripModels,today:todayDay,
    stops:todayDay ? stopsOfDay(events,todayDay.dateKey,keyOf) : [],
    pairs:todayDay ? legPairs(events,todayDay.dateKey,keyOf) : []};
}
