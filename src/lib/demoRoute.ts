import type { Place, RouteEvidence } from "./tripDomain";
import type { TravelMode } from "./todayMap";

function distanceKm(a: Place, b: Place) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const speed: Record<TravelMode, number> = { walking: 4.5, transit: 18, driving: 24, selfDrive: 24 };

export function demoRoute(from: Place, to: Place, mode: TravelMode, now = Date.now(), sameSpot = false): RouteEvidence {
  const km = sameSpot ? 0 : distanceKm(from, to);
  return {
    mode, source: "estimate", observedAt: now,
    minutes: Math.max(km === 0 ? 0 : 4, Math.round((km / speed[mode]) * 60) + (km === 0 ? 0 : 4)),
    points: [{ latitude: from.lat, longitude: from.lng }, { latitude: to.lat, longitude: to.lng }],
  };
}
