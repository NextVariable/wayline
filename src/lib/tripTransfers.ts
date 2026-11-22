import { bookingPlaceKey } from "./useBookingPlaces";
import type { Place, Trip } from "./tripDomain";

export interface TripTransfer {
  key: string;
  segmentId: string;
  orderId: string;
  eventId: string;
  kind: "depart-after" | "arrive-before";
  from: Place;
  to: Place;
  availableMinutes: number;
}

export function tripTransfers(trip:Trip, locations:Record<string,Place>):TripTransfer[] {
  const events = new Map(trip.days.flatMap(day => day.events.map(event => [event.id,event] as const)));
  return trip.segments.flatMap(segment => {
    if (segment.kind !== "intercity") return [];
    return segment.leg.orders.flatMap(order => {
      if (order.state && order.state !== "confirmed") return [];
      return segment.constraints.flatMap(constraint => {
        const meeting=events.get(constraint.eventId)?.place;
        const inbound=constraint.kind==="arrive-before";
        const terminal=inbound ? order.to : order.from;
        const station=terminal && (terminal.place ?? locations[bookingPlaceKey(terminal)]);
        const bookedAt=inbound ? order.end : order.start;
        if (!meeting || !station || !bookedAt) return [];
        const from=inbound ? station : meeting;
        const to=inbound ? meeting : station;
        const gap=inbound ? Date.parse(constraint.at)-Date.parse(bookedAt) : Date.parse(bookedAt)-Date.parse(constraint.at);
        if (!Number.isFinite(gap) || gap<0) return [];
        const key=JSON.stringify([trip.id,segment.id,order.id,constraint.eventId,constraint.kind,bookedAt,constraint.at,
          from.id,from.lat,from.lng,to.id,to.lat,to.lng]);
        return [{key,segmentId:segment.id,orderId:order.id,eventId:constraint.eventId,kind:constraint.kind,from,to,
          availableMinutes:Math.floor(gap/60_000)}];
      });
    });
  });
}
