import type { Place } from "../types/place";
export function isSchedule(place: Place) {
  return place.tags.includes("日程助手");
}
export function samePlace(a: Place, b: Place) {
  if (a.id === b.id) return true;
  // Two meetings at the same venue are separate records, not duplicate locations.
  if (isSchedule(a) || isSchedule(b)) return false;
  const city = (s: string) => s.replace(/市$/, "");
  // Same-name branches across a city are distinct destinations.
  return a.name === b.name && city(a.city) === city(b.city) &&
    ((a.address.trim().length >= 6 && a.address.replace(/\s/g, "") === b.address.replace(/\s/g, "") && Math.abs(a.lat-b.lat)<.01 && Math.abs(a.lng-b.lng)<.01) ||
    Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lng - b.lng) < 0.001);
}
