/**
 * Client-side Context Builder for the Contextual Copilot.
 * Only the fields the copilot needs are sent: no mail bodies, notes, passenger
 * details or full calendar history. The revision lets the server and the client
 * detect that a preview went stale before a proposal is applied.
 */
import type { Place } from "../types/place";

export interface CopilotEventInput {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  placeName?: string;
  placeId?: string;
  source?: string;
  local?: boolean;
  stale?: boolean;
}

export interface CopilotActionInput {
  id: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  problem: string;
  eventIds: string[];
  nextStep: { kind: string; label: string };
}

export interface CopilotCommuteInput {
  fromEventId: string;
  toEventId: string;
  mode: string;
  status: string;
  availableMinutes: number | null;
  routeMinutes?: number | null;
  bufferMinutes?: number | null;
  remainingMinutes?: number | null;
  latestDeparture?: string | null;
  advice?: string;
  reference?: boolean;
  pending?: boolean;
  source?: string;
}

export interface CopilotBookingInput {
  id: string;
  kind: string;
  title: string;
  from?: string;
  to?: string;
  start?: string;
  end?: string;
  state?: string;
  source?: string;
}

export interface CopilotTripInput {
  id: string;
  title: string;
  cities: string[];
  startDate: string;
  endDate: string;
  eventCount: number;
}

export interface CopilotPlace {
  id: string;
  name: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface CopilotContext {
  owner: string;
  revision: string;
  activeCity: string;
  events: CopilotEventInput[];
  places: CopilotPlace[];
  actions: CopilotActionInput[];
  commutes: CopilotCommuteInput[];
  bookings: CopilotBookingInput[];
  trips: CopilotTripInput[];
}

const clean = (value: unknown, max = 120) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function hash(value: string) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, "0");
}

export function contextRevision(events: CopilotEventInput[], places: CopilotPlace[]) {
  const material = JSON.stringify([
    events.map((event) => [event.id, event.start, event.end, event.placeId, event.placeName]),
    places.map((place) => [place.id, place.name, place.city]),
  ]);
  return hash(material);
}

export function buildCopilotContext(input: {
  owner: string;
  activeCity: string;
  events: CopilotEventInput[];
  places: Place[];
  actions: CopilotActionInput[];
  commutes: CopilotCommuteInput[];
  bookings: CopilotBookingInput[];
  trips: CopilotTripInput[];
}): CopilotContext {
  const events = input.events.slice(0, 24).map((event) => ({
    id: clean(event.id, 120),
    title: clean(event.title, 80),
    start: clean(event.start, 40),
    end: clean(event.end, 40),
    allDay: event.allDay === true,
    placeName: clean(event.placeName, 80),
    placeId: clean(event.placeId, 120),
    source: clean(event.source, 24) || "wayline",
    local: event.local === true,
    stale: event.stale === true,
  })).filter((event) => event.id && event.title && event.start && event.end);
  const places = input.places.slice(0, 50).map((place) => ({
    id: clean(place.id, 120),
    name: clean(place.name, 80),
    city: clean(place.city, 40),
    address: clean(place.address, 120),
    lat: finite(place.lat),
    lng: finite(place.lng),
  })).filter((place) => place.id && place.name);  return {
    owner: clean(input.owner, 120),
    revision: contextRevision(events, places),
    activeCity: clean(input.activeCity, 40),
    events,
    places,
    actions: input.actions.slice(0, 12).map((action) => ({
      id: clean(action.id, 120),
      type: clean(action.type, 32),
      severity: clean(action.severity, 12),
      status: clean(action.status, 12),
      title: clean(action.title, 80),
      problem: clean(action.problem, 160),
      eventIds: action.eventIds.map((id) => clean(id, 120)).filter(Boolean).slice(0, 4),
      nextStep: { kind: clean(action.nextStep.kind, 32), label: clean(action.nextStep.label, 60) },
    })).filter((action) => action.id && action.title),
    commutes: input.commutes.slice(0, 24).map((commute) => ({
      fromEventId: clean(commute.fromEventId, 120),
      toEventId: clean(commute.toEventId, 120),
      mode: clean(commute.mode, 16),
      status: clean(commute.status, 24),
      availableMinutes: finite(commute.availableMinutes),
      routeMinutes: finite(commute.routeMinutes),
      bufferMinutes: finite(commute.bufferMinutes),
      remainingMinutes: finite(commute.remainingMinutes),
      latestDeparture: commute.latestDeparture ? clean(commute.latestDeparture, 40) : "",
      advice: clean(commute.advice, 160),
      reference: commute.reference === true,
      pending: commute.pending === true,
      source: clean(commute.source, 24),
    })).filter((commute) => commute.fromEventId && commute.toEventId && commute.status),
    bookings: input.bookings.slice(0, 20).map((booking) => ({
      id: clean(booking.id, 120),
      kind: clean(booking.kind, 24),
      title: clean(booking.title, 80),
      from: clean(booking.from, 80),
      to: clean(booking.to, 80),
      start: clean(booking.start, 40),
      end: clean(booking.end, 40),
      state: clean(booking.state, 24) || "confirmed",
      source: clean(booking.source, 24),
    })).filter((booking) => booking.id),
    trips: input.trips.slice(0, 6).map((trip) => ({
      id: clean(trip.id, 120),
      title: clean(trip.title, 80),
      cities: trip.cities.map((city) => clean(city, 40)).filter(Boolean).slice(0, 6),
      startDate: clean(trip.startDate, 10),
      endDate: clean(trip.endDate, 10),
      eventCount: Number.isFinite(trip.eventCount) ? Math.max(0, Math.floor(trip.eventCount)) : 0,
    })).filter((trip) => trip.id && trip.title),
  };
}
