/**
 * Context Builder (server side): accepts only the minimum workspace fields the
 * copilot needs, strips notes/emails, caps sizes and labels everything as
 * untrusted data. Mail bodies and full calendars are never part of this shape.
 */

const MAX_EVENTS = 24;
const MAX_PLACES = 50;
const MAX_BOOKINGS = 20;
const MAX_ACTIONS = 12;
const MAX_COMMUTES = 24;
const MAX_TRIPS = 6;

const text = (value, max = 120) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

const number = (value, min = -Infinity, max = Infinity) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

const iso = (value) => {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
};

const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

export class ContextError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ContextError";
    this.code = code;
    this.status = status;
  }
}

export function sanitizeCopilotContext(raw, { owner, now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object") throw new ContextError("invalid_context", "缺少工作区上下文");
  const suppliedOwner = text(raw.owner, 120);
  if (!owner) throw new ContextError("owner_required", "缺少账号标识");
  if (suppliedOwner && suppliedOwner !== owner)
    throw new ContextError("owner_mismatch", "上下文不属于当前账号", 403);

  const events = list(raw.events, MAX_EVENTS).flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const id = text(event.id, 120);
    const title = text(event.title, 80);
    const start = iso(event.start);
    const end = iso(event.end);
    if (!id || !title || !start || !end) return [];
    return [{
      id,
      title,
      start,
      end,
      allDay: event.allDay === true,
      placeName: text(event.placeName, 80),
      placeId: text(event.placeId, 120),
      source: text(event.source, 24) || "wayline",
      local: event.local === true,
      stale: event.stale === true,
    }];
  });

  const places = list(raw.places, MAX_PLACES).flatMap((place) => {
    if (!place || typeof place !== "object") return [];
    const id = text(place.id, 120);
    const name = text(place.name, 80);
    if (!id || !name) return [];
    return [{
      id,
      name,
      city: text(place.city, 40),
      address: text(place.address, 120),
      category: text(place.category, 24),
      lat: number(place.lat, -90, 90),
      lng: number(place.lng, -180, 180),
    }];
  });

  const bookings = list(raw.bookings, MAX_BOOKINGS).flatMap((booking) => {
    if (!booking || typeof booking !== "object") return [];
    const id = text(booking.id, 120);
    if (!id) return [];
    return [{
      id,
      kind: text(booking.kind, 24),
      title: text(booking.title, 80),
      from: text(booking.from, 80),
      to: text(booking.to, 80),
      start: iso(booking.start),
      end: iso(booking.end),
      state: text(booking.state, 24) || "confirmed",
      source: text(booking.source, 24),
    }];
  });

  const actions = list(raw.actions, MAX_ACTIONS).flatMap((action) => {
    if (!action || typeof action !== "object") return [];
    const id = text(action.id, 120);
    const title = text(action.title, 80);
    if (!id || !title) return [];
    return [{
      id,
      type: text(action.type, 32),
      severity: text(action.severity, 12),
      status: text(action.status, 12),
      title,
      problem: text(action.problem, 160),
      eventIds: list(action.eventIds, 4).map((id) => text(id, 120)).filter(Boolean),
      nextStep: {
        kind: text(action.nextStep?.kind, 32),
        label: text(action.nextStep?.label, 60),
      },
    }];
  });

  const commutes = list(raw.commutes, MAX_COMMUTES).flatMap((commute) => {
    if (!commute || typeof commute !== "object") return [];
    const fromEventId = text(commute.fromEventId, 120);
    const toEventId = text(commute.toEventId, 120);
    const mode = text(commute.mode, 16);
    const status = text(commute.status, 24);
    if (!fromEventId || !toEventId || !status) return [];
    return [{
      fromEventId,
      toEventId,
      mode,
      status,
      availableMinutes: number(commute.availableMinutes, 0, 10_080),
      routeMinutes: number(commute.routeMinutes, 0, 10_080),
      bufferMinutes: number(commute.bufferMinutes, 0, 1_440),
      remainingMinutes: number(commute.remainingMinutes, -10_080, 10_080),
      latestDeparture: iso(commute.latestDeparture),
      advice: text(commute.advice, 160),
      reference: commute.reference === true,
      pending: commute.pending === true,
      source: text(commute.source, 24),
    }];
  });

  const trips = list(raw.trips, MAX_TRIPS).flatMap((trip) => {
    if (!trip || typeof trip !== "object") return [];
    const id = text(trip.id, 120);
    const title = text(trip.title, 80);
    if (!id || !title) return [];
    return [{
      id,
      title,
      cities: list(trip.cities, 6).map((city) => text(city, 40)).filter(Boolean),
      startDate: text(trip.startDate, 10),
      endDate: text(trip.endDate, 10),
      eventCount: number(trip.eventCount, 0, 500) ?? 0,
    }];
  });

  return {
    kind: "wayline-workspace-context",
    untrusted: true,
    owner,
    revision: text(raw.revision, 200),
    activeCity: text(raw.activeCity, 40),
    now: new Date(now).toISOString(),
    events,
    places,
    bookings,
    actions,
    commutes,
    trips,
  };
}
